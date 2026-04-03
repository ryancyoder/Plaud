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
 * Parse an SRT file into a transcript.
 * @param fileName - original file name
 * @param content - SRT file content
 * @param recordingStart - absolute date/time the recording began
 */
export function srtToTranscript(
  fileName: string,
  content: string,
  recordingStart: Date,
): ParsedTranscript {
  let entries = parseSrt(content);
  if (entries.length === 0) {
    throw new Error("No valid SRT entries found in file");
  }

  // Apply absolute timestamps
  entries = applyAbsoluteTimestamps(entries, recordingStart);

  const firstEntry = entries[0];
  const lastEntry = entries[entries.length - 1];
  const durationSeconds = lastEntry.endSeconds - firstEntry.startSeconds;
  const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

  // Extract unique speaker names (lines starting with "Speaker:" or "Name:" patterns)
  const speakerPattern = /^([A-Z][a-zA-Z\s]+?):\s/;
  const speakers = new Set<string>();
  for (const entry of entries) {
    const match = entry.text.match(speakerPattern);
    if (match) speakers.add(match[1].trim());
  }

  const fullText = entries.map((e) => e.text).join(" ");

  return {
    fileName,
    date: formatDateYMD(recordingStart),
    startTime: formatTimeHHMM(recordingStart),
    duration: durationMinutes,
    fullText,
    entries,
    participants: Array.from(speakers),
  };
}
