"use client";

import { Client, ClientStatus } from "./types";

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
  };
  clients.push(client);
  saveClients(clients);
  return client;
}

export function deleteClient(id: string): void {
  const clients = loadClients().filter((c) => c.id !== id);
  saveClients(clients);
}

export function updateClientStatus(id: string, status: ClientStatus): void {
  const clients = loadClients();
  const client = clients.find((c) => c.id === id);
  if (client) {
    client.status = status;
    saveClients(clients);
  }
}

export function updateClient(id: string, updates: Partial<Omit<Client, "id">>): void {
  const clients = loadClients();
  const client = clients.find((c) => c.id === id);
  if (client) {
    Object.assign(client, updates);
    saveClients(clients);
  }
}

/**
 * Geocode a client's address to lat/lng if they have an address but no coordinates.
 * Call this after updating a client's address.
 */
export async function geocodeClientAddress(id: string): Promise<void> {
  const { forwardGeocode } = await import("./photo-matcher");
  const clients = loadClients();
  const client = clients.find((c) => c.id === id);
  if (!client || !client.address) return;
  // Skip if already geocoded and address hasn't changed
  if (client.lat != null && client.lng != null) return;
  const coords = await forwardGeocode(client.address);
  if (coords) {
    client.lat = coords.lat;
    client.lng = coords.lng;
    saveClients(clients);
  }
}

/**
 * Geocode all clients that have addresses but no coordinates.
 */
export async function geocodeAllClients(): Promise<number> {
  const { forwardGeocode } = await import("./photo-matcher");
  const clients = loadClients();
  let updated = 0;
  for (const client of clients) {
    if (client.address && (client.lat == null || client.lng == null)) {
      const coords = await forwardGeocode(client.address);
      if (coords) {
        client.lat = coords.lat;
        client.lng = coords.lng;
        updated++;
      }
      // Rate limit: Nominatim asks for 1 req/sec
      await new Promise((r) => setTimeout(r, 1100));
    }
  }
  if (updated > 0) saveClients(clients);
  return updated;
}
