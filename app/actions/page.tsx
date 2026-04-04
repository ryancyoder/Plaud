"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Client, ClientStatus, CLIENT_STATUSES, AppEvent, EventType } from "@/lib/types";
import { loadClients, updateClient } from "@/lib/clients";
import { loadEvents, addEvent } from "@/lib/event-store";
import { getLastName } from "@/lib/utils";
import { setPersistedClientId } from "@/lib/selected-client";
import NavButtons from "@/components/NavButtons";

// --- Constants ---

const ROW_HEIGHT = 36; // px — cells are ROW_HEIGHT x ROW_HEIGHT squares
const CELL_SIZE = ROW_HEIGHT;

// Event type → icon mapping for the timeline
const EVENT_ICONS: Partial<Record<EventType, { icon: string; color: string; title: string }>> = {
  "site-visit":    { icon: "house",     color: "#16a34a", title: "Site Visit" },
  "recording":     { icon: "mic",       color: "#e11d48",  title: "Recording" },
  "phone-call":    { icon: "phone",     color: "#2563eb",  title: "Phone Call" },
  "text-message":  { icon: "message",   color: "#6366f1",  title: "Text Message" },
  "email":         { icon: "email",     color: "#9333ea",  title: "Email" },
  "proposal":      { icon: "proposal",  color: "#0891b2",  title: "Proposal" },
  "contract":      { icon: "contract",  color: "#0d9488",  title: "Contract" },
  "delivery":      { icon: "delivery",  color: "#ea580c",  title: "Delivery" },
  "payment":       { icon: "payment",   color: "#059669",  title: "Payment" },
  "status-change": { icon: "status",    color: "#d97706",  title: "Status Change" },
  "next-action":   { icon: "check",     color: "#16a34a",  title: "Next Action" },
  "note":          { icon: "note",      color: "#6b7280",  title: "Note" },
  "photo":         { icon: "photo",     color: "#ec4899",  title: "Photo" },
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  return Math.round((db.getTime() - da.getTime()) / (86400000));
}

