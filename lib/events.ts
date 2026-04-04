"use client";

import { ClientEvent, ClientEventType } from "./types";

const EVENTS_KEY = "plaud-client-events";

export function loadEvents(): ClientEvent[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(EVENTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveEvents(events: ClientEvent[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export function getEventsForClient(clientId: string): ClientEvent[] {
  return loadEvents()
    .filter((e) => e.clientId === clientId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function addEvent(
  clientId: string,
  type: ClientEventType,
  date: string,
  label: string,
  auto?: boolean,
  photoUrl?: string
): ClientEvent {
  const events = loadEvents();
  const event: ClientEvent = {
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    clientId,
    type,
    date,
    label,
    auto,
    photoUrl,
  };
  events.push(event);
  saveEvents(events);
  return event;
}

export function deleteEvent(eventId: string): void {
  const events = loadEvents().filter((e) => e.id !== eventId);
  saveEvents(events);
}

export function deleteEventsForClient(clientId: string): void {
  const events = loadEvents().filter((e) => e.clientId !== clientId);
  saveEvents(events);
}
