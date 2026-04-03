"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Transcript, Attachment, ActionItem, CallItem, ErrandItem, Client } from "@/lib/types";
import { formatDuration, getTagColor, formatDate } from "@/lib/utils";
import { hasApiKey, getCachedSegmentSummary, generateSegmentSummary } from "@/lib/claude-api";

type Tab = "transcript" | "photos" | "todos" | "calls" | "errands";

interface ViewerPanelProps {
  selectedTranscript: Transcript | null;
  actionItems: ActionItem[];
  callItems: CallItem[];
  errandItems: ErrandItem[];
  clients: Client[];
  onClose: () => void;
  onAssignClient: (transcriptId: string, clientName: string | undefined) => void;
  onAddAttachments: (transcriptId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (transcriptId: string, attachmentId: string) => void;
}

export default function ViewerPanel({
  selectedTranscript,
  actionItems,
  callItems,
  errandItems,
  clients,
  onClose,
  onAssignClient,
  onAddAttachments,
  onRemoveAttachment,
}: ViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(selectedTranscript ? "transcript" : "todos");

  // Switch to transcript tab when a transcript is selected
  const effectiveTab = selectedTranscript && activeTab === "transcript" ? "transcript" : activeTab;

  const photoCount = selectedTranscript?.attachments?.length ?? 0;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "photos", label: "Photos", count: photoCount },
    { key: "todos", label: "To-Do", count: actionItems.filter((a) => !a.done).length },
    { key: "calls", label: "Calls", count: callItems.filter((c) => !c.done).length },
    { key: "errands", label: "Errands", count: errandItems.filter((e) => !e.done).length },
  ];

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors relative ${
              effectiveTab === tab.key
                ? "text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`ml-1 inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-full ${
                effectiveTab === tab.key ? "bg-accent text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {tab.count}
              </span>
            )}
            {effectiveTab === tab.key && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === "transcript" && (
          <TranscriptView
            transcript={selectedTranscript}
            clients={clients}
            onClose={onClose}
            onAssignClient={onAssignClient}
            onAddAttachments={onAddAttachments}
          />
        )}
        {effectiveTab === "photos" && (
          <PhotoGallery
            transcript={selectedTranscript}
            onAddAttachments={onAddAttachments}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}
        {effectiveTab === "todos" && <TodoList items={actionItems} />}
        {effectiveTab === "calls" && <CallList items={callItems} />}
        {effectiveTab === "errands" && <ErrandList items={errandItems} />}
      </div>
    </div>
  );
}

