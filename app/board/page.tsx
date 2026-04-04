"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Client, ClientStatus, CLIENT_STATUSES, AppEvent, EventType, EVENT_TYPES } from "@/lib/types";
import { loadClients, saveClients, updateClientStatus, deleteClient, updateClient } from "@/lib/clients";
import { loadEvents, getEventsForClient, addEvent, deleteEvent, deleteEventsForClient } from "@/lib/event-store";
import { parseRfpClipboard, rfpToClientData } from "@/lib/rfp-parser";
import { formatDuration, getLastName } from "@/lib/utils";
import Link from "next/link";
import { getPersistedClientId, setPersistedClientId } from "@/lib/selected-client";

export default function BoardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedClient, setSelectedClientRaw] = useState<Client | null>(null);
  const setSelectedClient = useCallback((client: Client | null | ((prev: Client | null) => Client | null)) => {
    setSelectedClientRaw((prev) => {
      const next = typeof client === "function" ? client(prev) : client;
      setPersistedClientId(next?.id ?? null);
      return next;
    });
  }, []);
  const [mounted, setMounted] = useState(false);
  const [importToast, setImportToast] = useState<string | null>(null);

  // Drag state
  const [draggedClient, setDraggedClient] = useState<Client | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<ClientStatus | null>(null);

  // Touch drag state
  const touchDragClient = useRef<Client | null>(null);
  const touchCurrentColumn = useRef<ClientStatus | null>(null);
  const [touchDragActive, setTouchDragActive] = useState(false);
  const [touchPos, setTouchPos] = useState({ x: 0, y: 0 });
  const columnRefs = useRef<Map<ClientStatus, HTMLDivElement>>(new Map());

  useEffect(() => {
    const loaded = loadClients();
    setClients(loaded);
    setEvents(loadEvents());
    // Restore persisted client selection
    const persistedId = getPersistedClientId();
    if (persistedId) {
      const match = loaded.find((c) => c.id === persistedId);
      if (match) setSelectedClient(match);
    }
    setMounted(true);
  }, []);

  const getClientsForStatus = useCallback(
    (status: ClientStatus) => clients
      .filter((c) => (c.status || "lead") === status)
      .sort((a, b) => getLastName(a.name).localeCompare(getLastName(b.name))),
    [clients]
  );

  const handleDrop = useCallback((clientId: string, newStatus: ClientStatus) => {
    const client = clients.find((c) => c.id === clientId);
    const oldStatus = client?.status || "lead";
    if (oldStatus === newStatus) { setDraggedClient(null); setDragOverColumn(null); return; }
    updateClientStatus(clientId, newStatus);
    const statusLabel = CLIENT_STATUSES.find((s) => s.key === newStatus)?.label || newStatus;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    addEvent({ type: "status-change", clientId, date: dateStr, label: `Status changed to ${statusLabel}`, auto: true });
    setClients((prev) => prev.map((c) => c.id === clientId ? { ...c, status: newStatus } : c));
    setSelectedClient((prev) => prev?.id === clientId ? { ...prev, status: newStatus } : prev);
    setDraggedClient(null);
    setDragOverColumn(null);
  }, [clients]);

  // Touch handlers for iPad drag
  const handleTouchStart = useCallback((e: React.TouchEvent, client: Client) => {
    touchDragClient.current = client;
    setTouchDragActive(true);
    setTouchPos({ x: e.touches[0].clientX, y: e.touches[0].clientY });
    setDraggedClient(client);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchDragClient.current) return;
    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    setTouchPos({ x, y });

    // Determine which column we're over
    let foundColumn: ClientStatus | null = null;
    for (const [status, el] of columnRefs.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        foundColumn = status;
        break;
      }
    }
    touchCurrentColumn.current = foundColumn;
    setDragOverColumn(foundColumn);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (touchDragClient.current && touchCurrentColumn.current) {
      handleDrop(touchDragClient.current.id, touchCurrentColumn.current);
    }
    touchDragClient.current = null;
    touchCurrentColumn.current = null;
    setTouchDragActive(false);
    setDraggedClient(null);
    setDragOverColumn(null);
  }, [handleDrop]);

  const handleClipboardImport = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setImportToast("Clipboard is empty");
        setTimeout(() => setImportToast(null), 3000);
        return;
      }
      const rfp = parseRfpClipboard(text);
      const clientData = rfpToClientData(rfp);

      // Check for duplicate
      const existing = loadClients();
      const dupe = existing.find((c) => c.name.toLowerCase() === clientData.name.toLowerCase());
      if (dupe) {
        setImportToast(`"${dupe.name}" already exists`);
        setTimeout(() => setImportToast(null), 3000);
        setSelectedClient(dupe);
        return;
      }

      const newClient: Client = {
        ...clientData,
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      };
      const updated = [...existing, newClient];
      saveClients(updated);
      setClients(updated);
      setSelectedClient(newClient);
      setImportToast(`Imported "${newClient.name}"`);
      setTimeout(() => setImportToast(null), 3000);
    } catch (err) {
      setImportToast(err instanceof Error ? err.message : "Failed to parse clipboard");
      setTimeout(() => setImportToast(null), 4000);
    }
  }, []);

  const clientEvents = selectedClient
    ? events.filter((e) => e.clientId === selectedClient.id)
    : [];

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight">Plaud</h1>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95"
          >
            Dashboard
          </Link>
          <Link
            href="/map"
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95"
          >
            Map
          </Link>
          <span className="text-sm font-semibold">Client Board</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleClipboardImport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-blue-600 active:scale-95"
            title="Import client from clipboard (Outlook RFP)"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            </svg>
            Import from Clipboard
          </button>
          <span className="text-xs text-muted">
            {clients.length} client{clients.length !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {/* Top half: Kanban board */}
      <div className="h-[50vh] shrink-0 border-b border-border overflow-hidden">
        <div
          className="flex h-full overflow-x-auto"
          onTouchMove={touchDragActive ? handleTouchMove as unknown as React.TouchEventHandler : undefined}
          onTouchEnd={touchDragActive ? handleTouchEnd : undefined}
        >
          {CLIENT_STATUSES.map((col) => {
            const colClients = getClientsForStatus(col.key);
            const isOver = dragOverColumn === col.key;
            return (
              <div
                key={col.key}
                ref={(el) => { if (el) columnRefs.current.set(col.key, el); }}
                className={`flex-1 min-w-[130px] flex flex-col border-r border-border last:border-r-0 transition-colors ${
                  isOver ? "bg-accent/5" : ""
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverColumn(col.key);
                }}
                onDragLeave={() => setDragOverColumn(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const clientId = e.dataTransfer.getData("text/plain");
                  if (clientId) handleDrop(clientId, col.key);
                }}
              >
                {/* Column header */}
                <div className={`shrink-0 px-2.5 py-2 border-b ${col.color} border-opacity-50`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">{col.label}</span>
                    <span className="text-[10px] font-medium opacity-60">{colClients.length}</span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  {colClients.map((client) => {
                    const isSelected = selectedClient?.id === client.id;
                    const isDragging = draggedClient?.id === client.id;
                    const tCount = events.filter((e) => e.clientId === client.id).length;
                    return (
                      <div
                        key={client.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", client.id);
                          setDraggedClient(client);
                        }}
                        onDragEnd={() => {
                          setDraggedClient(null);
                          setDragOverColumn(null);
                        }}
                        onTouchStart={(e) => handleTouchStart(e, client)}
                        onClick={() => setSelectedClient(client)}
                        className={`px-2.5 py-2 rounded-lg border cursor-grab active:cursor-grabbing transition-all select-none ${
                          isDragging
                            ? "opacity-40 scale-95"
                            : isSelected
                              ? "border-accent bg-accent-light shadow-sm"
                              : "border-border bg-white hover:shadow-sm hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium truncate">
                            {getLastName(client.name)}{client.nextAction ? `: ${client.nextAction}` : ""}
                          </span>
                        </div>
                        {(client.company || tCount > 0) && (
                          <div className="flex items-center gap-2 mt-1">
                            {client.company && (
                              <span className="text-[9px] text-muted truncate">{client.company}</span>
                            )}
                            {tCount > 0 && (
                              <span className="text-[9px] text-muted">{tCount} rec</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Touch drag ghost */}
      {touchDragActive && draggedClient && (
        <div
          className="fixed z-50 pointer-events-none px-3 py-2 rounded-lg bg-white border border-accent shadow-lg text-xs font-medium"
          style={{ left: touchPos.x - 40, top: touchPos.y - 20 }}
        >
          {draggedClient.name}
        </div>
      )}

      {/* Bottom half: Client viewer */}
      <div className="flex-1 overflow-hidden">
        {selectedClient ? (
          <ClientViewer
            client={selectedClient}
            events={clientEvents}
            onDelete={(id) => {
              deleteClient(id);
              deleteEventsForClient(id);
              setClients((prev) => prev.filter((c) => c.id !== id));
              setSelectedClient(null);
            }}
            onUpdate={(id, updates) => {
              updateClient(id, updates);
              const updated = { ...selectedClient, ...updates };
              setSelectedClient(updated);
              setClients((prev) => prev.map((c) => c.id === id ? updated : c));
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-sm text-gray-300">
            Select a client to view details
          </div>
        )}
      </div>

      {/* Toast */}
      {importToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {importToast}
        </div>
      )}
    </div>
  );
}

// --- Client Viewer ---

function ClientViewer({ client, events, onDelete, onUpdate }: {
  client: Client;
  events: AppEvent[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Client>) => void;
}) {
  const recordings = events.filter((e) => e.type === "recording");
  const sorted = [...recordings].sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || "").localeCompare(a.startTime || ""));
  const statusInfo = CLIENT_STATUSES.find((s) => s.key === (client.status || "lead"));

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: client.name,
    company: client.company || "",
    phone: client.phone || "",
    email: client.email || "",
    address: client.address || "",
    lat: client.lat != null ? String(client.lat) : "",
    lng: client.lng != null ? String(client.lng) : "",
    notes: client.notes || "",
    nextAction: client.nextAction || "",
  });

  // Reset form when client changes
  useEffect(() => {
    setForm({
      name: client.name,
      company: client.company || "",
      phone: client.phone || "",
      email: client.email || "",
      address: client.address || "",
      lat: client.lat != null ? String(client.lat) : "",
      lng: client.lng != null ? String(client.lng) : "",
      notes: client.notes || "",
      nextAction: client.nextAction || "",
    });
    setEditing(false);
  }, [client.id, client.name, client.company, client.phone, client.email, client.address, client.lat, client.lng, client.notes, client.nextAction]);

  function handleSave() {
    const parsedLat = form.lat.trim() ? parseFloat(form.lat.trim()) : undefined;
    const parsedLng = form.lng.trim() ? parseFloat(form.lng.trim()) : undefined;
    const hasValidCoords = parsedLat != null && !isNaN(parsedLat) && parsedLng != null && !isNaN(parsedLng);

    onUpdate(client.id, {
      name: form.name.trim(),
      company: form.company.trim() || undefined,
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      lat: hasValidCoords ? parsedLat : undefined,
      lng: hasValidCoords ? parsedLng : undefined,
      notes: form.notes.trim() || undefined,
      nextAction: form.nextAction.trim() || undefined,
    });
    setEditing(false);

    // Only try background geocoding if address changed and no coordinates entered manually
    const addressChanged = (form.address.trim() || "") !== (client.address || "");
    if (addressChanged && form.address.trim() && !hasValidCoords) {
      import("@/lib/clients").then(({ geocodeClientAddress }) => {
        geocodeClientAddress(client.id);
      });
    }
  }

  const fieldClass = "w-full px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent";

  return (
    <div className="flex h-full overflow-hidden">
      {/* Client info sidebar */}
      <div className="w-64 shrink-0 border-r border-border p-4 overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold">{client.name}</h2>
            {client.company && <p className="text-[10px] text-muted">{client.company}</p>}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => {
                if (editing) {
                  // Cancel
                  setForm({
                    name: client.name,
                    company: client.company || "",
                    phone: client.phone || "",
                    email: client.email || "",
                    address: client.address || "",
                    lat: client.lat != null ? String(client.lat) : "",
                    lng: client.lng != null ? String(client.lng) : "",
                    notes: client.notes || "",
                    nextAction: client.nextAction || "",
                  });
                  setEditing(false);
                } else {
                  setEditing(true);
                }
              }}
              className={`p-1.5 rounded-lg shrink-0 ${editing ? "text-muted hover:text-foreground hover:bg-gray-100" : "text-gray-300 hover:text-accent hover:bg-blue-50"}`}
              title={editing ? "Cancel editing" : "Edit client"}
            >
              {editing ? (
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  <path d="m15 5 4 4" />
                </svg>
              )}
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete "${client.name}"?`)) onDelete(client.id);
              }}
              className="p-1.5 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 shrink-0"
              title="Delete client"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2.5">
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Name</span>
              <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={fieldClass} />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Company</span>
              <input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} className={fieldClass} placeholder="Optional" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Phone</span>
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={fieldClass} placeholder="555-555-5555" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Email</span>
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={fieldClass} placeholder="email@example.com" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase text-muted">Address</span>
                {form.address.trim() && (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(form.address.trim())}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-accent hover:underline flex items-center gap-0.5"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Look up in Maps
                  </a>
                )}
              </div>
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className={fieldClass} placeholder="123 Main St, City, State" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">GPS Coordinates</span>
              <div className="flex gap-2">
                <input
                  value={form.lat}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Auto-split "41.4834, -87.3456" pasted into lat field
                    const parts = v.split(/[,\s]+/).filter(Boolean);
                    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
                      setForm((f) => ({ ...f, lat: parts[0], lng: parts[1] }));
                    } else {
                      setForm((f) => ({ ...f, lat: v }));
                    }
                  }}
                  className={fieldClass}
                  placeholder="Latitude"
                  inputMode="decimal"
                />
                <input
                  value={form.lng}
                  onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                  className={fieldClass}
                  placeholder="Longitude"
                  inputMode="decimal"
                />
              </div>
              <p className="text-[9px] text-gray-400 mt-0.5">In Google Maps: tap the pin → copy the coordinates → paste above</p>
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Next Action</span>
              <input value={form.nextAction} onChange={(e) => setForm((f) => ({ ...f, nextAction: e.target.value }))} className={fieldClass} placeholder="e.g. Follow up, Send proposal" />
            </div>
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Notes</span>
              <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={4} className={`${fieldClass} resize-y`} />
            </div>
            <button
              onClick={handleSave}
              disabled={!form.name.trim()}
              className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98] disabled:opacity-40"
            >
              Save Changes
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted">Status</span>
              <div className={`mt-1 inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusInfo?.color || ""}`}>
                {statusInfo?.label || "Lead"}
              </div>
            </div>

            {client.nextAction && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted">Next Action</span>
                <p className="text-xs mt-0.5 font-medium text-accent">{client.nextAction}</p>
              </div>
            )}

            {client.phone && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted">Phone</span>
                <p className="text-xs mt-0.5">{client.phone}</p>
              </div>
            )}

            {client.email && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted">Email</span>
                <p className="text-xs mt-0.5 break-all">{client.email}</p>
              </div>
            )}

            {client.address && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase text-muted">Address</span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-accent hover:underline flex items-center gap-0.5"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    Open in Maps
                  </a>
                </div>
                <p className="text-xs mt-0.5">{client.address}</p>
              </div>
            )}

            {(client.lat != null && client.lng != null) && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase text-muted">GPS</span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${client.lat},${client.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-accent hover:underline"
                  >
                    View on map
                  </a>
                </div>
                <p className="text-xs mt-0.5 text-gray-500 font-mono">{client.lat.toFixed(5)}, {client.lng.toFixed(5)}</p>
              </div>
            )}

            {client.appointmentDate && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted">Appointment</span>
                <p className="text-xs mt-0.5">
                  {(() => {
                    try {
                      const d = new Date(client.appointmentDate);
                      return isNaN(d.getTime()) ? client.appointmentDate : d.toLocaleString("en-US", {
                        weekday: "short", month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                      });
                    } catch { return client.appointmentDate; }
                  })()}
                </p>
              </div>
            )}

            {client.notes && (
              <div>
                <span className="text-[10px] font-semibold uppercase text-muted">Notes</span>
                <p className="text-xs mt-0.5 leading-relaxed whitespace-pre-wrap text-gray-700">{client.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Timeline + Recordings */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        <ClientTimeline client={client} events={events} />

        {/* Recordings */}
        <div className="border-t border-border">
          <div className="px-4 py-2 border-b border-border bg-gray-50/50">
            <h3 className="text-[10px] font-bold uppercase text-muted">Recordings ({sorted.length})</h3>
          </div>
          {sorted.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-xs text-gray-300">
              No recordings associated with this client
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {sorted.map((ev) => (
                <div key={ev.id} className="px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0 w-14">
                      <div className="text-[10px] text-muted">{ev.date}</div>
                      <div className="text-xs font-semibold tabular-nums">{ev.startTime}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-medium truncate">{ev.label}</h4>
                      <p className="text-[10px] text-muted truncate mt-0.5">
                        {(ev.summary || "").length > 120 ? (ev.summary || "").slice(0, 120) + "..." : ev.summary || ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-[10px] text-muted">
                      {formatDuration(ev.duration || 0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Event Icon ---

function EventIcon({ type, size = 14 }: { type: EventType; size?: number }) {
  const s = String(size);
  const props = { width: s, height: s, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (type) {
    case "site-visit":
      return <svg {...props}><path d="M3 10.5L12 3l9 7.5" /><path d="M5 10v9a1 1 0 001 1h12a1 1 0 001-1v-9" /></svg>;
    case "phone-call":
      return <svg {...props}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>;
    case "text-message":
      return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>;
    case "email":
      return <svg {...props}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 7L2 7" /></svg>;
    case "status-change":
      return <svg {...props}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" /></svg>;
    case "proposal":
      return <svg {...props}><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>;
    case "contract":
      return <svg {...props}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" /><path d="M9 14l2 2 4-4" /></svg>;
    case "delivery":
      return <svg {...props}><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>;
    case "payment":
      return <svg {...props}><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /></svg>;
    case "note":
      return <svg {...props}><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>;
    case "recording":
      return <svg {...props}><path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3Z" /><path d="M19 10v2a7 7 0 01-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>;
    case "photo":
      return <svg {...props}><rect x="2" y="4" width="20" height="16" rx="2" /><circle cx="12" cy="13" r="3" /><path d="M8.5 4V2M15.5 4V2" /></svg>;
    default:
      return <svg {...props}><circle cx="12" cy="12" r="4" /></svg>;
  }
}

// --- Client Timeline ---

function ClientTimeline({ client, events: clientEvents }: { client: Client; events: AppEvent[] }) {
  const [localEvents, setLocalEvents] = useState<AppEvent[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<EventType>("phone-call");
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newLabel, setNewLabel] = useState("");

  useEffect(() => {
    refreshEvents();
  }, [client.id]);

  function refreshEvents() {
    const stored = getEventsForClient(client.id);
    // Auto-seed site-visit from appointmentDate if not already present
    if (client.appointmentDate && !stored.some((e) => e.type === "site-visit" && e.auto)) {
      const apptDate = client.appointmentDate.includes("T") ? client.appointmentDate.split("T")[0] : client.appointmentDate;
      addEvent({ type: "site-visit", clientId: client.id, date: apptDate, label: "Site Visit", auto: true });
      setLocalEvents(getEventsForClient(client.id));
    } else {
      setLocalEvents(stored);
    }
  }

  // Use clientEvents passed from parent (already filtered) merged with any local-only events
  const allEvents = useMemo(() => {
    // Dedupe: prefer clientEvents, add any localEvents not already present
    const ids = new Set(clientEvents.map((e) => e.id));
    const extra = localEvents.filter((e) => !ids.has(e.id));
    return [...clientEvents, ...extra].sort((a, b) => a.date.localeCompare(b.date));
  }, [localEvents, clientEvents]);

  function handleAdd() {
    if (!newLabel.trim()) return;
    addEvent({ type: newType, clientId: client.id, date: newDate, label: newLabel.trim() });
    setNewLabel("");
    setShowAdd(false);
    refreshEvents();
  }

  function handleDelete(eventId: string) {
    deleteEvent(eventId);
    refreshEvents();
  }

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return iso; }
  };

  const eventTypeColors: Record<EventType, string> = {
    "site-visit": "text-green-600 bg-green-50 border-green-200",
    "phone-call": "text-blue-600 bg-blue-50 border-blue-200",
    "text-message": "text-indigo-600 bg-indigo-50 border-indigo-200",
    "email": "text-purple-600 bg-purple-50 border-purple-200",
    "status-change": "text-amber-600 bg-amber-50 border-amber-200",
    "proposal": "text-cyan-600 bg-cyan-50 border-cyan-200",
    "contract": "text-teal-600 bg-teal-50 border-teal-200",
    "delivery": "text-orange-600 bg-orange-50 border-orange-200",
    "payment": "text-emerald-600 bg-emerald-50 border-emerald-200",
    "note": "text-gray-600 bg-gray-50 border-gray-200",
    "recording": "text-rose-600 bg-rose-50 border-rose-200",
    "photo": "text-pink-600 bg-pink-50 border-pink-200",
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-bold uppercase text-muted">Timeline</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[10px] font-medium text-accent hover:text-blue-700"
        >
          {showAdd ? "Cancel" : "+ Add Event"}
        </button>
      </div>

      {/* Add event form */}
      {showAdd && (
        <div className="mb-3 p-2.5 border border-border rounded-lg bg-gray-50/50 space-y-2">
          <div className="flex gap-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as EventType)}
              className="flex-1 px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent"
            >
              {EVENT_TYPES.filter((t) => t.key !== "status-change" && t.key !== "recording" && t.key !== "photo").map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <div className="flex gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Description..."
              className="flex-1 px-2 py-1.5 border border-border rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button
              onClick={handleAdd}
              disabled={!newLabel.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:bg-blue-600 active:scale-95 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Timeline visualization */}
      {allEvents.length === 0 ? (
        <div className="text-center text-[10px] text-gray-300 py-4">No events yet</div>
      ) : (
        <div className="relative">
          {/* Horizontal line */}
          <div className="absolute left-0 right-0 top-[15px] h-px bg-gray-200" />

          <div className="flex gap-0 overflow-x-auto pb-2" style={{ minHeight: 70 }}>
            {allEvents.map((ev) => {
              const isRecording = ev.type === "recording";
              const photoUrl = ev.type === "photo" && ev.attachments?.[0]?.dataUrl;
              const colors = eventTypeColors[ev.type] || "text-gray-500 bg-gray-50 border-gray-200";
              const colorParts = colors.split(" ");
              return (
                <div
                  key={ev.id}
                  className="flex flex-col items-center shrink-0 group relative"
                  style={{ minWidth: 52 }}
                >
                  {/* Dot/icon — photo events show thumbnail */}
                  {photoUrl ? (
                    <div className="w-[30px] h-[30px] rounded-full border-2 border-pink-200 overflow-hidden z-10">
                      <img src={photoUrl} alt={ev.label} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className={`w-[30px] h-[30px] rounded-full border-2 flex items-center justify-center z-10 ${colorParts.slice(0, 3).join(" ")}`}>
                      <EventIcon type={ev.type} size={13} />
                    </div>
                  )}
                  {/* Photo hover preview */}
                  {photoUrl && (
                    <div className="absolute bottom-full mb-1 hidden group-hover:block z-30">
                      <div className="w-32 h-32 rounded-lg border-2 border-pink-200 overflow-hidden shadow-lg">
                        <img src={photoUrl} alt={ev.label} className="w-full h-full object-cover" />
                      </div>
                    </div>
                  )}
                  {/* Date */}
                  <div className="text-[9px] text-muted mt-1 tabular-nums whitespace-nowrap">{formatDate(ev.date)}</div>
                  {/* Label */}
                  <div className="text-[9px] text-center leading-tight mt-0.5 max-w-[60px] truncate">{ev.label}</div>

                  {/* Hover delete — not for recording events (managed via transcript list) */}
                  {!isRecording && (
                    <button
                      onClick={() => handleDelete(ev.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white items-center justify-center text-[8px] hidden group-hover:flex z-20"
                      title="Remove event"
                    >
                      &times;
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
