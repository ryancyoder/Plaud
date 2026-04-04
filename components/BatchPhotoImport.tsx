"use client";

import { useState, useRef, useEffect } from "react";
import { Transcript, Attachment, Client } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult, UnmatchedPhoto } from "@/lib/photo-matcher";
import { savePendingPhotos, loadPendingPhotos, removePendingPhotos, PendingPhoto } from "@/lib/attachment-store";
import { addEvent } from "@/lib/events";

interface BatchPhotoImportProps {
  transcripts: Transcript[];
  clients: Client[];
  onPhotosMatched: (results: PhotoMatchResult[]) => void;
  pendingCount?: number;
  onPendingCountChange?: (count: number) => void;
}

export default function BatchPhotoImport({
  transcripts,
  clients,
  onPhotosMatched,
  pendingCount = 0,
  onPendingCountChange,
}: BatchPhotoImportProps) {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{
    matched: PhotoMatchResult[];
    unmatched: UnmatchedPhoto[];
  } | null>(null);
  const [assigningIndex, setAssigningIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pending photos modal
  const [showPending, setShowPending] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [pendingAssigning, setPendingAssigning] = useState<number | null>(null);

  const handleFiles = async (files: FileList) => {
    if (files.length === 0) return;
    setProcessing(true);

    try {
      const result = await batchMatchPhotos(files, transcripts);
      setResults(result);

      if (result.matched.length > 0) {
        onPhotosMatched(result.matched);
      }

      if (result.unmatched.length > 0) {
        const pending: PendingPhoto[] = result.unmatched.map((u) => ({
          ...u.attachment,
          timestamp: u.timestamp.toISOString(),
        }));
        await savePendingPhotos(pending);
        onPendingCountChange?.((pendingCount || 0) + pending.length);
      }
    } catch (err) {
      console.error("Batch photo import error:", err);
    } finally {
      setProcessing(false);
    }
  };

  async function openPendingModal() {
    const photos = await loadPendingPhotos();
    setPendingPhotos(photos);
    setPendingAssigning(null);
    setShowPending(true);
  }

  async function assignPendingPhoto(photo: PendingPhoto, client: Client) {
    addEvent(
      client.id,
      "photo",
      photo.timestamp,
      photo.name,
      false,
      photo.dataUrl
    );
    await removePendingPhotos([photo.id]);
    setPendingPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    setPendingAssigning(null);
    onPendingCountChange?.(Math.max(0, (pendingCount || 0) - 1));
  }

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

      <div className="flex items-center gap-0">
        {/* Main import button */}
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
          {processing ? "Matching..." : "Photos"}
        </button>

        {/* Pending count badge — opens pending modal */}
        {pendingCount > 0 && (
          <button
            onClick={openPendingModal}
            className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1 text-[9px] font-bold rounded-full bg-amber-500 text-white hover:bg-amber-600 active:scale-95"
            title={`${pendingCount} unassigned photo${pendingCount !== 1 ? "s" : ""} — tap to assign`}
          >
            {pendingCount}
          </button>
        )}
      </div>

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
                <div className="flex-1 rounded-lg bg-amber-50 border border-amber-200 p-3 text-center">
                  <div className="text-lg font-bold text-amber-700">{results.unmatched.length}</div>
                  <div className="text-[10px] text-amber-600 font-medium uppercase">Unmatched</div>
                </div>
              </div>

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

              {results.unmatched.length > 0 && (
                <div>
                  <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Unmatched Photos</h3>
                  <p className="text-[10px] text-gray-400 mb-2">Assign to a client or tap the pending badge later</p>
                  <div className="space-y-1.5">
                    {results.unmatched.map((u, i) => (
                      <div key={i} className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                        <div className="flex items-center gap-2">
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
                          <button
                            onClick={() => setAssigningIndex(assigningIndex === i ? null : i)}
                            className={`shrink-0 px-2 py-1 rounded text-[10px] font-medium ${
                              assigningIndex === i
                                ? "bg-accent text-white"
                                : "bg-white border border-border text-muted hover:text-foreground"
                            }`}
                          >
                            Assign
                          </button>
                        </div>
                        {assigningIndex === i && clients.length > 0 && (
                          <div className="mt-2 max-h-32 overflow-y-auto border border-border rounded-lg bg-white">
                            {clients.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => {
                                  addEvent(
                                    c.id,
                                    "photo",
                                    u.timestamp.toISOString(),
                                    u.attachment.name,
                                    false,
                                    u.attachment.dataUrl
                                  );
                                  setResults((prev) =>
                                    prev ? { ...prev, unmatched: prev.unmatched.filter((_, j) => j !== i) } : prev
                                  );
                                  setAssigningIndex(null);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                              >
                                {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {assigningIndex === i && clients.length === 0 && (
                          <p className="mt-2 text-[10px] text-gray-400 text-center py-2">No clients yet</p>
                        )}
                      </div>
                    ))}
                  </div>
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

      {/* Pending photos modal */}
      {showPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPending(false)}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold">Unassigned Photos ({pendingPhotos.length})</h2>
              <button
                onClick={() => setShowPending(false)}
                className="p-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {pendingPhotos.length === 0 ? (
                <div className="text-center text-xs text-gray-300 py-8">No pending photos</div>
              ) : (
                <div className="space-y-2">
                  {pendingPhotos.map((photo, i) => (
                    <div key={photo.id} className="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                      <div className="flex items-center gap-2.5">
                        <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden border border-amber-300">
                          <img src={photo.dataUrl} alt={photo.name} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{photo.name}</p>
                          <p className="text-[10px] text-muted">
                            {new Date(photo.timestamp).toLocaleDateString("en-US", {
                              month: "short", day: "numeric", year: "numeric",
                            })}
                            {" "}
                            {new Date(photo.timestamp).toLocaleTimeString("en-US", {
                              hour: "numeric", minute: "2-digit",
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => setPendingAssigning(pendingAssigning === i ? null : i)}
                          className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-medium ${
                            pendingAssigning === i
                              ? "bg-accent text-white"
                              : "bg-white border border-border text-muted hover:text-foreground"
                          }`}
                        >
                          Assign to Client
                        </button>
                      </div>
                      {pendingAssigning === i && (
                        <div className="mt-2 max-h-36 overflow-y-auto border border-border rounded-lg bg-white">
                          {clients.length === 0 ? (
                            <p className="text-[10px] text-gray-400 text-center py-3">No clients yet</p>
                          ) : (
                            clients.map((c) => (
                              <button
                                key={c.id}
                                onClick={() => assignPendingPhoto(photo, c)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                              >
                                {c.name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border">
              <button
                onClick={() => setShowPending(false)}
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
