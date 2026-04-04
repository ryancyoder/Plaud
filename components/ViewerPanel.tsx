"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AppEvent, Attachment, Client } from "@/lib/types";
import { formatDuration, getTagColor, formatDate } from "@/lib/utils";
import { hasApiKey, getCachedSegmentSummary, generateSegmentSummary, getCachedSummary, generateDailySummary } from "@/lib/claude-api";
import PdfViewer from "@/components/PdfViewer";
import DrawingCanvas from "@/components/DrawingCanvas";
import { loadScratchpad, saveScratchpad, ScratchpadData, ScratchpadStroke } from "@/lib/attachment-store";

type Tab = "transcript" | "photos" | "documents" | "scratchpad";
type ViewMode = "event" | "client-aggregate" | "day-aggregate";

interface ViewerPanelProps {
  selectedEvent: AppEvent | null;
  selectedClient: Client | null;
  clients: Client[];
  onClose: () => void;
  onAssignClient: (eventId: string, clientId: string | undefined) => void;
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (eventId: string, attachmentId: string) => void;
  viewMode: ViewMode;
  aggregateEvents: AppEvent[];
  selectedDate: string;
}

export default function ViewerPanel({
  selectedEvent,
  selectedClient,
  clients,
  onClose,
  onAssignClient,
  onAddAttachments,
  onRemoveAttachment,
  viewMode,
  aggregateEvents,
  selectedDate,
}: ViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("transcript");

  // Attachment counts depend on mode
  const { photoCount, docCount } = useMemo(() => {
    const countFrom = (atts: Attachment[] | undefined) => {
      const photos = atts?.filter((a) => a.mimeType.startsWith("image/")).length ?? 0;
      const docs = atts?.filter((a) => !a.mimeType.startsWith("image/")).length ?? 0;
      return { photos, docs };
    };
    if (viewMode === "event" && selectedEvent) {
      const c = countFrom(selectedEvent.attachments);
      return { photoCount: c.photos, docCount: c.docs };
    }
    if (viewMode === "client-aggregate" || viewMode === "day-aggregate") {
      let photos = 0, docs = 0;
      for (const ev of aggregateEvents) {
        const c = countFrom(ev.attachments);
        photos += c.photos;
        docs += c.docs;
      }
      return { photoCount: photos, docCount: docs };
    }
    return { photoCount: 0, docCount: 0 };
  }, [viewMode, selectedEvent, aggregateEvents]);

  // Determine which client is active (for scratchpad)
  const activeClient = useMemo(() => {
    if (viewMode === "client-aggregate" && selectedClient) return selectedClient;
    if (viewMode === "event" && selectedEvent?.clientId) {
      return clients.find((c) => c.id === selectedEvent.clientId) || null;
    }
    return null;
  }, [viewMode, selectedClient, selectedEvent, clients]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "transcript", label: viewMode === "event" ? "Detail" : "Overview" },
    { key: "photos", label: "Photos", count: photoCount },
    { key: "documents", label: "Docs", count: docCount },
    ...(activeClient ? [{ key: "scratchpad" as const, label: "Pad" }] : []),
  ];

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors relative ${
              activeTab === tab.key ? "text-accent" : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`ml-1 inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-full ${
                activeTab === tab.key ? "bg-accent text-white" : "bg-gray-200 text-gray-600"
              }`}>{tab.count}</span>
            )}
            {activeTab === tab.key && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      <div className={`flex-1 ${activeTab === "scratchpad" ? "overflow-hidden flex flex-col" : "overflow-y-auto"}`}>
        {activeTab === "transcript" && (
          <>
            {viewMode === "event" && (
              <EventView
                event={selectedEvent}
                clients={clients}
                onClose={onClose}
                onAssignClient={onAssignClient}
                onAddAttachments={onAddAttachments}
              />
            )}
            {viewMode === "client-aggregate" && (
              <ClientAggregateView client={selectedClient} events={aggregateEvents} />
            )}
            {viewMode === "day-aggregate" && (
              <DayAggregateView date={selectedDate} events={aggregateEvents} />
            )}
          </>
        )}
        {activeTab === "photos" && (
          <PhotoGallery
            event={selectedEvent}
            viewMode={viewMode}
            selectedClient={selectedClient}
            aggregateEvents={aggregateEvents}
            onAddAttachments={onAddAttachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}
        {activeTab === "documents" && (
          <DocumentList
            event={selectedEvent}
            viewMode={viewMode}
            selectedClient={selectedClient}
            aggregateEvents={aggregateEvents}
            onAddAttachments={onAddAttachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}
        {activeTab === "scratchpad" && activeClient && (
          <ScratchpadTab
            client={activeClient}
            photos={aggregateEvents.flatMap((ev) =>
              (ev.attachments || []).filter((a) => a.mimeType.startsWith("image/") && a.dataUrl)
            )}
            documents={aggregateEvents.flatMap((ev) =>
              (ev.attachments || []).filter((a) => a.mimeType === "application/pdf" && a.dataUrl)
            )}
          />
        )}
      </div>
    </div>
  );
}

// --- Single Event Detail View (existing, unchanged) ---

function EventView({
  event,
  clients,
  onClose,
  onAssignClient,
  onAddAttachments,
}: {
  event: AppEvent | null;
  clients: Client[];
  onClose: () => void;
  onAssignClient: (eventId: string, clientId: string | undefined) => void;
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
}) {
  const [showAssign, setShowAssign] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState<"summary" | "raw">("summary");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (event) { setTranscriptMode("summary"); setSummaryError(null); }
  }, [event?.id]);

  const aiSummary = event ? getCachedSegmentSummary(event.id) || event.summary : null;

  const handleGenerateSummary = async () => {
    if (!event) return;
    setSummaryLoading(true); setSummaryError(null);
    try {
      await generateSegmentSummary(event.id, event.label, event.fullTranscript || event.summary || "");
      setTranscriptMode("summary");
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally { setSummaryLoading(false); }
  };

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm p-8 text-center">
        <div>
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Select an event to view details
        </div>
      </div>
    );
  }

  const assignedClient = event.clientId ? clients.find((c) => c.id === event.clientId) : null;

  return (
    <div className="p-4">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-muted">
          {formatDate(event.date)} · {event.startTime || ""} · {formatDuration(event.duration || 0)}
        </p>
        <button onClick={onClose} className="p-1.5 -mr-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {/* Client assignment */}
      <div className="mb-3 p-2.5 rounded-lg bg-gray-50 border border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase text-muted">Client:</span>
          {assignedClient ? (
            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{assignedClient.name}</span>
          ) : (
            <span className="text-xs text-gray-400">Unassigned</span>
          )}
          <button
            onClick={() => setShowAssign(!showAssign)}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-accent text-accent font-medium hover:bg-accent-light active:scale-95 ml-auto"
          >
            {assignedClient ? "Change" : "Assign Client"}
          </button>
          {assignedClient && (
            <button
              onClick={() => { onAssignClient(event.id, undefined); setShowAssign(false); }}
              className="text-[11px] px-2 py-1 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 active:scale-95"
            >
              Remove
            </button>
          )}
        </div>
        {showAssign && (
          <div className="mt-2 border border-border rounded-lg overflow-hidden bg-white max-h-40 overflow-y-auto">
            {clients.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No clients — add one in the roster</div>
            ) : (
              clients.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                <button
                  key={c.id}
                  onClick={() => { onAssignClient(event.id, c.id); setShowAssign(false); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 active:bg-gray-100 border-b border-gray-50 last:border-0"
                >
                  <span className="font-medium">{c.name}</span>
                  {c.company && <span className="text-gray-400 ml-2">{c.company}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Tags */}
      {(event.tags || []).length > 0 && (
        <div className="flex gap-1.5 mb-3">
          {event.tags!.map((tag) => {
            const color = getTagColor(tag);
            return <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>{tag}</span>;
          })}
        </div>
      )}

      {/* Participants */}
      {(event.participants || []).length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Participants</h3>
          <p className="text-sm">{event.participants!.join(", ")}</p>
        </div>
      )}

      {/* Summary / Transcript toggle */}
      {event.type === "recording" && (
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setTranscriptMode("summary")}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${transcriptMode === "summary" ? "bg-purple-600 text-white" : "text-muted hover:bg-gray-50"}`}
              >Summary</button>
              <button
                onClick={() => setTranscriptMode("raw")}
                className={`px-2.5 py-1 text-[10px] font-medium transition-colors border-l border-border ${transcriptMode === "raw" ? "bg-accent text-white" : "text-muted hover:bg-gray-50"}`}
              >Transcript</button>
            </div>
            {transcriptMode === "summary" && hasApiKey() && (
              <button onClick={handleGenerateSummary} disabled={summaryLoading} className="text-[10px] text-muted hover:text-purple-600 disabled:opacity-50" title="Regenerate summary">
                {summaryLoading ? "Generating..." : "↻ Regenerate"}
              </button>
            )}
          </div>
          {summaryError && <p className="text-[10px] text-red-500 mb-2">{summaryError}</p>}
          {transcriptMode === "summary" ? (
            <div className="text-sm text-gray-700 leading-relaxed prose-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary || event.summary || "") }} />
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">{event.fullTranscript || event.summary}</p>
          )}
        </div>
      )}

      {/* Notes for non-recording events */}
      {event.type !== "recording" && event.notes && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Notes</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">{event.notes}</p>
        </div>
      )}

      {/* Attachments on this event */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[10px] font-semibold uppercase text-muted">
            Photos & Documents
            {(event.attachments?.length ?? 0) > 0 && <span className="ml-1 text-accent">({event.attachments!.length})</span>}
          </h3>
          <div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf,.doc,.docx" multiple className="hidden"
              onChange={(e) => { const f = e.target.files; if (f && f.length > 0) { handleFileAttach(f, event.id, onAddAttachments); e.target.value = ""; } }} />
            <button onClick={() => fileInputRef.current?.click()} className="text-[10px] px-2 py-0.5 rounded border border-accent text-accent hover:bg-accent-light active:scale-95 font-medium">+ Attach</button>
          </div>
        </div>
        {(event.attachments?.length ?? 0) > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {event.attachments!.map((att) => (
              <div key={att.id} className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border relative group">
                {att.mimeType.startsWith("image/") ? (
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" /><polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span className="text-[8px] text-gray-400 mt-0.5 truncate max-w-[56px]">{att.name.split(".").pop()}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-300">No attachments yet</p>
        )}
      </div>
    </div>
  );
}

// --- Client Aggregate View ---

function ClientAggregateView({ client, events }: { client: Client | null; events: AppEvent[] }) {
  if (!client) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm p-8 text-center">
        <div>
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
          Select a client to view their history
        </div>
      </div>
    );
  }

  const recordings = events.filter((e) => e.type === "recording");
  const totalDuration = recordings.reduce((s, e) => s + (e.duration || 0), 0);

  // Group by date
  const grouped = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.date.localeCompare(a.date));
    const groups: { date: string; events: AppEvent[] }[] = [];
    for (const ev of sorted) {
      const last = groups[groups.length - 1];
      if (last && last.date === ev.date) {
        last.events.push(ev);
      } else {
        groups.push({ date: ev.date, events: [ev] });
      }
    }
    return groups;
  }, [events]);

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-sm font-bold">{client.name}</h2>
        {client.company && <p className="text-xs text-muted">{client.company}</p>}
        <div className="flex gap-3 mt-2 text-xs text-muted">
          <span>{events.length} event{events.length !== 1 ? "s" : ""}</span>
          <span>{recordings.length} recording{recordings.length !== 1 ? "s" : ""}</span>
          {totalDuration > 0 && <span>{formatDuration(totalDuration)} total</span>}
        </div>
      </div>

      {grouped.length === 0 ? (
        <p className="text-xs text-gray-300 text-center py-8">No events yet</p>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.date}>
              <div className="text-[10px] font-bold uppercase text-muted tracking-wider mb-1.5">
                {formatDate(group.date)}
              </div>
              <div className="space-y-2">
                {group.events.map((ev) => (
                  <div key={ev.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-muted tabular-nums">{ev.startTime || ""}</span>
                      <span className="text-xs font-semibold">{ev.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">{ev.type.replace("-", " ")}</span>
                    </div>
                    {ev.summary && (
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{ev.summary}</p>
                    )}
                    {ev.fullTranscript && !ev.summary && (
                      <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{ev.fullTranscript.slice(0, 200)}...</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Day Aggregate View ---

function DayAggregateView({ date, events }: { date: string; events: AppEvent[] }) {
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordings = events.filter((e) => e.type === "recording");
  const sorted = [...events].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  const totalDuration = recordings.reduce((s, e) => s + (e.duration || 0), 0);

  useEffect(() => {
    const cached = getCachedSummary(date);
    if (cached) setAiSummary(cached);
    else setAiSummary(null);
  }, [date]);

  const handleGenerate = useCallback(async () => {
    if (!hasApiKey()) { setError("Set your Claude API key in Settings first"); return; }
    setLoading(true); setError(null);
    try {
      const segments = recordings.map((ev) => ({
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
  }, [date, recordings]);

  return (
    <div className="p-4">
      <div className="mb-4">
        <h2 className="text-sm font-bold">{formatDate(date)}</h2>
        <div className="flex gap-3 mt-1 text-xs text-muted">
          <span>{events.length} event{events.length !== 1 ? "s" : ""}</span>
          {recordings.length > 0 && <span>{recordings.length} recording{recordings.length !== 1 ? "s" : ""}</span>}
          {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
        </div>
      </div>

      {/* AI Summary */}
      {recordings.length > 0 && (
        <div className="mb-4">
          {aiSummary ? (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-semibold uppercase text-purple-600">AI Daily Summary</span>
                <button onClick={handleGenerate} disabled={loading} className="text-[10px] text-muted hover:text-purple-600 disabled:opacity-50">
                  {loading ? "Generating..." : "↻ Regenerate"}
                </button>
              </div>
              <div className="text-sm text-gray-700 leading-relaxed prose-sm rounded-lg bg-purple-50/50 border border-purple-100 p-3"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary) }} />
            </div>
          ) : (
            <div>
              <button onClick={handleGenerate} disabled={loading}
                className="text-[11px] px-3 py-1.5 rounded-lg border border-purple-200 text-purple-600 font-medium hover:bg-purple-50 active:scale-95 disabled:opacity-50">
                {loading ? "Generating..." : "Generate AI Daily Summary"}
              </button>
              {error && <p className="text-[10px] text-red-500 mt-1">{error}</p>}
            </div>
          )}
        </div>
      )}

      {/* Event list */}
      {sorted.length === 0 ? (
        <p className="text-xs text-gray-300 text-center py-8">No events on this day</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((ev) => (
            <div key={ev.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-muted tabular-nums">{ev.startTime || ""}</span>
                <span className="text-xs font-semibold">{ev.label}</span>
                {ev.duration && <span className="text-[10px] text-muted">{formatDuration(ev.duration)}</span>}
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 capitalize">{ev.type.replace("-", " ")}</span>
              </div>
              {ev.summary && (
                <p className="text-xs text-gray-600 leading-relaxed line-clamp-3">{ev.summary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Shared Utilities ---

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

function handleFileAttach(
  files: FileList,
  eventId: string,
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void,
) {
  const promises = Array.from(files).map(
    (file) => new Promise<Attachment>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          type: file.type.startsWith("image/") ? "photo" : "document",
          mimeType: file.type,
          dataUrl: reader.result as string,
          timestamp: new Date().toISOString(),
        });
      };
      reader.readAsDataURL(file);
    }),
  );
  Promise.all(promises).then((attachments) => onAddAttachments(eventId, attachments));
}

// --- Documents Tab ---

/**
 * Convert a base64 data URL to a blob URL that browsers (especially iOS Safari)
 * can render in iframes/object tags. Data URLs often fail for PDF rendering.
 */
function dataUrlToBlobUrl(dataUrl: string): string {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] || "application/pdf";
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mime });
  return URL.createObjectURL(blob);
}

function DocumentList({
  event,
  viewMode,
  selectedClient,
  aggregateEvents,
  onAddAttachments,
  onRemoveAttachment,
}: {
  event: AppEvent | null;
  viewMode: ViewMode;
  selectedClient: Client | null;
  aggregateEvents: AppEvent[];
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (eventId: string, attachmentId: string) => void;
}) {
  const [inlinePreviewId, setInlinePreviewId] = useState<string | null>(null);
  const [fullscreenDoc, setFullscreenDoc] = useState<(Attachment & { eventId: string }) | null>(null);
  const [blobUrls, setBlobUrls] = useState<Record<string, string>>({});
  const [markupHint, setMarkupHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceDocRef = useRef<(Attachment & { eventId: string }) | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Clean up blob URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(blobUrls).forEach(URL.revokeObjectURL);
    };
  }, [blobUrls]);

  const getBlobUrl = useCallback((doc: Attachment): string => {
    if (blobUrls[doc.id]) return blobUrls[doc.id];
    if (!doc.dataUrl) return "";
    const url = dataUrlToBlobUrl(doc.dataUrl);
    setBlobUrls((prev) => ({ ...prev, [doc.id]: url }));
    return url;
  }, [blobUrls]);

  const docs = useMemo(() => {
    const isDoc = (a: Attachment) => !a.mimeType.startsWith("image/");
    if (viewMode === "event" && event) {
      return (event.attachments || [])
        .filter(isDoc)
        .map((a) => ({ ...a, eventId: event.id, eventLabel: event.label, eventDate: event.date }));
    }
    if (viewMode === "client-aggregate" || viewMode === "day-aggregate") {
      const result: (Attachment & { eventId: string; eventLabel: string; eventDate: string })[] = [];
      for (const ev of aggregateEvents) {
        for (const att of ev.attachments || []) {
          if (isDoc(att)) {
            result.push({ ...att, eventId: ev.id, eventLabel: ev.label, eventDate: ev.date });
          }
        }
      }
      return result;
    }
    return [];
  }, [viewMode, event, aggregateEvents]);

  const heading = viewMode === "client-aggregate" && selectedClient
    ? `${selectedClient.name}'s Documents (${docs.length})`
    : `${docs.length} document${docs.length !== 1 ? "s" : ""}`;

  const canUpload = viewMode === "event" && event;

  const isPdf = (mimeType: string) => mimeType === "application/pdf";

  const getFileIcon = (mimeType: string) => {
    if (isPdf(mimeType)) return "PDF";
    if (mimeType.includes("word") || mimeType.includes("document")) return "DOC";
    if (mimeType.includes("sheet") || mimeType.includes("excel")) return "XLS";
    if (mimeType.includes("text")) return "TXT";
    return "FILE";
  };

  const getFileColor = (mimeType: string) => {
    if (isPdf(mimeType)) return "bg-red-100 text-red-600 border-red-200";
    if (mimeType.includes("word") || mimeType.includes("document")) return "bg-blue-100 text-blue-600 border-blue-200";
    if (mimeType.includes("sheet") || mimeType.includes("excel")) return "bg-green-100 text-green-600 border-green-200";
    return "bg-gray-100 text-gray-600 border-gray-200";
  };

  const handleTogglePreview = useCallback((doc: Attachment & { eventId: string }) => {
    if (inlinePreviewId === doc.id) {
      setInlinePreviewId(null);
    } else {
      getBlobUrl(doc); // pre-generate
      setInlinePreviewId(doc.id);
    }
  }, [inlinePreviewId, getBlobUrl]);

  const handleFullscreen = useCallback((doc: Attachment & { eventId: string }) => {
    getBlobUrl(doc); // pre-generate
    setFullscreenDoc(doc);
  }, [getBlobUrl]);

  // Open PDF in new tab — iOS Safari shows native PDF viewer with Markup
  const handleOpenNative = useCallback((doc: Attachment) => {
    const url = getBlobUrl(doc);
    if (url) window.open(url, "_blank");
  }, [getBlobUrl]);

  // Share PDF via iOS share sheet (gives access to Markup, Files, etc.)
  const handleShare = useCallback(async (doc: Attachment & { eventId: string }) => {
    try {
      const url = getBlobUrl(doc);
      if (!url) return;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], doc.name, { type: doc.mimeType });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: doc.name });
        // After share completes, show paste hint
        setMarkupHint(doc.id);
      } else {
        window.open(url, "_blank");
        setMarkupHint(doc.id);
      }
    } catch {
      // User cancelled share — ignore
    }
  }, [getBlobUrl]);

  // Replace a document with an annotated version from file picker
  const handleReplaceStart = useCallback((doc: Attachment & { eventId: string }) => {
    replaceDocRef.current = doc;
    replaceInputRef.current?.click();
  }, []);

  const handleReplaceFile = useCallback((files: FileList | null) => {
    const doc = replaceDocRef.current;
    if (!files || files.length === 0 || !doc) return;
    const file = files[0];

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const replacement: Attachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        type: file.type.startsWith("image/") ? "photo" : "document",
        mimeType: file.type || doc.mimeType,
        dataUrl,
        timestamp: new Date().toISOString(),
      };

      // Remove old, add new
      onRemoveAttachment(doc.eventId, doc.id);
      onAddAttachments(doc.eventId, [replacement]);

      // Clear cached blob URL for old doc
      if (blobUrls[doc.id]) {
        URL.revokeObjectURL(blobUrls[doc.id]);
        setBlobUrls((prev) => {
          const next = { ...prev };
          delete next[doc.id];
          return next;
        });
      }

      setMarkupHint(null);
      replaceDocRef.current = null;
    };
    reader.readAsDataURL(file);
  }, [onRemoveAttachment, onAddAttachments, blobUrls]);

  return (
    <div className="p-3">
      {/* Hidden file input for replacing a document with annotated version */}
      <input
        ref={replaceInputRef}
        type="file"
        accept=".pdf,image/*"
        className="hidden"
        onChange={(e) => { handleReplaceFile(e.target.files); e.target.value = ""; }}
      />

      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold">{heading}</h3>
        {canUpload && (
          <div>
            <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv" multiple className="hidden"
              onChange={(e) => { const f = e.target.files; if (f && f.length > 0) { handleFileAttach(f, event.id, onAddAttachments); e.target.value = ""; } }} />
            <button onClick={() => fileInputRef.current?.click()} className="text-[11px] px-3 py-1 rounded-lg bg-accent text-white font-medium hover:bg-blue-600 active:scale-95">+ Add Docs</button>
          </div>
        )}
      </div>

      {docs.length > 0 ? (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id}>
              <div className="flex items-center gap-3 p-2.5 rounded-lg border border-border hover:bg-gray-50 group">
                {/* File type badge */}
                <div className={`shrink-0 w-10 h-10 rounded-lg border flex items-center justify-center text-[10px] font-bold ${getFileColor(doc.mimeType)}`}>
                  {getFileIcon(doc.mimeType)}
                </div>

                {/* File info — tap to preview PDFs */}
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => isPdf(doc.mimeType) ? handleTogglePreview(doc) : undefined}
                >
                  <p className="text-xs font-medium truncate">{doc.name}</p>
                  <p className="text-[10px] text-muted">
                    {viewMode !== "event" && <span>{doc.eventDate} &middot; </span>}
                    {doc.mimeType.split("/").pop()?.toUpperCase()}
                    {isPdf(doc.mimeType) && <span className="text-accent ml-1">Tap to preview</span>}
                  </p>
                </button>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {isPdf(doc.mimeType) && (
                    <>
                      <button
                        onClick={() => handleShare(doc)}
                        className="text-[10px] px-2 py-1 rounded border border-purple-300 text-purple-600 hover:bg-purple-50 active:scale-95 font-medium"
                        title="Share / Markup"
                      >
                        Markup
                      </button>
                      <button
                        onClick={() => handleFullscreen(doc)}
                        className="text-[10px] px-2 py-1 rounded border border-accent text-accent hover:bg-accent-light active:scale-95 font-medium"
                        title="Full screen preview"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                        </svg>
                      </button>
                    </>
                  )}
                  <a
                    href={doc.dataUrl || blobUrls[doc.id] || "#"}
                    download={doc.name}
                    className="text-[10px] px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 active:scale-95 font-medium"
                  >
                    Save
                  </a>
                  {viewMode === "event" && event && (
                    <button
                      onClick={() => onRemoveAttachment(event.id, doc.id)}
                      className="text-[10px] px-1.5 py-1 rounded border border-red-200 text-red-400 hover:bg-red-50 active:scale-95 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      x
                    </button>
                  )}
                </div>
              </div>

              {/* Replace with annotated version */}
              {markupHint === doc.id && (
                <div className="mt-1 p-2.5 rounded-lg bg-purple-50 border border-purple-200 flex items-center gap-3">
                  <p className="text-[11px] text-purple-700 flex-1">
                    Save annotated file to Files, then:
                  </p>
                  <button
                    onClick={() => handleReplaceStart(doc)}
                    className="text-[11px] px-3 py-1.5 rounded-lg bg-purple-600 text-white font-medium hover:bg-purple-700 active:scale-95 shrink-0"
                  >
                    Replace with Annotated
                  </button>
                  <button
                    onClick={() => setMarkupHint(null)}
                    className="text-muted hover:text-foreground shrink-0"
                  >
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Inline PDF preview */}
              {inlinePreviewId === doc.id && isPdf(doc.mimeType) && (
                <div className="mt-1 rounded-lg border border-border overflow-hidden bg-gray-100 overflow-y-auto" style={{ maxHeight: "60vh" }}>
                  {blobUrls[doc.id] ? (
                    <PdfViewer src={blobUrls[doc.id]} />
                  ) : (
                    <div className="flex items-center justify-center py-12 text-xs text-muted">
                      Loading preview...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-gray-300">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="text-xs">No documents</p>
          {canUpload && (
            <button onClick={() => fileInputRef.current?.click()} className="text-[10px] text-accent mt-2 hover:underline">
              Upload a PDF or document
            </button>
          )}
        </div>
      )}

      {/* Full-screen PDF viewer */}
      {fullscreenDoc && isPdf(fullscreenDoc.mimeType) && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={() => setFullscreenDoc(null)}>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded bg-red-500/20 flex items-center justify-center text-[10px] font-bold text-red-300">PDF</div>
              <span className="text-sm text-white truncate">{fullscreenDoc.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={blobUrls[fullscreenDoc.id] || fullscreenDoc.dataUrl}
                download={fullscreenDoc.name}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 active:scale-95"
                onClick={(e) => e.stopPropagation()}
              >
                Download
              </a>
              <button onClick={() => setFullscreenDoc(null)} className="text-white/70 hover:text-white p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-800" onClick={(e) => e.stopPropagation()}>
            {blobUrls[fullscreenDoc.id] ? (
              <PdfViewer src={blobUrls[fullscreenDoc.id]} />
            ) : (
              <div className="flex items-center justify-center h-full text-white/60 text-sm">
                Loading PDF...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Scratchpad Tab ---

function ScratchpadTab({ client, photos, documents }: { client: Client; photos: Attachment[]; documents: Attachment[] }) {
  const [scratchpad, setScratchpad] = useState<ScratchpadData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [showBgPicker, setShowBgPicker] = useState(false);
  const [bgPickerTab, setBgPickerTab] = useState<"photos" | "pdfs">("photos");
  const [pdfPages, setPdfPages] = useState<{ docName: string; pages: string[] }[]>([]);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load scratchpad from IndexedDB when client changes
  useEffect(() => {
    setLoaded(false);
    setShowBgPicker(false);
    setPdfPages([]);
    loadScratchpad(client.id).then((data) => {
      setScratchpad(data);
      setBackgroundSrc(data?.backgroundDataUrl || null);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [client.id]);

  // Debounced auto-save
  const handleStrokesChange = useCallback(
    (strokes: ScratchpadStroke[], canvasDataUrl: string) => {
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = setTimeout(() => {
        const data: ScratchpadData = {
          clientId: client.id,
          imageDataUrl: canvasDataUrl,
          backgroundDataUrl: backgroundSrc,
          strokes,
          updatedAt: new Date().toISOString(),
        };
        saveScratchpad(data);
        setScratchpad(data);
      }, 500);
    },
    [client.id, backgroundSrc],
  );

  const handleSetBackground = useCallback((src: string | null) => {
    setBackgroundSrc(src);
    setShowBgPicker(false);
    // Save immediately with new background, clear strokes
    const data: ScratchpadData = {
      clientId: client.id,
      imageDataUrl: "",
      backgroundDataUrl: src,
      strokes: [],
      updatedAt: new Date().toISOString(),
    };
    saveScratchpad(data);
    setScratchpad(data);
  }, [client.id]);

  // Render PDF pages as images for the background picker
  const handleRenderPdf = useCallback(async (doc: Attachment) => {
    setRenderingPdf(true);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
      }

      // Convert data URL to blob URL for pdf.js
      const [header, base64] = doc.dataUrl.split(",");
      const mime = header.match(/:(.*?);/)?.[1] || "application/pdf";
      const bytes = atob(base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      const blobUrl = URL.createObjectURL(blob);

      const pdf = await pdfjsLib.getDocument(blobUrl).promise;
      const pageImages: string[] = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2 }); // High res for annotation
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvasContext: ctx, viewport } as any).promise;
          pageImages.push(canvas.toDataURL("image/png"));
        }
      }

      URL.revokeObjectURL(blobUrl);
      setPdfPages((prev) => [...prev, { docName: doc.name, pages: pageImages }]);
    } catch (err) {
      console.warn("Failed to render PDF pages:", err);
    } finally {
      setRenderingPdf(false);
    }
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted">
        Loading scratchpad...
      </div>
    );
  }

  const hasPhotos = photos.length > 0;
  const hasPdfs = documents.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Background picker header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-white shrink-0">
        <span className="text-[10px] font-semibold text-muted uppercase">
          {client.name}&rsquo;s Pad
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowBgPicker(!showBgPicker)}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:bg-gray-100 active:scale-95"
          >
            {backgroundSrc ? "Change BG" : "Add BG"}
          </button>
          {backgroundSrc && (
            <button
              onClick={() => handleSetBackground(null)}
              className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 active:scale-95"
            >
              Clear BG
            </button>
          )}
        </div>
      </div>

      {/* Background picker */}
      {showBgPicker && (
        <div className="px-3 py-2 border-b border-border bg-gray-50 shrink-0 max-h-[40vh] overflow-y-auto">
          {/* Tabs if both photos and PDFs exist */}
          {hasPhotos && hasPdfs && (
            <div className="flex gap-0 mb-2 border-b border-border">
              <button
                onClick={() => setBgPickerTab("photos")}
                className={`px-3 py-1 text-[10px] font-medium relative ${bgPickerTab === "photos" ? "text-accent" : "text-muted"}`}
              >
                Photos
                {bgPickerTab === "photos" && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent rounded-full" />}
              </button>
              <button
                onClick={() => setBgPickerTab("pdfs")}
                className={`px-3 py-1 text-[10px] font-medium relative ${bgPickerTab === "pdfs" ? "text-accent" : "text-muted"}`}
              >
                PDFs
                {bgPickerTab === "pdfs" && <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-accent rounded-full" />}
              </button>
            </div>
          )}

          {/* Photos */}
          {(bgPickerTab === "photos" || !hasPdfs) && hasPhotos && (
            <div>
              <p className="text-[10px] text-muted mb-2">Select a photo to annotate:</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {photos.map((photo) => (
                  <button
                    key={photo.id}
                    onClick={() => handleSetBackground(photo.dataUrl)}
                    className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 border-border hover:border-accent active:scale-95"
                  >
                    <img src={photo.dataUrl} alt={photo.name} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PDFs */}
          {(bgPickerTab === "pdfs" || !hasPhotos) && hasPdfs && (
            <div>
              <p className="text-[10px] text-muted mb-2">Select a PDF page to annotate:</p>
              {/* PDF file list — click to render pages */}
              <div className="space-y-2">
                {documents.map((doc) => {
                  const rendered = pdfPages.find((p) => p.docName === doc.name);
                  return (
                    <div key={doc.id}>
                      {!rendered ? (
                        <button
                          onClick={() => handleRenderPdf(doc)}
                          disabled={renderingPdf}
                          className="flex items-center gap-2 w-full text-left px-2.5 py-2 rounded-lg border border-border hover:bg-white active:scale-[0.98] disabled:opacity-50"
                        >
                          <div className="w-8 h-8 rounded bg-red-100 border border-red-200 flex items-center justify-center text-[9px] font-bold text-red-600">PDF</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-medium truncate">{doc.name}</p>
                            <p className="text-[10px] text-muted">{renderingPdf ? "Rendering pages..." : "Tap to load pages"}</p>
                          </div>
                        </button>
                      ) : (
                        <div>
                          <p className="text-[10px] font-medium mb-1">{doc.name} ({rendered.pages.length} pages)</p>
                          <div className="flex gap-2 overflow-x-auto pb-1">
                            {rendered.pages.map((pageImg, i) => (
                              <button
                                key={i}
                                onClick={() => handleSetBackground(pageImg)}
                                className="shrink-0 w-16 h-20 rounded-lg overflow-hidden border-2 border-border hover:border-accent active:scale-95 bg-white relative"
                              >
                                <img src={pageImg} alt={`Page ${i + 1}`} className="w-full h-full object-contain" />
                                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[8px] text-center py-0.5">
                                  p.{i + 1}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!hasPhotos && !hasPdfs && (
            <p className="text-[10px] text-gray-400">No photos or documents available for this client.</p>
          )}
        </div>
      )}

      {/* Drawing canvas */}
      <div className="flex-1 min-h-0">
        <DrawingCanvas
          key={`${client.id}-${backgroundSrc || "blank"}`}
          backgroundSrc={backgroundSrc}
          initialStrokes={scratchpad?.strokes || []}
          onStrokesChange={handleStrokesChange}
        />
      </div>
    </div>
  );
}

// --- Photos Tab ---

function PhotoGallery({
  event,
  viewMode,
  selectedClient,
  aggregateEvents,
  onAddAttachments,
  onRemoveAttachment,
}: {
  event: AppEvent | null;
  viewMode: ViewMode;
  selectedClient: Client | null;
  aggregateEvents: AppEvent[];
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (eventId: string, attachmentId: string) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef(0);

  const photos = useMemo(() => {
    if (viewMode === "event" && event) {
      return (event.attachments || [])
        .filter((a) => a.mimeType.startsWith("image/"))
        .map((a) => ({ ...a, eventLabel: event.label, eventDate: event.date }));
    }
    if (viewMode === "client-aggregate" || viewMode === "day-aggregate") {
      const result: (Attachment & { eventLabel: string; eventDate: string })[] = [];
      for (const ev of aggregateEvents) {
        for (const att of ev.attachments || []) {
          if (att.mimeType.startsWith("image/")) {
            result.push({ ...att, eventLabel: ev.label, eventDate: ev.date });
          }
        }
      }
      return result;
    }
    return [];
  }, [viewMode, event, aggregateEvents]);

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (lightboxIndex === null) return;
      if (direction === "left" && lightboxIndex < photos.length - 1) setLightboxIndex(lightboxIndex + 1);
      else if (direction === "right" && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
    },
    [lightboxIndex, photos.length],
  );

  const heading = viewMode === "client-aggregate" && selectedClient
    ? `${selectedClient.name}'s Photos (${photos.length})`
    : `${photos.length} photo${photos.length !== 1 ? "s" : ""}`;

  const canUpload = viewMode === "event" && event;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold">{heading}</h3>
        {canUpload && (
          <div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { const f = e.target.files; if (f && f.length > 0) { handleFileAttach(f, event.id, onAddAttachments); e.target.value = ""; } }} />
            <button onClick={() => fileInputRef.current?.click()} className="text-[11px] px-3 py-1 rounded-lg bg-accent text-white font-medium hover:bg-blue-600 active:scale-95">+ Add Photos</button>
          </div>
        )}
      </div>

      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {photos.map((img, i) => (
            <button key={img.id} onClick={() => setLightboxIndex(i)} className="aspect-square rounded-lg overflow-hidden border border-border relative group">
              <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
              {viewMode !== "event" && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                  <span className="text-[8px] text-white truncate block">{img.eventDate}</span>
                </div>
              )}
              {viewMode === "event" && event && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveAttachment(event.id, img.id); }}
                    className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow"
                  >x</button>
                </div>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-gray-300">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
          </svg>
          <p className="text-xs">No photos</p>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { const diff = e.changedTouches[0].clientX - touchStartX.current; if (Math.abs(diff) > 50) { handleSwipe(diff < 0 ? "left" : "right"); e.stopPropagation(); } }}
        >
          <button onClick={() => setLightboxIndex(null)} className="absolute top-4 right-4 text-white/80 hover:text-white z-10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          {lightboxIndex > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }} className="absolute left-3 text-white/70 hover:text-white p-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
          )}
          {lightboxIndex < photos.length - 1 && (
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }} className="absolute right-3 text-white/70 hover:text-white p-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          )}
          <img src={photos[lightboxIndex].dataUrl} alt={photos[lightboxIndex].name} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-4 text-white/60 text-xs">
            {lightboxIndex + 1} / {photos.length} — {photos[lightboxIndex].name}
          </div>
        </div>
      )}
    </div>
  );
}