export default function ActionsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [allEvents, setAllEvents] = useState<AppEvent[]>([]);
  const [mounted, setMounted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [nextValue, setNextValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const nextInputRef = useRef<HTMLInputElement>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setClients(loadClients());
    setAllEvents(loadEvents());
    setMounted(true);
  }, []);

  // Scroll calendar to show "today" area on mount
  useEffect(() => {
    if (!mounted || !calendarScrollRef.current) return;
    const el = calendarScrollRef.current;
    // Scroll to end (today is rightmost)
    el.scrollLeft = el.scrollWidth;
  }, [mounted, clients.length]);

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

  // Group clients by status
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

  // Flat list for tab navigation
  const allClientsList = useMemo(() => grouped.flatMap((g) => g.clients), [grouped]);

  // Build per-client event maps and compute calendar date range
  const { clientEventsMap, calendarStart, calendarEnd, totalDays } = useMemo(() => {
    const today = todayStr();
    const map = new Map<string, AppEvent[]>();

    for (const ev of allEvents) {
      if (!ev.clientId) continue;
      const list = map.get(ev.clientId) || [];
      list.push(ev);
      map.set(ev.clientId, list);
    }

    // Sort each client's events by date
    for (const [, evts] of map) {
      evts.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || "").localeCompare(b.startTime || ""));
    }

    // Find global min/max dates across all client events
    let minDate = today;
    let maxDate = today;
    for (const [, evts] of map) {
      if (evts.length > 0) {
        if (evts[0].date < minDate) minDate = evts[0].date;
        const last = evts[evts.length - 1].date;
        if (last > maxDate) maxDate = last;
      }
    }

    // Pad a few days on each side
    const start = addDays(minDate, -2);
    const end = addDays(today, 3); // always extend a few days past today
    const total = daysBetween(start, end) + 1;

    return { clientEventsMap: map, calendarStart: start, calendarEnd: end, totalDays: Math.max(total, 7) };
  }, [allEvents]);

  // Navigate to dashboard with event selected
  const handleEventClick = useCallback((event: AppEvent) => {
    if (event.clientId) {
      setPersistedClientId(event.clientId);
    }
    // Store event ID for dashboard to pick up
    sessionStorage.setItem("plaud-navigate-event", event.id);
    sessionStorage.setItem("plaud-navigate-date", event.date);
    router.push("/");
  }, [router]);

  // --- Action handlers (same as before) ---
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

    const newEvent = addEvent({
      type: "next-action",
      clientId: client.id,
      date: dateStr,
      startTime: timeStr,
      label: `Completed: ${completedAction}`,
      auto: true,
    });

    // Update local events list
    setAllEvents((prev) => [...prev, newEvent]);

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
      const idx = allClientsList.findIndex((c) => c.id === clientId);
      const next = allClientsList[idx + (e.shiftKey ? -1 : 1)];
      if (next) {
        setTimeout(() => handleStartEdit(next), 0);
      }
    }
  }, [handleSaveEdit, handleStartEdit, allClientsList]);

  const handleCompleteKeyDown = useCallback((e: React.KeyboardEvent, client: Client) => {
    if (e.key === "Enter") {
      handleConfirmComplete(client);
    } else if (e.key === "Escape") {
      handleCancelComplete();
    }
  }, [handleConfirmComplete, handleCancelComplete]);

  if (!mounted) return null;

  const today = todayStr();

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
          <Link href="/" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Dashboard</Link>
          <Link href="/board" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Board</Link>
          <Link href="/map" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Map</Link>
          <span className="text-sm font-semibold">Actions</span>
        </div>
        <NavButtons />
      </header>

      {/* Main content: fixed left | scrollable calendar | fixed right hours */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left fixed columns: Client | NextAction | Done */}
        <div className="shrink-0 flex flex-col overflow-y-auto border-r-2 border-border" style={{ width: 420 }}>
          {/* Header row */}
          <div className="sticky top-0 z-10 bg-surface border-b border-border flex" style={{ height: ROW_HEIGHT }}>
            <div className="w-36 shrink-0 px-3 flex items-center text-[10px] font-semibold uppercase text-muted">Client</div>
            <div className="flex-1 px-3 flex items-center text-[10px] font-semibold uppercase text-muted">Next Action</div>
            <div className="w-12 shrink-0 flex items-center justify-center text-[10px] font-semibold uppercase text-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
          </div>

          {/* Rows */}
          {grouped.map((group) => (
            <div key={group.status}>
              {/* Status group header */}
              <div
                className={`flex items-center px-3 text-[10px] font-bold uppercase tracking-wider border-b border-t border-border ${group.color}`}
                style={{ height: ROW_HEIGHT - 4 }}
              >
                {group.label} ({group.clients.length})
              </div>

              {group.clients.map((client) => {
                const isEditing = editingId === client.id;
                const isCompleting = completingId === client.id;

                return (
                  <div key={client.id} className="flex border-b border-border hover:bg-gray-50/50" style={{ minHeight: ROW_HEIGHT }}>
                    {/* Client name */}
                    <div className="w-36 shrink-0 px-3 flex flex-col justify-center">
                      <div className="text-[11px] font-medium truncate">{getLastName(client.name)}</div>
                      {client.company && <div className="text-[8px] text-muted truncate">{client.company}</div>}
                    </div>

                    {/* Next Action */}
                    <div className="flex-1 px-2 flex items-center min-w-0">
                      {isCompleting ? (
                        <div className="w-full space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[8px] font-semibold uppercase text-green-600">Done:</span>
                            <span className="text-[10px] text-muted line-through truncate">{client.nextAction}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              ref={nextInputRef}
                              value={nextValue}
                              onChange={(e) => setNextValue(e.target.value)}
                              onKeyDown={(e) => handleCompleteKeyDown(e, client)}
                              placeholder="New action..."
                              className="flex-1 px-1.5 py-1 border border-green-300 rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-green-400 bg-green-50 min-w-0"
                            />
                            <button onClick={() => handleConfirmComplete(client)} className="px-2 py-1 rounded text-[9px] font-medium bg-green-600 text-white hover:bg-green-700 active:scale-95 shrink-0">OK</button>
                            <button onClick={handleCancelComplete} className="px-1.5 py-1 rounded text-[9px] text-muted hover:bg-gray-100 active:scale-95 shrink-0">X</button>
                          </div>
                        </div>
                      ) : isEditing ? (
                        <input
                          ref={inputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, client.id)}
                          onBlur={() => handleSaveEdit(client.id)}
                          placeholder="Next action..."
                          className="w-full px-1.5 py-1 border border-accent rounded text-[10px] focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                      ) : (
                        <div
                          onClick={() => handleStartEdit(client)}
                          className="w-full min-h-[24px] flex items-center cursor-text rounded px-1.5 hover:bg-gray-100 transition-colors"
                        >
                          {client.nextAction ? (
                            <span className="text-[10px] truncate">{client.nextAction}</span>
                          ) : (
                            <span className="text-[10px] text-gray-300 italic">Add...</span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Done button */}
                    <div className="w-12 shrink-0 flex items-center justify-center">
                      {!isEditing && !isCompleting && client.nextAction && (
                        <button
                          onClick={() => handleComplete(client)}
                          className="p-1 rounded text-green-500 hover:bg-green-50 hover:text-green-700 active:scale-95"
                          title="Mark complete"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Scrollable calendar grid */}
        <div className="flex-1 overflow-x-auto overflow-y-auto" ref={calendarScrollRef}>
          <div style={{ width: totalDays * CELL_SIZE, minHeight: "100%" }}>
            {/* Calendar header: month names row + day numbers row */}
            <div className="sticky top-0 z-10 bg-surface border-b border-border">
              {/* Month labels row */}
              <div className="flex" style={{ height: 14 }}>
                {(() => {
                  const spans: { month: string; cols: number; startIdx: number }[] = [];
                  for (let i = 0; i < totalDays; i++) {
                    const d = new Date(addDays(calendarStart, i) + "T00:00:00");
                    const label = d.toLocaleDateString("en-US", { month: "short" });
                    const last = spans[spans.length - 1];
                    if (last && last.month === label) {
                      last.cols++;
                    } else {
                      spans.push({ month: label, cols: 1, startIdx: i });
                    }
                  }
                  return spans.map((span) => (
                    <div
                      key={`${span.month}-${span.startIdx}`}
                      className="text-[8px] font-semibold text-muted uppercase tracking-wider flex items-end px-1 border-r border-gray-100 overflow-hidden"
                      style={{ width: span.cols * CELL_SIZE }}
                    >
                      {span.month}
                    </div>
                  ));
                })()}
              </div>
              {/* Day number row */}
              <div className="flex" style={{ height: ROW_HEIGHT - 14 }}>
                {Array.from({ length: totalDays }, (_, i) => {
                  const date = addDays(calendarStart, i);
                  const isToday = date === today;
                  const d = new Date(date + "T00:00:00");
                  return (
                    <div
                      key={date}
                      className={`shrink-0 flex items-center justify-center border-r border-gray-100 ${
                        isToday ? "bg-accent/10 text-accent" : "text-foreground"
                      }`}
                      style={{ width: CELL_SIZE }}
                      title={date}
                    >
                      <span className="text-[10px] font-bold">{d.getDate()}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Calendar rows aligned with left panel */}
            {grouped.map((group) => (
              <div key={group.status}>
                {/* Status group header spacer */}
                <div className={`border-b border-t border-border ${group.color}`} style={{ height: ROW_HEIGHT - 4 }} />

                {group.clients.map((client) => {
                  const events = clientEventsMap.get(client.id) || [];
                  return (
                    <TimelineRow
                      key={client.id}
                      events={events}
                      calendarStart={calendarStart}
                      totalDays={totalDays}
                      today={today}
                      onEventClick={handleEventClick}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Right fixed column: Total Hours */}
        <div className="shrink-0 flex flex-col overflow-y-auto border-l-2 border-border" style={{ width: 56 }}>
          {/* Header */}
          <div className="sticky top-0 z-10 bg-surface border-b border-border flex items-center justify-center text-[9px] font-semibold uppercase text-muted" style={{ height: ROW_HEIGHT }}>
            Hrs
          </div>

          {/* Rows */}
          {grouped.map((group) => (
            <div key={group.status}>
              {/* Status group header spacer */}
              <div className={`border-b border-t border-border ${group.color}`} style={{ height: ROW_HEIGHT - 4 }} />

              {group.clients.map((client) => {
                const events = clientEventsMap.get(client.id) || [];
                const totalMinutes = events.reduce((sum, ev) => sum + (ev.duration || 0), 0);
                const hours = totalMinutes / 60;
                return (
                  <div
                    key={client.id}
                    className="flex items-center justify-center border-b border-border"
                    style={{ height: ROW_HEIGHT }}
                    title={`${totalMinutes} minutes total`}
                  >
                    {totalMinutes > 0 ? (
                      <span className="text-[10px] font-bold text-foreground">{hours < 10 ? hours.toFixed(1) : Math.round(hours)}</span>
                    ) : (
                      <span className="text-[10px] text-gray-300">-</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Timeline Row ---

function TimelineRow({
  events,
  calendarStart,
  totalDays,
  today,
  onEventClick,
}: {
  events: AppEvent[];
  calendarStart: string;
  totalDays: number;
  today: string;
  onEventClick: (event: AppEvent) => void;
}) {
  // Group events by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AppEvent[]>();
    for (const ev of events) {
      const list = map.get(ev.date) || [];
      list.push(ev);
      map.set(ev.date, list);
    }
    return map;
  }, [events]);

  // Find first and last event dates for the connecting line
  const firstDate = events.length > 0 ? events[0].date : null;
  const lastDate = events.length > 0 ? events[events.length - 1].date : null;
  const isComplete = lastDate != null && events.some((e) => e.type === "payment");

  // Line spans from first event to last event (or today if not complete)
  const lineStartCol = firstDate ? daysBetween(calendarStart, firstDate) : -1;
  const lineEndCol = firstDate
    ? daysBetween(calendarStart, isComplete && lastDate ? lastDate : today)
    : -1;

  return (
    <div className="flex border-b border-border relative" style={{ height: ROW_HEIGHT }}>
      {/* Connecting line */}
      {lineStartCol >= 0 && lineEndCol >= lineStartCol && (
        <div
          className="absolute top-1/2 -translate-y-[0.5px] bg-gray-300"
          style={{
            left: lineStartCol * CELL_SIZE + CELL_SIZE / 2,
            width: (lineEndCol - lineStartCol) * CELL_SIZE,
            height: 1.5,
          }}
        />
      )}

      {/* Forward arrow at today if not complete */}
      {!isComplete && firstDate && lineEndCol >= 0 && (
        <div
          className="absolute top-1/2 -translate-y-1/2 text-gray-400"
          style={{ left: lineEndCol * CELL_SIZE + CELL_SIZE / 2 - 1 }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <polygon points="0,1 10,5 0,9" />
          </svg>
        </div>
      )}

      {/* Day cells with event icons */}
      {Array.from({ length: totalDays }, (_, i) => {
        const date = addDays(calendarStart, i);
        const dayEvents = eventsByDate.get(date);
        const isToday = date === today;

        return (
          <div
            key={date}
            className={`shrink-0 flex items-center justify-center relative ${isToday ? "bg-accent/5" : ""}`}
            style={{ width: CELL_SIZE, height: ROW_HEIGHT }}
          >
            {dayEvents && dayEvents.length > 0 && (
              <EventDot events={dayEvents} onClick={onEventClick} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// --- Event Dot/Icon ---

function EventDot({ events, onClick }: { events: AppEvent[]; onClick: (ev: AppEvent) => void }) {
  // Show the most significant event icon, prioritizing: site-visit > payment > contract > proposal > recording > others
  const priority: EventType[] = ["site-visit", "payment", "contract", "proposal", "delivery", "recording", "phone-call", "email", "text-message", "next-action", "note", "photo", "status-change"];
  const sorted = [...events].sort((a, b) => {
    const ai = priority.indexOf(a.type);
    const bi = priority.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const primary = sorted[0];
  const iconInfo = EVENT_ICONS[primary.type];
  const hasMultiple = events.length > 1;

  return (
    <button
      onClick={() => onClick(primary)}
      className="relative z-[1] flex items-center justify-center rounded-full hover:scale-125 active:scale-95 transition-transform"
      style={{ width: CELL_SIZE - 8, height: CELL_SIZE - 8 }}
      title={`${events.map((e) => `${EVENT_ICONS[e.type]?.title || e.type}: ${e.label}`).join("\n")}`}
    >
      <EventIcon type={primary.type} color={iconInfo?.color || "#6b7280"} size={16} />
      {hasMultiple && (
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-gray-600 text-white text-[6px] font-bold flex items-center justify-center">
          {events.length}
        </span>
      )}
    </button>
  );
}

// --- SVG Icons for event types ---

function EventIcon({ type, color, size }: { type: EventType; color: string; size: number }) {
  const s = size;
  const sw = 2;
  switch (type) {
    case "site-visit":
      // House icon
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "payment":
      // Money bag icon
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case "recording":
      // Mic icon
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        </svg>
      );
    case "phone-call":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case "email":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      );
    case "text-message":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "proposal":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      );
    case "contract":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      );
    case "delivery":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="3" width="15" height="13" />
          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
    case "next-action":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case "note":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
      );
    case "photo":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case "status-change":
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      );
    default:
      // Generic dot
      return (
        <svg width={s} height={s} viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="5" fill={color} />
        </svg>
      );
  }
}
