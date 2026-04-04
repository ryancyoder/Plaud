"use client";

import { useRef, useState } from "react";
import { importParsedSegments, importFromText, addEvent } from "@/lib/event-store";
import { srtToSegments, ParsedTranscript } from "@/lib/srt-parser";
import { AppEvent, Attachment, Client } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult, PhotoSegment, GpsCoords, reverseGeocode, findClosestClient } from "@/lib/photo-matcher";
import { saveAttachments as dbSaveAttachments } from "@/lib/attachment-store";

interface ImportButtonProps {
  onImport: (events: AppEvent[]) => void;
  // Photo import props
  events?: AppEvent[];
  clients?: Client[];
  onPhotosMatched?: (results: PhotoMatchResult[]) => void;
  onPhotoEventsCreated?: (events: AppEvent[]) => void;
}

export default function ImportButton({
  onImport,
  events = [],
  clients = [],
  onPhotosMatched,
  onPhotoEventsCreated,
}: ImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [importing, setImporting] = useState(false);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);

  // SRT start-time prompt state
  const [pendingFiles, setPendingFiles] = useState<FileList | null>(null);
  const [showStartPrompt, setShowStartPrompt] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [gapThreshold, setGapThreshold] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("plaud-gap-threshold");
      return saved ? parseInt(saved) : 180;
    }
    return 180;
  });
  const [minDuration, setMinDuration] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("plaud-min-duration");
      return saved ? parseInt(saved) : 0;
    }
    return 0;
  });

  // Segment preview state (shown after settings, before final import)
  const [previewSegments, setPreviewSegments] = useState<(ParsedTranscript & { segmentTitle?: string })[]>([]);
  const [ignoredIndices, setIgnoredIndices] = useState<Set<number>>(new Set());
  const [showPreview, setShowPreview] = useState(false);
  const [pendingRecordingStart, setPendingRecordingStart] = useState<Date | null>(null);

  // Paste SRT start-time state
  const [pendingPasteText, setPendingPasteText] = useState<string | null>(null);
  const [showPasteStartPrompt, setShowPasteStartPrompt] = useState(false);
  const [pasteStartDate, setPasteStartDate] = useState("");
  const [pasteStartTime, setPasteStartTime] = useState("");

  // Photo import state
  type PhotoStep = "closed" | "config" | "processing" | "results";
  const [photoStep, setPhotoStep] = useState<PhotoStep>("closed");
  const [photoGapMinutes, setPhotoGapMinutes] = useState(30);
  const [photoMatchRecordings, setPhotoMatchRecordings] = useState(true);
  const [photoBufferMinutes, setPhotoBufferMinutes] = useState(15);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoResults, setPhotoResults] = useState<{
    matched: PhotoMatchResult[];
    createdEvents: AppEvent[];
    segments: PhotoSegment[];
    totalFiles: number;
    diagnostics: { fileTypes: Record<string, number>; gpsFound: number; gpsTotal: number; clientsWithCoords: number; clientsTotal: number; matchDetails: { segmentLabel: string; closestClient: string | null; distanceMeters: number | null }[] };
  } | null>(null);
  const [pendingImageFiles, setPendingImageFiles] = useState<FileList | null>(null);
  const [fallbackLocation, setFallbackLocation] = useState<GpsCoords | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "granted" | "denied">("idle");

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nowTimeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    const hasSrt = Array.from(files).some((f) => f.name.toLowerCase().endsWith(".srt"));
    const hasImages = Array.from(files).some((f) => f.type.startsWith("image/"));

    if (hasSrt) {
      setPendingFiles(files);
      setStartDate(todayStr());
      setStartTime("09:00");
      setShowStartPrompt(true);
    } else if (hasImages) {
      setPendingImageFiles(files);
      setPhotoStep("config");
    } else {
      toast("Supported: .srt transcript files or image files");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function processPhotos() {
    if (!pendingImageFiles) return;
    setPhotoStep("processing");
    setPhotoError(null);

    try {
      // Geocode any clients that have addresses but no coordinates
      const { geocodeAllClients } = await import("@/lib/clients");
      const geocoded = await geocodeAllClients();
      // Reload clients if any were geocoded so we have fresh lat/lng
      let activeClients = clients;
      if (geocoded > 0) {
        const { loadClients } = await import("@/lib/clients");
        activeClients = loadClients();
      }

      const result = await batchMatchPhotos(
        pendingImageFiles,
        photoMatchRecordings ? events : [],
        photoGapMinutes,
        photoBufferMinutes,
        activeClients,
      );

      if (result.matched.length > 0) {
        onPhotosMatched?.(result.matched);
      }

      // Apply fallback location to segments without GPS
      if (fallbackLocation) {
        for (const seg of result.unmatchedSegments) {
          if (!seg.gps) {
            seg.gps = fallbackLocation;
            try {
              seg.address = await reverseGeocode(fallbackLocation);
            } catch { /* skip */ }
            seg.matchedClient = findClosestClient(fallbackLocation, clients);
          }
        }
      }

      const created: AppEvent[] = [];
      for (const seg of result.unmatchedSegments) {
        const timeStr = seg.startTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const count = seg.attachments.length;
        const locationLabel = seg.address || timeStr;
        const label = `${count} Photo${count !== 1 ? "s" : ""} — ${locationLabel}`;

        const strippedAtts: Attachment[] = seg.attachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" }));

        const newEvent = addEvent({
          type: "photo",
          date: seg.date,
          startTime: `${String(seg.startTime.getHours()).padStart(2, "0")}:${String(seg.startTime.getMinutes()).padStart(2, "0")}`,
          label,
          attachments: strippedAtts,
          ...(seg.matchedClient ? { clientId: seg.matchedClient.id } : {}),
        });

        await dbSaveAttachments(newEvent.id, seg.attachments);
        created.push({ ...newEvent, attachments: seg.attachments });
      }

      if (created.length > 0) {
        onPhotoEventsCreated?.(created);
      }

      setPhotoResults({
        matched: result.matched,
        createdEvents: created,
        segments: result.unmatchedSegments,
        totalFiles: pendingImageFiles.length,
        diagnostics: result.diagnostics,
      });
      setPhotoStep("results");
    } catch (err) {
      console.error("Photo import error:", err);
      setPhotoError(err instanceof Error ? err.message : String(err));
      setPhotoStep("config");
    }
  }

  function closePhotoModal() {
    setPhotoStep("closed");
    setPhotoError(null);
    setPhotoResults(null);
    setPendingImageFiles(null);
    setFallbackLocation(null);
    setLocationStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function confirmStartTime() {
    if (!pendingFiles) return;
    if (!startDate || !startTime) {
      toast("Please enter a start date and time");
      return;
    }
    const recordingStart = new Date(`${startDate}T${startTime}:00`);
    if (isNaN(recordingStart.getTime())) {
      toast("Invalid date or time");
      return;
    }
    // Persist settings
    localStorage.setItem("plaud-gap-threshold", String(gapThreshold));
    localStorage.setItem("plaud-min-duration", String(minDuration));
    setShowStartPrompt(false);

    // Parse SRT files to get segments for preview
    const allSegments: (ParsedTranscript & { segmentTitle?: string })[] = [];
    for (const file of Array.from(pendingFiles)) {
      if (file.name.toLowerCase().endsWith(".srt")) {
        const content = await file.text();
        const segs = srtToSegments(file.name, content, recordingStart, gapThreshold);
        allSegments.push(...segs);
      }
    }

    if (allSegments.length === 0) {
      toast("No valid SRT entries found");
      setPendingFiles(null);
      return;
    }

    // Check if any segments are under the min duration threshold
    const shortSegments = minDuration > 0
      ? allSegments.filter((s) => s.duration * 60 < minDuration || (s.entries.length > 0 && getDurationSeconds(s) < minDuration))
      : [];

    if (shortSegments.length > 0) {
      // Show preview with short segments pre-checked for ignore
      const shortIndices = new Set<number>();
      allSegments.forEach((s, i) => {
        const durSec = getDurationSeconds(s);
        if (durSec < minDuration) shortIndices.add(i);
      });
      setPreviewSegments(allSegments);
      setIgnoredIndices(shortIndices);
      setPendingRecordingStart(recordingStart);
      setShowPreview(true);
    } else {
      // No short segments — import directly
      const kept = allSegments;
      const imported = importParsedSegments(kept);
      onImport(imported);
      toast(`${imported.length} transcript${imported.length > 1 ? "s" : ""} imported`);
      setPendingFiles(null);
    }
  }

  function getDurationSeconds(seg: ParsedTranscript): number {
    if (seg.entries.length === 0) return seg.duration * 60;
    const first = seg.entries[0];
    const last = seg.entries[seg.entries.length - 1];
    return last.endSeconds - first.startSeconds;
  }

  function confirmPreview() {
    const kept = previewSegments.filter((_, i) => !ignoredIndices.has(i));
    if (kept.length === 0) {
      toast("No segments to import — uncheck some to keep them");
      return;
    }
    const imported = importParsedSegments(kept);
    onImport(imported);
    toast(`${imported.length} transcript${imported.length > 1 ? "s" : ""} imported`);
    setShowPreview(false);
    setPreviewSegments([]);
    setIgnoredIndices(new Set());
    setPendingFiles(null);
    setPendingRecordingStart(null);
  }

  function handlePasteSubmit() {
    const text = pasteRef.current?.value;
    if (!text || text.trim().length < 5) {
      toast("Paste some transcript text first");
      return;
    }

    const trimmed = text.trim();
    const looksLikeSrt = /\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d+\s*-->/.test(trimmed);

    if (looksLikeSrt) {
      // SRT detected — prompt for start time
      setPendingPasteText(trimmed);
      setPasteStartDate(todayStr());
      setPasteStartTime("09:00");
      setShowPasteStartPrompt(true);
      setShowPasteArea(false);
    } else {
      // JSON or plain text — import directly
      try {
        const transcripts = importFromText(trimmed);
        if (transcripts.length > 0) {
          onImport(transcripts);
          toast(`${transcripts.length} transcript${transcripts.length > 1 ? "s" : ""} imported`);
          setShowPasteArea(false);
          if (pasteRef.current) pasteRef.current.value = "";
        }
      } catch (e) {
        toast(`Parse error: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    }
  }

  function confirmPasteStartTime() {
    if (!pendingPasteText) return;
    if (!pasteStartDate || !pasteStartTime) {
      toast("Please enter a start date and time");
      return;
    }
    const recordingStart = new Date(`${pasteStartDate}T${pasteStartTime}:00`);
    if (isNaN(recordingStart.getTime())) {
      toast("Invalid date or time");
      return;
    }
    localStorage.setItem("plaud-gap-threshold", String(gapThreshold));
    localStorage.setItem("plaud-min-duration", String(minDuration));
    setShowPasteStartPrompt(false);

    // Parse into segments
    const segs = srtToSegments("Pasted Transcript", pendingPasteText, recordingStart, gapThreshold);
    if (segs.length === 0) {
      toast("No valid SRT entries found");
      setPendingPasteText(null);
      return;
    }

    const shortSegments = minDuration > 0
      ? segs.filter((s) => getDurationSeconds(s) < minDuration)
      : [];

    if (shortSegments.length > 0) {
      const shortIndices = new Set<number>();
      segs.forEach((s, i) => {
        if (getDurationSeconds(s) < minDuration) shortIndices.add(i);
      });
      setPreviewSegments(segs);
      setIgnoredIndices(shortIndices);
      setPendingRecordingStart(recordingStart);
      setShowPreview(true);
    } else {
      const imported = importParsedSegments(segs);
      onImport(imported);
      toast(`${imported.length} transcript${imported.length > 1 ? "s" : ""} imported`);
    }
    setPendingPasteText(null);
    if (pasteRef.current) pasteRef.current.value = "";
  }

  function toast(msg: string) {
    setShowToast(msg);
    setTimeout(() => setShowToast(null), 3000);
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        multiple
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files)}
      />

      <div className="flex items-center gap-2">
        {/* File import button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileSelect(e.dataTransfer.files);
          }}
          disabled={importing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95 ${
            importing
              ? "bg-gray-200 text-gray-500"
              : "bg-accent text-white hover:bg-blue-600"
          }`}
        >
          {importing ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20" />
              </svg>
              Importing...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" x2="12" y1="3" y2="15" />
              </svg>
              Import
            </>
          )}
        </button>

        {/* Paste toggle button */}
        <button
          onClick={() => setShowPasteArea(!showPasteArea)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all active:scale-95 ${
            showPasteArea
              ? "border-accent bg-accent-light text-accent"
              : "border-border bg-surface text-foreground hover:bg-gray-50"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          </svg>
          Paste
        </button>
      </div>

      {/* Paste area */}
      {showPasteArea && (
        <div className="fixed top-14 left-0 right-0 z-40 bg-surface border-b border-border shadow-lg p-4">
          <div className="max-w-2xl mx-auto">
            <p className="text-sm text-muted mb-2">
              Paste your SRT, JSON, or transcript text:
            </p>
            <textarea
              ref={pasteRef}
              autoFocus
              placeholder="Tap here, then paste your SRT, JSON, or transcript text..."
              className="w-full h-32 p-3 border border-border rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={() => {
                  setShowPasteArea(false);
                  if (pasteRef.current) pasteRef.current.value = "";
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:bg-gray-100 active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteSubmit}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-95"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SRT Start Time Prompt — File Import */}
      {showStartPrompt && (
        <StartTimeModal
          title="SRT Import — Recording Start Time"
          description="SRT files have relative timestamps. Enter when the recording started so we can plot it on the calendar."
          dateValue={startDate}
          timeValue={startTime}
          gapValue={gapThreshold}
          minDurationValue={minDuration}
          onDateChange={setStartDate}
          onTimeChange={setStartTime}
          onGapChange={setGapThreshold}
          onMinDurationChange={setMinDuration}
          onConfirm={confirmStartTime}
          onCancel={() => {
            setShowStartPrompt(false);
            setPendingFiles(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
          }}
        />
      )}

      {/* SRT Start Time Prompt — Paste */}
      {showPasteStartPrompt && (
        <StartTimeModal
          title="Pasted SRT — Recording Start Time"
          description="We detected SRT format. Enter when the recording started."
          dateValue={pasteStartDate}
          timeValue={pasteStartTime}
          gapValue={gapThreshold}
          minDurationValue={minDuration}
          onDateChange={setPasteStartDate}
          onTimeChange={setPasteStartTime}
          onGapChange={setGapThreshold}
          onMinDurationChange={setMinDuration}
          onConfirm={confirmPasteStartTime}
          onCancel={() => {
            setShowPasteStartPrompt(false);
            setPendingPasteText(null);
          }}
        />
      )}

      {/* Segment Preview — short segment ignore */}
      {showPreview && (
        <SegmentPreviewModal
          segments={previewSegments}
          ignoredIndices={ignoredIndices}
          minDuration={minDuration}
          onToggle={(index) => {
            setIgnoredIndices((prev) => {
              const next = new Set(prev);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            });
          }}
          onConfirm={confirmPreview}
          onCancel={() => {
            setShowPreview(false);
            setPreviewSegments([]);
            setIgnoredIndices(new Set());
            setPendingFiles(null);
            setPendingRecordingStart(null);
          }}
        />
      )}

      {/* Photo Import Modal */}
      {photoStep !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closePhotoModal}>
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-bold">
                {photoStep === "config" && "Import Photos"}
                {photoStep === "processing" && "Processing..."}
                {photoStep === "results" && "Import Results"}
              </h2>
              <button onClick={closePhotoModal} className="p-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {photoStep === "config" && (
                <>
                  {photoError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-xs font-semibold text-red-700 mb-1">Import Error</p>
                      <p className="text-[10px] text-red-600 break-words">{photoError}</p>
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    {pendingImageFiles ? `${pendingImageFiles.length} photo${pendingImageFiles.length !== 1 ? "s" : ""} selected` : "Configure photo import settings"}
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase text-muted">Time gap between events</label>
                    <p className="text-[10px] text-gray-400">Photos separated by more than this gap are split into separate events</p>
                    <div className="flex items-center gap-2">
                      <input type="range" min={5} max={120} step={5} value={photoGapMinutes} onChange={(e) => setPhotoGapMinutes(Number(e.target.value))} className="flex-1 h-1.5 accent-accent" />
                      <span className="text-xs font-medium w-16 text-right">{photoGapMinutes} min</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-xs font-medium">Match to recordings</p>
                      <p className="text-[10px] text-gray-400">Auto-attach photos taken during a recording</p>
                    </div>
                    <button
                      onClick={() => setPhotoMatchRecordings(!photoMatchRecordings)}
                      className={`relative w-10 h-5.5 rounded-full transition-colors ${photoMatchRecordings ? "bg-accent" : "bg-gray-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${photoMatchRecordings ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  {photoMatchRecordings && (
                    <div className="space-y-1.5 pl-2 border-l-2 border-accent/20">
                      <label className="text-[10px] font-semibold uppercase text-muted">Recording match buffer</label>
                      <p className="text-[10px] text-gray-400">How far before/after a recording to match photos</p>
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={60} step={5} value={photoBufferMinutes} onChange={(e) => setPhotoBufferMinutes(Number(e.target.value))} className="flex-1 h-1.5 accent-accent" />
                        <span className="text-xs font-medium w-16 text-right">{photoBufferMinutes} min</span>
                      </div>
                    </div>
                  )}

                  {/* Location info */}
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                    <p className="text-[10px] text-amber-800 font-medium">
                      To keep photo GPS data, tap <strong>Browse</strong> (not Photo Library) when the picker appears. iOS strips location from Photo Library uploads.
                    </p>
                  </div>

                  {/* Location fallback */}
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                    <p className="text-[10px] text-muted">
                      If photos lack GPS, use your current location as fallback for naming and client matching.
                    </p>
                    {fallbackLocation ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                          Current location: {fallbackLocation.lat.toFixed(4)}, {fallbackLocation.lng.toFixed(4)}
                        </span>
                        <button
                          onClick={() => { setFallbackLocation(null); setLocationStatus("idle"); }}
                          className="text-[10px] text-red-500 hover:text-red-700"
                        >
                          Clear
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setLocationStatus("loading");
                          navigator.geolocation.getCurrentPosition(
                            (pos) => {
                              setFallbackLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                              setLocationStatus("granted");
                            },
                            () => setLocationStatus("denied"),
                            { enableHighAccuracy: true, timeout: 10000 },
                          );
                        }}
                        disabled={locationStatus === "loading"}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium bg-white border border-border text-foreground hover:bg-gray-50 active:scale-95 disabled:opacity-50"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" />
                          <line x1="12" y1="2" x2="12" y2="6" />
                          <line x1="12" y1="18" x2="12" y2="22" />
                          <line x1="2" y1="12" x2="6" y2="12" />
                          <line x1="18" y1="12" x2="22" y2="12" />
                        </svg>
                        {locationStatus === "loading" ? "Getting location..." : "Use Current Location"}
                      </button>
                    )}
                    {locationStatus === "denied" && (
                      <p className="text-[10px] text-red-500">Location access denied. Check browser/device settings.</p>
                    )}
                  </div>
                </>
              )}

              {photoStep === "processing" && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-muted">Reading EXIF data, geocoding locations...</p>
                </div>
              )}

              {photoStep === "results" && photoResults && (
                <>
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                      <div className="text-lg font-bold text-gray-700">{photoResults.totalFiles}</div>
                      <div className="text-[10px] text-gray-500 font-medium uppercase">Selected</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                      <div className="text-lg font-bold text-green-700">
                        {photoResults.matched.reduce((n, r) => n + r.attachments.length, 0)}
                      </div>
                      <div className="text-[10px] text-green-600 font-medium uppercase">Matched</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                      <div className="text-lg font-bold text-blue-700">{photoResults.createdEvents.length}</div>
                      <div className="text-[10px] text-blue-600 font-medium uppercase">New Events</div>
                    </div>
                  </div>

                  {/* Diagnostics */}
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5 space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-muted">Diagnostics</p>
                    <p className="text-[10px] text-gray-500">
                      File types: {Object.entries(photoResults.diagnostics.fileTypes).map(([t, n]) => `${t} (${n})`).join(", ") || "none"}
                    </p>
                    <p className="text-[10px] text-gray-500">
                      GPS extracted: {photoResults.diagnostics.gpsFound} of {photoResults.diagnostics.gpsTotal} photos
                    </p>
                    <p className="text-[10px] text-gray-500">
                      Clients with coordinates: {photoResults.diagnostics.clientsWithCoords} of {photoResults.diagnostics.clientsTotal}
                    </p>
                    {photoResults.diagnostics.matchDetails.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {photoResults.diagnostics.matchDetails.map((md, i) => (
                          <p key={i} className="text-[10px] text-gray-500">
                            {md.segmentLabel}: {md.closestClient
                              ? `nearest client "${md.closestClient}" at ${md.distanceMeters}m${md.distanceMeters! <= 500 ? " (matched)" : " (>500m, not matched)"}`
                              : "no geocoded clients to compare"}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  {photoResults.matched.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Matched to Recordings</h3>
                      <div className="space-y-2">
                        {photoResults.matched.map((r) => (
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

                  {photoResults.createdEvents.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-semibold uppercase text-muted mb-2">Photo Events Created</h3>
                      <p className="text-[10px] text-gray-400 mb-2">Grouped by time and location, added to calendar</p>
                      <div className="space-y-2">
                        {photoResults.createdEvents.map((ev, idx) => {
                          const seg = photoResults.segments[idx];
                          const assignedClient = ev.clientId ? clients.find((c) => c.id === ev.clientId) : null;
                          return (
                            <div key={ev.id} className="rounded-lg border border-blue-200 bg-blue-50 p-2.5">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-semibold text-blue-800">{ev.label}</span>
                                <span className="text-[10px] text-blue-600">{ev.date}</span>
                              </div>
                              {/* GPS / Location info */}
                              {seg?.gps ? (
                                <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                  <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">
                                    GPS: {seg.gps.lat.toFixed(4)}, {seg.gps.lng.toFixed(4)}
                                  </span>
                                  {seg.address && (
                                    <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full">
                                      {seg.address}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <div className="mb-1.5">
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                                    No GPS data
                                  </span>
                                </div>
                              )}
                              {assignedClient && (
                                <div className="mb-1.5">
                                  <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                                    Assigned to {assignedClient.name}
                                  </span>
                                </div>
                              )}
                              <div className="flex gap-1.5 overflow-x-auto">
                                {ev.attachments?.map((att) => (
                                  <div key={att.id} className="shrink-0 w-12 h-12 rounded overflow-hidden border border-blue-200">
                                    <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {photoResults.matched.length === 0 && photoResults.createdEvents.length === 0 && (
                    <div className="text-center text-xs text-gray-400 py-6">No image files found</div>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border">
              {photoStep === "config" && (
                <button
                  onClick={processPhotos}
                  className="w-full py-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-blue-600 active:scale-[0.98]"
                >
                  Import {pendingImageFiles?.length || 0} Photo{(pendingImageFiles?.length || 0) !== 1 ? "s" : ""}
                </button>
              )}
              {photoStep === "results" && (
                <button
                  onClick={closePhotoModal}
                  className="w-full py-2.5 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-blue-600 active:scale-[0.98]"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {showToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {showToast}
        </div>
      )}
    </>
  );
}

function formatDurationLabel(seconds: number): string {
  if (seconds === 0) return "Off";
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
  return `${seconds}s`;
}

function StartTimeModal({
  title,
  description,
  dateValue,
  timeValue,
  gapValue,
  minDurationValue,
  onDateChange,
  onTimeChange,
  onGapChange,
  onMinDurationChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  dateValue: string;
  timeValue: string;
  gapValue: number;
  minDurationValue: number;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onGapChange: (v: number) => void;
  onMinDurationChange: (v: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold mb-1">{title}</h2>
          <p className="text-xs text-muted mb-4">{description}</p>

          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted block mb-1">
                Recording Date
              </label>
              <input
                type="date"
                value={dateValue}
                onChange={(e) => onDateChange(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted block mb-1">
                Recording Start Time
              </label>
              <input
                type="time"
                value={timeValue}
                onChange={(e) => onTimeChange(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted block mb-1">
                Silence Gap for Grouping
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={30}
                  max={600}
                  step={30}
                  value={gapValue}
                  onChange={(e) => onGapChange(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-medium tabular-nums w-14 text-right">
                  {formatDurationLabel(gapValue)}
                </span>
              </div>
              <p className="text-[10px] text-muted mt-0.5">
                Segments separated by more than this silence become separate recordings
              </p>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase text-muted block mb-1">
                Ignore Short Segments
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={120}
                  step={5}
                  value={minDurationValue}
                  onChange={(e) => onMinDurationChange(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xs font-medium tabular-nums w-14 text-right">
                  {formatDurationLabel(minDurationValue)}
                </span>
              </div>
              <p className="text-[10px] text-muted mt-0.5">
                {minDurationValue > 0
                  ? `Segments shorter than ${formatDurationLabel(minDurationValue)} will be flagged for review before import`
                  : "No minimum — all segments will be imported"}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border bg-gray-50">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-muted hover:bg-gray-100 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98]"
          >
            {minDurationValue > 0 ? "Preview & Import" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SegmentPreviewModal({
  segments,
  ignoredIndices,
  minDuration,
  onToggle,
  onConfirm,
  onCancel,
}: {
  segments: (ParsedTranscript & { segmentTitle?: string })[];
  ignoredIndices: Set<number>;
  minDuration: number;
  onToggle: (index: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const keptCount = segments.length - ignoredIndices.size;
  const ignoredCount = ignoredIndices.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-sm font-bold mb-1">Review Short Segments</h2>
          <p className="text-xs text-muted mb-1">
            {ignoredCount} segment{ignoredCount !== 1 ? "s" : ""} under {formatDurationLabel(minDuration)} will be ignored.
            Uncheck any you want to keep.
          </p>
          <div className="flex gap-3 text-[10px] font-medium mt-2">
            <span className="text-green-600">{keptCount} importing</span>
            <span className="text-red-500">{ignoredCount} ignoring</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-3">
          <div className="space-y-1">
            {segments.map((seg, i) => {
              const durSec = seg.entries.length > 0
                ? seg.entries[seg.entries.length - 1].endSeconds - seg.entries[0].startSeconds
                : seg.duration * 60;
              const isShort = durSec < minDuration;
              const isIgnored = ignoredIndices.has(i);
              const title = seg.segmentTitle || seg.fileName;
              const preview = seg.fullText.slice(0, 100).replace(/\n/g, " ");

              return (
                <button
                  key={i}
                  onClick={() => isShort ? onToggle(i) : undefined}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
                    isIgnored
                      ? "border-red-200 bg-red-50/50 opacity-60"
                      : "border-border bg-white"
                  } ${isShort ? "cursor-pointer hover:bg-gray-50" : "cursor-default"}`}
                >
                  <div className="flex items-start gap-2.5">
                    {isShort && (
                      <div className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center ${
                        isIgnored ? "border-red-400 bg-red-400" : "border-green-500 bg-green-500"
                      }`}>
                        {isIgnored ? (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                            <path d="M2 2l6 6M8 2L2 8" />
                          </svg>
                        ) : (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                            <path d="M2 5l2 2 4-4" />
                          </svg>
                        )}
                      </div>
                    )}
                    {!isShort && <div className="mt-0.5 w-4 h-4 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">{title}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                          isShort
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {durSec < 60 ? `${Math.round(durSec)}s` : `${Math.round(durSec / 60)}m`}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted mt-0.5 truncate">
                        {seg.startTime} · {preview}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border bg-gray-50 shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-muted hover:bg-gray-100 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98]"
          >
            Import {keptCount} Segment{keptCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