function TranscriptView({
  transcript,
  clients,
  onClose,
  onAssignClient,
  onAddAttachments,
}: {
  transcript: Transcript | null;
  clients: Client[];
  onClose: () => void;
  onAssignClient: (transcriptId: string, clientName: string | undefined) => void;
  onAddAttachments: (transcriptId: string, attachments: Attachment[]) => void;
}) {
  const [showAssign, setShowAssign] = useState(false);
  const [transcriptMode, setTranscriptMode] = useState<"raw" | "summary">("raw");
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load cached summary when transcript changes
  useEffect(() => {
    if (transcript) {
      const cached = getCachedSegmentSummary(transcript.id);
      setAiSummary(cached);
      setSummaryError(null);
    } else {
      setAiSummary(null);
      setTranscriptMode("raw");
    }
  }, [transcript?.id]);

  const handleGenerateSummary = async () => {
    if (!transcript) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const text = transcript.fullTranscript || transcript.summary || "";
      const result = await generateSegmentSummary(transcript.id, transcript.title, text);
      setAiSummary(result);
      setTranscriptMode("summary");
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Failed to generate summary");
    } finally {
      setSummaryLoading(false);
    }
  };

  if (!transcript) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm p-8 text-center">
        <div>
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Select a transcript from the calendar to view details
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs text-muted">
          {formatDate(transcript.date)} · {transcript.startTime} · {formatDuration(transcript.duration)}
        </p>
        <button onClick={onClose} className="p-1.5 -mr-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {/* Client assignment - right after header */}
      <div className="mb-3 p-2.5 rounded-lg bg-gray-50 border border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase text-muted">Client:</span>
          {transcript.clientName ? (
            <span className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              {transcript.clientName}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Unassigned</span>
          )}
          <button
            onClick={() => setShowAssign(!showAssign)}
            className="text-[11px] px-2.5 py-1 rounded-lg border border-accent text-accent font-medium hover:bg-accent-light active:scale-95 ml-auto"
          >
            {transcript.clientName ? "Change" : "Assign Client"}
          </button>
          {transcript.clientName && (
            <button
              onClick={() => {
                onAssignClient(transcript.id, undefined);
                setShowAssign(false);
              }}
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
              clients
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onAssignClient(transcript.id, c.name);
                      setShowAssign(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2 border-b border-gray-50 last:border-0"
                  >
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      c.type === "client" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {c.name.charAt(0)}
                    </span>
                    <span className="font-medium">{c.name}</span>
                    {c.company && <span className="text-gray-400 ml-auto">{c.company}</span>}
                  </button>
                ))
            )}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="flex gap-1.5 mb-3">
        {transcript.tags.map((tag) => {
          const color = getTagColor(tag);
          return (
            <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>
              {tag}
            </span>
          );
        })}
      </div>

      {/* Participants */}
      {transcript.participants.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Participants</h3>
          <p className="text-sm">{transcript.participants.join(", ")}</p>
        </div>
      )}

      {/* Transcript / Summary toggle */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setTranscriptMode("raw")}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
                transcriptMode === "raw" ? "bg-accent text-white" : "text-muted hover:bg-gray-50"
              }`}
            >
              Transcript
            </button>
            <button
              onClick={() => {
                if (aiSummary) {
                  setTranscriptMode("summary");
                } else if (hasApiKey()) {
                  handleGenerateSummary();
                }
              }}
              disabled={summaryLoading}
              className={`px-2.5 py-1 text-[10px] font-medium transition-colors border-l border-border ${
                transcriptMode === "summary" ? "bg-purple-600 text-white" : "text-muted hover:bg-gray-50"
              } disabled:opacity-50`}
            >
              {summaryLoading ? "Generating..." : "AI Summary"}
            </button>
          </div>
          {transcriptMode === "summary" && aiSummary && (
            <button
              onClick={handleGenerateSummary}
              disabled={summaryLoading}
              className="text-[10px] text-muted hover:text-purple-600 disabled:opacity-50"
              title="Regenerate summary"
            >
              ↻ Regenerate
            </button>
          )}
          {!hasApiKey() && transcriptMode === "raw" && (
            <span className="text-[10px] text-gray-400">Set API key in settings for AI summaries</span>
          )}
        </div>

        {summaryError && (
          <p className="text-[10px] text-red-500 mb-2">{summaryError}</p>
        )}

        {transcriptMode === "summary" && aiSummary ? (
          <div
            className="text-sm text-gray-700 leading-relaxed prose-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(aiSummary) }}
          />
        ) : (
          <>
            {transcript.summary && (
              <div className="mb-2">
                <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Summary</h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{transcript.summary}</p>
              </div>
            )}
            {transcript.fullTranscript && transcript.fullTranscript !== transcript.summary && (
              <div>
                <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Full Transcript</h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">{transcript.fullTranscript}</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Photos & Attachments */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[10px] font-semibold uppercase text-muted">
            Photos & Documents
            {(transcript.attachments?.length ?? 0) > 0 && (
              <span className="ml-1 text-accent">({transcript.attachments!.length})</span>
            )}
          </h3>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (!files || files.length === 0) return;
                handleFileAttach(files, transcript.id, onAddAttachments);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-[10px] px-2 py-0.5 rounded border border-accent text-accent hover:bg-accent-light active:scale-95 font-medium"
            >
              + Attach
            </button>
          </div>
        </div>
        {(transcript.attachments?.length ?? 0) > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {transcript.attachments!.map((att) => (
              <div key={att.id} className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-border relative group">
                {att.mimeType.startsWith("image/") ? (
                  <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex flex-col items-center justify-center">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                      <polyline points="14 2 14 8 20 8" />
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

      {/* Action Items from this transcript */}
      {transcript.actionItems.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Action Items</h3>
          <ul className="space-y-1">
            {transcript.actionItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${item.done ? "bg-accent border-accent" : "border-gray-300"}`}>
                  {item.done && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                      <path d="M2 5l2 2 4-4" />
                    </svg>
                  )}
                </span>
                <span className={item.done ? "line-through text-muted" : ""}>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Calls from this transcript */}
      {transcript.calls.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Calls to Make</h3>
          <ul className="space-y-1">
            {transcript.calls.map((call) => (
              <li key={call.id} className="text-sm flex items-center gap-2">
                <span className="text-green-600 text-xs">tel</span>
                <span className="font-medium">{call.person}</span>
                <span className="text-muted">— {call.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Errands from this transcript */}
      {transcript.errands.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Errands</h3>
          <ul className="space-y-1">
            {transcript.errands.map((errand) => (
              <li key={errand.id} className="text-sm flex items-center gap-2">
                <span className="text-amber-600 text-xs">loc</span>
                <span>{errand.text}</span>
                {errand.location && <span className="text-muted text-xs">@ {errand.location}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Lightweight markdown-to-HTML for AI summaries */
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
  transcriptId: string,
  onAddAttachments: (transcriptId: string, attachments: Attachment[]) => void,
) {
  const promises = Array.from(files).map(
    (file) =>
      new Promise<Attachment>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const type: Attachment["type"] = file.type.startsWith("image/")
            ? "photo"
            : "document";
          resolve({
            id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name,
            type,
            mimeType: file.type,
            dataUrl: reader.result as string,
            timestamp: new Date().toISOString(),
          });
        };
        reader.readAsDataURL(file);
      }),
  );
  Promise.all(promises).then((attachments) => {
    onAddAttachments(transcriptId, attachments);
  });
}

function PhotoGallery({
  transcript,
  onAddAttachments,
  onRemoveAttachment,
}: {
  transcript: Transcript | null;
  onAddAttachments: (transcriptId: string, attachments: Attachment[]) => void;
  onRemoveAttachment: (transcriptId: string, attachmentId: string) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartX = useRef(0);

  const attachments = transcript?.attachments ?? [];
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const docs = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  const handleSwipe = useCallback(
    (direction: "left" | "right") => {
      if (lightboxIndex === null) return;
      if (direction === "left" && lightboxIndex < images.length - 1) {
        setLightboxIndex(lightboxIndex + 1);
      } else if (direction === "right" && lightboxIndex > 0) {
        setLightboxIndex(lightboxIndex - 1);
      }
    },
    [lightboxIndex, images.length],
  );

  if (!transcript) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-gray-300">
        Select a transcript to view photos
      </div>
    );
  }

  return (
    <div className="p-3">
      {/* Attach button */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold">
          {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
        </h3>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (!files || files.length === 0) return;
              handleFileAttach(files, transcript.id, onAddAttachments);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[11px] px-3 py-1 rounded-lg bg-accent text-white font-medium hover:bg-blue-600 active:scale-95"
          >
            + Add Photos
          </button>
        </div>
      </div>

      {/* Image grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {images.map((img, i) => (
            <button
              key={img.id}
              onClick={() => setLightboxIndex(i)}
              className="aspect-square rounded-lg overflow-hidden border border-border relative group"
            >
              <img src={img.dataUrl} alt={img.name} className="w-full h-full object-cover" />
              {/* Delete button on hover */}
              <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveAttachment(transcript.id, img.id);
                  }}
                  className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] shadow"
                >
                  x
                </button>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Documents */}
      {docs.length > 0 && (
        <>
          <h4 className="text-[10px] font-semibold uppercase text-muted mb-1.5">Documents</h4>
          <div className="space-y-1">
            {docs.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-border group">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400 shrink-0">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-xs truncate flex-1">{doc.name}</span>
                <button
                  onClick={() => onRemoveAttachment(transcript.id, doc.id)}
                  className="opacity-0 group-hover:opacity-100 text-[10px] text-red-500 hover:text-red-700 transition-opacity"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {attachments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-gray-300">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <p className="text-xs">No photos or documents</p>
          <p className="text-[10px] mt-0.5">Tap &quot;+ Add Photos&quot; to attach files</p>
        </div>
      )}

      {/* Lightbox overlay */}
      {lightboxIndex !== null && images[lightboxIndex] && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
          onTouchStart={(e) => {
            touchStartX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            const diff = e.changedTouches[0].clientX - touchStartX.current;
            if (Math.abs(diff) > 50) {
              handleSwipe(diff < 0 ? "left" : "right");
              e.stopPropagation();
            }
          }}
        >
          {/* Close button */}
          <button
            onClick={() => setLightboxIndex(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white z-10"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>

          {/* Nav arrows */}
          {lightboxIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
              }}
              className="absolute left-3 text-white/70 hover:text-white p-2"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {lightboxIndex < images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
              }}
              className="absolute right-3 text-white/70 hover:text-white p-2"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          {/* Image */}
          <img
            src={images[lightboxIndex].dataUrl}
            alt={images[lightboxIndex].name}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Counter */}
          <div className="absolute bottom-4 text-white/60 text-xs">
            {lightboxIndex + 1} / {images.length} — {images[lightboxIndex].name}
          </div>
        </div>
      )}
    </div>
  );
}

function TodoList({ items }: { items: ActionItem[] }) {
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  if (pending.length === 0 && done.length === 0) {
    return <EmptyState label="No to-do items" />;
  }

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-4 h-4 mt-0.5 rounded border-2 border-gray-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">{item.text}</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
          {item.dueDate && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">
              due {new Date(item.dueDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
            </span>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <>
          <div className="text-[10px] uppercase text-muted font-semibold tracking-wider px-2 pt-3 pb-1">
            Completed ({done.length})
          </div>
          {done.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg opacity-50">
              <div className="w-4 h-4 mt-0.5 rounded border-2 border-accent bg-accent shrink-0 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                  <path d="M2 5l2 2 4-4" />
                </svg>
              </div>
              <p className="text-sm leading-snug line-through text-muted">{item.text}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CallList({ items }: { items: CallItem[] }) {
  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return <EmptyState label="No calls to make" />;

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-xs">
            tel
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{item.person}</p>
            <p className="text-xs text-muted mt-0.5">{item.reason}</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrandList({ items }: { items: ErrandItem[] }) {
  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return <EmptyState label="No errands" />;

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xs">
            loc
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">{item.text}</p>
            {item.location && (
              <p className="text-xs text-muted mt-0.5">@ {item.location}</p>
            )}
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-gray-300">
      {label}
    </div>
  );
}
