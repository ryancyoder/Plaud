"use client";

import { useRef, useState } from "react";
import { importFiles, importFromText, importParsedSegments } from "@/lib/store";
import { srtToSegments, ParsedTranscript } from "@/lib/srt-parser";
import { Transcript } from "@/lib/types";

interface ImportButtonProps {
  onImport: (transcripts: Transcript[]) => void;
}

export default function ImportButton({ onImport }: ImportButtonProps) {
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

    // Check if any SRT files are in the selection
    const hasSrt = Array.from(files).some((f) => f.name.toLowerCase().endsWith(".srt"));
    if (hasSrt) {
      // Show the start date/time prompt
      setPendingFiles(files);
      setStartDate(todayStr());
      setStartTime("09:00");
      setShowStartPrompt(true);
    } else {
      // JSON files — import directly
      doImport(files);
    }
  }

  async function doImport(files: FileList, recordingStart?: Date, gap?: number) {
    setImporting(true);
    try {
      const imported = await importFiles(files, recordingStart, gap);
      if (imported.length > 0) {
        onImport(imported);
        toast(`${imported.length} transcript${imported.length > 1 ? "s" : ""} imported`);
      } else {
        toast("No .srt or .json files found");
      }
    } catch (e) {
      toast(`Import error: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
