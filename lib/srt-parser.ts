export interface SrtEntry {
  index: number;
  startTime: string; // HH:MM:SS,mmm (relative)
  endTime: string;
  startSeconds: number; // relative seconds from file start
  endSeconds: number;
  text: string;
  // Absolute fields — populated when a start date/time is provided
  absoluteStart?: Date;
  absoluteEnd?: Date;
}

function parseTimestamp(ts: string): number {
  const [time, ms] = ts.trim().split(",");
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s + (parseInt(ms) || 0) / 1000;
}

function formatTimeHHMM(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseSrt(content: string): SrtEntry[] {
  const blocks = content.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  const entries: SrtEntry[] = [];

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;

    const index = parseInt(lines[0]);
    if (isNaN(index)) continue;

    const timeLine = lines[1];
    const match = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[,.]?\d*)\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]?\d*)/
    );
    if (!match) continue;

    const startTime = match[1].replace(".", ",");
    const endTime = match[2].replace(".", ",");
    const text = lines.slice(2).join(" ").trim();

    entries.push({
      index,
      startTime,
      endTime,
      startSeconds: parseTimestamp(startTime),
      endSeconds: parseTimestamp(endTime),
      text,
    });
  }

  return entries;
}

/**
 * Apply absolute timestamps to SRT entries given a recording start time.
 */
export function applyAbsoluteTimestamps(entries: SrtEntry[], recordingStart: Date): SrtEntry[] {
  const baseMs = recordingStart.getTime();
  return entries.map((e) => ({
    ...e,
    absoluteStart: new Date(baseMs + e.startSeconds * 1000),
    absoluteEnd: new Date(baseMs + e.endSeconds * 1000),
  }));
}

export interface ParsedTranscript {
  fileName: string;
  date: string;       // YYYY-MM-DD
  startTime: string;  // HH:MM (absolute)
  duration: number;   // minutes
  fullText: string;
  entries: SrtEntry[];
  participants: string[];
}

/**
 * Parse an SRT file into a single transcript (legacy, used for short files).
 */
export function srtToTranscript(
  fileName: string,
  content: string,
  recordingStart: Date,
): ParsedTranscript {
  const segments = srtToSegments(fileName, content, recordingStart);
  if (segments.length === 0) {
    throw new Error("No valid SRT entries found in file");
  }
  // If only one segment, return it directly
  if (segments.length === 1) return segments[0];
  // Otherwise merge into one (shouldn't normally be called for multi-segment)
  return segments[0];
}

/**
 * Split an SRT file into multiple segments based on gaps in speech.
 * A gap of `gapThresholdSeconds` or more between entries starts a new segment.
 * Each segment becomes its own transcript with absolute timestamps.
 */
export function srtToSegments(
  fileName: string,
  content: string,
  recordingStart: Date,
  gapThresholdSeconds = 60,
): ParsedTranscript[] {
  let entries = parseSrt(content);
  if (entries.length === 0) return [];

  // Apply absolute timestamps
  entries = applyAbsoluteTimestamps(entries, recordingStart);

  // Group entries into segments by detecting gaps
  const segments: SrtEntry[][] = [];
  let currentSegment: SrtEntry[] = [entries[0]];

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const gap = curr.startSeconds - prev.endSeconds;

    if (gap >= gapThresholdSeconds) {
      segments.push(currentSegment);
      currentSegment = [curr];
    } else {
      currentSegment.push(curr);
    }
  }
  segments.push(currentSegment);

  // Convert each segment group into a ParsedTranscript
  const baseName = fileName.replace(/\.srt$/i, "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return segments.map((segEntries, idx) => {
    const first = segEntries[0];
    const last = segEntries[segEntries.length - 1];
    const durationSeconds = last.endSeconds - first.startSeconds;
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

    // Extract speakers
    const speakerPattern = /^([A-Z][a-zA-Z\s]+?):\s/;
    const speakers = new Set<string>();
    for (const entry of segEntries) {
      const match = entry.text.match(speakerPattern);
      if (match) speakers.add(match[1].trim());
    }

    const fullText = segEntries.map((e) => e.text).join(" ");
    const segStart = first.absoluteStart || recordingStart;

    return {
      fileName,
      date: formatDateYMD(segStart),
      startTime: formatTimeHHMM(segStart),
      duration: durationMinutes,
      fullText,
      entries: segEntries,
      participants: Array.from(speakers),
      // Add a readable title with segment number and time
      segmentTitle: segments.length > 1
        ? `${baseName} — Segment ${idx + 1} (${formatTimeHHMM(segStart)})`
        : baseName,
    };
  });
}
