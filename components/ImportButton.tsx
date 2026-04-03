"use client";

import { useRef, useState } from "react";
import { importMultipleSrtFiles, importFromClipboardText } from "@/lib/store";
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const imported = await importMultipleSrtFiles(files);
      if (imported.length > 0) {
        onImport(imported);
        toast(`${imported.length} transcript${imported.length > 1 ? "s" : ""} imported`);
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handlePasteSubmit() {
    const text = pasteRef.current?.value;
    if (!text || text.trim().length < 10) {
      toast("Paste some transcript text first");
      return;
    }
    const transcript = importFromClipboardText(text);
    if (transcript) {
      onImport([transcript]);
      toast("Transcript imported");
      setShowPasteArea(false);
      if (pasteRef.current) pasteRef.current.value = "";
    }
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
        accept=".srt"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="flex items-center gap-2">
        {/* File import button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
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
              Import SRT
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

      {/* Paste area - slides down below header */}
      {showPasteArea && (
        <div className="fixed top-14 left-0 right-0 z-40 bg-surface border-b border-border shadow-lg p-4">
          <div className="max-w-2xl mx-auto">
            <p className="text-sm text-muted mb-2">
              Tap the box below, then long-press and select Paste to paste your transcript:
            </p>
            <textarea
              ref={pasteRef}
              autoFocus
              placeholder="Tap here, then paste your SRT or transcript text..."
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
                Import Pasted Text
              </button>
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
