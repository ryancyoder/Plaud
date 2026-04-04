"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Client, ClientStatus, CLIENT_STATUSES, Transcript } from "@/lib/types";
import { loadClients, saveClients, updateClientStatus } from "@/lib/clients";
import { loadTranscripts } from "@/lib/store";
import { getTranscriptsForClient } from "@/lib/clients";
import { parseRfpClipboard, rfpToClientData } from "@/lib/rfp-parser";
import { formatDuration, getLastName } from "@/lib/utils";
import Link from "next/link";

export default function BoardPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
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
    setClients(loadClients());
    setTranscripts(loadTranscripts());
    setMounted(true);
  }, []);

  const getClientsForStatus = useCallback(
    (status: ClientStatus) => clients.filter((c) => (c.status || "lead") === status),
    [clients]
  );

  const handleDrop = useCallback((clientId: string, newStatus: ClientStatus) => {
    updateClientStatus(clientId, newStatus);
    setClients((prev) => prev.map((c) => c.id === clientId ? { ...c, status: newStatus } : c));
    setSelectedClient((prev) => prev?.id === clientId ? { ...prev, status: newStatus } : prev);
    setDraggedClient(null);
    setDragOverColumn(null);
  }, []);

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

  const clientTranscripts = selectedClient
    ? getTranscriptsForClient(transcripts, selectedClient)
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
                    const tCount = getTranscriptsForClient(transcripts, client).length;
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
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                            client.type === "client" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                          }`}>
                            {client.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-[11px] font-medium truncate">{getLastName(client.name)}</span>
                        </div>
                        {(client.company || tCount > 0) && (
                          <div className="flex items-center gap-2 mt-1 pl-6.5">
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
            transcripts={clientTranscripts}
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

function ClientViewer({ client, transcripts }: { client: Client; transcripts: Transcript[] }) {
  const sorted = [...transcripts].sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  const totalDuration = transcripts.reduce((s, t) => s + t.duration, 0);
  const statusInfo = CLIENT_STATUSES.find((s) => s.key === (client.status || "lead"));

  return (
    <div className="flex h-full overflow-hidden">
      {/* Client info sidebar */}
      <div className="w-64 shrink-0 border-r border-border p-4 overflow-y-auto">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
            client.type === "client" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
          }`}>
            {client.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-sm font-bold">{client.name}</h2>
            {client.company && <p className="text-[10px] text-muted">{client.company}</p>}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-semibold uppercase text-muted">Status</span>
            <div className={`mt-1 inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${statusInfo?.color || ""}`}>
              {statusInfo?.label || "Lead"}
            </div>
          </div>

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
              <span className="text-[10px] font-semibold uppercase text-muted">Address</span>
              <p className="text-xs mt-0.5">{client.address}</p>
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
      </div>

      {/* Transcript list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3 border-b border-border bg-gray-50/50">
          <h3 className="text-xs font-bold">Recordings ({transcripts.length})</h3>
        </div>
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-gray-300">
            No recordings associated with this client
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sorted.map((t) => (
              <div key={t.id} className="px-4 py-2.5 hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  <div className="shrink-0 w-14">
                    <div className="text-[10px] text-muted">{t.date}</div>
                    <div className="text-xs font-semibold tabular-nums">{t.startTime}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-medium truncate">{t.title}</h4>
                    <p className="text-[10px] text-muted truncate mt-0.5">
                      {t.summary.length > 120 ? t.summary.slice(0, 120) + "..." : t.summary}
                    </p>
                  </div>
                  <div className="shrink-0 text-[10px] text-muted">
                    {formatDuration(t.duration)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
