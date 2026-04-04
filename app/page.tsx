"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { AppEvent, Attachment, Client } from "@/lib/types";
import { getWeekDates } from "@/lib/mock-data";
import { loadEvents, saveEvents } from "@/lib/event-store";
import { loadClients } from "@/lib/clients";
import {
  saveAttachments as dbSaveAttachments,
  removeAttachment as dbRemoveAttachment,
  loadAllAttachments,
  clearAllAttachments,
  clearPendingPhotos,
  resizeImage,
} from "@/lib/attachment-store";
import { PhotoMatchResult } from "@/lib/photo-matcher";
import { hasApiKey, processSegmentWithAI } from "@/lib/claude-api";
import { isToday } from "@/lib/utils";
import EventListPanel from "@/components/EventListPanel";
import ViewerPanel from "@/components/ViewerPanel";
import ClientRoster from "@/components/ClientRoster";
import WeekNav from "@/components/WeekNav";
import ImportButton from "@/components/ImportButton";
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
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("calendar");

  const [showSettings, setShowSettings] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Derive selectedEvent from ID
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((ev) => ev.id === selectedEventId) || null;
  }, [selectedEventId, events]);

  // Determine viewer mode
  const viewerMode = useMemo(() => {
    if (selectedEventId && selectedEvent) return "event" as const;
    if (sidebarTab === "contacts" && selectedClient) return "client-aggregate" as const;
    return "day-aggregate" as const;
  }, [selectedEventId, selectedEvent, sidebarTab, selectedClient]);

  useEffect(() => {
    const stored = loadEvents();
    const cleaned = stored.map((ev) => ({
      ...ev,
      attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
    }));
    setClients(loadClients());
    setEvents(cleaned);

    loadAllAttachments()
      .then((allAtts) => {
        setEvents((prev) =>
          prev.map((ev) => ({
            ...ev,
            attachments: allAtts[ev.id] || ev.attachments || [],
          }))
        );
        setMounted(true);
      })
      .catch(() => {
        setMounted(true);
      });
  }, []);

  const currentWeek = getWeekDates(weekOffset);

  // Keep week header in sync with selected date
  useEffect(() => {
    if (!currentWeek.includes(selectedDate)) {
      const targetMs = new Date(selectedDate + "T00:00:00").getTime();
      const now = new Date();
      const day = now.getDay();
      const mondayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1)).getTime();
      const diffWeeks = Math.floor((targetMs - mondayMs) / (7 * 24 * 60 * 60 * 1000));
      setWeekOffset(diffWeeks);
    }
  }, [selectedDate, currentWeek]);

  // Center panel events depend on active sidebar tab
  const centerPanelEvents = useMemo(() => {
    if (sidebarTab === "contacts" && selectedClient) {
      return events.filter(
        (ev) =>
          ev.clientId === selectedClient.id ||
          ev.mentions?.some((m) => m.toLowerCase() === selectedClient.name.toLowerCase())
      );
    }
    return events.filter((ev) => ev.date === selectedDate);
  }, [sidebarTab, selectedClient, selectedDate, events]);

  const eventCountByClient = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const client of clients) {
      counts[client.id] = events.filter(
        (ev) =>
          ev.clientId === client.id ||
          ev.mentions?.some((m) => m.toLowerCase() === client.name.toLowerCase())
      ).length;
    }
    return counts;
  }, [events, clients]);

  // For WeekNav: show all events (not filtered by client) per date
  const getRecordingsForDate = useCallback(
    (date: string) => events.filter((ev) => ev.date === date),
    [events]
  );

  // Clear drill-down when date changes
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    setSelectedEventId(null);
  }, []);

  // Clear drill-down and switch context when client changes
  const handleSelectClient = useCallback((client: Client | null) => {
    setSelectedClient(client);
    setSelectedEventId(null);
  }, []);

  // Clear drill-down when switching sidebar tabs
  const handleSwitchTab = useCallback((tab: SidebarTab) => {
    setSidebarTab(tab);
    setSelectedEventId(null);
  }, []);

  const handleImport = useCallback((newEvents: AppEvent[]) => {
    setEvents((prev) => [...prev, ...newEvents]);

    if (hasApiKey()) {
      (async () => {
        for (const ev of newEvents) {
          try {
            const result = await processSegmentWithAI(ev.fullTranscript || ev.summary || "");
            if (!result) break;
            setEvents((prev) => {
              const updated = prev.map((p) =>
                p.id === ev.id ? { ...p, label: result.title, summary: result.summary } : p
              );
              saveEvents(updated.map((p) => ({
                ...p,
                attachments: (p.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
              })));
              return updated;
            });
          } catch {
            // Silently skip failed segments
          }
        }
      })();
    }
  }, []);

  const handleClearData = useCallback(() => {
    if (window.confirm("Clear all imported data? This cannot be undone.")) {
      saveEvents([]);
      clearAllAttachments().catch(() => {});
      clearPendingPhotos().catch(() => {});
      setEvents([]);
      setSelectedEventId(null);
    }
  }, []);

  const handleClientsChange = useCallback(() => {
    setClients(loadClients());
  }, []);

  const handleDeleteEvent = useCallback((eventId: string) => {
    setEvents((prev) => {
      const updated = prev.filter((ev) => ev.id !== eventId);
      saveEvents(updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      })));
      return updated;
    });
    setSelectedEventId((prev) => (prev === eventId ? null : prev));
  }, []);

  const handleAddAttachments = useCallback(async (eventId: string, newAttachments: Attachment[]) => {
    const processed = await Promise.all(
      newAttachments.map(async (att) => {
        if (att.mimeType.startsWith("image/")) {
          const resized = await resizeImage(att.dataUrl, 1200);
          return { ...att, dataUrl: resized };
        }
        return att;
      })
    );

    await dbSaveAttachments(eventId, processed);

    setEvents((prev) => {
      const updated = prev.map((ev) =>
        ev.id === eventId
          ? { ...ev, attachments: [...(ev.attachments || []), ...processed] }
          : ev
      );
      const forStorage = updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveEvents(forStorage);
      return updated;
    });
  }, []);

  const handleRemoveAttachment = useCallback(async (eventId: string, attachmentId: string) => {
    await dbRemoveAttachment(attachmentId);

    setEvents((prev) => {
      const updated = prev.map((ev) =>
        ev.id === eventId
          ? { ...ev, attachments: (ev.attachments || []).filter((a) => a.id !== attachmentId) }
          : ev
      );
      const forStorage = updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveEvents(forStorage);
      return updated;
    });
  }, []);

  const handleBatchPhotos = useCallback(async (results: PhotoMatchResult[]) => {
    for (const r of results) {
      await dbSaveAttachments(r.eventId, r.attachments);
    }

    setEvents((prev) => {
      const updated = prev.map((ev) => {
        const match = results.find((r) => r.eventId === ev.id);
        if (!match) return ev;
        return { ...ev, attachments: [...(ev.attachments || []), ...match.attachments] };
      });
      const forStorage = updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      }));
      saveEvents(forStorage);
      return updated;
    });

  }, []);

  const handleAssignClient = useCallback((eventId: string, clientId: string | undefined) => {
    setEvents((prev) => {
      const updated = prev.map((ev) =>
        ev.id === eventId ? { ...ev, clientId } : ev
      );
      saveEvents(updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      })));
      return updated;
    });
  }, []);

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
          <Link
            href="/board"
            className="ml-2 px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted border border-border hover:bg-gray-50 active:scale-95"
          >
            Board
          </Link>
          <Link
            href="/map"
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted border border-border hover:bg-gray-50 active:scale-95"
          >
            Map
          </Link>
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
          <ImportButton onImport={handleImport} events={events} clients={clients} onPhotosMatched={handleBatchPhotos} onPhotoEventsCreated={(created) => setEvents((prev) => [...prev, ...created])} />
          {events.length > 0 && (
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
          <div className="shrink-0 flex border-b border-border">
            <button
              onClick={() => handleSwitchTab("calendar")}
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
              onClick={() => handleSwitchTab("contacts")}
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

          <div className="flex-1 overflow-hidden">
            {sidebarTab === "calendar" ? (
              <WeekNav
                weekDates={currentWeek}
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                getRecordingsForDate={getRecordingsForDate}
              />
            ) : (
              <ClientRoster
                clients={clients}
                selectedClientId={selectedClient?.id || null}
                onSelectClient={handleSelectClient}
                onClientsChange={handleClientsChange}
                transcriptCountByClient={eventCountByClient}
              />
            )}
          </div>
        </div>

        {/* Center: Event List */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
          <EventListPanel
            mode={sidebarTab === "contacts" && selectedClient ? "client" : "date"}
            date={selectedDate}
            client={selectedClient}
            events={centerPanelEvents}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            onDeleteEvent={handleDeleteEvent}
          />
        </div>

        {/* Right: Viewer Panel — 50% of screen */}
        <div className="w-[50vw] shrink-0 flex flex-col overflow-hidden">
          <ViewerPanel
            selectedEvent={selectedEvent}
            selectedClient={selectedClient}
            clients={clients}
            onClose={() => setSelectedEventId(null)}
            onAssignClient={handleAssignClient}
            onAddAttachments={handleAddAttachments}
            onRemoveAttachment={handleRemoveAttachment}
            viewMode={viewerMode}
            aggregateEvents={centerPanelEvents}
            selectedDate={selectedDate}
          />
        </div>
      </div>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
