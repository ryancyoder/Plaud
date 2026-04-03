import { Transcript, Tag } from "./types";

// Flexible JSON parser that handles many possible Plaud export shapes.
// Accepts a single recording object, an array, or an object with a
// recordings/transcripts/data array property.

interface RawRecording {
  // Various possible field names Plaud might use
  title?: string;
  name?: string;
  file_name?: string;
  fileName?: string;

  date?: string;
  recording_date?: string;
  recordingDate?: string;
  created_at?: string;
  createdAt?: string;
  timestamp?: string | number;

  start_time?: string;
  startTime?: string;
  time?: string;

  duration?: number;
  duration_minutes?: number;
  durationMinutes?: number;
  duration_seconds?: number;
  durationSeconds?: number;
  length?: number;

  transcript?: string;
  text?: string;
  content?: string;
  body?: string;
  summary?: string;

  participants?: string[];
  speakers?: string[];
  attendees?: string[];

  transcript_type?: string;
  transcriptType?: string;
  transcript_summary?: string;
  transcriptSummary?: string;

  tags?: string[];
  category?: string;
  type?: string;
}

function generateId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractDate(raw: RawRecording): string {
  const dateStr =
    raw.date ||
    raw.recording_date ||
    raw.recordingDate ||
    raw.created_at ||
    raw.createdAt;

  if (dateStr) {
    // Handle ISO strings, "YYYY-MM-DD", "MM/DD/YYYY", etc.
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  if (raw.timestamp) {
    const ts = typeof raw.timestamp === "number" ? raw.timestamp : parseInt(raw.timestamp);
    // Handle seconds vs milliseconds
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }

  return new Date().toISOString().split("T")[0];
}

function extractTime(raw: RawRecording): string {
  const timeStr = raw.start_time || raw.startTime || raw.time;

  if (timeStr) {
    // "14:30", "2:30 PM", "14:30:00", etc.
    const match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (match) {
      let h = parseInt(match[1]);
      const m = match[2];
      // Handle AM/PM
      if (/pm/i.test(timeStr) && h < 12) h += 12;
      if (/am/i.test(timeStr) && h === 12) h = 0;
      return `${h.toString().padStart(2, "0")}:${m}`;
    }
  }

  // Try to extract time from date/timestamp fields
  const dateStr = raw.created_at || raw.createdAt || raw.date;
  if (dateStr && dateStr.includes("T")) {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    }
  }

  if (raw.timestamp) {
    const ts = typeof raw.timestamp === "number" ? raw.timestamp : parseInt(raw.timestamp);
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
    }
  }

  return "00:00";
}

function extractDuration(raw: RawRecording): number {
  if (raw.duration_minutes || raw.durationMinutes) {
    return raw.duration_minutes || raw.durationMinutes || 1;
  }
  if (raw.duration_seconds || raw.durationSeconds) {
    return Math.max(1, Math.round((raw.duration_seconds || raw.durationSeconds || 60) / 60));
  }
  if (raw.duration) {
    // Guess: if > 300, probably seconds; otherwise minutes
    return raw.duration > 300 ? Math.max(1, Math.round(raw.duration / 60)) : Math.max(1, raw.duration);
  }
  if (raw.length) {
    return raw.length > 300 ? Math.max(1, Math.round(raw.length / 60)) : Math.max(1, raw.length);
  }
  return 1;
}

function extractTitle(raw: RawRecording): string {
  return (
    raw.title ||
    raw.name ||
    raw.file_name?.replace(/\.\w+$/, "") ||
    raw.fileName?.replace(/\.\w+$/, "") ||
    `Recording - ${extractDate(raw)}`
  );
}

function extractText(raw: RawRecording): string {
  return raw.transcript || raw.text || raw.content || raw.body || raw.summary || "";
}

function extractParticipants(raw: RawRecording): string[] {
  return raw.participants || raw.speakers || raw.attendees || [];
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

function guessTag(title: string, text: string): Tag[] {
  const lower = (title + " " + text).toLowerCase();
  const tags: Tag[] = [];
  if (lower.includes("call") || lower.includes("phone")) tags.push("call");
  if (lower.includes("meeting") || lower.includes("standup") || lower.includes("sync"))
    tags.push("meeting");
  if (lower.includes("interview")) tags.push("interview");
  if (lower.includes("doctor") || lower.includes("medical") || lower.includes("dentist"))
    tags.push("medical");
  if (lower.includes("errand") || lower.includes("grocery") || lower.includes("store"))
    tags.push("errand");
  if (lower.includes("brainstorm") || lower.includes("idea")) tags.push("brainstorm");
  if (lower.includes("personal") || lower.includes("lunch") || lower.includes("dinner"))
    tags.push("personal");
  if (tags.length === 0) tags.push("meeting");
  return tags;
}

const VALID_TAGS: Tag[] = ["meeting", "call", "personal", "medical", "errand", "brainstorm", "interview"];

function extractTags(raw: RawRecording, title: string, text: string): Tag[] {
  // First check transcript_type / type / category
  const typeStr = raw.transcript_type || raw.transcriptType || raw.type || raw.category;
  if (typeStr) {
    const normalized = typeStr.toLowerCase().trim();
    if (VALID_TAGS.includes(normalized as Tag)) {
      return [normalized as Tag];
    }
    // Try mapping common synonyms
    const synonyms: Record<string, Tag> = {
      "phone call": "call",
      "phone": "call",
      "appointment": "medical",
      "doctor": "medical",
      "dentist": "medical",
      "standup": "meeting",
      "sync": "meeting",
      "1:1": "meeting",
      "one on one": "meeting",
      "catch up": "personal",
      "lunch": "personal",
      "dinner": "personal",
      "shopping": "errand",
      "grocery": "errand",
      "idea": "brainstorm",
    };
    if (synonyms[normalized]) {
      return [synonyms[normalized]];
    }
  }

  // Then check tags array
  if (raw.tags) {
    const matched = raw.tags
      .map((t) => t.toLowerCase().trim())
      .filter((t): t is Tag => VALID_TAGS.includes(t as Tag));
    if (matched.length > 0) return matched;
  }

  // Fall back to guessing from content
  return guessTag(title, text);
}

function extractSummary(raw: RawRecording): string {
  // Prefer explicit summary fields over truncating transcript
  const summary = raw.transcript_summary || raw.transcriptSummary || raw.summary;
  if (summary) return summary;
  return truncate(extractText(raw), 300);
}

function rawToTranscript(raw: RawRecording): Transcript {
  const title = extractTitle(raw);
  const text = extractText(raw);

  return {
    id: generateId(),
    title,
    date: extractDate(raw),
    startTime: extractTime(raw),
    duration: extractDuration(raw),
    summary: extractSummary(raw),
    participants: extractParticipants(raw),
    tags: extractTags(raw, title, text),
    actionItems: [],
    calls: [],
    errands: [],
  };
}

export function parseJsonTranscripts(jsonString: string): Transcript[] {
  const parsed = JSON.parse(jsonString);

  // Single recording object
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    // Check if it has a wrapper with an array inside
    const arrayKey = Object.keys(parsed).find((k) =>
      Array.isArray(parsed[k])
    );

    if (arrayKey) {
      return (parsed[arrayKey] as RawRecording[]).map(rawToTranscript);
    }

    // It's a single recording
    return [rawToTranscript(parsed as RawRecording)];
  }

  // Array of recordings
  if (Array.isArray(parsed)) {
    return parsed.map(rawToTranscript);
  }

  throw new Error("Unrecognized JSON format");
}

export function isJsonString(text: string): boolean {
  const trimmed = text.trim();
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
}
