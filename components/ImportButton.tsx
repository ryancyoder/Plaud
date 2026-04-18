"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { importParsedSegments, importFromText, addEvent, updateEvent } from "@/lib/event-store";
import { srtToSegments, ParsedTranscript } from "@/lib/srt-parser";
import { AppEvent, Attachment, Client } from "@/lib/types";
import { batchMatchPhotos, PhotoMatchResult, PhotoSegment, GpsCoords, reverseGeocode, findClosestClient, findClientByAddress } from "@/lib/photo-matcher";
import { getLastName } from "@/lib/utils";
import {
  saveAttachments as dbSaveAttachments,
  loadAttachments as dbLoadAttachments,
  removeAttachmentsForTranscript as dbRemoveAttachmentsForEvent,
} from "@/lib/attachment-store";
import { deleteEvent } from "@/lib/event-store";

interface ImportButtonProps {
  onImport: (events: AppEvent[]) => void;
  // Photo import props
  events?: AppEvent[];
  clients?: Client[];
  onPhotosMatched?: (results: PhotoMatchResult[]) => void;
  onPhotoEventsCreated?: (events: AppEvent[]) => void;
  onNavigateToEvent?: (eventId: string, date: string) => void;
  onDeleteEvent?: (eventId: string) => void;
  onUpdateEvent?: (eventId: string, updates: Partial<AppEvent>) => void;
}

