"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { AppEvent } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getTagColor, formatDate } from "@/lib/utils";
import { getCachedSummary, generateDailySummary, hasApiKey } from "@/lib/claude-api";

interface DayCalendarProps {
  date: string;
  events: AppEvent[];
  onSelectEvent: (event: AppEvent) => void;
  onDeleteEvent?: (eventId: string) => void;
  selectedEventId?: string;
}

function renderMarkdown(md: string): string {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-xs mt-2 mb-0.5">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-sm mt-2 mb-0.5">$1</h3>')
    .replace(/^# (.+)$/gm, '<h3 class="font-bold text-sm mt-2 mb-0.5">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[-*] (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-1">$1</ul>')
    .replace(/\n{2,}/g, '<div class="h-1.5"></div>')
    .replace(/\n/g, "<br>");
}

export default function DayCalendar({ date, events, onSelectEvent, onDeleteEvent, selectedEventId }: DayCalendarProps) {
  const [viewMode, setViewMode] = useState<"granular" | "summary">("granular");
  const today = isToday(date);
  const past = isPast(date);
  const recordings = events.filter((e) => e.type === "recording");
  const sorted = [...recordings].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const summaryId = `summary-${date}`;
  const isSummarySelected = selectedEventId === summaryId;

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
        <div className="ml-auto flex items-center gap-2.5">
          <span className={`text-xs ${today ? "text-white/70" : "text-muted"}`}>
            {sorted.length} recording{sorted.length !== 1 ? "s" : ""}
            {sorted.length > 0 && ` · ${formatDuration(sorted.reduce((s, e) => s + (e.duration || 0), 0))}`}
          </span>
          {sorted.length > 0 && (
            <button
              onClick={() => setViewMode((v) => v === "granular" ? "summary" : "granular")}
              className={`p-1.5 rounded-lg transition-colors ${today ? "hover:bg-white/20 text-white/80" : "hover:bg-gray-100 text-muted"}`}
              title={viewMode === "granular" ? "Show daily summary" : "Show segments"}
            >
              {viewMode === "granular" ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-300">
            No recordings for this day
          </div>
        ) : viewMode === "summary" ? (
          <DaySummaryCard date={date} events={sorted} onSelect={onSelectEvent} isSelected={isSummarySelected} />
        ) : (
          <div className="divide-y divide-gray-100">
            {sorted.map((ev) => (
              <EventRow key={ev.id} event={ev} onSelect={onSelectEvent} onDelete={onDeleteEvent} isSelected={selectedEventId === ev.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DaySummaryCard({ date, events, onSelect, isSelected }: {
  date: string; events: AppEvent[]; onSelect: (e: AppEvent) => void; isSelected: boolean;
}) {
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedSummary(date);
    if (cached) setAiSummary(cached);
  }, [date]);

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasApiKey()) { setError("Set your Claude API key in Settings first"); return; }
    setLoading(true); setError(null);
    try {
      const segments = events.map((ev) => ({
        startTime: ev.startTime || "00:00",
        duration: ev.duration || 0,
        title: ev.label,
        text: ev.fullTranscript || ev.summary || ev.label,
      }));
      const result = await generateDailySummary(date, segments);
      setAiSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally { setLoading(false); }
  }, [date, events]);

  // Create a synthetic event for the viewer
  const summaryEvent: AppEvent = {
    id: `summary-${date}`,
    type: "note",
    date,
    label: `Daily Summary — ${date}`,
    summary: aiSummary || events.map((e) => `${e.startTime} — ${e.label}`).join("\n"),
    duration: events.reduce((s, e) => s + (e.duration || 0), 0),
    participants: [...new Set(events.flatMap((e) => e.participants || []))],
  };

  return (
    <div
      onClick={() => onSelect(summaryEvent)}
      className={`w-full text-left px-4 py-3 cursor-pointer transition-colors ${isSelected ? "bg-accent-light" : "hover:bg-gray-50 active:bg-gray-100"}`}
    >
      {aiSummary ? (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase text-purple-600">AI Summary</span>
            <button onClick={handleGenerate} className="text-[10px] text-muted hover:text-accent" title="Regenerate">↻</button>
          </div>
          <div className="text-xs text-gray-700 leading-relaxed prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary) }} />
        </div>
      ) : (
        <div className="mb-2">
          <button onClick={handleGenerate} disabled={loading} className="text-[11px] px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 font-medium hover:bg-purple-50 active:scale-95 disabled:opacity-50">
            {loading ? "Generating..." : "Generate AI Summary"}
          </button>
          {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
          <div className="mt-2 space-y-0.5">
            {events.map((e) => (
              <p key={e.id} className="text-xs text-gray-500 leading-snug truncate">
                <span className="font-semibold">{e.startTime}</span> {e.label.length > 60 ? e.label.slice(0, 60) + "..." : e.label}
              </p>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted">
        <span>{events.length} segment{events.length !== 1 ? "s" : ""}</span>
        <span>{formatDuration(events.reduce((s, e) => s + (e.duration || 0), 0))}</span>
      </div>
    </div>
  );
}

function EventRow({ event, onSelect, onDelete, isSelected }: {
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
            <div className="text-[10px] text-muted">{formatDuration(event.duration || 0)}</div>
          </div>
          <div className={`shrink-0 w-1 self-stretch rounded-full ${tagColor.bg.replace("100", "500")}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold truncate">
                {event.label.length > 60 ? event.label.slice(0, 60) + "..." : event.label}
              </h4>
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
