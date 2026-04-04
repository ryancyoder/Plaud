"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import { AppEvent, Client } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getTagColor, formatDate } from "@/lib/utils";

interface EventListPanelProps {
  mode: "date" | "client";
  date?: string;
  client?: Client | null;
  events: AppEvent[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
  onDeleteEvent?: (eventId: string) => void;
}

export default function EventListPanel({ mode, date, client, events, selectedEventId, onSelectEvent, onDeleteEvent }: EventListPanelProps) {
  if (mode === "client" && client) {
    return <ClientEventList client={client} events={events} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} onDeleteEvent={onDeleteEvent} />;
  }

  return <DateEventList date={date || ""} events={events} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} onDeleteEvent={onDeleteEvent} />;
}

// --- Date Mode ---

function DateEventList({ date, events, selectedEventId, onSelectEvent, onDeleteEvent }: {
  date: string; events: AppEvent[]; selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void; onDeleteEvent?: (eventId: string) => void;
}) {
  const today = isToday(date);
  const past = isPast(date);
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || "")),
    [events]
  );

  return (
    <div className="flex flex-col h-full">
      <div className={`shrink-0 flex items-center gap-3 px-4 py-3 border-b ${today ? "bg-accent text-white border-accent" : past ? "bg-gray-50 border-border" : "border-border"}`}>
        <div className={`text-3xl font-bold leading-none ${today ? "text-white" : ""}`}>
          {getDayNumber(date)}
        </div>
        <div>
          <div className={`text-sm font-semibold ${today ? "text-white" : ""}`}>{getDayName(date)}</div>
          <div className={`text-xs ${today ? "text-white/70" : "text-muted"}`}>{formatDate(date)}</div>
        </div>
        <div className="ml-auto">
          <span className={`text-xs ${today ? "text-white/70" : "text-muted"}`}>
            {sorted.length} event{sorted.length !== 1 ? "s" : ""}
            {sorted.length > 0 && ` · ${formatDuration(sorted.reduce((s, e) => s + (e.duration || 0), 0))}`}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-300">
            No events for this day
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sorted.map((ev) => (
              <EventRow
                key={ev.id}
                event={ev}
                onSelect={(e) => onSelectEvent(selectedEventId === e.id ? null : e.id)}
                onDelete={onDeleteEvent}
                isSelected={selectedEventId === ev.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Client Mode ---

function ClientEventList({ client, events, selectedEventId, onSelectEvent, onDeleteEvent }: {
  client: Client; events: AppEvent[]; selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void; onDeleteEvent?: (eventId: string) => void;
}) {
  // Group events by date, sorted newest-first
  const grouped = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || "").localeCompare(a.startTime || ""));
    const groups: { date: string; events: AppEvent[] }[] = [];
    for (const ev of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.date === ev.date) {
        last.events.push(ev);
      } else {
        groups.push({ date: ev.date, events: [ev] });
      }
    }
    return groups;
  }, [events]);

  const totalRecordings = events.filter((e) => e.type === "recording").length;

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border bg-surface">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate">{client.name}</div>
          <div className="text-xs text-muted">
            {events.length} event{events.length !== 1 ? "s" : ""}
            {totalRecordings > 0 && ` · ${totalRecordings} recording${totalRecordings !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-300">
            No events for this client
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.date}>
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                <span className="text-[10px] font-bold uppercase text-muted tracking-wider">
                  {formatDate(group.date)}
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {group.events.map((ev) => (
                  <EventRow
                    key={ev.id}
                    event={ev}
                    onSelect={(e) => onSelectEvent(selectedEventId === e.id ? null : e.id)}
                    onDelete={onDeleteEvent}
                    isSelected={selectedEventId === ev.id}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Shared EventRow ---

export function EventRow({ event, onSelect, onDelete, isSelected }: {
  event: AppEvent; onSelect: (e: AppEvent) => void; onDelete?: (id: string) => void; isSelected: boolean;
}) {
  const firstTag = event.tags?.[0];
  const tagColor = firstTag ? getTagColor(firstTag) : { bg: "bg-gray-100", text: "text-gray-700" };

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isHorizontal = useRef<boolean | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [swiped, setSwiped] = useState(false);
  const DELETE_THRESHOLD = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isHorizontal.current = null;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (isHorizontal.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      return;
    }
    if (!isHorizontal.current) return;
    if (dx < 0) setOffsetX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (offsetX < -DELETE_THRESHOLD) { setSwiped(true); setOffsetX(-DELETE_THRESHOLD); }
    else setOffsetX(0);
    isHorizontal.current = null;
  }, [offsetX]);

  // Event type icon for non-recording events
  const typeLabel = event.type !== "recording" ? event.type.replace("-", " ") : null;

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-end bg-red-500 px-5">
        <button onClick={() => onDelete?.(event.id)} className="text-white text-xs font-bold">Delete</button>
      </div>
      <div
        className="relative bg-surface"
        style={{ transform: `translateX(${swiped ? -DELETE_THRESHOLD : offsetX}px)`, transition: offsetX === 0 || swiped ? "transform 0.2s ease" : "none" }}
        onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}
      >
        <button
          onClick={() => { if (swiped) { setSwiped(false); setOffsetX(0); } else onSelect(event); }}
          className={`w-full text-left flex items-start gap-3 px-4 py-2.5 transition-colors ${isSelected ? "bg-accent-light" : "hover:bg-gray-50 active:bg-gray-100"}`}
        >
          <div className="shrink-0 w-14 pt-0.5">
            <div className="text-sm font-semibold tabular-nums">{event.startTime || ""}</div>
            <div className="text-[10px] text-muted">{event.duration ? formatDuration(event.duration) : ""}</div>
          </div>
          <div className={`shrink-0 w-1 self-stretch rounded-full ${tagColor.bg.replace("100", "500")}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold truncate">
                {event.label.length > 60 ? event.label.slice(0, 60) + "..." : event.label}
              </h4>
              {typeLabel && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0 capitalize">{typeLabel}</span>
              )}
              {(event.tags || []).map((tag) => {
                const c = getTagColor(tag);
                return <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${c.bg} ${c.text}`}>{tag}</span>;
              })}
              {(event.attachments?.length ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-gray-400 shrink-0">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                  {event.attachments!.length}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0 self-center text-gray-300">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </div>
        </button>
      </div>
    </div>
  );
}
