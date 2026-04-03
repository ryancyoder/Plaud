export interface SrtEntry {
  index: number;
  startTime: string; // HH:MM:SS,mmm
  endTime: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

function parseTimestamp(ts: string): number {
  const [time, ms] = ts.trim().split(",");
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + s + (parseInt(ms) || 0) / 1000;
}

function formatTimeFromSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
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

export interface ParsedTranscript {
  fileName: string;
  date: string;
  startTime: string;
  duration: number; // minutes
  fullText: string;
  entries: SrtEntry[];
  participants: string[];
}

export function srtToTranscript(
  fileName: string,
  content: string,
  fileDate?: Date
): ParsedTranscript {
  const entries = parseSrt(content);
  if (entries.length === 0) {
    throw new Error("No valid SRT entries found in file");
  }

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

  // Try to extract date from filename first (e.g. "2026-04-03_meeting.srt", "meeting_20260403.srt")
  let date: string | null = null;
  const isoMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    date = isoMatch[1];
  } else {
    const compactMatch = fileName.match(/(\d{4})(\d{2})(\d{2})/);
    if (compactMatch) {
      date = `${compactMatch[1]}-${compactMatch[2]}-${compactMatch[3]}`;
    }
  }
  if (!date && fileDate) {
    date = fileDate.toISOString().split("T")[0];
  }
  if (!date) {
    date = new Date().toISOString().split("T")[0];
  }

  return {
    fileName,
    date,
    startTime: formatTimeFromSeconds(firstEntry.startSeconds),
    duration: durationMinutes,
    fullText,
    entries,
    participants: Array.from(speakers),
  };
}
