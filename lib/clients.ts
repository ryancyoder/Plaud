"use client";

import { Client, Transcript } from "./types";

const CLIENTS_KEY = "plaud-clients";

export function loadClients(): Client[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(CLIENTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export function saveClients(clients: Client[]): void {
  localStorage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

function generateId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addClient(name: string, company?: string, type: "client" | "contact" = "client"): Client {
  const clients = loadClients();
  const existing = clients.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;

  const client: Client = {
    id: generateId(),
    name,
    company,
    type,
    transcriptCount: 0,
  };
  clients.push(client);
  saveClients(clients);
  return client;
}

export function deleteClient(id: string): void {
  const clients = loadClients().filter((c) => c.id !== id);
  saveClients(clients);
}

export function updateClient(id: string, updates: Partial<Pick<Client, "name" | "company" | "type">>): void {
  const clients = loadClients();
  const client = clients.find((c) => c.id === id);
  if (client) {
    Object.assign(client, updates);
    saveClients(clients);
  }
}

// Match participant names from transcripts against client roster
function normalizeForMatch(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z\s]/g, "");
}

export function matchTranscriptToClients(transcript: Transcript, clients: Client[]): Client[] {
  const matched: Client[] = [];

  for (const client of clients) {
    const clientNorm = normalizeForMatch(client.name);
    const clientParts = clientNorm.split(/\s+/);

    // Check participants
    for (const participant of transcript.participants) {
      const partNorm = normalizeForMatch(participant);
      // Full match or last-name match
      if (
        partNorm === clientNorm ||
        partNorm.includes(clientNorm) ||
        clientNorm.includes(partNorm) ||
        (clientParts.length > 1 && partNorm.includes(clientParts[clientParts.length - 1]))
      ) {
        matched.push(client);
        break;
      }
    }

    // Check clientName field
    if (transcript.clientName) {
      const cnNorm = normalizeForMatch(transcript.clientName);
      if (cnNorm === clientNorm || cnNorm.includes(clientNorm) || clientNorm.includes(cnNorm)) {
        if (!matched.find((m) => m.id === client.id)) {
          matched.push(client);
        }
      }
    }
  }

  return matched;
}

// Auto-discover new clients from transcript participants
export function autoDiscoverClients(transcripts: Transcript[]): string[] {
  const existingClients = loadClients();
  const existingNames = new Set(existingClients.map((c) => normalizeForMatch(c.name)));
  const discovered = new Set<string>();

  for (const t of transcripts) {
    for (const p of t.participants) {
      const norm = normalizeForMatch(p);
      if (norm && !existingNames.has(norm) && !discovered.has(norm)) {
        discovered.add(p.trim()); // keep original casing
      }
    }
    if (t.clientName) {
      const norm = normalizeForMatch(t.clientName);
      if (norm && !existingNames.has(norm) && !discovered.has(norm)) {
        discovered.add(t.clientName.trim());
      }
    }
  }

  return Array.from(discovered);
}

// Get transcripts filtered by client
export function getTranscriptsForClient(transcripts: Transcript[], client: Client): Transcript[] {
  const clientNorm = normalizeForMatch(client.name);
  const clientParts = clientNorm.split(/\s+/);

  return transcripts.filter((t) => {
    // Check participants
    for (const participant of t.participants) {
      const partNorm = normalizeForMatch(participant);
      if (
        partNorm === clientNorm ||
        partNorm.includes(clientNorm) ||
        clientNorm.includes(partNorm) ||
        (clientParts.length > 1 && partNorm.includes(clientParts[clientParts.length - 1]))
      ) {
        return true;
      }
    }
    // Check clientName
    if (t.clientName) {
      const cnNorm = normalizeForMatch(t.clientName);
      if (cnNorm === clientNorm || cnNorm.includes(clientNorm) || clientNorm.includes(cnNorm)) {
        return true;
      }
    }
    return false;
  });
}
