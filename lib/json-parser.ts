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
  starttime?: string;
  time?: string;

  duration?: number | string;
  duration_minutes?: number | string;
  durationMinutes?: number | string;
  duration_seconds?: number | string;
  durationSeconds?: number | string;
  length?: number | string;

  transcript?: string;
  fullTranscript?: string;
  full_transcript?: string;
  fulltranscript?: string;
  text?: string;
  content?: string;
  body?: string;
  summary?: string;

  participants?: string[];
  speakers?: string[];
  attendees?: string[];

  clientName?: string;
  client_name?: string;
  clientname?: string;
  client?: string;

  todos?: string[];
  to_dos?: string[];
  action_items?: string[];
  actionItems?: string[];

  transcript_type?: string;
  transcriptType?: string;
  transcripttype?: string;
  transcript_summary?: string;
  transcriptSummary?: string;
  transcriptsummary?: string;

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
    // If already YYYY-MM-DD, use directly (avoids timezone shifts)
    const isoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    // Otherwise parse and extract date in local timezone
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }

  if (raw.timestamp) {
    const ts = typeof raw.timestamp === "number" ? raw.timestamp : parseInt(raw.timestamp);
    // Handle seconds vs milliseconds
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function extractTime(raw: RawRecording): string {
  const timeStr = raw.start_time || raw.startTime || raw.starttime || raw.time;

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
  const val =
    raw.duration_minutes ?? raw.durationMinutes ??
    raw.duration_seconds ?? raw.durationSeconds ??
    raw.duration ?? raw.length;

  if (val === undefined || val === null) return 1;

  const num = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(num)) return 1;

  // If the source field was explicitly seconds, convert
  if (raw.duration_seconds !== undefined || raw.durationSeconds !== undefined) {
    return Math.max(1, Math.round(num / 60));
  }

  // If the source field was explicitly minutes, use directly
  if (raw.duration_minutes !== undefined || raw.durationMinutes !== undefined) {
    return Math.max(1, Math.round(num));
  }

  // For generic "duration" / "length", guess: > 300 probably seconds
  if (num > 300) return Math.max(1, Math.round(num / 60));
  return Math.max(1, Math.round(num));
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

function extractFullTranscript(raw: RawRecording): string {
  return raw.fullTranscript || raw.full_transcript || raw.fulltranscript ||
    raw.transcript || raw.text || raw.content || raw.body || "";
}

function extractText(raw: RawRecording): string {
  return extractFullTranscript(raw) || raw.summary || "";
}

function extractClientName(raw: RawRecording): string | undefined {
  return raw.clientName || raw.client_name || raw.clientname || raw.client || undefined;
}

function extractTodos(raw: RawRecording): { id: string; text: string; done: boolean; source: string }[] {
  const todos = raw.todos || raw.to_dos || raw.action_items || raw.actionItems;
  if (!todos || !Array.isArray(todos)) return [];
  const source = extractTitle(raw);
  return todos.map((text, i) => ({
    id: `${generateId()}-todo-${i}`,
    text: typeof text === "string" ? text : String(text),
    done: false,
    source,
  }));
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

const VALID_TAGS: Tag[] = ["meeting", "call", "personal", "medical", "errand", "brainstorm", "interview", "discussion", "advertisement"];

function extractTags(raw: RawRecording, title: string, text: string): Tag[] {
  // First check transcript_type / type / category
  const typeStr = raw.transcript_type || raw.transcriptType || raw.transcripttype || raw.type || raw.category;
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
  const summary = raw.transcript_summary || raw.transcriptSummary || raw.transcriptsummary || raw.summary;
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
    fullTranscript: extractFullTranscript(raw) || undefined,
    participants: extractParticipants(raw),
    clientName: extractClientName(raw),
    tags: extractTags(raw, title, text),
    actionItems: extractTodos(raw),
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
