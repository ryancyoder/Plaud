"use client";

import { useState, useEffect, useRef } from "react";
import {
  getApiKey,
  setApiKey,
  clearCachedSummaries,
  getApiLog,
  clearApiLog,
  getPromptTemplates,
  savePromptTemplates,
  resetPromptTemplates,
  getDefaultPrompts,
  PromptTemplates,
  ApiLogEntry,
} from "@/lib/claude-api";
import {
  loadAllAttachments,
  saveAttachments,
  clearAllAttachments,
  loadPendingPhotos,
  savePendingPhotos,
  clearPendingPhotos,
  PendingPhoto,
} from "@/lib/attachment-store";
import type { Attachment } from "@/lib/types";

type SettingsTab = "api-key" | "api-log" | "prompts" | "data";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>("api-key");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-xl mx-4 overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header & tabs */}
        <div className="shrink-0 px-5 pt-4 pb-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">Settings</h2>
            <button onClick={onClose} className="p-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>
          <div className="flex gap-0 border-b border-border">
            {([
              { key: "api-key" as const, label: "API Key" },
              { key: "api-log" as const, label: "API Log" },
              { key: "prompts" as const, label: "Prompts" },
              { key: "data" as const, label: "Data" },
            ]).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-xs font-medium transition-colors relative ${
                  tab === t.key ? "text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
                {tab === t.key && <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === "api-key" && <ApiKeyTab />}
          {tab === "api-log" && <ApiLogTab />}
          {tab === "prompts" && <PromptsTab />}
          {tab === "data" && <DataTab />}
        </div>
      </div>
    </div>
  );
}

// --- API Key Tab ---

function ApiKeyTab() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setKey(getApiKey());
  }, []);

  function handleSave() {
    setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className="text-[10px] font-semibold uppercase text-muted block mb-1">
          Claude API Key
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-..."
          className="w-full px-3 py-2 border border-border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <p className="text-[10px] text-muted mt-1">
          Stored locally in your browser. Never sent anywhere except api.anthropic.com.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98]"
        >
          Save Key
        </button>
        {saved && <span className="text-[10px] text-green-600 font-medium">Saved</span>}
      </div>

      <div className="pt-2 border-t border-border">
        <button
          onClick={() => { clearCachedSummaries(); }}
          className="text-[11px] text-red-500 hover:text-red-700"
        >
          Clear all cached summaries
        </button>
      </div>
    </div>
  );
}

// --- API Log Tab ---

const TYPE_LABELS: Record<ApiLogEntry["type"], string> = {
  segment_summary: "Segment Summary",
  segment_process: "Import Processing",
  daily_summary: "Daily Summary",
};

