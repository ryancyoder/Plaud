"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { AppEvent, Attachment } from "@/lib/types";
import { loadEvents } from "@/lib/event-store";
import { loadAttachments } from "@/lib/attachment-store";
import NavButtons from "@/components/NavButtons";

const COVER_KEY = "plaud-cover-photos"; // date -> eventId

function loadCoverMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const s = localStorage.getItem(COVER_KEY);
  return s ? JSON.parse(s) : {};
}

function saveCoverMap(map: Record<string, string>) {
  localStorage.setItem(COVER_KEY, JSON.stringify(map));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getMonthDates(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks: (string | null)[][] = [];
  let week: (string | null)[] = new Array(startDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    const str = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    week.push(str);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }
  return weeks;
}

interface DayPhotoData {
  coverUrl: string | null;
  photoCount: number;
  coverEventId: string | null;
  allPhotoEvents: { eventId: string; label: string; photos: Attachment[] }[];
}

export default function CalendarPage() {
  const today = new Date();
  const [monthOffset, setMonthOffset] = useState(0);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [coverMap, setCoverMap] = useState<Record<string, string>>({});
  const [dayPhotos, setDayPhotos] = useState<Record<string, DayPhotoData>>({});
  const [previewDate, setPreviewDate] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const viewDate = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [monthOffset]);

  const weeks = useMemo(() => getMonthDates(viewDate.year, viewDate.month), [viewDate]);
  const monthLabel = new Date(viewDate.year, viewDate.month).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const isCurrentMonth = monthOffset === 0;

  useEffect(() => {
    setEvents(loadEvents());
    setCoverMap(loadCoverMap());
    setMounted(true);
  }, []);

  // Get all photo events grouped by date for this month
  const photoEventsByDate = useMemo(() => {
    const map: Record<string, AppEvent[]> = {};
    for (const ev of events) {
      if (ev.type === "photo" && ev.attachments && ev.attachments.length > 0) {
        if (!map[ev.date]) map[ev.date] = [];
        map[ev.date].push(ev);
      }
    }
    return map;
  }, [events]);

  // Load actual photo data (from IndexedDB) for visible dates
  useEffect(() => {
    if (!mounted) return;
    const visibleDates = weeks.flat().filter((d): d is string => d !== null);
    const datesWithPhotos = visibleDates.filter((d) => photoEventsByDate[d]?.length);

    async function loadPhotos() {
      const result: Record<string, DayPhotoData> = {};

      for (const date of datesWithPhotos) {
        const photoEvents = photoEventsByDate[date];
        const allPhotoEvents: DayPhotoData["allPhotoEvents"] = [];
        let totalPhotos = 0;

        for (const ev of photoEvents) {
          const atts = await loadAttachments(ev.id);
          const photos = atts.filter((a) => a.mimeType?.startsWith("image/") || a.type === "photo");
          if (photos.length > 0) {
            allPhotoEvents.push({ eventId: ev.id, label: ev.label, photos });
            totalPhotos += photos.length;
          }
        }

        // Determine cover: user-selected event, or first event with photos
        const userCoverEventId = coverMap[date];
        const coverEvent = userCoverEventId
          ? allPhotoEvents.find((e) => e.eventId === userCoverEventId) || allPhotoEvents[0]
          : allPhotoEvents[0];

        result[date] = {
          coverUrl: coverEvent?.photos[0]?.dataUrl || null,
          photoCount: totalPhotos,
          coverEventId: coverEvent?.eventId || null,
          allPhotoEvents,
        };
      }

      setDayPhotos(result);
    }

    loadPhotos();
  }, [mounted, weeks, photoEventsByDate, coverMap]);

  const handleSetCover = useCallback((date: string, eventId: string) => {
    setCoverMap((prev) => {
      const next = { ...prev, [date]: eventId };
      saveCoverMap(next);
      return next;
    });
  }, []);

  if (!mounted) return null;

  const previewData = previewDate ? dayPhotos[previewDate] : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface">
        <div className="flex items-center gap-2">
          <Link href="/" className="text-base font-bold tracking-tight hover:text-accent">Plaud</Link>
          <Link href="/board" className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Board</Link>
          <Link href="/actions" className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Actions</Link>
          <Link href="/map" className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">Map</Link>
          <span className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-accent bg-accent-light border border-accent/20">Calendar</span>
        </div>
        <NavButtons />
      </header>

      {/* Month Navigation */}
      <div className="shrink-0 flex items-center justify-center gap-3 py-3 border-b border-border bg-surface">
        <button
          onClick={() => setMonthOffset((o) => o - 1)}
          className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-base font-bold min-w-[180px] text-center">{monthLabel}</span>
          {!isCurrentMonth && (
            <button
              onClick={() => setMonthOffset(0)}
              className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white hover:bg-blue-600 active:scale-95"
            >
              Today
            </button>
          )}
        </div>
        <button
          onClick={() => setMonthOffset((o) => o + 1)}
          className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="flex-1 overflow-hidden p-3">
        <div className="h-full flex flex-col">
          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-[10px] font-semibold text-muted text-center py-1">{d}</div>
            ))}
          </div>

          {/* Weeks */}
          <div className="flex-1 grid gap-1" style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}>
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-1">
                {week.map((date, di) => {
                  if (!date) return <div key={di} className="rounded-lg bg-gray-50/50" />;

                  const isToday = date === todayStr();
                  const data = dayPhotos[date];
                  const hasCover = !!data?.coverUrl;

                  return (
                    <button
                      key={date}
                      onClick={() => {
                        if (data?.allPhotoEvents.length) setPreviewDate(date);
                      }}
                      className={`relative rounded-lg overflow-hidden border transition-all ${
                        isToday
                          ? "border-accent ring-1 ring-accent"
                          : hasCover
                          ? "border-gray-200 hover:border-accent hover:shadow-md"
                          : "border-gray-100 hover:border-gray-300"
                      }`}
                    >
                      {/* Cover photo */}
                      {hasCover && (
                        <img
                          src={data.coverUrl!}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}

                      {/* Day number */}
                      <div className={`absolute top-1 left-1.5 text-xs font-bold ${
                        hasCover
                          ? "text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
                          : isToday ? "text-accent" : "text-gray-400"
                      }`}>
                        {new Date(date + "T00:00:00").getDate()}
                      </div>

                      {/* Photo count badge */}
                      {data && data.photoCount > 0 && (
                        <div className="absolute top-1 right-1 bg-accent text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 shadow">
                          {data.photoCount}
                        </div>
                      )}

                      {/* Spacer to maintain aspect ratio */}
                      {!hasCover && <div className="w-full" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Photo Preview Modal */}
      {previewDate && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPreviewDate(null)}>
          <div
            className="bg-white rounded-xl shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-bold">
                {new Date(previewDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted">{previewData.photoCount} photo{previewData.photoCount !== 1 ? "s" : ""}</span>
                <button onClick={() => setPreviewDate(null)} className="p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l10 10M15 5L5 15" /></svg>
                </button>
              </div>
            </div>

            {/* Photo groups by event */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {previewData.allPhotoEvents.map((group) => {
                const isCover = previewData.coverEventId === group.eventId;
                return (
                  <div key={group.eventId}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold">{group.label}</span>
                      <button
                        onClick={() => handleSetCover(previewDate, group.eventId)}
                        className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${
                          isCover
                            ? "bg-accent text-white"
                            : "bg-gray-100 text-muted hover:bg-gray-200"
                        }`}
                      >
                        {isCover ? "Cover Photo" : "Set as Cover"}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {group.photos.map((photo) => (
                        <div
                          key={photo.id}
                          className={`aspect-square rounded-lg overflow-hidden border-2 ${
                            isCover && photo.id === group.photos[0]?.id
                              ? "border-accent ring-1 ring-accent"
                              : "border-gray-200"
                          }`}
                        >
                          <img src={photo.dataUrl} alt={photo.name} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border">
              <button
                onClick={() => setPreviewDate(null)}
                className="w-full py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-blue-600 active:scale-[0.98]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
