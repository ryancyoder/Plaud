"use client";

import { useState, useEffect } from "react";
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

type SettingsTab = "api-key" | "api-log" | "prompts";

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
        Edit the prompts sent to Claude. Use the placeholder variables shown below each prompt — they&apos;ll be replaced with actual data at call time.
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
