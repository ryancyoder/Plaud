"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Transcript, Client } from "@/lib/types";
import { getWeekDates } from "@/lib/mock-data";
import { loadTranscripts, saveTranscripts } from "@/lib/store";
import { loadClients, getTranscriptsForClient } from "@/lib/clients";
import WeekCalendar from "@/components/WeekCalendar";
import SummaryBar from "@/components/SummaryBar";
import ViewerPanel from "@/components/ViewerPanel";
import ClientRoster from "@/components/ClientRoster";
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
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTranscripts(loadTranscripts());
    setClients(loadClients());
    setMounted(true);
  }, []);

  const currentWeek = getWeekDates(weekOffset);

  // Filter transcripts by selected client
  const visibleTranscripts = useMemo(() => {
    if (!selectedClient) return transcripts;
    return getTranscriptsForClient(transcripts, selectedClient);
  }, [transcripts, selectedClient]);

  const currentWeekTranscripts = visibleTranscripts.filter((t) => currentWeek.includes(t.date));

  const actionItems = visibleTranscripts.flatMap((t) => t.actionItems);
  const callItems = visibleTranscripts.flatMap((t) => t.calls);
  const errandItems = visibleTranscripts.flatMap((t) => t.errands);

  // Count transcripts per client for badges
  const transcriptCountByClient = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const client of clients) {
      counts[client.id] = getTranscriptsForClient(transcripts, client).length;
    }
    return counts;
  }, [transcripts, clients]);

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

  const handleClientsChange = useCallback(() => {
    setClients(loadClients());
  }, []);

  const getTranscriptsForDate = useCallback(
    (date: string) => visibleTranscripts.filter((t) => t.date === date),
    [visibleTranscripts]
  );

  if (!mounted) return null;

  const isCurrentWeek = weekOffset === 0;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </div>
          <h1 className="text-base font-bold tracking-tight">Plaud</h1>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold min-w-[160px] text-center">{getWeekLabel(currentWeek)}</span>
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
            className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <ImportButton onImport={handleImport} />
          {transcripts.length > 0 && (
            <button
              onClick={handleClearData}
              className="px-2 py-1.5 rounded-lg text-[10px] font-medium text-red-600 border border-red-200 hover:bg-red-50 active:scale-95"
            >
              Clear
            </button>
          )}
        </div>
      </header>

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Client Roster */}
        <div className="w-56 shrink-0 border-r border-border overflow-hidden">
          <ClientRoster
            clients={clients}
            selectedClientId={selectedClient?.id || null}
            onSelectClient={setSelectedClient}
            onClientsChange={handleClientsChange}
            transcriptCountByClient={transcriptCountByClient}
          />
        </div>

        {/* Center: Calendar */}
        <div className="flex-[2] flex flex-col overflow-hidden border-r border-border">
          {/* Summary bar */}
          <div className="shrink-0 p-3 pb-0">
            <SummaryBar
              label={selectedClient ? `${selectedClient.name} — ${getWeekLabel(currentWeek)}` : getWeekLabel(currentWeek)}
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

        {/* Right: Viewer Panel */}
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
