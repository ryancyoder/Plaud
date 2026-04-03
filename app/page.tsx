"use client";

import { useState, useEffect, useCallback } from "react";
import { Transcript } from "@/lib/types";
import { getWeekDates } from "@/lib/mock-data";
import { loadTranscripts, saveTranscripts } from "@/lib/store";
import WeekCalendar from "@/components/WeekCalendar";
import SummaryBar from "@/components/SummaryBar";
import ViewerPanel from "@/components/ViewerPanel";
import ImportButton from "@/components/ImportButton";

function getWeekLabel(weekDates: string[]): string {
  const start = new Date(weekDates[0] + "T00:00:00");
  const end = new Date(weekDates[6] + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString("en-US", { ...opts, year: "numeric" })} – ${end.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
  }
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}, ${start.getFullYear()}`;
}

export default function Dashboard() {
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTranscripts(loadTranscripts());
    setMounted(true);
  }, []);

  const currentWeek = getWeekDates(weekOffset);
  const currentWeekTranscripts = transcripts.filter((t) => currentWeek.includes(t.date));

  const actionItems = transcripts.flatMap((t) => t.actionItems);
  const callItems = transcripts.flatMap((t) => t.calls);
  const errandItems = transcripts.flatMap((t) => t.errands);

  const handleImport = useCallback((newTranscripts: Transcript[]) => {
    setTranscripts((prev) => [...prev, ...newTranscripts]);
  }, []);

  const handleClearData = useCallback(() => {
    if (window.confirm("Clear all imported transcripts? This cannot be undone.")) {
      saveTranscripts([]);
      setTranscripts([]);
      setSelectedTranscript(null);
    }
  }, []);

  const getTranscriptsForDate = useCallback(
    (date: string) => transcripts.filter((t) => t.date === date),
    [transcripts]
  );

  if (!mounted) return null;

  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-5 py-2.5 flex items-center justify-between border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <h1 className="text-lg font-bold tracking-tight">Plaud Dashboard</h1>
        </div>

        {/* Week navigation - centered */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 rounded-lg text-muted hover:bg-gray-100 active:scale-95 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold min-w-[180px] text-center">{getWeekLabel(currentWeek)}</h2>
            {!isCurrentWeek && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white hover:bg-blue-600 active:scale-95"
              >
                Today
              </button>
            )}
          </div>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 rounded-lg text-muted hover:bg-gray-100 active:scale-95 transition-all"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <ImportButton onImport={handleImport} />
          {transcripts.length > 0 && (
            <button
              onClick={handleClearData}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50 active:scale-95 transition-all"
            >
              Clear
            </button>
          )}
        </div>
      </header>

      {/* Main content: 2/3 calendar, 1/3 viewer */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left 2/3: Calendar */}
        <div className="flex-[2] flex flex-col overflow-y-auto border-r border-border">
          {/* Week summary */}
          <div className="shrink-0 p-3 pb-0">
            <SummaryBar
              label={getWeekLabel(currentWeek)}
              transcripts={currentWeekTranscripts}
              variant={isCurrentWeek ? "this-week" : "next-week"}
            />
          </div>

          {/* Calendar rows */}
          <div className="flex-1 p-3 overflow-y-auto">
            <WeekCalendar
              weekDates={currentWeek}
              onSelectTranscript={setSelectedTranscript}
              getTranscriptsForDate={getTranscriptsForDate}
              selectedTranscriptId={selectedTranscript?.id}
            />
          </div>
        </div>

        {/* Right 1/3: Viewer panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <ViewerPanel
            selectedTranscript={selectedTranscript}
            actionItems={actionItems}
            callItems={callItems}
            errandItems={errandItems}
            onClose={() => setSelectedTranscript(null)}
          />
        </div>
      </div>
    </div>
  );
}