function ApiLogTab() {
  const [log, setLog] = useState<ApiLogEntry[]>([]);

  useEffect(() => {
    setLog(getApiLog());
  }, []);

  const totalCalls = log.length;
  const totalInputTokens = log.reduce((s, e) => s + e.inputTokens, 0);
  const totalOutputTokens = log.reduce((s, e) => s + e.outputTokens, 0);
  const errorCount = log.filter((e) => e.status === "error").length;

  return (
    <div className="p-5">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold">{totalCalls}</div>
          <div className="text-[10px] text-muted">Calls</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold">{formatTokenCount(totalInputTokens)}</div>
          <div className="text-[10px] text-muted">Input Tokens</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className="text-lg font-bold">{formatTokenCount(totalOutputTokens)}</div>
          <div className="text-[10px] text-muted">Output Tokens</div>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className={`text-lg font-bold ${errorCount > 0 ? "text-red-500" : ""}`}>{errorCount}</div>
          <div className="text-[10px] text-muted">Errors</div>
        </div>
      </div>

      {totalCalls > 0 && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => { clearApiLog(); setLog([]); }}
            className="text-[10px] text-red-500 hover:text-red-700"
          >
            Clear log
          </button>
        </div>
      )}

      {/* Log entries */}
      {log.length === 0 ? (
        <div className="text-center text-xs text-gray-300 py-8">No API calls yet</div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {log.map((entry) => (
            <div
              key={entry.id}
              className={`p-2.5 rounded-lg border text-xs ${
                entry.status === "error" ? "border-red-200 bg-red-50/50" : "border-border bg-white"
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  entry.status === "success" ? "bg-green-500" : "bg-red-500"
                }`} />
                <span className="font-medium">{TYPE_LABELS[entry.type]}</span>
                <span className="text-muted ml-auto tabular-nums">
                  {new Date(entry.timestamp).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted pl-3.5">
                <span>{entry.model}</span>
                <span>{entry.durationMs}ms</span>
                {entry.inputTokens > 0 && <span>{entry.inputTokens} in / {entry.outputTokens} out</span>}
                {entry.error && <span className="text-red-500 truncate">{entry.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// --- Prompts Tab ---

const PROMPT_INFO: { key: keyof PromptTemplates; label: string; description: string; variables: string }[] = [
  {
    key: "segmentProcess",
    label: "Import Processing",
    description: "Used when auto-processing segments after import. Generates both a title and summary.",
    variables: "{{text}}",
  },
  {
    key: "segmentSummary",
    label: "Segment Summary",
    description: "Used when manually generating/regenerating a segment summary in the transcript tab.",
    variables: "{{title}}, {{text}}",
  },
  {
    key: "dailySummary",
    label: "Daily Summary",
    description: "Used when generating a daily summary from all segments on a given day.",
    variables: "{{date}}, {{segments}}",
  },
];

function PromptsTab() {
  const [templates, setTemplates] = useState<PromptTemplates>(getDefaultPrompts());
  const [editing, setEditing] = useState<keyof PromptTemplates | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setTemplates(getPromptTemplates());
  }, []);

  function handleSave() {
    savePromptTemplates(templates);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleReset() {
    const defaults = getDefaultPrompts();
    setTemplates(defaults);
    resetPromptTemplates();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="p-5">
      <p className="text-xs text-muted mb-4">
        Edit the prompts sent to Claude. Use the placeholder variables shown below each prompt — they&rsquo;ll be replaced with actual data at call time.
      </p>

      <div className="space-y-3">
        {PROMPT_INFO.map((info) => {
          const isEditing = editing === info.key;
          return (
            <div key={info.key} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setEditing(isEditing ? null : info.key)}
                className="w-full text-left px-3.5 py-2.5 flex items-center gap-2 hover:bg-gray-50"
              >
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`shrink-0 transition-transform ${isEditing ? "rotate-90" : ""}`}
                >
                  <polyline points="3 1 7 5 3 9" />
                </svg>
                <div className="flex-1">
                  <span className="text-xs font-semibold">{info.label}</span>
                  <span className="text-[10px] text-muted ml-2">{info.description}</span>
                </div>
              </button>

              {isEditing && (
                <div className="px-3.5 pb-3.5 border-t border-border bg-gray-50/50">
                  <div className="text-[10px] text-muted mt-2 mb-1.5">
                    Variables: <code className="bg-gray-100 px-1 py-0.5 rounded">{info.variables}</code>
                  </div>
                  <textarea
                    value={templates[info.key]}
                    onChange={(e) => setTemplates((prev) => ({ ...prev, [info.key]: e.target.value }))}
                    rows={10}
                    className="w-full px-3 py-2 border border-border rounded-lg text-xs font-mono leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-accent bg-white"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-border">
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98]"
        >
          Save Prompts
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 rounded-lg text-sm font-medium text-muted border border-border hover:bg-gray-100 active:scale-[0.98]"
        >
          Reset to Defaults
        </button>
        {saved && <span className="text-[10px] text-green-600 font-medium">Saved</span>}
      </div>
    </div>
  );
}

// --- Data Tab ---

const BACKUP_KEYS = [
  "plaud-events",
  "plaud-transcripts",
  "plaud-lists",
  "plaud-clients",
  "plaud-daily-summaries",
  "plaud-segment-summaries",
  "plaud-prompt-templates",
  "plaud-api-log",
  "plaud-client-events",
  "plaud-gap-threshold",
  "plaud-min-duration",
];

function DataTab() {
  const [importStatus, setImportStatus] = useState<{ message: string; error?: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ localStorage: string; attachments: number; pending: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate storage usage on mount
  useEffect(() => {
    (async () => {
      let lsSize = 0;
      for (const key of BACKUP_KEYS) {
        const val = localStorage.getItem(key);
        if (val) lsSize += val.length * 2; // rough bytes (UTF-16)
      }
      try {
        const atts = await loadAllAttachments();
        const attCount = Object.values(atts).reduce((n, arr) => n + arr.length, 0);
        const pending = await loadPendingPhotos();
        setStorageInfo({
          localStorage: formatBytes(lsSize),
          attachments: attCount,
          pending: pending.length,
        });
      } catch {
        setStorageInfo({ localStorage: formatBytes(lsSize), attachments: 0, pending: 0 });
      }
    })();
  }, []);

  async function handleExport() {
    setExporting(true);
    setExportProgress("Gathering settings and events...");
    setImportStatus(null);

    try {
      // 1. Gather localStorage data
      const backup: Record<string, unknown> = {
        _meta: {
          version: 2,
          exportedAt: new Date().toISOString(),
          app: "plaud-transcripts",
        },
      };
      for (const key of BACKUP_KEYS) {
        const val = localStorage.getItem(key);
        if (val !== null) {
          try { backup[key] = JSON.parse(val); } catch { backup[key] = val; }
        }
      }

      // 2. Gather IndexedDB attachments
      setExportProgress("Reading photos and documents...");
      const allAttachments = await loadAllAttachments();
      const attCount = Object.values(allAttachments).reduce((n, arr) => n + arr.length, 0);
      if (attCount > 0) {
        backup["_attachments"] = allAttachments;
        setExportProgress(`Packaging ${attCount} attachment${attCount !== 1 ? "s" : ""}...`);
      }

      // 3. Gather pending photos
      const pending = await loadPendingPhotos();
      if (pending.length > 0) {
        backup["_pendingPhotos"] = pending;
      }

      // 4. Build and download the file
      setExportProgress("Creating backup file...");
      const json = JSON.stringify(backup);
      const sizeMB = (json.length / 1024 / 1024).toFixed(1);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `plaud-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      setExportProgress(null);
      setImportStatus({
        message: `Backup exported (${sizeMB} MB, ${attCount} attachment${attCount !== 1 ? "s" : ""}).`,
      });
    } catch (err) {
      setImportStatus({
        message: `Export failed: ${err instanceof Error ? err.message : "unknown error"}`,
        error: true,
      });
      setExportProgress(null);
    } finally {
      setExporting(false);
    }
  }

  async function handleImport() {
    fileInputRef.current?.click();
  }

  async function processImportFile(file: File) {
    setImporting(true);
    setImportProgress("Reading backup file...");
    setImportStatus(null);

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data._meta) {
        setImportStatus({ message: "Invalid backup file — missing metadata.", error: true });
        return;
      }

      // 1. Restore localStorage
      setImportProgress("Restoring settings and events...");
      let lsCount = 0;
      for (const key of BACKUP_KEYS) {
        if (key in data) {
          const val = data[key];
          localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
          lsCount++;
        }
      }

      // 2. Restore IndexedDB attachments
      let attCount = 0;
      if (data._attachments && typeof data._attachments === "object") {
        const attachmentMap = data._attachments as Record<string, Attachment[]>;
        const entries = Object.entries(attachmentMap);
        setImportProgress(`Restoring attachments (0/${entries.length} events)...`);

        await clearAllAttachments();
        for (let i = 0; i < entries.length; i++) {
          const [transcriptId, atts] = entries[i];
          await saveAttachments(transcriptId, atts);
          attCount += atts.length;
          if (i % 5 === 0) {
            setImportProgress(`Restoring attachments (${i + 1}/${entries.length} events)...`);
          }
        }
      }

      // 3. Restore pending photos
      let pendingCount = 0;
      if (data._pendingPhotos && Array.isArray(data._pendingPhotos)) {
        setImportProgress("Restoring pending photos...");
        await clearPendingPhotos();
        await savePendingPhotos(data._pendingPhotos as PendingPhoto[]);
        pendingCount = data._pendingPhotos.length;
      }

      setImportProgress(null);
      const parts = [`${lsCount} data entries`];
      if (attCount > 0) parts.push(`${attCount} attachments`);
      if (pendingCount > 0) parts.push(`${pendingCount} pending photos`);
      setImportStatus({
        message: `Restored ${parts.join(", ")}. Reload the page to see changes.`,
      });
    } catch {
      setImportStatus({ message: "Failed to parse backup file.", error: true });
      setImportProgress(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="p-5 space-y-5">
      {/* Storage info */}
      {storageInfo && (
        <div className="grid grid-cols-3 gap-2 mb-1">
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-sm font-bold">{storageInfo.localStorage}</div>
            <div className="text-[10px] text-muted">Settings & Events</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-sm font-bold">{storageInfo.attachments}</div>
            <div className="text-[10px] text-muted">Photos & Docs</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5 text-center">
            <div className="text-sm font-bold">{storageInfo.pending}</div>
            <div className="text-[10px] text-muted">Pending Photos</div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-xs font-semibold mb-1">Export Full Backup</h3>
        <p className="text-[10px] text-muted mb-3">
          Download everything — clients, events, transcripts, photos, documents, and settings — as a single file. This may take a moment if you have many photos.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98] disabled:opacity-50"
        >
          {exporting ? "Exporting..." : "Export Backup"}
        </button>
        {exportProgress && (
          <p className="text-[10px] text-muted mt-2 animate-pulse">{exportProgress}</p>
        )}
      </div>

      <div className="pt-3 border-t border-border">
        <h3 className="text-xs font-semibold mb-1">Import Backup</h3>
        <p className="text-[10px] text-muted mb-3">
          Restore from a previously exported backup file. This will overwrite current data including all photos and documents.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) processImportFile(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={handleImport}
          disabled={importing}
          className="px-4 py-2 rounded-lg text-sm font-medium text-muted border border-border hover:bg-gray-100 active:scale-[0.98] disabled:opacity-50"
        >
          {importing ? "Importing..." : "Import Backup"}
        </button>
        {importProgress && (
          <p className="text-[10px] text-muted mt-2 animate-pulse">{importProgress}</p>
        )}
        {importStatus && (
          <p className={`text-[10px] mt-2 ${importStatus.error ? "text-red-500" : "text-green-600"}`}>
            {importStatus.message}
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
