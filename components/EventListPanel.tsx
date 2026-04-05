"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import { AppEvent, Client, CLIENT_STATUSES, EventType } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getTagColor, formatDate } from "@/lib/utils";

interface EventListPanelProps {
  mode: "date" | "client";
  date?: string;
  client?: Client | null;
  events: AppEvent[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
  onDeleteEvent?: (eventId: string) => void;
  onUpdateEvent?: (eventId: string, updates: Partial<AppEvent>) => void;
}

export default function EventListPanel({ mode, date, client, events, selectedEventId, onSelectEvent, onDeleteEvent, onUpdateEvent }: EventListPanelProps) {
  if (mode === "client" && client) {
    return <ClientEventList client={client} events={events} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} onDeleteEvent={onDeleteEvent} />;
  }

  return <DateEventList date={date || ""} events={events} selectedEventId={selectedEventId} onSelectEvent={onSelectEvent} onDeleteEvent={onDeleteEvent} onUpdateEvent={onUpdateEvent} />;
}

// --- Date Mode ---

type DayViewMode = "list" | "calendar";

function DateEventList({ date, events, selectedEventId, onSelectEvent, onDeleteEvent, onUpdateEvent }: {
  date: string; events: AppEvent[]; selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void; onDeleteEvent?: (eventId: string) => void;
  onUpdateEvent?: (eventId: string, updates: Partial<AppEvent>) => void;
}) {
  const [viewMode, setViewMode] = useState<DayViewMode>("list");
  const today = isToday(date);
  const past = isPast(date);
  const sorted = useMemo(
    () => [...events].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || "")),
    [events]
  );

  return (
    <div className="flex flex-col h-full">
      <div className={`shrink-0 flex items-center gap-3 px-4 py-2.5 border-b ${today ? "bg-accent text-white border-accent" : past ? "bg-gray-50 border-border" : "border-border"}`}>
        <div className={`text-3xl font-bold leading-none ${today ? "text-white" : ""}`}>
          {getDayNumber(date)}
        </div>
        <div>
          <div className={`text-sm font-semibold ${today ? "text-white" : ""}`}>{getDayName(date)}</div>
          <div className={`text-xs ${today ? "text-white/70" : "text-muted"}`}>{formatDate(date)}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-[10px] ${today ? "text-white/70" : "text-muted"}`}>
            {sorted.length} event{sorted.length !== 1 ? "s" : ""}
          </span>
          {/* View toggle */}
          <div className={`flex rounded-lg overflow-hidden border ${today ? "border-white/30" : "border-border"}`}>
            <button
              onClick={() => setViewMode("list")}
              className={`px-1.5 py-0.5 ${viewMode === "list"
                ? today ? "bg-white/20 text-white" : "bg-gray-200 text-foreground"
                : today ? "text-white/60 hover:bg-white/10" : "text-muted hover:bg-gray-50"
              }`}
              title="List view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
              </svg>
            </button>
            <button
              onClick={() => setViewMode("calendar")}
              className={`px-1.5 py-0.5 ${viewMode === "calendar"
                ? today ? "bg-white/20 text-white" : "bg-gray-200 text-foreground"
                : today ? "text-white/60 hover:bg-white/10" : "text-muted hover:bg-gray-50"
              }`}
              title="Calendar view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="2" x2="9" y2="6"/><line x1="15" y1="2" x2="15" y2="6"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {viewMode === "list" ? (
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
      ) : (
        <DayCalendarView
          events={sorted}
          selectedEventId={selectedEventId}
          onSelectEvent={onSelectEvent}
          onUpdateEvent={onUpdateEvent}
        />
      )}
    </div>
  );
}

// --- Hourly Calendar View (5am–5pm) ---

const CAL_START_HOUR = 5;
const CAL_END_HOUR = 17; // 5pm
const HOUR_HEIGHT = 52; // px per hour
const TOTAL_HOURS = CAL_END_HOUR - CAL_START_HOUR;

const EVENT_TYPE_COLORS: Partial<Record<EventType, string>> = {
  "recording": "bg-rose-100 border-rose-300 text-rose-800",
  "photo": "bg-pink-100 border-pink-300 text-pink-800",
  "site-visit": "bg-green-100 border-green-300 text-green-800",
  "phone-call": "bg-blue-100 border-blue-300 text-blue-800",
  "text-message": "bg-indigo-100 border-indigo-300 text-indigo-800",
  "email": "bg-purple-100 border-purple-300 text-purple-800",
  "proposal": "bg-cyan-100 border-cyan-300 text-cyan-800",
  "contract": "bg-teal-100 border-teal-300 text-teal-800",
  "delivery": "bg-orange-100 border-orange-300 text-orange-800",
  "payment": "bg-emerald-100 border-emerald-300 text-emerald-800",
  "next-action": "bg-green-50 border-green-300 text-green-800",
  "note": "bg-gray-100 border-gray-300 text-gray-700",
  "status-change": "bg-amber-100 border-amber-300 text-amber-800",
};

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h + (m || 0) / 60;
}

function hoursToTimeStr(h: number): string {
  const clamped = Math.max(0, Math.min(23.99, h));
  const hrs = Math.floor(clamped);
  const mins = Math.round((clamped - hrs) * 60);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

// Snap to 5-minute increments
function snapHours(h: number): number {
  return Math.round(h * 4) / 4; // 4 = 60/15
}

function DayCalendarView({ events, selectedEventId, onSelectEvent, onUpdateEvent }: {
  events: AppEvent[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string | null) => void;
  onUpdateEvent?: (eventId: string, updates: Partial<AppEvent>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    eventId: string;
    mode: "move" | "resize";
    startY: number;
    origHour: number;
    origDuration: number; // in hours
  } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ top: number; height: number } | null>(null);
  const dragRef = useRef(dragState);
  dragRef.current = dragState;

  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const showNowLine = currentHour >= CAL_START_HOUR && currentHour <= CAL_END_HOUR;

  const positioned = useMemo(() => {
    return events
      .filter((ev) => ev.startTime)
      .map((ev) => {
        const start = parseTime(ev.startTime!);
        const duration = ev.duration ? ev.duration / 60 : 0.5;
        const top = (start - CAL_START_HOUR) * HOUR_HEIGHT;
        const height = Math.max(duration * HOUR_HEIGHT, 20);
        return { event: ev, top, height, start, durationHrs: duration };
      })
      .filter((p) => p.start >= CAL_START_HOUR - 0.5 && p.start <= CAL_END_HOUR);
  }, [events]);

  const unpositioned = useMemo(
    () => events.filter((ev) => !ev.startTime),
    [events]
  );

  const handlePointerDown = useCallback((e: React.PointerEvent, eventId: string, mode: "move" | "resize", origHour: number, origDuration: number) => {
    if (!onUpdateEvent) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const state = { eventId, mode, startY: e.clientY, origHour, origDuration };
    setDragState(state);
    dragRef.current = state;
    // Set initial preview
    const top = (origHour - CAL_START_HOUR) * HOUR_HEIGHT;
    const height = Math.max(origDuration * HOUR_HEIGHT, 20);
    setDragPreview({ top, height });
  }, [onUpdateEvent]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds) return;
    e.preventDefault();
    const deltaY = e.clientY - ds.startY;
    const deltaHours = deltaY / HOUR_HEIGHT;

    if (ds.mode === "move") {
      const newHour = snapHours(ds.origHour + deltaHours);
      const clamped = Math.max(CAL_START_HOUR, Math.min(CAL_END_HOUR - ds.origDuration, newHour));
      const top = (clamped - CAL_START_HOUR) * HOUR_HEIGHT;
      const height = Math.max(ds.origDuration * HOUR_HEIGHT, 20);
      setDragPreview({ top, height });
    } else {
      const newDuration = snapHours(ds.origDuration + deltaHours);
      const clamped = Math.max(15 / 60, Math.min(CAL_END_HOUR - ds.origHour, newDuration));
      const top = (ds.origHour - CAL_START_HOUR) * HOUR_HEIGHT;
      const height = Math.max(clamped * HOUR_HEIGHT, 20);
      setDragPreview({ top, height });
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const ds = dragRef.current;
    if (!ds || !onUpdateEvent) {
      setDragState(null);
      setDragPreview(null);
      return;
    }
    const deltaY = e.clientY - ds.startY;
    const deltaHours = deltaY / HOUR_HEIGHT;

    if (ds.mode === "move") {
      const newHour = snapHours(ds.origHour + deltaHours);
      const clamped = Math.max(CAL_START_HOUR, Math.min(CAL_END_HOUR - ds.origDuration, newHour));
      onUpdateEvent(ds.eventId, {
        startTime: hoursToTimeStr(clamped),
      });
    } else {
      const newDuration = snapHours(ds.origDuration + deltaHours);
      const clamped = Math.max(15 / 60, Math.min(CAL_END_HOUR - ds.origHour, newDuration));
      onUpdateEvent(ds.eventId, {
        duration: Math.round(clamped * 60),
      });
    }
    setDragState(null);
    setDragPreview(null);
  }, [onUpdateEvent]);

  return (
    <div
      className="flex-1 overflow-y-auto relative"
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ userSelect: dragState ? "none" : "auto" }}
    >
      <div className="relative" style={{ height: TOTAL_HOURS * HOUR_HEIGHT }}>
        {/* Hour lines and labels */}
        {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
          const hour = CAL_START_HOUR + i;
          const label = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
          return (
            <div key={hour} className="absolute left-0 right-0" style={{ top: i * HOUR_HEIGHT }}>
              <div className="flex items-start">
                <span className="text-[9px] text-gray-400 w-10 text-right pr-2 -mt-1.5 shrink-0">{label}</span>
                <div className="flex-1 border-t border-gray-100" />
              </div>
            </div>
          );
        })}

        {/* Now indicator */}
        {showNowLine && (
          <div
            className="absolute left-10 right-0 z-10 flex items-center pointer-events-none"
            style={{ top: (currentHour - CAL_START_HOUR) * HOUR_HEIGHT }}
          >
            <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
            <div className="flex-1 border-t-2 border-red-500" />
          </div>
        )}

        {/* Drag preview ghost */}
        {dragState && dragPreview && (
          <div
            className="absolute left-11 right-2 rounded-lg border-2 border-accent bg-accent/10 pointer-events-none z-30"
            style={{ top: dragPreview.top, height: dragPreview.height }}
          />
        )}

        {/* Positioned events */}
        {positioned.map(({ event, top, height, start, durationHrs }) => {
          const isSelected = selectedEventId === event.id;
          const isDragging = dragState?.eventId === event.id;
          const colorClass = EVENT_TYPE_COLORS[event.type] || "bg-gray-100 border-gray-300 text-gray-700";
          return (
            <div
              key={event.id}
              className={`absolute left-11 right-2 rounded-lg border text-left overflow-hidden transition-shadow select-none ${colorClass} ${
                isDragging ? "opacity-40 z-5" : isSelected ? "ring-2 ring-accent shadow-md z-20" : "hover:shadow-sm z-10"
              }`}
              style={{ top, height: Math.max(height, 20), minHeight: 20 }}
            >
              {/* Move handle (body) */}
              <div
                className={`px-2 py-1 ${onUpdateEvent ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                style={{ height: Math.max(height - 8, 12), touchAction: onUpdateEvent ? "none" : "auto" }}
                onClick={() => {
                  if (!dragState) onSelectEvent(isSelected ? null : event.id);
                }}
                onPointerDown={(e) => handlePointerDown(e, event.id, "move", start, durationHrs)}
              >
                <div className="text-[10px] font-semibold truncate leading-tight">{event.label}</div>
                {height >= 32 && (
                  <div className="text-[9px] opacity-70 truncate">
                    {event.startTime}{event.duration ? ` · ${formatDuration(event.duration)}` : ""}
                  </div>
                )}
              </div>

              {/* Resize handle (bottom edge) */}
              {onUpdateEvent && (
                <div
                  className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize flex items-center justify-center"
                  style={{ touchAction: "none" }}
                  onPointerDown={(e) => handlePointerDown(e, event.id, "resize", start, durationHrs)}
                >
                  <div className="w-8 h-[3px] rounded-full bg-current opacity-30" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Events without times shown at bottom */}
      {unpositioned.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="text-[9px] font-semibold uppercase text-muted mb-1">No time set</div>
          {unpositioned.map((ev) => {
            const isSelected = selectedEventId === ev.id;
            const colorClass = EVENT_TYPE_COLORS[ev.type] || "bg-gray-100 border-gray-300 text-gray-700";
            return (
              <button
                key={ev.id}
                onClick={() => onSelectEvent(isSelected ? null : ev.id)}
                className={`w-full text-left rounded-lg border px-2 py-1.5 mb-1 text-[10px] font-semibold truncate ${colorClass} ${
                  isSelected ? "ring-2 ring-accent" : ""
                }`}
              >
                {ev.label}
              </button>
            );
          })}
        </div>
      )}
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

      <ClientInfoBanner client={client} />

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

// --- Collapsible Client Info Banner ---

function ClientInfoBanner({ client }: { client: Client }) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = CLIENT_STATUSES.find((s) => s.key === (client.status || "lead"));
  const hasDetails = !!(client.phone || client.email || client.address || client.notes || client.appointmentDate);

  return (
    <div className="shrink-0 border-b border-border bg-gray-50/80">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-100/60 active:bg-gray-100"
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {client.company && <span className="text-[10px] text-muted truncate">{client.company}</span>}
          {statusInfo && (
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          )}
          {client.nextAction && (
            <span className="text-[9px] font-medium text-accent truncate">{client.nextAction}</span>
          )}
          {hasDetails && (
            <span className="text-[9px] text-gray-400">{expanded ? "Hide" : "Info"}</span>
          )}
        </div>
        {hasDetails && (
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            className={`shrink-0 text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-2 pt-0.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {client.phone && (
            <div>
              <span className="text-[9px] font-semibold uppercase text-muted">Phone</span>
              <p className="text-[11px]">{client.phone}</p>
            </div>
          )}
          {client.email && (
            <div>
              <span className="text-[9px] font-semibold uppercase text-muted">Email</span>
              <p className="text-[11px] break-all">{client.email}</p>
            </div>
          )}
          {client.address && (
            <div className="col-span-2">
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-semibold uppercase text-muted">Address</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open in Maps
                </a>
              </div>
              <p className="text-[11px]">{client.address}</p>
            </div>
          )}
          {client.appointmentDate && (
            <div>
              <span className="text-[9px] font-semibold uppercase text-muted">Appointment</span>
              <p className="text-[11px]">
                {(() => {
                  try {
                    const d = new Date(client.appointmentDate);
                    return isNaN(d.getTime()) ? client.appointmentDate : d.toLocaleString("en-US", {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "numeric", minute: "2-digit",
                    });
                  } catch { return client.appointmentDate; }
                })()}
              </p>
            </div>
          )}
          {client.notes && (
            <div className="col-span-2">
              <span className="text-[9px] font-semibold uppercase text-muted">Notes</span>
              <p className="text-[11px] leading-relaxed whitespace-pre-wrap text-gray-700 max-h-20 overflow-y-auto">{client.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
