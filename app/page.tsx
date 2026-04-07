"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { AppEvent, Attachment, Client } from "@/lib/types";

import { loadEvents, saveEvents, updateEvent } from "@/lib/event-store";
import { loadClients } from "@/lib/clients";
import {
  saveAttachments as dbSaveAttachments,
  removeAttachment as dbRemoveAttachment,
  loadAttachments as dbLoadAttachments,
  loadAllAttachments,
  removeAttachmentsForTranscript as dbRemoveAttachmentsForEvent,
  clearAllAttachments,
  clearPendingPhotos,
  resizeImage,
} from "@/lib/attachment-store";
import { PhotoMatchResult } from "@/lib/photo-matcher";
import { hasApiKey, processSegmentWithAI } from "@/lib/claude-api";
import { isToday } from "@/lib/utils";
import { getPersistedClientId, setPersistedClientId } from "@/lib/selected-client";
import EventListPanel from "@/components/EventListPanel";
import ViewerPanel from "@/components/ViewerPanel";
import ClientRoster from "@/components/ClientRoster";
import WeekNav from "@/components/WeekNav";
import ImportButton from "@/components/ImportButton";
import SettingsModal from "@/components/SettingsModal";
import NavButtons from "@/components/NavButtons";
import QuickAssign from "@/components/QuickAssign";
import AppNav from "@/components/AppNav";