export default function ImportButton({
  onImport,
  events = [],
  clients = [],
  onPhotosMatched,
  onPhotoEventsCreated,
  onNavigateToEvent,
  onDeleteEvent,
  onUpdateEvent: onUpdateEventProp,
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
  type PhotoStep = "closed" | "config" | "preview" | "processing" | "results";
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
    diagnostics: { fileTypes: Record<string, number>; gpsFound: number; gpsTotal: number; clientsWithCoords: number; clientsTotal: number; matchDetails: { segmentLabel: string; closestClient: string | null; distanceMeters: number | null; matchMethod?: "gps" | "address" | null }[] };
  } | null>(null);
  const [pendingImageFiles, setPendingImageFiles] = useState<FileList | null>(null);
  const [photoThumbnails, setPhotoThumbnails] = useState<{ file: File; url: string }[]>([]);
  const [excludedPhotos, setExcludedPhotos] = useState<Set<number>>(new Set());
  const [editedEventLabels, setEditedEventLabels] = useState<Record<string, string>>({});
  const [showAssignAll, setShowAssignAll] = useState(false);
  const [assignAllSearch, setAssignAllSearch] = useState("");
  const [fallbackLocation, setFallbackLocation] = useState<GpsCoords | null>(null);
  const [locationStatus, setLocationStatus] = useState<"idle" | "loading" | "granted" | "denied">("idle");

  // Global paste handler for images
  const handleGlobalPaste = useCallback((e: ClipboardEvent) => {
    // Skip if user is typing in an input/textarea (unless it's our paste area)
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || (target.tagName === "TEXTAREA" && target !== pasteRef.current)) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      // Create a FileList-like object via DataTransfer
      const dt = new DataTransfer();
      imageFiles.forEach(f => dt.items.add(f));
      setPendingImageFiles(dt.files);
      setPhotoStep("config");
    }
  }, []);

  useEffect(() => {
    document.addEventListener("paste", handleGlobalPaste);
    return () => document.removeEventListener("paste", handleGlobalPaste);
  }, [handleGlobalPaste]);

  // Handle paste in the paste textarea — check for images first
  function handlePasteAreaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach(f => dt.items.add(f));
      setPendingImageFiles(dt.files);
      setShowPasteArea(false);
      setPhotoStep("config");
    }
    // Otherwise let normal text paste proceed
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function nowTimeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  const isDocFile = (f: File) =>
    f.type === "application/pdf" ||
    f.type === "application/msword" ||
    f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    f.type === "application/vnd.ms-excel" ||
    f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    f.type === "text/plain" ||
    f.type === "text/csv" ||
    f.name.toLowerCase().match(/\.(pdf|doc|docx|xls|xlsx|txt|csv)$/);

  function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;

    const hasSrt = Array.from(files).some((f) => f.name.toLowerCase().endsWith(".srt"));
    const hasImages = Array.from(files).some((f) => f.type.startsWith("image/") || f.type.startsWith("video/"));
    const hasDocs = Array.from(files).some(isDocFile);

    if (hasSrt) {
      setPendingFiles(files);
      setStartDate(todayStr());
      setStartTime("09:00");
      setShowStartPrompt(true);
    } else if (hasImages) {
      setPendingImageFiles(files);
      setPhotoStep("config");
    } else if (hasDocs) {
      importDocuments(Array.from(files).filter(isDocFile));
    } else {
      toast("Supported: .srt transcripts, images, videos, or documents (PDF, DOC, XLS, TXT)");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function importDocuments(files: File[]) {
    setImporting(true);
    try {
      const today = todayStr();
      const now = nowTimeStr();
      const attachments: Attachment[] = [];

      for (const file of files) {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        attachments.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          type: "document",
          mimeType: file.type || "application/octet-stream",
          dataUrl,
          timestamp: new Date().toISOString(),
        });
      }

      const fileNames = files.map((f) => f.name).join(", ");
      const label = files.length === 1
        ? files[0].name
        : `${files.length} Documents`;

      const strippedAtts: Attachment[] = attachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" }));

      const newEvent = addEvent({
        type: "site-visit",
        date: today,
        startTime: now,
        label,
        notes: `Imported: ${fileNames}`,
        attachments: strippedAtts,
      });

      await dbSaveAttachments(newEvent.id, attachments);
      onImport([{ ...newEvent, attachments }]);
      toast(`Imported ${files.length} document${files.length !== 1 ? "s" : ""}`);
    } catch {
      toast("Failed to import documents");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function goToPhotoPreview() {
    if (!pendingImageFiles) return;
    // Generate thumbnails for preview
    const thumbs: { file: File; url: string }[] = [];
    for (let i = 0; i < pendingImageFiles.length; i++) {
      const file = pendingImageFiles[i];
      if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
        const url = URL.createObjectURL(file);
        thumbs.push({ file, url });
      }
    }
    setPhotoThumbnails(thumbs);
    setExcludedPhotos(new Set());
    setPhotoStep("preview");
  }

  function togglePhotoExclusion(idx: number) {
    setExcludedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function processPhotos() {
    if (!pendingImageFiles) return;
    // Filter out excluded photos
    const filesToImport = photoThumbnails
      .filter((_, i) => !excludedPhotos.has(i))
      .map(t => t.file);
    if (filesToImport.length === 0) {
      setPhotoError("No photos selected for import");
      setPhotoStep("config");
      return;
    }
    // Clean up object URLs
    photoThumbnails.forEach(t => URL.revokeObjectURL(t.url));
    setPhotoThumbnails([]);
    setPhotoStep("processing");
    setPhotoError(null);

    // Create a synthetic FileList-like array
    const dataTransfer = new DataTransfer();
    filesToImport.forEach(f => dataTransfer.items.add(f));
    const filteredFiles = dataTransfer.files;

    try {
      const result = await batchMatchPhotos(
        filteredFiles,
        photoMatchRecordings ? events : [],
        photoGapMinutes,
        photoBufferMinutes,
        clients,
      );

      if (result.matched.length > 0) {
        onPhotosMatched?.(result.matched);
      }

      // Apply fallback location to segments without GPS
      if (fallbackLocation) {
        const noGpsSegments = result.unmatchedSegments.filter((s) => !s.gps);
        if (noGpsSegments.length > 0) {
          // Reverse-geocode once for the shared fallback location
          let fallbackAddress: string | null = null;
          try {
            fallbackAddress = await reverseGeocode(fallbackLocation);
          } catch { /* skip */ }
          const fallbackClient = findClosestClient(fallbackLocation, clients)
            || (fallbackAddress ? findClientByAddress(fallbackAddress, clients) : null);
          for (const seg of noGpsSegments) {
            seg.gps = fallbackLocation;
            seg.address = fallbackAddress;
            seg.matchedClient = fallbackClient;
          }
        }
      }

      const created: AppEvent[] = [];
      for (const seg of result.unmatchedSegments) {
        const timeStr = seg.startTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        const clientLastName = seg.matchedClient ? getLastName(seg.matchedClient.name) : null;
        const addressLabel = seg.matchedClient?.address || seg.address || null;
        const label = clientLastName && addressLabel
          ? `${clientLastName} - ${addressLabel}`
          : clientLastName || addressLabel || timeStr;

        const strippedAtts: Attachment[] = seg.attachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" }));

        const durationMin = Math.round((seg.endTime.getTime() - seg.startTime.getTime()) / 60000);

        const newEvent = addEvent({
          type: "photo",
          date: seg.date,
          startTime: `${String(seg.startTime.getHours()).padStart(2, "0")}:${String(seg.startTime.getMinutes()).padStart(2, "0")}`,
          duration: durationMin > 0 ? durationMin : undefined,
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
        totalFiles: filteredFiles.length,
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
    // Navigate to most recent created event before clearing state
    if (photoResults && onNavigateToEvent) {
      const allCreated = photoResults.createdEvents;
      if (allCreated.length > 0) {
        // Pick the most recent by date/time
        const sorted = [...allCreated].sort((a, b) => {
          const cmp = b.date.localeCompare(a.date);
          if (cmp !== 0) return cmp;
          return (b.startTime || "").localeCompare(a.startTime || "");
        });
        onNavigateToEvent(sorted[0].id, sorted[0].date);
      }
    }
    photoThumbnails.forEach(t => URL.revokeObjectURL(t.url));
    setPhotoThumbnails([]);
    setExcludedPhotos(new Set());
    setEditedEventLabels({});
    setShowAssignAll(false);
    setAssignAllSearch("");
    setPhotoStep("closed");
    setPhotoError(null);
    setPhotoResults(null);
    setPendingImageFiles(null);
    setFallbackLocation(null);
    setLocationStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /**
   * Merge a created photo event into an adjacent event in the results list.
   * The source event (lacking client/GPS) is consumed into the target.
   * Target keeps its title, client, and GPS. Source contributes attachments
   * and extends the time range.
   */
  async function handleMergeImportEvent(sourceIdx: number, direction: "up" | "down") {
    if (!photoResults) return;
    const list = photoResults.createdEvents;
    const targetIdx = direction === "up" ? sourceIdx - 1 : sourceIdx + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    const source = list[sourceIdx];
    const target = list[targetIdx];

    // Move attachments from source to target in IndexedDB
    const sourceAtts = await dbLoadAttachments(source.id);
    if (sourceAtts.length > 0) {
      await dbSaveAttachments(target.id, sourceAtts);
    }
    await dbRemoveAttachmentsForEvent(source.id);

    // Merge in-memory attachments
    const mergedAttachments = [...(target.attachments || []), ...(source.attachments || [])];

    // Determine merged time range
    const allStarts = [target.startTime, source.startTime].filter(Boolean) as string[];
    const allEnds: string[] = [];
    for (const ev of [target, source]) {
      if (ev.startTime && ev.duration) {
        const [h, m] = ev.startTime.split(":").map(Number);
        const endMin = h * 60 + m + ev.duration;
        allEnds.push(`${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`);
      } else if (ev.startTime) {
        allEnds.push(ev.startTime);
      }
    }
    const newStart = allStarts.sort()[0] || target.startTime;
    const newEnd = allEnds.sort().reverse()[0];
    let newDuration: number | undefined;
    if (newStart && newEnd) {
      const [sh, sm] = newStart.split(":").map(Number);
      const [eh, em] = newEnd.split(":").map(Number);
      const d = (eh * 60 + em) - (sh * 60 + sm);
      if (d > 0) newDuration = d;
    }

    // Update target event in storage
    const targetUpdates: Partial<AppEvent> = {
      startTime: newStart,
      ...(newDuration ? { duration: newDuration } : {}),
      attachments: mergedAttachments.map(({ dataUrl, ...rest }) => ({ ...rest, dataUrl: "" })),
    };
    updateEvent(target.id, targetUpdates);

    // Delete source event from storage
    deleteEvent(source.id);

    // Update results state
    const updatedTarget = { ...target, ...targetUpdates, attachments: mergedAttachments };
    const updatedEvents = list
      .map((ev, i) => i === targetIdx ? updatedTarget : ev)
      .filter((_, i) => i !== sourceIdx);
    const updatedSegments = photoResults.segments.filter((_, i) => i !== sourceIdx);

    setPhotoResults({
      ...photoResults,
      createdEvents: updatedEvents,
      segments: updatedSegments,
    });

    // Notify parent so dashboard state stays in sync
    onDeleteEvent?.(source.id);
    onUpdateEventProp?.(target.id, { ...targetUpdates, attachments: mergedAttachments });
  }

  function handleAssignAllToClient(clientId: string) {
    if (!photoResults) return;
    const updatedEvents = photoResults.createdEvents.map((ev) => {
      updateEvent(ev.id, { clientId });
      onUpdateEventProp?.(ev.id, { clientId });
      return { ...ev, clientId };
    });
    setPhotoResults({ ...photoResults, createdEvents: updatedEvents });
    setShowAssignAll(false);
    setAssignAllSearch("");
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
              Paste text (SRT, JSON, transcript) or photos:
            </p>
            <textarea
              ref={pasteRef}
              autoFocus
              onPaste={handlePasteAreaPaste}
              placeholder="Paste text (SRT, JSON, transcript) or images..."
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
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-bold">
                {photoStep === "config" && "Import Photos"}
                {photoStep === "preview" && `Select Photos (${photoThumbnails.length - excludedPhotos.size} of ${photoThumbnails.length})`}
                {photoStep === "processing" && "Processing..."}
                {photoStep === "results" && "Import Results"}
              </h2>
              <button onClick={closePhotoModal} className="p-1.5 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {photoStep === "config" && (
                <>
                  {photoError && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                      <p className="text-sm font-semibold text-red-700 mb-1">Import Error</p>
                      <p className="text-xs text-red-600 break-words">{photoError}</p>
                    </div>
                  )}
                  <p className="text-sm text-muted">
                    {pendingImageFiles ? `${pendingImageFiles.length} photo${pendingImageFiles.length !== 1 ? "s" : ""} selected` : "Configure photo import settings"}
                  </p>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold uppercase text-muted">Time gap between events</label>
                    <p className="text-xs text-gray-400">Photos separated by more than this gap are split into separate events</p>
                    <div className="flex items-center gap-2">
                      <input type="range" min={5} max={120} step={5} value={photoGapMinutes} onChange={(e) => setPhotoGapMinutes(Number(e.target.value))} className="flex-1 h-2 accent-accent" />
                      <span className="text-sm font-medium w-16 text-right">{photoGapMinutes} min</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium">Match to recordings</p>
                      <p className="text-xs text-gray-400">Auto-attach photos taken during a recording</p>
                    </div>
                    <button
                      onClick={() => setPhotoMatchRecordings(!photoMatchRecordings)}
                      className={`relative w-10 h-5.5 rounded-full transition-colors ${photoMatchRecordings ? "bg-accent" : "bg-gray-300"}`}
                    >
                      <div className={`absolute top-0.5 w-4.5 h-4.5 bg-white rounded-full shadow transition-transform ${photoMatchRecordings ? "translate-x-5" : "translate-x-0.5"}`} />
                    </button>
                  </div>

                  {photoMatchRecordings && (
                    <div className="space-y-1.5 pl-3 border-l-2 border-accent/20">
                      <label className="text-xs font-semibold uppercase text-muted">Recording match buffer</label>
                      <p className="text-xs text-gray-400">How far before/after a recording to match photos</p>
                      <div className="flex items-center gap-2">
                        <input type="range" min={0} max={60} step={5} value={photoBufferMinutes} onChange={(e) => setPhotoBufferMinutes(Number(e.target.value))} className="flex-1 h-2 accent-accent" />
                        <span className="text-sm font-medium w-16 text-right">{photoBufferMinutes} min</span>
                      </div>
                    </div>
                  )}

                  {/* Location info */}
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                    <p className="text-xs text-amber-800 font-medium">
                      To keep photo GPS data, tap <strong>Browse</strong> (not Photo Library) when the picker appears. iOS strips location from Photo Library uploads.
                    </p>
                  </div>

                  {/* Location fallback */}
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 space-y-2">
                    <p className="text-xs text-muted">
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

              {photoStep === "preview" && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted">Tap photos to exclude them from import</p>
                    <button
                      onClick={() => {
                        if (excludedPhotos.size === photoThumbnails.length) {
                          setExcludedPhotos(new Set());
                        } else {
                          setExcludedPhotos(new Set(photoThumbnails.map((_, i) => i)));
                        }
                      }}
                      className="text-xs font-medium text-accent hover:text-blue-700"
                    >
                      {excludedPhotos.size === photoThumbnails.length ? "Select All" : "Deselect All"}
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {photoThumbnails.map((thumb, idx) => {
                      const excluded = excludedPhotos.has(idx);
                      return (
                        <button
                          key={idx}
                          onClick={() => togglePhotoExclusion(idx)}
                          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                            excluded ? "border-red-300 opacity-40" : "border-green-400"
                          }`}
                        >
                          {thumb.file.type.startsWith("video/") ? (
                            <>
                              <video src={thumb.url + "#t=0.1"} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                              <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21" /></svg>
                              </div>
                            </>
                          ) : (
                            <img src={thumb.url} alt={thumb.file.name} className="w-full h-full object-cover" />
                          )}
                          {excluded && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                                <line x1="4" y1="4" x2="20" y2="20" />
                                <line x1="20" y1="4" x2="4" y2="20" />
                              </svg>
                            </div>
                          )}
                          {!excluded && (
                            <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          )}
                          <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5">
                            <span className="text-[9px] text-white truncate block">{thumb.file.name}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {photoStep === "processing" && (
                <div className="flex flex-col items-center py-8 gap-3">
                  <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-muted">Reading EXIF data and matching locations...</p>
                </div>
              )}

              {photoStep === "results" && photoResults && (
                <>
                  <div className="flex gap-3">
                    <div className="flex-1 rounded-lg bg-gray-50 border border-gray-200 p-3 text-center">
                      <div className="text-lg font-bold text-gray-700">{photoResults.totalFiles}</div>
                      <div className="text-xs text-gray-500 font-medium uppercase">Selected</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                      <div className="text-lg font-bold text-green-700">
                        {photoResults.matched.reduce((n, r) => n + r.attachments.length, 0)}
                      </div>
                      <div className="text-xs text-green-600 font-medium uppercase">To Events</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-purple-50 border border-purple-200 p-3 text-center">
                      <div className="text-lg font-bold text-purple-700">
                        {photoResults.createdEvents.filter(ev => ev.clientId).length}
                      </div>
                      <div className="text-xs text-purple-600 font-medium uppercase">To Clients</div>
                    </div>
                    <div className="flex-1 rounded-lg bg-blue-50 border border-blue-200 p-3 text-center">
                      <div className="text-lg font-bold text-blue-700">{photoResults.createdEvents.length}</div>
                      <div className="text-xs text-blue-600 font-medium uppercase">New Events</div>
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
                      Clients with coords: {photoResults.diagnostics.clientsWithCoords} of {photoResults.diagnostics.clientsTotal} | Address text matching: enabled
                    </p>
                    {photoResults.diagnostics.matchDetails.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {photoResults.diagnostics.matchDetails.map((md, i) => (
                          <p key={i} className="text-[10px] text-gray-500">
                            {md.segmentLabel}: {md.matchMethod === "gps"
                              ? `GPS match "${md.closestClient}" at ${md.distanceMeters}m`
                              : md.matchMethod === "address"
                              ? `address match "${md.closestClient}"`
                              : md.closestClient && md.distanceMeters != null
                              ? `nearest "${md.closestClient}" at ${md.distanceMeters}m (too far)`
                              : "no client match"}
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
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h3 className="text-xs font-semibold uppercase text-muted">Photo Events Created</h3>
                          <p className="text-xs text-gray-400">Grouped by time and location, added to calendar</p>
                        </div>
                        <div className="relative">
                          <button
                            onClick={() => setShowAssignAll(!showAssignAll)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-accent border border-accent/30 hover:bg-accent/10 active:scale-95"
                          >
                            Assign All
                          </button>
                          {showAssignAll && (
                            <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-white border border-border rounded-lg shadow-lg overflow-hidden">
                              <div className="p-2 border-b border-border">
                                <input
                                  type="text"
                                  value={assignAllSearch}
                                  onChange={(e) => setAssignAllSearch(e.target.value)}
                                  placeholder="Search clients & projects..."
                                  className="w-full text-xs px-2 py-1.5 border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent/40"
                                  autoFocus
                                />
                              </div>
                              <div className="max-h-48 overflow-y-auto">
                                {clients
                                  .filter((c) => c.name.toLowerCase().includes(assignAllSearch.toLowerCase()))
                                  .sort((a, b) => {
                                    if (a.kind === "project" && b.kind !== "project") return -1;
                                    if (a.kind !== "project" && b.kind === "project") return 1;
                                    return a.name.localeCompare(b.name);
                                  })
                                  .map((c) => (
                                    <button
                                      key={c.id}
                                      onClick={() => handleAssignAllToClient(c.id)}
                                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2"
                                    >
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.kind === "project" ? "bg-emerald-500" : "bg-blue-500"}`} />
                                      <span className="truncate">{c.name}</span>
                                      {c.kind === "project" && <span className="text-[9px] text-gray-400 shrink-0">project</span>}
                                    </button>
                                  ))}
                                {clients.filter((c) => c.name.toLowerCase().includes(assignAllSearch.toLowerCase())).length === 0 && (
                                  <div className="px-3 py-2 text-[10px] text-gray-400">No matches</div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {photoResults.createdEvents.map((ev, idx) => {
                          const seg = photoResults.segments[idx];
                          const assignedClient = ev.clientId ? clients.find((c) => c.id === ev.clientId) : null;
                          const isUnmatched = !ev.clientId && !photoResults.matched.some(m => m.eventId === ev.id);
                          const currentLabel = editedEventLabels[ev.id] ?? ev.label;
                          const canMergeUp = idx > 0;
                          const canMergeDown = idx < photoResults.createdEvents.length - 1;
                          return (
                            <div key={ev.id} className="flex gap-1.5">
                              {/* Merge arrows */}
                              {photoResults.createdEvents.length > 1 && (
                                <div className="flex flex-col items-center justify-center gap-0.5 shrink-0">
                                  <button
                                    onClick={() => handleMergeImportEvent(idx, "up")}
                                    disabled={!canMergeUp}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
                                      canMergeUp
                                        ? "bg-gray-200 hover:bg-blue-200 text-gray-600 hover:text-blue-700 active:scale-95"
                                        : "bg-gray-50 text-gray-300 cursor-not-allowed"
                                    }`}
                                    title={canMergeUp ? "Merge into event above" : ""}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="18 15 12 9 6 15" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => handleMergeImportEvent(idx, "down")}
                                    disabled={!canMergeDown}
                                    className={`w-6 h-6 rounded flex items-center justify-center text-xs transition-colors ${
                                      canMergeDown
                                        ? "bg-gray-200 hover:bg-blue-200 text-gray-600 hover:text-blue-700 active:scale-95"
                                        : "bg-gray-50 text-gray-300 cursor-not-allowed"
                                    }`}
                                    title={canMergeDown ? "Merge into event below" : ""}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                              {/* Event card */}
                              <div className={`flex-1 rounded-lg border p-2.5 ${isUnmatched ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
                                <div className="flex items-center justify-between mb-1 gap-2">
                                  <input
                                    type="text"
                                    value={currentLabel}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setEditedEventLabels(prev => ({ ...prev, [ev.id]: val }));
                                    }}
                                    onBlur={() => {
                                      const val = editedEventLabels[ev.id];
                                      if (val !== undefined && val !== ev.label) {
                                        updateEvent(ev.id, { label: val });
                                        ev.label = val;
                                        onUpdateEventProp?.(ev.id, { label: val });
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                    }}
                                    className={`flex-1 text-sm font-semibold rounded px-2 py-0.5 focus:outline-none focus:ring-2 ${
                                      isUnmatched
                                        ? "text-amber-800 bg-white border border-amber-300 focus:ring-amber-400"
                                        : "text-blue-800 bg-white/60 border border-blue-200 focus:ring-blue-400"
                                    }`}
                                    placeholder="Name this event..."
                                  />
                                  <span className="text-xs text-blue-600 shrink-0">{ev.date} {ev.startTime || ""}</span>
                                </div>
                                {isUnmatched && (
                                  <p className="text-[10px] text-amber-600 mb-1.5">No matching client or event — rename or merge with adjacent event</p>
                                )}
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
                                {seg?.dateSources && seg.dateSources.some((s) => s.includes("UNRELIABLE")) && (
                                  <div className="mb-1.5">
                                    <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
                                      Date may be wrong — no metadata found, using file date
                                    </span>
                                  </div>
                                )}
                                {seg?.dateSources && (
                                  <div className="mb-1.5">
                                    <span className="text-[10px] bg-gray-50 text-gray-400 px-1.5 py-0.5 rounded-full">
                                      Date from: {seg.dateSources.join(", ")}
                                    </span>
                                  </div>
                                )}
                                {assignedClient && (
                                  <div className="mb-1.5 flex items-center gap-1.5">
                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                                      Assigned to {assignedClient.name}
                                    </span>
                                    <button
                                      onClick={() => {
                                        updateEvent(ev.id, { clientId: undefined });
                                        onUpdateEventProp?.(ev.id, { clientId: undefined });
                                        setPhotoResults((prev) => {
                                          if (!prev) return prev;
                                          return {
                                            ...prev,
                                            createdEvents: prev.createdEvents.map((e) =>
                                              e.id === ev.id ? { ...e, clientId: undefined } : e
                                            ),
                                          };
                                        });
                                      }}
                                      className="text-[10px] text-red-500 hover:text-red-700 hover:bg-red-50 rounded px-1 py-0.5"
                                      title="Remove assignment"
                                    >
                                      &times;
                                    </button>
                                  </div>
                                )}
                                <div className="flex gap-1.5 overflow-x-auto">
                                  {ev.attachments?.map((att) => (
                                    <div key={att.id} className="shrink-0 w-14 h-14 rounded overflow-hidden border border-blue-200">
                                      <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                                    </div>
                                  ))}
                                </div>
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

            <div className="px-5 py-4 border-t border-border">
              {photoStep === "config" && (
                <button
                  onClick={goToPhotoPreview}
                  className="w-full py-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-blue-600 active:scale-[0.98]"
                >
                  Review {pendingImageFiles?.length || 0} Photo{(pendingImageFiles?.length || 0) !== 1 ? "s" : ""}
                </button>
              )}
              {photoStep === "preview" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => setPhotoStep("config")}
                    className="flex-1 py-3 rounded-lg border border-border text-sm font-semibold hover:bg-gray-50 active:scale-[0.98]"
                  >
                    Back
                  </button>
                  <button
                    onClick={processPhotos}
                    disabled={excludedPhotos.size === photoThumbnails.length}
                    className="flex-1 py-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-blue-600 active:scale-[0.98] disabled:opacity-40"
                  >
                    Import {photoThumbnails.length - excludedPhotos.size} Photo{(photoThumbnails.length - excludedPhotos.size) !== 1 ? "s" : ""}
                  </button>
                </div>
              )}
              {photoStep === "results" && (
                <button
                  onClick={closePhotoModal}
                  className="w-full py-3 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-blue-600 active:scale-[0.98]"
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
