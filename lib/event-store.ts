"use client";

import { AppEvent, EventType, Attachment } from "./types";
import { srtToSegments, ParsedTranscript } from "./srt-parser";

const EVENTS_KEY = "plaud-events";
const MIGRATED_KEY = "plaud-events-migrated";

// --- Core CRUD ---

function generateId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "...";
}

export function loadEvents(): AppEvent[] {
  if (typeof window === "undefined") return [];
  migrateIfNeeded();
  const stored = localStorage.getItem(EVENTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveEvents(events: AppEvent[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export function addEvent(event: Omit<AppEvent, "id">): AppEvent {
  const events = loadEvents();
  const full: AppEvent = { ...event, id: generateId() };
  events.push(full);
  saveEvents(events);
  return full;
}

export function updateEvent(id: string, updates: Partial<AppEvent>): void {
  const events = loadEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx >= 0) {
    events[idx] = { ...events[idx], ...updates };
    saveEvents(events);
  }
}

export function deleteEvent(id: string): void {
  const events = loadEvents().filter((e) => e.id !== id);
  saveEvents(events);
}

export function deleteEventsForClient(clientId: string): void {
  const events = loadEvents().filter((e) => e.clientId !== clientId);
  saveEvents(events);
}

// --- Queries ---

export function getEventsForClient(clientId: string): AppEvent[] {
  return loadEvents()
    .filter((e) => e.clientId === clientId)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
}

export function getMentionsForClient(clientName: string): AppEvent[] {
  const lower = clientName.toLowerCase();
  return loadEvents()
    .filter((e) => e.mentions?.some((m) => m.toLowerCase() === lower))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getEventsForDate(date: string): AppEvent[] {
  return loadEvents()
    .filter((e) => e.date === date)
    .sort((a, b) => (a.startTime || "00:00").localeCompare(b.startTime || "00:00"));
}

export function getRecordingEvents(): AppEvent[] {
  return loadEvents()
    .filter((e) => e.type === "recording")
    .sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || "").localeCompare(a.startTime || ""));
}

export function getUnassignedEvents(): AppEvent[] {
  return loadEvents().filter((e) => !e.clientId);
}

export function getPhotosForClient(clientId: string): { event: AppEvent; attachment: Attachment }[] {
  const events = getEventsForClient(clientId);
  const photos: { event: AppEvent; attachment: Attachment }[] = [];
  for (const ev of events) {
    if (ev.attachments) {
      for (const att of ev.attachments) {
        if (att.mimeType.startsWith("image/")) {
          photos.push({ event: ev, attachment: att });
        }
      }
    }
  }
  return photos.sort((a, b) => a.event.date.localeCompare(b.event.date));
}

// --- SRT Import ---

export function importParsedSegments(segments: ParsedTranscript[]): AppEvent[] {
  if (segments.length === 0) return [];

  const newEvents: AppEvent[] = segments.map((seg) => ({
    id: generateId(),
    type: "recording" as EventType,
    date: seg.date,
    startTime: seg.startTime,
    duration: seg.duration,
    label: (seg as { segmentTitle?: string }).segmentTitle || seg.fileName,
    summary: truncate(seg.fullText, 300),
    fullTranscript: seg.fullText,
    participants: seg.participants,
    tags: [],
  }));

  const events = loadEvents();
  events.push(...newEvents);
  saveEvents(events);

  return newEvents;
}

export function importFromText(text: string, recordingStart?: Date, gapThreshold?: number): AppEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // SRT
  const looksLikeSrt = /\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(trimmed);
  if (looksLikeSrt) {
    const start = recordingStart || new Date();
    const segments = srtToSegments("Pasted Transcript", trimmed, start, gapThreshold);
    if (segments.length === 0) return [];
    return importParsedSegments(segments);
  }

  // Plain text note
  const now = new Date();
  const event: AppEvent = {
    id: generateId(),
    type: "note",
    date: now.toISOString().split("T")[0],
    startTime: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
    duration: 1,
    label: `Pasted Note - ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    summary: truncate(trimmed, 300),
    fullTranscript: trimmed,
  };

  const events = loadEvents();
  events.push(event);
  saveEvents(events);
  return [event];
}

// --- Migration from old format ---

function migrateIfNeeded(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(MIGRATED_KEY)) return;

  const newEvents: AppEvent[] = [];

  // Migrate old transcripts → recording events
  const oldTranscripts = localStorage.getItem("plaud-transcripts");
  if (oldTranscripts) {
    try {
      const transcripts = JSON.parse(oldTranscripts) as Array<{
        id: string; title: string; date: string; startTime: string;
        duration: number; summary: string; fullTranscript?: string;
        participants: string[]; clientName?: string; tags: string[];
        attachments?: Attachment[]; pinned?: boolean;
      }>;
      for (const t of transcripts) {
        newEvents.push({
          id: t.id,
          type: "recording",
          date: t.date,
          startTime: t.startTime,
          duration: t.duration,
          label: t.title,
          summary: t.summary,
          fullTranscript: t.fullTranscript,
          participants: t.participants || [],
          tags: (t.tags || []) as AppEvent["tags"],
          attachments: t.attachments,
          // If the transcript had a clientName, store it as a mention for now
          mentions: t.clientName ? [t.clientName] : undefined,
        });
      }
    } catch { /* ignore corrupt data */ }
  }

  // Migrate old client events → events
  const oldClientEvents = localStorage.getItem("plaud-client-events");
  if (oldClientEvents) {
    try {
      const clientEvents = JSON.parse(oldClientEvents) as Array<{
        id: string; clientId: string; type: string;
        date: string; label: string; auto?: boolean; photoUrl?: string;
      }>;
      for (const ce of clientEvents) {
        // Skip if this ID already exists (from recording migration)
        if (newEvents.some((e) => e.id === ce.id)) continue;
        const event: AppEvent = {
          id: ce.id,
          type: ce.type as EventType,
          clientId: ce.clientId,
          date: ce.date.includes("T") ? ce.date.split("T")[0] : ce.date,
          label: ce.label,
          auto: ce.auto,
        };
        // Migrate photo events with photoUrl → attachment
        if (ce.type === "photo" && ce.photoUrl) {
          event.attachments = [{
            id: `att-${ce.id}`,
            name: ce.label,
            type: "photo",
            mimeType: "image/jpeg",
            dataUrl: ce.photoUrl,
            timestamp: ce.date,
          }];
        }
        newEvents.push(event);
      }
    } catch { /* ignore corrupt data */ }
  }

  if (newEvents.length > 0) {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(newEvents));
  }

  localStorage.setItem(MIGRATED_KEY, "1");
}
