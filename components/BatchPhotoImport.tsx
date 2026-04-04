"use client";

import { useState, useRef } from "react";
import { AppEvent, Client, Attachment } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult } from "@/lib/photo-matcher";
import { addEvent } from "@/lib/event-store";
import { saveAttachments as dbSaveAttachments } from "@/lib/attachment-store";

interface BatchPhotoImportProps {
  events: AppEvent[];
  clients: Client[];
  onPhotosMatched: (results: PhotoMatchResult[]) => void;
  onEventsCreated?: (events: AppEvent[]) => void;
}

type Step = "closed" | "config" | "processing" | "results";

export default function BatchPhotoImport({
  events,
  clients,
  onPhotosMatched,
  onEventsCreated,
}: BatchPhotoImportProps) {
  const [step, setStep] = useState<Step>("closed");
  const [gapMinutes, setGapMinutes] = useState(30);
  const [matchToRecordings, setMatchToRecordings] = useState(true);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    matched: PhotoMatchResult[];
    createdEvents: AppEvent[];
    totalFiles: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    if (files.length === 0) {
      setStep("config");
      return;
    }
    setStep("processing");
    setError(null);

    try {
      const result = await batchMatchPhotos(
        files,
        matchToRecordings ? events : [],
        gapMinutes,
        bufferMinutes,
      );

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

        const strippedAtts: Attachment[] = seg.attachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" }));

        const newEvent = addEvent({
          type: "photo",
          date: seg.date,
          startTime: `${String(seg.startTime.getHours()).padStart(2, "0")}:${String(seg.startTime.getMinutes()).padStart(2, "0")}`,
          label,
          attachments: strippedAtts,
        });

        await dbSaveAttachments(newEvent.id, seg.attachments);
        created.push({ ...newEvent, attachments: seg.attachments });
      }

      if (created.length > 0) {
        onEventsCreated?.(created);
      }

      setResults({
        matched: result.matched,
        createdEvents: created,
        totalFiles: files.length,
      });
      setStep("results");
    } catch (err) {
      console.error("Batch photo import error:", err);
      setError(err instanceof Error ? err.message : String(err));
      setStep("config");
    }
  };

  const close = () => {
    setStep("closed");
    setError(null);
    setResults(null);
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
          if (e.target.files && e.target.files.length > 0) {
            handleFiles(e.target.files);
          }
          e.target.value = "";
        }}
      />

      <button
        onClick={() => setStep("config")}
        disabled={step === "processing"}
        className="px-2 py-1.5 rounded-lg text-[10px] font-medium border border-border text-muted hover:bg-gray-50 active:scale-95 disabled:opacity-40 flex items-center gap-1"
        title="Import photos"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {step === "processing" ? "Importing..." : "Photos"}
      </button>

      {/* Config + Results modal */}
      {step !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={close}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold">
                {step === "config" && "Import Photos"}
                {step === "processing" && "Processing..."}
                {step === "results" && "Import Results"}
              </h2>
              <button
                onClick={close}
                className="p-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* ── Config step ── */}
              {step === "config" && (
                <>
                  {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-xs font-semibold text-red-700 mb-1">Import Error</p>
                      <p className="text-[10px] text-red-600 break-words">{error}</p>
                    </div>
                  )}

                  <p className="text-xs text-muted">
                    Select photos to import. They&apos;ll be grouped into events based on timestamps.
                  </p>

                  {/* Segmentation gap */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-muted">
                      Time gap between events
                    </label>
                    <p className="text-[10px] text-gray-400">
                      Photos separated by more than this gap are split into separate events
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={5}
                        max={120}
                        step={5}
                        value={gapMinutes}
                        onChange={(e) => setGapMinutes(Number(e.target.value))}
                        className="flex-1 h-1.5 accent-accent"
                      />
                      <span className="text-xs font-medium w-16 text-right">{gapMinutes} min</span>
                    </div>
                  </div>

                  {/* Match to recordings toggle */}
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-xs font-medium">Match to recordings</p>
                      <p className="text-[10px] text-gray-400">
                        Auto-attach photos taken during a recording
                      </p>
                    </div>
                    <button
                      onClick={() => setMatchToRecordings(!matchToRecordings)}
                      className={`relative w-10 h-5.5 rounded-full transition-colors ${
                        matchToRecordings ? "bg-accent" : "bg-gray-300"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${
                          matchToRecordings ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Recording match buffer */}
                  {matchToRecordings && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-accent/20">
                      <label className="text-[10px] font-semibold uppercase text-muted">
                        Recording match buffer
                      </label>
                      <p className="text-[10px] text-gray-400">
                        How far before/after a recording to match photos
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={60}
                          step={5}
                          value={bufferMinutes}
                          onChange={(e) => setBufferMinutes(Number(e.target.value))}
                          className="flex-1 h-1.5 accent-accent"
                        />
                        <span className="text-xs font-medium w-16 text-right">{bufferMinutes} min</span>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Processing step ── */}
              {step === "processing" && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-muted">Reading timestamps and grouping photos...</p>
                </div>
              )}

              {/* ── Results step ── */}
              {step === "results" && results && (
                <>
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                      <div className="text-lg font-bold text-gray-700">{results.totalFiles}</div>
                      <div className="text-[10px] text-gray-500 font-medium uppercase">Selected</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                      <div className="text-lg font-bold text-green-700">
                        {results.matched.reduce((n, r) => n + r.attachments.length, 0)}
                      </div>
                      <div className="text-[10px] text-green-600 font-medium uppercase">Matched</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                      <div className="text-lg font-bold text-blue-700">
                        {results.createdEvents.length}
                      </div>
                      <div className="text-[10px] text-blue-600 font-medium uppercase">New Events</div>
                    </div>
                  </div>

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

                  {results.createdEvents.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Photo Events Created</h3>
                      <p className="text-[10px] text-gray-400 mb-2">
                        Grouped by time ({gapMinutes}min gap) and added to calendar
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
                      No image files found in selection
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border">
              {step === "config" && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-blue-600 active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Select Photos
                </button>
              )}
              {step === "results" && (
                <button
                  onClick={close}
                  className="w-full py-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-blue-600 active:scale-[0.98]"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
