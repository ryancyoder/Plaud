"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Transcript, Attachment, Client } from "@/lib/types";
import { getWeekDates } from "@/lib/mock-data";
import { loadTranscripts, saveTranscripts } from "@/lib/store";
import { loadClients, getTranscriptsForClient } from "@/lib/clients";
import {
  saveAttachments as dbSaveAttachments,
  removeAttachment as dbRemoveAttachment,
  loadAllAttachments,
  clearAllAttachments,
  resizeImage,
} from "@/lib/attachment-store";
import WeekCalendar from "@/components/WeekCalendar";
import SummaryBar from "@/components/SummaryBar";
import ViewerPanel from "@/components/ViewerPanel";
import ClientRoster from "@/components/ClientRoster";
import ImportButton from "@/components/ImportButton";
import BatchPhotoImport from "@/components/BatchPhotoImport";
import { PhotoMatchResult } from "@/lib/photo-matcher";

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
  const [viewMode, setViewMode] = useState<"granular" | "summary">("granular");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = loadTranscripts();
    // Strip any leftover dataUrl attachments from localStorage (migrated to IndexedDB)
    const cleaned = stored.map((t) => ({
      ...t,
      attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
    }));
    setClients(loadClients());

    // Load attachment data from IndexedDB and merge
    loadAllAttachments()
      .then((allAtts) => {
        const merged = cleaned.map((t) => ({
          ...t,
          attachments: allAtts[t.id] || t.attachments || [],
        }));
        setTranscripts(merged);
        setMounted(true);
      })
      .catch(() => {
        setTranscripts(cleaned);
        setMounted(true);
      });
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
      clearAllAttachments().catch(() => {});
      setTranscripts([]);
      setSelectedTranscript(null);
    }
  }, []);

  const handleClientsChange = useCallback(() => {
    setClients(loadClients());
  }, []);

  const handleAddAttachments = useCallback(async (transcriptId: string, newAttachments: Attachment[]) => {
    // Resize images before storing
    const processed = await Promise.all(
      newAttachments.map(async (att) => {
        if (att.mimeType.startsWith("image/")) {
          const resized = await resizeImage(att.dataUrl, 1200);
          return { ...att, dataUrl: resized };
        }
        return att;
      })
    );

    // Save full data to IndexedDB
    await dbSaveAttachments(transcriptId, processed);

    // Update in-memory state with full data
    setTranscripts((prev) => {
      const updated = prev.map((t) =>
        t.id === transcriptId
          ? { ...t, attachments: [...(t.attachments || []), ...processed] }
          : t
      );
      // Save to localStorage WITHOUT dataUrl (just metadata)
      const forStorage = updated.map((t) => ({
        ...t,
        attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveTranscripts(forStorage);
      return updated;
    });
    setSelectedTranscript((prev) =>
      prev?.id === transcriptId
        ? { ...prev, attachments: [...(prev.attachments || []), ...processed] }
        : prev
    );
  }, []);

  const handleRemoveAttachment = useCallback(async (transcriptId: string, attachmentId: string) => {
    // Remove from IndexedDB
    await dbRemoveAttachment(attachmentId);

    setTranscripts((prev) => {
      const updated = prev.map((t) =>
        t.id === transcriptId
          ? { ...t, attachments: (t.attachments || []).filter((a) => a.id !== attachmentId) }
          : t
      );
      const forStorage = updated.map((t) => ({
        ...t,
        attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveTranscripts(forStorage);
      return updated;
    });
    setSelectedTranscript((prev) =>
      prev?.id === transcriptId
        ? { ...prev, attachments: (prev.attachments || []).filter((a) => a.id !== attachmentId) }
        : prev
    );
  }, []);

  const handleBatchPhotos = useCallback(async (results: PhotoMatchResult[]) => {
    // Save all matched attachments to IndexedDB
    for (const r of results) {
      await dbSaveAttachments(r.transcriptId, r.attachments);
    }

    // Update in-memory transcript state
    setTranscripts((prev) => {
      const updated = prev.map((t) => {
        const match = results.find((r) => r.transcriptId === t.id);
        if (!match) return t;
        return { ...t, attachments: [...(t.attachments || []), ...match.attachments] };
      });
      const forStorage = updated.map((t) => ({
        ...t,
        attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveTranscripts(forStorage);
      return updated;
    });

    // Update selected transcript if affected
    setSelectedTranscript((prev) => {
      if (!prev) return prev;
      const match = results.find((r) => r.transcriptId === prev.id);
      if (!match) return prev;
      return { ...prev, attachments: [...(prev.attachments || []), ...match.attachments] };
    });
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
          {/* View mode toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setViewMode("granular")}
              className={`px-2.5 py-1.5 text-[10px] font-medium transition-colors ${
                viewMode === "granular"
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-gray-50"
              }`}
            >
              Granular
            </button>
            <button
              onClick={() => setViewMode("summary")}
              className={`px-2.5 py-1.5 text-[10px] font-medium transition-colors border-l border-border ${
                viewMode === "summary"
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-gray-50"
              }`}
            >
              Daily Summary
            </button>
          </div>
          <ImportButton onImport={handleImport} />
          <BatchPhotoImport transcripts={transcripts} onPhotosMatched={handleBatchPhotos} />
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
              viewMode={viewMode}
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
            clients={clients}
            onClose={() => setSelectedTranscript(null)}
            onAddAttachments={handleAddAttachments}
            onRemoveAttachment={handleRemoveAttachment}
            onAssignClient={(transcriptId, clientName) => {
              setTranscripts((prev) => {
                const updated = prev.map((t) =>
                  t.id === transcriptId ? { ...t, clientName } : t
                );
                saveTranscripts(updated);
                return updated;
              });
              if (selectedTranscript?.id === transcriptId) {
                setSelectedTranscript((prev) =>
                  prev ? { ...prev, clientName } : null
                );
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
