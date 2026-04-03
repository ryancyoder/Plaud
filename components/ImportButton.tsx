"use client";

import { useRef, useState } from "react";
import { importFiles, importFromText } from "@/lib/store";
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

  function confirmStartTime() {
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
    // Persist gap setting
    localStorage.setItem("plaud-gap-threshold", String(gapThreshold));
    setShowStartPrompt(false);
    doImport(pendingFiles, recordingStart, gapThreshold);
    setPendingFiles(null);
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
    setShowPasteStartPrompt(false);
    try {
      const transcripts = importFromText(pendingPasteText, recordingStart, gapThreshold);
      if (transcripts.length > 0) {
        onImport(transcripts);
        toast(`${transcripts.length} transcript${transcripts.length > 1 ? "s" : ""} imported`);
      }
    } catch (e) {
      toast(`Parse error: ${e instanceof Error ? e.message : "Unknown error"}`);
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
          onDateChange={setStartDate}
          onTimeChange={setStartTime}
          onGapChange={setGapThreshold}
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
          onDateChange={setPasteStartDate}
          onTimeChange={setPasteStartTime}
          onGapChange={setGapThreshold}
          onConfirm={confirmPasteStartTime}
          onCancel={() => {
            setShowPasteStartPrompt(false);
            setPendingPasteText(null);
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

function StartTimeModal({
  title,
  description,
  dateValue,
  timeValue,
  gapValue,
  onDateChange,
  onTimeChange,
  onGapChange,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  dateValue: string;
  timeValue: string;
  gapValue: number;
  onDateChange: (v: string) => void;
  onTimeChange: (v: string) => void;
  onGapChange: (v: number) => void;
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
                  {gapValue >= 60 ? `${Math.floor(gapValue / 60)}m${gapValue % 60 ? ` ${gapValue % 60}s` : ""}` : `${gapValue}s`}
                </span>
              </div>
              <p className="text-[10px] text-muted mt-0.5">
                Segments separated by more than this silence become separate recordings
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
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
