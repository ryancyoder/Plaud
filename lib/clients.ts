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
