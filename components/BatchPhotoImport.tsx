"use client";

import { useState, useRef } from "react";
import { Transcript, Attachment } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult, UnmatchedPhoto } from "@/lib/photo-matcher";
import { savePendingPhotos, PendingPhoto } from "@/lib/attachment-store";

interface BatchPhotoImportProps {
  transcripts: Transcript[];
  onPhotosMatched: (results: PhotoMatchResult[]) => void;
  pendingCount?: number;
}

export default function BatchPhotoImport({ transcripts, onPhotosMatched, pendingCount = 0 }: BatchPhotoImportProps) {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{
    matched: PhotoMatchResult[];
    unmatched: UnmatchedPhoto[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    if (files.length === 0) return;
    setProcessing(true);

    try {
      const result = await batchMatchPhotos(files, transcripts);
      setResults(result);

      // Auto-save matched photos
      if (result.matched.length > 0) {
        onPhotosMatched(result.matched);
      }

      // Save unmatched photos to pending store for later re-matching
      if (result.unmatched.length > 0) {
        const pending: PendingPhoto[] = result.unmatched.map((u) => ({
          ...u.attachment,
          timestamp: u.timestamp.toISOString(),
        }));
        await savePendingPhotos(pending);
      }
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
        disabled={processing || transcripts.length === 0}
        className="px-2 py-1.5 rounded-lg text-[10px] font-medium border border-border text-muted hover:bg-gray-50 active:scale-95 disabled:opacity-40 flex items-center gap-1"
        title={transcripts.length === 0 ? "Import recordings first" : "Import photos and auto-match to recordings"}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        {processing ? "Matching..." : "Photos"}
        {pendingCount > 0 && (
          <span className="inline-flex items-center justify-center w-4 h-4 text-[8px] font-bold rounded-full bg-amber-500 text-white">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Results modal */}
      {results && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setResults(null)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Summary */}
              <div className="flex gap-3">
                <div className="flex-1 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                  <div className="text-lg font-bold text-green-700">
                    {results.matched.reduce((n, r) => n + r.attachments.length, 0)}
                  </div>
                  <div className="text-[10px] text-green-600 font-medium uppercase">Matched</div>
                </div>
                <div className="flex-1 rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
                  <div className="text-lg font-bold text-amber-700">{results.unmatched.length}</div>
                  <div className="text-[10px] text-amber-600 font-medium uppercase">Pending</div>
                </div>
              </div>

              {/* Matched recordings */}
              {results.matched.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Assigned to Recordings</h3>
                  <div className="space-y-2">
                    {results.matched.map((r) => (
                      <div key={r.transcriptId} className="rounded-lg border border-border p-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold">{r.transcriptTitle}</span>
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

              {/* Unmatched photos */}
              {results.unmatched.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Pending — Waiting for Matching Recordings</h3>
                  <p className="text-[10px] text-gray-400 mb-2">These will auto-match when recordings are imported</p>
                  <div className="space-y-1.5">
                    {results.unmatched.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="shrink-0 w-10 h-10 rounded overflow-hidden border border-amber-300">
                          <img src={u.attachment.dataUrl} alt={u.attachment.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{u.attachment.name}</p>
                          <p className="text-[10px] text-amber-700">
                            {u.timestamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            {" — "}
                            {u.reason}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
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
