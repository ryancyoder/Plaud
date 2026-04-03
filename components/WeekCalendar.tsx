"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Transcript } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getBlockColor, getTagColor, formatDate } from "@/lib/utils";
import { createDailySummary } from "@/lib/daily-summary";
import { getCachedSummary, generateDailySummary, hasApiKey } from "@/lib/claude-api";

interface WeekCalendarProps {
  weekDates: string[]; // Mon-Sun, 7 dates
  onSelectTranscript: (transcript: Transcript) => void;
  onDeleteTranscript?: (transcriptId: string) => void;
  getTranscriptsForDate: (date: string) => Transcript[];
  selectedTranscriptId?: string;
  viewMode?: "granular" | "summary";
}

const WEEKDAY_DATES = (dates: string[]) => dates.slice(0, 5); // Mon-Fri
const WEEKEND_DATES = (dates: string[]) => dates.slice(5, 7); // Sat-Sun

/** Lightweight markdown-to-HTML for AI summaries */
function renderMarkdown(md: string): string {
  return md
    // Escape HTML
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    // Headers
    .replace(/^### (.+)$/gm, '<h4 class="font-semibold text-xs mt-2 mb-0.5">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="font-semibold text-sm mt-2 mb-0.5">$1</h3>')
    .replace(/^# (.+)$/gm, '<h3 class="font-bold text-sm mt-2 mb-0.5">$1</h3>')
    // Bold and italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li class="ml-3 list-disc">$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-1">$1</ul>')
    // Line breaks for remaining lines
    .replace(/\n{2,}/g, '<div class="h-1.5"></div>')
    .replace(/\n/g, "<br>");
}

export default function WeekCalendar({ weekDates, onSelectTranscript, onDeleteTranscript, getTranscriptsForDate, selectedTranscriptId, viewMode = "granular" }: WeekCalendarProps) {
  const weekdays = WEEKDAY_DATES(weekDates);
  const weekend = WEEKEND_DATES(weekDates);

  return (
    <div className="flex flex-col gap-3">
      {/* Weekdays */}
      {weekdays.map((date) => (
        <DayRow
          key={date}
          date={date}
          transcripts={getTranscriptsForDate(date)}
          onSelect={onSelectTranscript}
          onDelete={onDeleteTranscript}
          selectedId={selectedTranscriptId}
          viewMode={viewMode}
        />
      ))}

      {/* Weekend section */}
      {weekend.some((d) => getTranscriptsForDate(d).length > 0) && (
        <>
          <div className="text-xs font-semibold uppercase text-muted tracking-wider px-1 pt-2">
            Weekend
          </div>
          {weekend.map((date) => {
            const transcripts = getTranscriptsForDate(date);
            if (transcripts.length === 0) return null;
            return (
              <DayRow
                key={date}
                date={date}
                transcripts={transcripts}
                onSelect={onSelectTranscript}
                selectedId={selectedTranscriptId}
                viewMode={viewMode}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

interface DayRowProps {
  date: string;
  transcripts: Transcript[];
  onSelect: (transcript: Transcript) => void;
  onDelete?: (transcriptId: string) => void;
  selectedId?: string;
  viewMode: "granular" | "summary";
}

function DayRow({ date, transcripts, onSelect, onDelete, selectedId, viewMode }: DayRowProps) {
  const today = isToday(date);
  const past = isPast(date);
  const sorted = [...transcripts].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const summaryId = `summary-${date}`;
  const isSummarySelected = selectedId === summaryId;

  return (
    <div className={`rounded-xl border overflow-hidden ${today ? "border-accent bg-blue-50/30" : "border-border bg-surface"}`}>
      {/* Day header */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${today ? "bg-accent text-white border-accent" : past ? "bg-gray-50 border-border" : "border-border"}`}>
        <div className={`text-2xl font-bold leading-none ${today ? "text-white" : ""}`}>
          {getDayNumber(date)}
        </div>
        <div>
          <div className={`text-sm font-medium ${today ? "text-white" : ""}`}>
            {getDayName(date)}
          </div>
          <div className={`text-[11px] ${today ? "text-white/70" : "text-muted"}`}>
            {formatDate(date)}
          </div>
        </div>
        <div className={`ml-auto text-xs ${today ? "text-white/70" : "text-muted"}`}>
          {sorted.length} recording{sorted.length !== 1 ? "s" : ""}
          {sorted.length > 0 && ` · ${formatDuration(sorted.reduce((s, t) => s + t.duration, 0))}`}
        </div>
      </div>

      {/* Content: granular or summary */}
      {sorted.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-300">No recordings</div>
      ) : viewMode === "summary" ? (
        <DaySummaryCard
          date={date}
          transcripts={sorted}
          onSelect={onSelect}
          isSelected={isSummarySelected}
        />
      ) : (
        <div className="divide-y divide-gray-100">
          {sorted.map((t) => (
            <TranscriptRow
              key={t.id}
              transcript={t}
              onSelect={onSelect}
              onDelete={onDelete}
              isSelected={selectedId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TranscriptRowProps {
  transcript: Transcript;
  onSelect: (transcript: Transcript) => void;
  onDelete?: (transcriptId: string) => void;
  isSelected: boolean;
}

interface DaySummaryCardProps {
  date: string;
  transcripts: Transcript[];
  onSelect: (transcript: Transcript) => void;
  isSelected: boolean;
}

function DaySummaryCard({ date, transcripts, onSelect, isSelected }: DaySummaryCardProps) {
  const baseSummary = createDailySummary(date, transcripts);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load cached summary on mount
  useEffect(() => {
    const cached = getCachedSummary(date);
    if (cached) setAiSummary(cached);
  }, [date]);

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasApiKey()) {
      setError("Set your Claude API key in Settings first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const segments = transcripts.map((t) => ({
        startTime: t.startTime,
        duration: t.duration,
        title: t.title,
        text: t.fullTranscript || t.summary || t.title,
      }));
      const result = await generateDailySummary(date, segments);
      setAiSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setLoading(false);
    }
  }, [date, transcripts]);

  // Build the synthetic transcript to show in viewer when clicked
  const viewerTranscript = {
    ...baseSummary,
    summary: aiSummary || baseSummary.summary,
  };

  return (
    <div
      onClick={() => onSelect(viewerTranscript)}
      className={`w-full text-left px-4 py-3 cursor-pointer transition-colors ${
        isSelected ? "bg-accent-light" : "hover:bg-gray-50 active:bg-gray-100"
      }`}
    >
      {/* AI summary or generate button */}
      {aiSummary ? (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase text-purple-600">AI Summary</span>
            <button
              onClick={handleGenerate}
              className="text-[10px] text-muted hover:text-accent"
              title="Regenerate"
            >
              ↻
            </button>
          </div>
          <div
            className="text-xs text-gray-700 leading-relaxed prose-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary) }}
          />
        </div>
      ) : (
        <div className="mb-2">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 font-medium hover:bg-purple-50 active:scale-95 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate AI Summary"}
          </button>
          {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
          {/* Fallback: show segment titles */}
          <div className="mt-2 space-y-0.5">
            {transcripts.map((t, i) => (
              <p key={i} className="text-xs text-gray-500 leading-snug truncate">
                <span className="font-semibold">{t.startTime}</span> {t.title.length > 60 ? t.title.slice(0, 60) + "..." : t.title}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-muted">
        <span>{transcripts.length} segment{transcripts.length !== 1 ? "s" : ""}</span>
        <span>{formatDuration(transcripts.reduce((s, t) => s + t.duration, 0))}</span>
      </div>
    </div>
  );
}

function TranscriptRow({ transcript, onSelect, onDelete, isSelected }: TranscriptRowProps) {
  const primaryTag = transcript.tags[0];
  const tagColor = primaryTag ? getTagColor(primaryTag) : { bg: "bg-gray-100", text: "text-gray-700" };

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
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        isHorizontal.current = Math.abs(dx) > Math.abs(dy);
      }
      return;
    }
    if (!isHorizontal.current) return;
    if (dx < 0) setOffsetX(dx);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (offsetX < -DELETE_THRESHOLD) {
      setSwiped(true);
      setOffsetX(-DELETE_THRESHOLD);
    } else {
      setOffsetX(0);
    }
    isHorizontal.current = null;
  }, [offsetX]);

  return (
    <div className="relative overflow-hidden">
      {/* Delete background */}
      <div className="absolute inset-0 flex items-center justify-end bg-red-500 px-5">
        <button
          onClick={() => onDelete?.(transcript.id)}
          className="text-white text-xs font-bold"
        >
          Delete
        </button>
      </div>

      {/* Swipeable content */}
      <div
        className="relative bg-surface"
        style={{
          transform: `translateX(${swiped ? -DELETE_THRESHOLD : offsetX}px)`,
          transition: offsetX === 0 || swiped ? "transform 0.2s ease" : "none",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <button
          onClick={() => {
            if (swiped) {
              setSwiped(false);
              setOffsetX(0);
            } else {
              onSelect(transcript);
            }
          }}
          className={`w-full text-left flex items-start gap-3 px-4 py-2.5 transition-colors ${
            isSelected ? "bg-accent-light" : "hover:bg-gray-50 active:bg-gray-100"
          }`}
        >
          <div className="shrink-0 w-14 pt-0.5">
            <div className="text-sm font-semibold tabular-nums">{transcript.startTime}</div>
            <div className="text-[10px] text-muted">{formatDuration(transcript.duration)}</div>
          </div>

          <div className={`shrink-0 w-1 self-stretch rounded-full ${tagColor.bg.replace("100", "500")}`} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold truncate">
                {transcript.title.length > 60 ? transcript.title.slice(0, 60) + "..." : transcript.title}
              </h4>
              {transcript.tags.map((tag) => {
                const c = getTagColor(tag);
                return (
                  <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${c.bg} ${c.text}`}>
                    {tag}
                  </span>
                );
              })}
              {(transcript.attachments?.length ?? 0) > 0 && (
                <span className="flex items-center gap-0.5 text-[10px] text-gray-400 shrink-0">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  {transcript.attachments!.length}
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 self-center text-gray-300">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  );
}
