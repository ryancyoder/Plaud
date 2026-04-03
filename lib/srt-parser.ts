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
 * Parse an SRT file into a single transcript (legacy).
 */
export function srtToTranscript(
  fileName: string,
  content: string,
  recordingStart: Date,
  gapThreshold?: number,
): ParsedTranscript {
  const segments = srtToSegments(fileName, content, recordingStart, gapThreshold);
  if (segments.length === 0) {
    throw new Error("No valid SRT entries found in file");
  }
  return segments[0];
}

/**
 * Group SRT entries into segments based on silence gaps between them.
 * Each SRT entry stays whole — entries are grouped when the gap between
 * consecutive entries is less than `gapThresholdSeconds`.
 * A gap >= threshold starts a new group/transcript.
 * Title is the first line of text from the first entry in the group.
 */
export function srtToSegments(
  fileName: string,
  content: string,
  recordingStart: Date,
  gapThresholdSeconds = 180,
): ParsedTranscript[] {
  let entries = parseSrt(content);
  if (entries.length === 0) return [];

  entries = applyAbsoluteTimestamps(entries, recordingStart);

  // Group entries by gap threshold
  const groups: SrtEntry[][] = [];
  let currentGroup: SrtEntry[] = [entries[0]];

  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const curr = entries[i];
    const gap = curr.startSeconds - prev.endSeconds;

    if (gap >= gapThresholdSeconds) {
      groups.push(currentGroup);
      currentGroup = [curr];
    } else {
      currentGroup.push(curr);
    }
  }
  groups.push(currentGroup);

  // Convert each group into a ParsedTranscript
  return groups.map((groupEntries) => {
    const first = groupEntries[0];
    const last = groupEntries[groupEntries.length - 1];
    const durationSeconds = last.endSeconds - first.startSeconds;
    const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));
    const segStart = first.absoluteStart || recordingStart;

    // Extract unique speakers
    const speakerPattern = /^([A-Z][a-zA-Z\s]+?):\s/;
    const speakers = new Set<string>();
    for (const entry of groupEntries) {
      const match = entry.text.match(speakerPattern);
      if (match) speakers.add(match[1].trim());
    }

    // Title = first line of text from first entry
    const firstLine = first.text.split("\n")[0].trim();
    const title = firstLine.length > 0 ? firstLine : formatTimeHHMM(segStart);

    const fullText = groupEntries.map((e) => e.text).join("\n\n");

    return {
      fileName,
      date: formatDateYMD(segStart),
      startTime: formatTimeHHMM(segStart),
      duration: durationMinutes,
      fullText,
      entries: groupEntries,
      participants: Array.from(speakers),
      segmentTitle: title,
    };
  });
}
