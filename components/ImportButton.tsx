"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { importMultipleSrtFiles, importFromClipboardText } from "@/lib/store";
import { Transcript } from "@/lib/types";

interface ImportButtonProps {
  onImport: (transcripts: Transcript[]) => void;
}

export default function ImportButton({ onImport }: ImportButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [showPasteToast, setShowPasteToast] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const imported = await importMultipleSrtFiles(files);
      if (imported.length > 0) {
        onImport(imported);
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text/plain");
      if (!text || text.trim().length < 10) return;

      // Don't intercept paste if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }

      e.preventDefault();
      const transcript = importFromClipboardText(text);
      if (transcript) {
        onImport([transcript]);
        setShowPasteToast(true);
        setTimeout(() => setShowPasteToast(false), 3000);
      }
    },
    [onImport]
  );

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

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

        {/* Paste hint */}
        <span className="text-xs text-muted hidden sm:inline">or paste (Cmd+V)</span>
      </div>

      {/* Paste success toast */}
      {showPasteToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          Transcript pasted and imported
        </div>
      )}
    </>
  );
}
