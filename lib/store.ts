"use client";

import { Transcript, ActionItem, CallItem, ErrandItem, Tag } from "./types";
import { srtToTranscript } from "./srt-parser";
import { parseJsonTranscripts, isJsonString } from "./json-parser";

const STORAGE_KEY = "plaud-transcripts";
const LISTS_KEY = "plaud-lists";

interface StoredLists {
  actionItems: ActionItem[];
  callItems: CallItem[];
  errandItems: ErrandItem[];
}

function generateId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function guessTag(fileName: string, text: string): Tag[] {
  const lower = (fileName + " " + text).toLowerCase();
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
  if (tags.length === 0) tags.push("meeting");
  return tags;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

export function loadTranscripts(): Transcript[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveTranscripts(transcripts: Transcript[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transcripts));
}

export function loadLists(): StoredLists {
  if (typeof window === "undefined")
    return { actionItems: [], callItems: [], errandItems: [] };
  const stored = localStorage.getItem(LISTS_KEY);
  return stored
    ? JSON.parse(stored)
    : { actionItems: [], callItems: [], errandItems: [] };
}

export function saveLists(lists: StoredLists): void {
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists));
}

export async function importSrtFile(file: File, recordingStart: Date): Promise<Transcript> {
  const content = await file.text();
  const parsed = srtToTranscript(file.name, content, recordingStart);

  const title = file.name
    .replace(/\.srt$/i, "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const transcript: Transcript = {
    id: generateId(),
    title,
    date: parsed.date,
    startTime: parsed.startTime,
    duration: parsed.duration,
    summary: truncate(parsed.fullText, 300),
    fullTranscript: parsed.fullText,
    participants: parsed.participants,
    tags: guessTag(file.name, parsed.fullText),
    actionItems: [],
    calls: [],
    errands: [],
  };

  const transcripts = loadTranscripts();
  transcripts.push(transcript);
  saveTranscripts(transcripts);

  return transcript;
}

export async function importJsonFile(file: File): Promise<Transcript[]> {
  const content = await file.text();
  const parsed = parseJsonTranscripts(content);
  const transcripts = loadTranscripts();
  transcripts.push(...parsed);
  saveTranscripts(transcripts);
  return parsed;
}

export async function importFiles(files: FileList, recordingStart?: Date): Promise<Transcript[]> {
  const results: Transcript[] = [];
  for (const file of Array.from(files)) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".srt")) {
      const start = recordingStart || new Date(file.lastModified);
      const t = await importSrtFile(file, start);
      results.push(t);
    } else if (name.endsWith(".json")) {
      const ts = await importJsonFile(file);
      results.push(...ts);
    }
  }
  return results;
}

export function importFromText(text: string, recordingStart?: Date): Transcript[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // JSON
  if (isJsonString(trimmed)) {
    try {
      const parsed = parseJsonTranscripts(trimmed);
      const transcripts = loadTranscripts();
      transcripts.push(...parsed);
      saveTranscripts(transcripts);
      return parsed;
    } catch {
      // Fall through to other formats
    }
  }

  // SRT
  const looksLikeSrt = /\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(trimmed);
  if (looksLikeSrt) {
    const start = recordingStart || new Date();
    const parsed = srtToTranscript("Pasted Transcript", trimmed, start);
    const transcript: Transcript = {
      id: generateId(),
      title: `Pasted Recording - ${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      date: parsed.date,
      startTime: parsed.startTime,
      duration: parsed.duration,
      summary: truncate(parsed.fullText, 300),
      participants: parsed.participants,
      tags: guessTag("", parsed.fullText),
      actionItems: [],
      calls: [],
      errands: [],
    };

    const transcripts = loadTranscripts();
    transcripts.push(transcript);
    saveTranscripts(transcripts);
    return [transcript];
  }

  // Plain text
  const transcript: Transcript = {
    id: generateId(),
    title: `Pasted Note - ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    date: new Date().toISOString().split("T")[0],
    startTime: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    duration: 1,
    summary: truncate(trimmed, 300),
    participants: [],
    tags: guessTag("", trimmed),
    actionItems: [],
    calls: [],
    errands: [],
  };

  const transcripts = loadTranscripts();
  transcripts.push(transcript);
  saveTranscripts(transcripts);
  return [transcript];
}

export function deleteTranscript(id: string): void {
  const transcripts = loadTranscripts().filter((t) => t.id !== id);
  saveTranscripts(transcripts);
}

export function toggleActionItem(id: string): void {
  const lists = loadLists();
  const item = lists.actionItems.find((a) => a.id === id);
  if (item) {
    item.done = !item.done;
    saveLists(lists);
  }
}

export function toggleCallItem(id: string): void {
  const lists = loadLists();
  const item = lists.callItems.find((c) => c.id === id);
  if (item) {
    item.done = !item.done;
    saveLists(lists);
  }
}

export function toggleErrandItem(id: string): void {
  const lists = loadLists();
  const item = lists.errandItems.find((e) => e.id === id);
  if (item) {
    item.done = !item.done;
    saveLists(lists);
  }
}
