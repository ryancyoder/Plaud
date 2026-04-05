"use client";

import React, { useRef, useEffect, useMemo, useCallback } from "react";
import { AppEvent, EventType } from "@/lib/types";
import { isToday, isPast } from "@/lib/utils";

const WEEKS_BACK = 12;

function generateDateRange(): string[] {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - WEEKS_BACK * 7);
  const dates: string[] = [];
  const d = new Date(monday);
  while (true) {
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    dates.push(str);
    if (str === todayStr) break;
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function getMonthLabel(date: string): string | null {
  const d = new Date(date + "T00:00:00");
  if (d.getDate() === 1) {
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  if (d.getDay() === 1) {
    const prev = new Date(d);
    prev.setDate(prev.getDate() - 7);
    if (prev.getMonth() !== d.getMonth()) {
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
  }
  return null;
}

function getDayAbbrev(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function getDayNumber(date: string): string {
  return String(new Date(date + "T00:00:00").getDate());
}

// Compact event type icons — small inline SVGs
const EVENT_TYPE_ICONS: Partial<Record<EventType, { color: string; icon: (s: number) => React.ReactNode }>> = {
  "recording":     { color: "#e11d48", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> },
  "photo":         { color: "#ec4899", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> },
  "site-visit":    { color: "#16a34a", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
  "phone-call":    { color: "#2563eb", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> },
  "text-message":  { color: "#6366f1", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  "email":         { color: "#9333ea", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> },
  "proposal":      { color: "#0891b2", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
  "contract":      { color: "#0d9488", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
  "delivery":      { color: "#ea580c", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
  "payment":       { color: "#059669", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> },
  "next-action":   { color: "#16a34a", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
  "note":          { color: "#6b7280", icon: (s) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> },
};

// Group events by type, return counts
function getEventTypeCounts(events: AppEvent[]): { type: EventType; count: number }[] {
  const counts = new Map<EventType, number>();
  for (const ev of events) {
    counts.set(ev.type, (counts.get(ev.type) || 0) + 1);
  }
  // Sort by a sensible display order
  const order: EventType[] = ["recording", "site-visit", "phone-call", "photo", "email", "text-message", "proposal", "contract", "delivery", "payment", "next-action", "note", "status-change"];
  return order
    .filter((t) => counts.has(t))
    .map((t) => ({ type: t, count: counts.get(t)! }));
}

interface WeekNavProps {
  selectedDate: string;
  onSelectDate: (date: string) => void;
  getRecordingsForDate: (date: string) => AppEvent[];
}

export default function WeekNav({ selectedDate, onSelectDate, getRecordingsForDate }: WeekNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const hasScrolled = useRef(false);

  const allDates = useMemo(() => generateDateRange(), []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const idx = allDates.indexOf(selectedDate);
    if (idx === -1) return;
    const next = e.key === "ArrowUp" ? idx - 1 : idx + 1;
    if (next >= 0 && next < allDates.length) {
      onSelectDate(allDates[next]);
    }
  }, [allDates, selectedDate, onSelectDate]);

  useEffect(() => {
    if (selectedRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const el = selectedRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offset = elRect.top - containerRect.top - containerRect.height / 3;
      container.scrollBy({ top: offset, behavior: hasScrolled.current ? "smooth" : "instant" });
      hasScrolled.current = true;
    }
  }, [selectedDate]);

  return (
    <div className="flex flex-col h-full" tabIndex={0} onKeyDown={handleKeyDown} style={{ outline: "none" }}>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-2 space-y-0">
        {allDates.map((date) => {
          const events = getRecordingsForDate(date);
          const today = isToday(date);
          const selected = date === selectedDate;
          const monthLabel = getMonthLabel(date);
          const d = new Date(date + "T00:00:00");
          const isMonday = d.getDay() === 1;
          const typeCounts = events.length > 0 ? getEventTypeCounts(events) : [];

          return (
            <div key={date}>
              {monthLabel && (
                <div className="text-[10px] font-bold uppercase text-muted tracking-wider px-3 pt-3 pb-1">
                  {monthLabel}
                </div>
              )}
              {isMonday && !monthLabel && (
                <div className="h-px bg-gray-100 mx-2 my-1" />
              )}
              <button
                ref={selected ? selectedRef : undefined}
                onClick={() => onSelectDate(date)}
                className={`w-full text-left px-3 py-1.5 rounded-xl transition-colors ${
                  selected
                    ? today ? "bg-accent text-white" : "bg-accent-light text-accent"
                    : today ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50 active:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`text-lg font-bold leading-none tabular-nums w-6 text-right ${
                    selected && today ? "text-white" : today ? "text-accent" : "text-gray-400"
                  }`}>
                    {getDayNumber(date)}
                  </div>
                  <div className={`text-[10px] font-semibold w-7 ${
                    selected && today ? "text-white/70" : selected ? "text-accent/70" : today ? "text-accent" : "text-muted"
                  }`}>
                    {getDayAbbrev(date)}
                  </div>
                  {typeCounts.length > 0 && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {typeCounts.map(({ type, count }) => {
                        const iconInfo = EVENT_TYPE_ICONS[type];
                        if (!iconInfo) return null;
                        return (
                          <span
                            key={type}
                            className="relative flex items-center"
                            title={`${count} ${type.replace("-", " ")}`}
                          >
                            <span style={{ color: selected ? (today ? "rgba(255,255,255,0.85)" : "currentColor") : iconInfo.color }}>
                              {iconInfo.icon(10)}
                            </span>
                            {count > 1 && (
                              <span className={`text-[7px] font-bold ml-px ${
                                selected && today ? "text-white/70" : selected ? "text-accent/70" : "text-gray-500"
                              }`}>
                                {count}
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