type SidebarTab = "week" | "contacts" | "projects";

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Dashboard() {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedDate, setSelectedDate] = useState(todayDateStr());
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("week");

  const [showSettings, setShowSettings] = useState(false);
  const [showQuickAssign, setShowQuickAssign] = useState(false);
  const [focusArea, setFocusArea] = useState<"week" | "day">("day");
  const [mounted, setMounted] = useState(false);

  // Derive selectedEvent from ID
  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((ev) => ev.id === selectedEventId) || null;
  }, [selectedEventId, events]);

  // Determine viewer mode
  const viewerMode = useMemo(() => {
    if (selectedEventId && selectedEvent) return "event" as const;
    if ((sidebarTab === "contacts" || sidebarTab === "projects") && selectedClient) return "client-aggregate" as const;
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

  // Restore persisted client selection from another view
  useEffect(() => {
    if (clients.length === 0) return;
    if (selectedClient) return; // already selected
    const persistedId = getPersistedClientId();
    if (persistedId) {
      const match = clients.find((c) => c.id === persistedId);
      if (match) {
        setSelectedClient(match);
        setSidebarTab("contacts");
      }
    }
  }, [clients, selectedClient]);

  // Pick up event navigation from Actions page
  useEffect(() => {
    const eventId = sessionStorage.getItem("plaud-navigate-event");
    const eventDate = sessionStorage.getItem("plaud-navigate-date");
    if (eventId) {
      sessionStorage.removeItem("plaud-navigate-event");
      sessionStorage.removeItem("plaud-navigate-date");
      setSelectedEventId(eventId);
      if (eventDate) {
        setSelectedDate(eventDate);
      }
    }
  }, []);

  // Center panel events depend on active sidebar tab
  const centerPanelEvents = useMemo(() => {
    if ((sidebarTab === "contacts" || sidebarTab === "projects") && selectedClient) {
      return events.filter(
        (ev) =>
          ev.clientId === selectedClient.id ||
          ev.mentions?.some((m) => m.toLowerCase() === selectedClient.name.toLowerCase())
      );
    }
    return events.filter((ev) => ev.date === selectedDate);
  }, [sidebarTab, selectedClient, selectedDate, events]);

  const sortedCenterEvents = useMemo(() =>
    [...centerPanelEvents].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || "")),
    [centerPanelEvents]
  );

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
    setPersistedClientId(client?.id ?? null);
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

  const handleUpdateEvent = useCallback((eventId: string, updates: Partial<AppEvent>) => {
    updateEvent(eventId, updates);
    setEvents((prev) => prev.map((ev) => ev.id === eventId ? { ...ev, ...updates } : ev));
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

  // Merge selected event with adjacent event
  const handleMerge = useCallback(async (direction: "up" | "down") => {
    if (!selectedEventId) return;
    const selected = events.find((ev) => ev.id === selectedEventId);
    if (!selected) return;

    // Get same-day events sorted by start time
    const sameDayEvents = events
      .filter((ev) => ev.date === selected.date && ev.id !== selected.id)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

    // Find adjacent event
    let target: AppEvent | undefined;
    if (direction === "up") {
      // First event that starts before selected
      target = [...sameDayEvents]
        .reverse()
        .find((ev) => (ev.startTime || "") < (selected.startTime || ""));
    } else {
      // First event that starts after selected
      target = sameDayEvents
        .find((ev) => (ev.startTime || "") > (selected.startTime || ""));
    }

    if (!target) return;

    // Determine start time and duration
    const startTime = direction === "up" ? target.startTime : selected.startTime;
    const endEvent = direction === "up" ? selected : target;
    let duration: number | undefined;
    if (startTime && endEvent.startTime && endEvent.duration) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endEvent.startTime.split(":").map(Number);
      duration = (eh * 60 + em) - (sh * 60 + sm) + endEvent.duration;
    } else if (selected.duration && target.duration) {
      duration = selected.duration + target.duration;
    }

    // Move attachments from target to selected event in IndexedDB
    const targetAtts = await dbLoadAttachments(target.id);
    if (targetAtts.length > 0) {
      await dbSaveAttachments(selectedEventId, targetAtts);
    }
    await dbRemoveAttachmentsForEvent(target.id);

    // Merge in-memory attachment refs
    const mergedAttachments = [
      ...(selected.attachments || []),
      ...(target.attachments || []),
    ];

    // Merge notes
    const mergedNotes = [selected.notes, target.notes].filter(Boolean).join("\n\n") || undefined;

    // Update the selected event
    const updates: Partial<AppEvent> = {
      startTime,
      ...(duration ? { duration } : {}),
      attachments: mergedAttachments,
      notes: mergedNotes,
    };
    updateEvent(selectedEventId, updates);

    // Remove the consumed event
    setEvents((prev) => {
      const updated = prev
        .map((ev) => ev.id === selectedEventId ? { ...ev, ...updates } : ev)
        .filter((ev) => ev.id !== target!.id);
      saveEvents(updated.map((ev) => ({
        ...ev,
        attachments: (ev.attachments || []).map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
      })));
      return updated;
    });
  }, [selectedEventId, events]);

  // Keyboard navigation & shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const cmd = e.metaKey || e.ctrlKey;

      // Cmd+A — quick assign
      if (cmd && e.key === "a" && selectedEventId) {
        e.preventDefault();
        setShowQuickAssign(true);
        return;
      }

      // Cmd+Up/Down — merge events
      if (cmd && (e.key === "ArrowUp" || e.key === "ArrowDown") && selectedEventId) {
        e.preventDefault();
        handleMerge(e.key === "ArrowUp" ? "up" : "down");
        return;
      }

      // Left/Right — switch focus between week nav and day view
      if (e.key === "ArrowLeft" && !cmd) {
        e.preventDefault();
        setFocusArea("week");
        return;
      }
      if (e.key === "ArrowRight" && !cmd) {
        e.preventDefault();
        setFocusArea("day");
        return;
      }

      // Up/Down — navigate within focused area
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !cmd) {
        e.preventDefault();
        if (focusArea === "week") {
          // Move selected date by one day
          const d = new Date(selectedDate + "T00:00:00");
          d.setDate(d.getDate() + (e.key === "ArrowUp" ? -1 : 1));
          // Don't go into the future
          if (d.getTime() <= Date.now()) {
            const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            setSelectedDate(str);
            setSelectedEventId(null);
          }
        } else {
          // Move event selection up/down in day view
          if (sortedCenterEvents.length === 0) return;
          const currentIdx = sortedCenterEvents.findIndex((ev) => ev.id === selectedEventId);
          if (e.key === "ArrowDown") {
            const nextIdx = currentIdx + 1;
            if (nextIdx < sortedCenterEvents.length) {
              setSelectedEventId(sortedCenterEvents[nextIdx].id);
            } else if (currentIdx === -1) {
              setSelectedEventId(sortedCenterEvents[0].id);
            }
          } else {
            const prevIdx = currentIdx - 1;
            if (prevIdx >= 0) {
              setSelectedEventId(sortedCenterEvents[prevIdx].id);
            } else if (currentIdx === -1) {
              setSelectedEventId(sortedCenterEvents[sortedCenterEvents.length - 1].id);
            }
          }
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedEventId, selectedDate, focusArea, sortedCenterEvents, handleMerge]);

  if (!mounted) return null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface">
        <AppNav current="/" />

        <div className="flex items-center gap-2">
          <NavButtons />
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
          <ImportButton onImport={handleImport} events={events} clients={clients} onPhotosMatched={handleBatchPhotos} onPhotoEventsCreated={(created) => setEvents((prev) => [...prev, ...created])} onNavigateToEvent={(eventId, date) => { setSelectedDate(date); setSidebarTab("week"); setSelectedEventId(eventId); }} onDeleteEvent={handleDeleteEvent} onUpdateEvent={handleUpdateEvent} />
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
        <div className={`w-56 shrink-0 border-r overflow-hidden flex flex-col ${focusArea === "week" && sidebarTab === "week" ? "border-r-accent/50 bg-accent/[0.02]" : "border-border"}`}>
          <div className="shrink-0 flex border-b border-border">
            {([
              { key: "week" as SidebarTab, label: "Week", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block mr-0.5 -mt-0.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> },
              { key: "contacts" as SidebarTab, label: "Contacts", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block mr-0.5 -mt-0.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg> },
              { key: "projects" as SidebarTab, label: "Projects", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline-block mr-0.5 -mt-0.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg> },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => handleSwitchTab(tab.key)}
                className={`flex-1 py-2 text-center text-[10px] font-medium transition-colors relative ${
                  sidebarTab === tab.key ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
                {sidebarTab === tab.key && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            {sidebarTab === "week" && (
              <WeekNav
                selectedDate={selectedDate}
                onSelectDate={handleSelectDate}
                getRecordingsForDate={getRecordingsForDate}
              />
            )}
            {sidebarTab === "contacts" && (
              <ClientRoster
                clients={clients.filter((c) => c.kind !== "project")}
                selectedClientId={selectedClient?.id || null}
                onSelectClient={handleSelectClient}
                onClientsChange={handleClientsChange}
                transcriptCountByClient={eventCountByClient}
              />
            )}
            {sidebarTab === "projects" && (
              <ClientRoster
                clients={clients.filter((c) => c.kind === "project")}
                selectedClientId={selectedClient?.id || null}
                onSelectClient={handleSelectClient}
                onClientsChange={handleClientsChange}
                transcriptCountByClient={eventCountByClient}
                mode="projects"
              />
            )}
          </div>
        </div>

        {/* Center: Event List */}
        <div className={`flex-1 flex flex-col overflow-hidden border-r ${focusArea === "day" ? "border-r-accent/50" : "border-border"}`}>
          <EventListPanel
            mode={(sidebarTab === "contacts" || sidebarTab === "projects") && selectedClient ? "client" : "date"}
            date={selectedDate}
            client={selectedClient}
            events={centerPanelEvents}
            selectedEventId={selectedEventId}
            onSelectEvent={setSelectedEventId}
            onDeleteEvent={handleDeleteEvent}
            onUpdateEvent={handleUpdateEvent}
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
            onUpdateEvent={handleUpdateEvent}
            viewMode={viewerMode}
            aggregateEvents={centerPanelEvents}
            selectedDate={selectedDate}
          />
        </div>
      </div>

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      {showQuickAssign && selectedEventId && (
        <QuickAssign
          clients={clients}
          currentClientId={selectedEvent?.clientId}
          onAssign={(clientId) => handleAssignClient(selectedEventId, clientId)}
          onClose={() => setShowQuickAssign(false)}
        />
      )}
    </div>
  );
}
