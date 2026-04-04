"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { AppEvent, Attachment, Client } from "@/lib/types";
import { formatDuration, getTagColor, formatDate } from "@/lib/utils";
import { hasApiKey, getCachedSegmentSummary, generateSegmentSummary } from "@/lib/claude-api";
import { getPhotosForClient } from "@/lib/event-store";

type Tab = "transcript" | "photos";

interface ViewerPanelProps {
  selectedEvent: AppEvent | null;
  selectedClient: Client | null;
  clients: Client[];
  onClose: () => void;
  onAssignClient: (eventId: string, clientId: string | undefined) => void;
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (eventId: string, attachmentId: string) => void;
}

export default function ViewerPanel({
  selectedEvent,
  selectedClient,
  clients,
  onClose,
  onAssignClient,
  onAddAttachments,
  onRemoveAttachment,
}: ViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("transcript");

  const photoCount = selectedEvent?.attachments?.filter((a) => a.mimeType.startsWith("image/")).length ?? 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "photos", label: "Photos", count: photoCount },
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

      <div className="flex-1 overflow-y-auto">
        {activeTab === "transcript" && (
          <EventView
            event={selectedEvent}
            clients={clients}
            onClose={onClose}
            onAssignClient={onAssignClient}
            onAddAttachments={onAddAttachments}
          />
        )}
        {activeTab === "photos" && (
          <PhotoGallery
            event={selectedEvent}
            selectedClient={selectedClient}
            onAddAttachments={onAddAttachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}
      </div>
    </div>
  );
}

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
          Select a recording from the calendar to view details
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

/**
 * Photos tab — shows all photos for the selected client (across all their events),
 * or photos on the selected event if no client is selected.
 */
function PhotoGallery({
  event,
  selectedClient,
  onAddAttachments,
  onRemoveAttachment,
}: {
  event: AppEvent | null;
  selectedClient: Client | null;
  onAddAttachments: (eventId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (eventId: string, attachmentId: string) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef(0);

  // If a client is selected, show ALL their photos across events. Otherwise show event photos.
  const clientPhotos = selectedClient ? getPhotosForClient(selectedClient.id) : [];
  const eventPhotos = event?.attachments?.filter((a) => a.mimeType.startsWith("image/")) || [];

  const photos = selectedClient
    ? clientPhotos.map((cp) => ({ ...cp.attachment, eventLabel: cp.event.label, eventDate: cp.event.date }))
    : eventPhotos.map((a) => ({ ...a, eventLabel: event?.label || "", eventDate: event?.date || "" }));

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (lightboxIndex === null) return;
      if (direction === "left" && lightboxIndex < photos.length - 1) setLightboxIndex(lightboxIndex + 1);
      else if (direction === "right" && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
    },
    [lightboxIndex, photos.length],
  );

  const heading = selectedClient
    ? `${selectedClient.name}'s Photos (${photos.length})`
    : `${photos.length} photo${photos.length !== 1 ? "s" : ""}`;

  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold">{heading}</h3>
        {event && (
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
              {selectedClient && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                  <span className="text-[8px] text-white truncate block">{img.eventDate}</span>
                </div>
              )}
              {event && !selectedClient && (
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
