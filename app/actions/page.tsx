"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { Client, ClientStatus, CLIENT_STATUSES } from "@/lib/types";
import { loadClients, updateClient } from "@/lib/clients";
import { addEvent } from "@/lib/event-store";
import { getLastName } from "@/lib/utils";
import { getPersistedClientId, setPersistedClientId } from "@/lib/selected-client";

export default function ActionsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [mounted, setMounted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [nextValue, setNextValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const nextInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setClients(loadClients());
    setMounted(true);
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (completingId && nextInputRef.current) {
      nextInputRef.current.focus();
    }
  }, [completingId]);

  const grouped = useMemo(() => {
    const groups: { status: ClientStatus; label: string; color: string; clients: Client[] }[] = [];
    for (const s of CLIENT_STATUSES) {
      const matching = clients
        .filter((c) => (c.status || "lead") === s.key)
        .sort((a, b) => getLastName(a.name).localeCompare(getLastName(b.name)));
      if (matching.length > 0) {
        groups.push({ status: s.key, label: s.label, color: s.color, clients: matching });
      }
    }
    return groups;
  }, [clients]);

  const handleStartEdit = useCallback((client: Client) => {
    setCompletingId(null);
    setEditingId(client.id);
    setEditValue(client.nextAction || "");
  }, []);

  const handleSaveEdit = useCallback((clientId: string) => {
    const trimmed = editValue.trim();
    updateClient(clientId, { nextAction: trimmed || undefined });
    setClients((prev) =>
      prev.map((c) => c.id === clientId ? { ...c, nextAction: trimmed || undefined } : c)
    );
    setEditingId(null);
    setEditValue("");
  }, [editValue]);

  const handleComplete = useCallback((client: Client) => {
    if (!client.nextAction) return;
    setEditingId(null);
    setCompletingId(client.id);
    setNextValue("");
  }, []);

  const handleConfirmComplete = useCallback((client: Client) => {
    const completedAction = client.nextAction || "";
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Log completed action as event
    addEvent({
      type: "next-action",
      clientId: client.id,
      date: dateStr,
      startTime: timeStr,
      label: `Completed: ${completedAction}`,
      auto: true,
    });

    // Set new next action
    const newAction = nextValue.trim() || undefined;
    updateClient(client.id, { nextAction: newAction });
    setClients((prev) =>
      prev.map((c) => c.id === client.id ? { ...c, nextAction: newAction } : c)
    );
    setCompletingId(null);
    setNextValue("");
  }, [nextValue]);

  const handleCancelComplete = useCallback(() => {
    setCompletingId(null);
    setNextValue("");
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, clientId: string) => {
    if (e.key === "Enter") {
      handleSaveEdit(clientId);
    } else if (e.key === "Escape") {
      setEditingId(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      handleSaveEdit(clientId);
      // Move to next client in the list
      const allClients = grouped.flatMap((g) => g.clients);
      const idx = allClients.findIndex((c) => c.id === clientId);
      const next = allClients[idx + (e.shiftKey ? -1 : 1)];
      if (next) {
        setTimeout(() => handleStartEdit(next), 0);
      }
    }
  }, [handleSaveEdit, handleStartEdit, grouped]);

  const handleCompleteKeyDown = useCallback((e: React.KeyboardEvent, client: Client) => {
    if (e.key === "Enter") {
      handleConfirmComplete(client);
    } else if (e.key === "Escape") {
      handleCancelComplete();
    }
  }, [handleConfirmComplete, handleCancelComplete]);

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
          <Link href="/" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">
            Dashboard
          </Link>
          <Link href="/board" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">
            Board
          </Link>
          <Link href="/map" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">
            Map
          </Link>
          <span className="text-sm font-semibold">Actions</span>
        </div>

        <div className="w-20" />
      </header>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-border">
              <th className="text-left text-[10px] font-semibold uppercase text-muted px-4 py-2 w-48">Client</th>
              <th className="text-left text-[10px] font-semibold uppercase text-muted px-4 py-2">Next Action</th>
              <th className="text-center text-[10px] font-semibold uppercase text-muted px-4 py-2 w-24">Done</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((group) => (
              <StatusGroup
                key={group.status}
                group={group}
                editingId={editingId}
                editValue={editValue}
                completingId={completingId}
                nextValue={nextValue}
                inputRef={inputRef}
                nextInputRef={nextInputRef}
                onEditValueChange={setEditValue}
                onNextValueChange={setNextValue}
                onStartEdit={handleStartEdit}
                onSaveEdit={handleSaveEdit}
                onKeyDown={handleKeyDown}
                onComplete={handleComplete}
                onConfirmComplete={handleConfirmComplete}
                onCancelComplete={handleCancelComplete}
                onCompleteKeyDown={handleCompleteKeyDown}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusGroup({
  group,
  editingId,
  editValue,
  completingId,
  nextValue,
  inputRef,
  nextInputRef,
  onEditValueChange,
  onNextValueChange,
  onStartEdit,
  onSaveEdit,
  onKeyDown,
  onComplete,
  onConfirmComplete,
  onCancelComplete,
  onCompleteKeyDown,
}: {
  group: { status: ClientStatus; label: string; color: string; clients: Client[] };
  editingId: string | null;
  editValue: string;
  completingId: string | null;
  nextValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  nextInputRef: React.RefObject<HTMLInputElement | null>;
  onEditValueChange: (v: string) => void;
  onNextValueChange: (v: string) => void;
  onStartEdit: (c: Client) => void;
  onSaveEdit: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent, id: string) => void;
  onComplete: (c: Client) => void;
  onConfirmComplete: (c: Client) => void;
  onCancelComplete: () => void;
  onCompleteKeyDown: (e: React.KeyboardEvent, c: Client) => void;
}) {
  return (
    <>
      {/* Status group header */}
      <tr>
        <td colSpan={3} className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b border-t border-border ${group.color}`}>
          {group.label} ({group.clients.length})
        </td>
      </tr>

      {group.clients.map((client) => {
        const isEditing = editingId === client.id;
        const isCompleting = completingId === client.id;

        return (
          <tr key={client.id} className="border-b border-border hover:bg-gray-50/50 group">
            {/* Client name */}
            <td className="px-4 py-2">
              <div className="text-xs font-medium">{getLastName(client.name)}</div>
              {client.company && <div className="text-[9px] text-muted">{client.company}</div>}
            </td>

            {/* Next Action cell */}
            <td className="px-4 py-2">
              {isCompleting ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-semibold uppercase text-green-600">Completing:</span>
                    <span className="text-xs text-muted line-through">{client.nextAction}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={nextInputRef}
                      value={nextValue}
                      onChange={(e) => onNextValueChange(e.target.value)}
                      onKeyDown={(e) => onCompleteKeyDown(e, client)}
                      placeholder="New next action (optional)"
                      className="flex-1 px-2 py-1.5 border border-green-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-green-400 bg-green-50"
                    />
                    <button
                      onClick={() => onConfirmComplete(client)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-green-600 text-white hover:bg-green-700 active:scale-95 shrink-0"
                    >
                      Save
                    </button>
                    <button
                      onClick={onCancelComplete}
                      className="px-2 py-1.5 rounded-lg text-[10px] text-muted hover:bg-gray-100 active:scale-95 shrink-0"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : isEditing ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => onEditValueChange(e.target.value)}
                  onKeyDown={(e) => onKeyDown(e, client.id)}
                  onBlur={() => onSaveEdit(client.id)}
                  placeholder="Enter next action..."
                  className="w-full px-2 py-1.5 border border-accent rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent"
                />
              ) : (
                <div
                  onClick={() => onStartEdit(client)}
                  className="min-h-[28px] flex items-center cursor-text rounded-lg px-2 py-1 hover:bg-gray-100 transition-colors"
                >
                  {client.nextAction ? (
                    <span className="text-xs">{client.nextAction}</span>
                  ) : (
                    <span className="text-xs text-gray-300 italic">Click to add...</span>
                  )}
                </div>
              )}
            </td>

            {/* Done button */}
            <td className="px-4 py-2 text-center">
              {!isEditing && !isCompleting && client.nextAction && (
                <button
                  onClick={() => onComplete(client)}
                  className="p-1.5 rounded-lg text-green-500 hover:bg-green-50 hover:text-green-700 active:scale-95 transition-colors"
                  title="Mark complete"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}
