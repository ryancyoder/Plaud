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
  clearPendingPhotos,
  loadPendingPhotos,
  removePendingPhotos,
  resizeImage,
} from "@/lib/attachment-store";
import { matchPhotoToTranscript, PhotoMatchResult } from "@/lib/photo-matcher";
import { hasApiKey, processSegmentWithAI } from "@/lib/claude-api";
import { isToday } from "@/lib/utils";
import DayCalendar from "@/components/DayCalendar";
import ViewerPanel from "@/components/ViewerPanel";
import ClientRoster from "@/components/ClientRoster";
import WeekNav from "@/components/WeekNav";
import ImportButton from "@/components/ImportButton";
import BatchPhotoImport from "@/components/BatchPhotoImport";
import SettingsModal from "@/components/SettingsModal";

type SidebarTab = "calendar" | "contacts";

function getWeekLabel(weekDates: string[]): string {
  const start = new Date(weekDates[0] + "T00:00:00");
  const end = new Date(weekDates[6] + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.toLocaleDateString("en-US", { ...opts, year: "numeric" })} – ${end.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
  }
  return `${start.toLocaleDateString("en-US", opts)} – ${end.toLocaleDateString("en-US", opts)}, ${start.getFullYear()}`;
}

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [viewMode, setViewMode] = useState<"granular" | "summary">("granular");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("calendar");
  const [pendingPhotoCount, setPendingPhotoCount] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = loadTranscripts();
    const cleaned = stored.map((t) => ({
      ...t,
      attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
    }));
    setClients(loadClients());

    Promise.all([loadAllAttachments(), loadPendingPhotos()])
      .then(([allAtts, pending]) => {
        const merged = cleaned.map((t) => ({
          ...t,
          attachments: allAtts[t.id] || t.attachments || [],
        }));
        setPendingPhotoCount(pending.length);
        setTranscripts(merged);
        setMounted(true);
      })
      .catch(() => {
        setTranscripts(cleaned);
        setMounted(true);
      });
  }, []);

  const currentWeek = getWeekDates(weekOffset);

  // Keep selectedDate in sync with week navigation
  useEffect(() => {
    if (!currentWeek.includes(selectedDate)) {
      // Find today in the new week, or default to Monday
      const todayInWeek = currentWeek.find((d) => isToday(d));
      setSelectedDate(todayInWeek || currentWeek[0]);
    }
  }, [currentWeek, selectedDate]);

  // Filter transcripts by selected client
  const visibleTranscripts = useMemo(() => {
    if (!selectedClient) return transcripts;
    return getTranscriptsForClient(transcripts, selectedClient);
  }, [transcripts, selectedClient]);

  const selectedDateTranscripts = useMemo(
    () => visibleTranscripts.filter((t) => t.date === selectedDate),
    [visibleTranscripts, selectedDate]
  );

  const actionItems = visibleTranscripts.flatMap((t) => t.actionItems);
  const callItems = visibleTranscripts.flatMap((t) => t.calls);
  const errandItems = visibleTranscripts.flatMap((t) => t.errands);

  const transcriptCountByClient = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const client of clients) {
      counts[client.id] = getTranscriptsForClient(transcripts, client).length;
    }
    return counts;
  }, [transcripts, clients]);

  const rematchPendingPhotos = useCallback(async (allTranscripts: Transcript[]) => {
    const pending = await loadPendingPhotos();
    if (pending.length === 0) return;

    const matched: Map<string, PhotoMatchResult> = new Map();
    const stillPendingIds: string[] = [];
    const matchedIds: string[] = [];

    for (const photo of pending) {
      const photoDate = new Date(photo.timestamp);
      const match = matchPhotoToTranscript(photoDate, allTranscripts);
      if (match) {
        matchedIds.push(photo.id);
        const existing = matched.get(match.id);
        if (existing) {
          existing.attachments.push(photo);
        } else {
          matched.set(match.id, {
            transcriptId: match.id,
            transcriptTitle: match.title,
            attachments: [photo],
          });
        }
      } else {
        stillPendingIds.push(photo.id);
      }
    }

    if (matched.size > 0) {
      const results = Array.from(matched.values());
      for (const r of results) {
        await dbSaveAttachments(r.transcriptId, r.attachments);
      }
      await removePendingPhotos(matchedIds);
      setTranscripts((prev) => {
        const updated = prev.map((t) => {
          const m = results.find((r) => r.transcriptId === t.id);
          if (!m) return t;
          return { ...t, attachments: [...(t.attachments || []), ...m.attachments] };
        });
        const forStorage = updated.map((t) => ({
          ...t,
          attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
        }));
        saveTranscripts(forStorage);
        return updated;
      });
      setSelectedTranscript((prev) => {
        if (!prev) return prev;
        const m = results.find((r) => r.transcriptId === prev.id);
        if (!m) return prev;
        return { ...prev, attachments: [...(prev.attachments || []), ...m.attachments] };
      });
    }

    setPendingPhotoCount(stillPendingIds.length);
  }, []);

  const handleImport = useCallback((newTranscripts: Transcript[]) => {
    setTranscripts((prev) => {
      const updated = [...prev, ...newTranscripts];
      rematchPendingPhotos(updated);
      return updated;
    });

    if (hasApiKey()) {
      (async () => {
        for (const t of newTranscripts) {
          try {
            const result = await processSegmentWithAI(t.fullTranscript || t.summary || "");
            if (!result) break;
            setTranscripts((prev) => {
              const updated = prev.map((p) =>
                p.id === t.id ? { ...p, title: result.title, summary: result.summary } : p
              );
              saveTranscripts(updated.map((p) => ({
                ...p,
                attachments: (p.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
              })));
              return updated;
            });
            setSelectedTranscript((prev) =>
              prev?.id === t.id ? { ...prev, title: result.title, summary: result.summary } : prev
            );
          } catch {
            // Silently skip failed segments
          }
        }
      })();
    }
  }, [rematchPendingPhotos]);

  const handleClearData = useCallback(() => {
    if (window.confirm("Clear all imported transcripts? This cannot be undone.")) {
      saveTranscripts([]);
      clearAllAttachments().catch(() => {});
      clearPendingPhotos().catch(() => {});
      setPendingPhotoCount(0);
      setTranscripts([]);
      setSelectedTranscript(null);
    }
  }, []);

  const handleClientsChange = useCallback(() => {
    setClients(loadClients());
  }, []);

  const handleDeleteTranscript = useCallback((transcriptId: string) => {
    setTranscripts((prev) => {
      const updated = prev.filter((t) => t.id !== transcriptId);
      saveTranscripts(updated.map((t) => ({
        ...t,
        attachments: (t.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      })));
      return updated;
    });
    setSelectedTranscript((prev) => (prev?.id === transcriptId ? null : prev));
  }, []);

  const handleAddAttachments = useCallback(async (transcriptId: string, newAttachments: Attachment[]) => {
    const processed = await Promise.all(
      newAttachments.map(async (att) => {
        if (att.mimeType.startsWith("image/")) {
          const resized = await resizeImage(att.dataUrl, 1200);
          return { ...att, dataUrl: resized };
        }
        return att;
      })
    );

    await dbSaveAttachments(transcriptId, processed);

    setTranscripts((prev) => {
      const updated = prev.map((t) =>
        t.id === transcriptId
          ? { ...t, attachments: [...(t.attachments || []), ...processed] }
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
        ? { ...prev, attachments: [...(prev.attachments || []), ...processed] }
        : prev
    );
  }, []);

  const handleRemoveAttachment = useCallback(async (transcriptId: string, attachmentId: string) => {
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
    for (const r of results) {
      await dbSaveAttachments(r.transcriptId, r.attachments);
    }

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

    setSelectedTranscript((prev) => {
      if (!prev) return prev;
      const match = results.find((r) => r.transcriptId === prev.id);
      if (!match) return prev;
      return { ...prev, attachments: [...(prev.attachments || []), ...match.attachments] };
    });

    loadPendingPhotos().then((p) => setPendingPhotoCount(p.length)).catch(() => {});
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
          {/* Settings */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
            title="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
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
              Segments
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
          <BatchPhotoImport transcripts={transcripts} onPhotosMatched={handleBatchPhotos} pendingCount={pendingPhotoCount} />
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
        {/* Left: Sidebar with tab toggle */}
        <div className="w-56 shrink-0 border-r border-border overflow-hidden flex flex-col">
          {/* Sidebar tab switcher */}
          <div className="shrink-0 flex border-b border-border">
            <button
              onClick={() => setSidebarTab("calendar")}
              className={`flex-1 py-2 text-center text-xs font-medium transition-colors relative ${
                sidebarTab === "calendar" ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block mr-1 -mt-0.5">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Week
              {sidebarTab === "calendar" && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
            </button>
            <button
              onClick={() => setSidebarTab("contacts")}
              className={`flex-1 py-2 text-center text-xs font-medium transition-colors relative ${
                sidebarTab === "contacts" ? "text-accent" : "text-muted hover:text-foreground"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block mr-1 -mt-0.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              Contacts
              {sidebarTab === "contacts" && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
            </button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === "calendar" ? (
              <WeekNav
                weekDates={currentWeek}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                getTranscriptsForDate={getTranscriptsForDate}
              />
            ) : (
              <ClientRoster
                clients={clients}
                selectedClientId={selectedClient?.id || null}
                onSelectClient={setSelectedClient}
                onClientsChange={handleClientsChange}
                transcriptCountByClient={transcriptCountByClient}
              />
            )}
          </div>
        </div>

        {/* Center: Day Calendar */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
          <DayCalendar
            date={selectedDate}
            transcripts={selectedDateTranscripts}
            onSelectTranscript={setSelectedTranscript}
            onDeleteTranscript={handleDeleteTranscript}
            selectedTranscriptId={selectedTranscript?.id}
            viewMode={viewMode}
          />
        </div>

        {/* Right: Viewer Panel — 50% of screen */}
        <div className="w-[50vw] shrink-0 flex flex-col overflow-hidden">
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

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
