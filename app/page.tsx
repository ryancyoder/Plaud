"use client";

import { useState, useEffect, useCallback } from "react";
import { Transcript } from "@/lib/types";
import { getWeekDates } from "@/lib/mock-data";
import { loadTranscripts, saveTranscripts } from "@/lib/store";
import WeekCalendar from "@/components/WeekCalendar";
import SummaryBar from "@/components/SummaryBar";
import SidebarLists from "@/components/SidebarLists";
import TranscriptDetail from "@/components/TranscriptDetail";
import ImportButton from "@/components/ImportButton";

export default function Dashboard() {
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTranscripts(loadTranscripts());
    setMounted(true);
  }, []);

  const thisWeek = getWeekDates(0);
  const nextWeek = getWeekDates(1);

  const thisWeekTranscripts = transcripts.filter((t) => thisWeek.includes(t.date));
  const nextWeekTranscripts = transcripts.filter((t) => nextWeek.includes(t.date));

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
    }
  }, []);

  const getTranscriptsForDate = useCallback(
    (date: string) => transcripts.filter((t) => t.date === date),
    [transcripts]
  );

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-5 py-3 flex items-center justify-between border-b border-border bg-surface">
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
        <div className="flex items-center gap-4">
          <ImportButton onImport={handleImport} />
          {transcripts.length > 0 && (
            <button
              onClick={handleClearData}
              className="px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 active:scale-95 transition-all"
            >
              Clear Data
            </button>
          )}
          <div className="text-sm text-muted">
            {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Calendar area */}
        <div className="flex-1 flex flex-col overflow-y-auto p-4 gap-4">
          {/* This Week Summary */}
          <SummaryBar
            label="This Week"
            transcripts={thisWeekTranscripts}
            variant="this-week"
          />

          {/* Calendar */}
          <WeekCalendar
            weekDates={thisWeek}
            onSelectTranscript={setSelectedTranscript}
            getTranscriptsForDate={getTranscriptsForDate}
          />

          {/* Next Week Summary */}
          <SummaryBar
            label="Next Week"
            transcripts={nextWeekTranscripts}
            variant="next-week"
          />
        </div>

        {/* Right: Sidebar lists */}
        <div className="w-80 shrink-0 border-l border-border p-4 overflow-hidden flex flex-col">
          <SidebarLists
            actionItems={actionItems}
            callItems={callItems}
            errandItems={errandItems}
          />
        </div>
      </div>

      {/* Transcript detail modal */}
      {selectedTranscript && (
        <TranscriptDetail
          transcript={selectedTranscript}
          onClose={() => setSelectedTranscript(null)}
        />
      )}
    </div>
  );
}
