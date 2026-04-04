"use client";

import { useState, useRef } from "react";
import { AppEvent, Client, Attachment } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult, PhotoSegment } from "@/lib/photo-matcher";
import { addEvent } from "@/lib/event-store";
import { saveAttachments as dbSaveAttachments } from "@/lib/attachment-store";

interface BatchPhotoImportProps {
  events: AppEvent[];
  clients: Client[];
  onPhotosMatched: (results: PhotoMatchResult[]) => void;
  onEventsCreated?: (events: AppEvent[]) => void;
}

export default function BatchPhotoImport({
  events,
  clients,
  onPhotosMatched,
  onEventsCreated,
}: BatchPhotoImportProps) {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{
    matched: PhotoMatchResult[];
    createdEvents: AppEvent[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    if (files.length === 0) return;
    setProcessing(true);

    try {
      const result = await batchMatchPhotos(files, events);

      if (result.matched.length > 0) {
        onPhotosMatched(result.matched);
      }

      // Auto-create photo events for each unmatched segment
      const created: AppEvent[] = [];
      for (const seg of result.unmatchedSegments) {
        const timeStr = seg.startTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const count = seg.attachments.length;
        const label = `${count} Photo${count !== 1 ? "s" : ""} — ${timeStr}`;

        // Strip dataUrls for localStorage (keep event small)
        const strippedAtts: Attachment[] = seg.attachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" }));

        const newEvent = addEvent({
          type: "photo",
          date: seg.date,
          startTime: `${String(seg.startTime.getHours()).padStart(2, "0")}:${String(seg.startTime.getMinutes()).padStart(2, "0")}`,
          label,
          attachments: strippedAtts,
        });

        // Save full photo data to IndexedDB
        await dbSaveAttachments(newEvent.id, seg.attachments);

        // Keep full dataUrls in memory for display
        created.push({ ...newEvent, attachments: seg.attachments });
      }

      if (created.length > 0) {
        onEventsCreated?.(created);
      }

      setResults({
        matched: result.matched,
        createdEvents: created,
      });
    } catch (err) {
      console.error("Batch photo import error:", err);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={processing}
        className="px-2 py-1.5 rounded-lg text-[10px] font-medium border border-border text-muted hover:bg-gray-50 active:scale-95 disabled:opacity-40 flex items-center gap-1"
        title="Import photos and auto-match to recordings"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {processing ? "Importing..." : "Photos"}
      </button>

      {/* Import results modal */}
      {results && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setResults(null)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold">Photo Import Results</h2>
              <button
                onClick={() => setResults(null)}
                className="p-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                  <div className="text-lg font-bold text-green-700">
                    {results.matched.reduce((n, r) => n + r.attachments.length, 0)}
                  </div>
                  <div className="text-[10px] text-green-600 font-medium uppercase">Matched</div>
                </div>
                <div className="flex-1 rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                  <div className="text-lg font-bold text-blue-700">
                    {results.createdEvents.reduce((n, e) => n + (e.attachments?.length || 0), 0)}
                  </div>
                  <div className="text-[10px] text-blue-600 font-medium uppercase">New Events</div>
                </div>
              </div>

              {/* Matched to existing recordings */}
              {results.matched.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Matched to Recordings</h3>
                  <div className="space-y-2">
                    {results.matched.map((r) => (
                      <div key={r.eventId} className="rounded-lg border border-border p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold">{r.eventTitle}</span>
                          <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                            {r.attachments.length} photo{r.attachments.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto">
                          {r.attachments.map((att) => (
                            <div key={att.id} className="shrink-0 w-12 h-12 rounded overflow-hidden border border-gray-200">
                              <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Auto-created photo events */}
              {results.createdEvents.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Photo Events Created</h3>
                  <p className="text-[10px] text-gray-400 mb-2">
                    Unmatched photos were grouped by time and added to the calendar
                  </p>
                  <div className="space-y-2">
                    {results.createdEvents.map((ev) => (
                      <div key={ev.id} className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-blue-800">{ev.label}</span>
                          <span className="text-[10px] text-blue-600">{ev.date}</span>
                        </div>
                        <div className="flex gap-1.5 overflow-x-auto">
                          {ev.attachments?.map((att) => (
                            <div key={att.id} className="shrink-0 w-12 h-12 rounded overflow-hidden border border-blue-200">
                              <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {results.matched.length === 0 && results.createdEvents.length === 0 && (
                <div className="text-center text-xs text-gray-400 py-6">
                  No photos were imported
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={() => setResults(null)}
                className="w-full py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-blue-600 active:scale-[0.98]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
