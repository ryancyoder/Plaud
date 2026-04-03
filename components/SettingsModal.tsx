"use client";

import { useState, useEffect } from "react";
import { getApiKey, setApiKey, clearCachedSummaries } from "@/lib/claude-api";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      setKey(getApiKey());
      setSaved(false);
    }
  }, [open]);

  if (!open) return null;

  function handleSave() {
    setApiKey(key.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleClearCache() {
    clearCachedSummaries();
    setSaved(false);
  }

  const masked = key.length > 8 ? key.slice(0, 7) + "..." + key.slice(-4) : key;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold mb-1">Settings</h2>
          <p className="text-xs text-muted mb-4">Configure your Claude API key for AI-generated daily summaries.</p>

          <div className="space-y-3">
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

            <div className="flex items-center justify-between">
              <button
                onClick={handleClearCache}
                className="text-[10px] text-red-500 hover:text-red-700"
              >
                Clear summary cache
              </button>
              {saved && (
                <span className="text-[10px] text-green-600 font-medium">Saved</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-border bg-gray-50">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-muted hover:bg-gray-100 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={() => { handleSave(); onClose(); }}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:bg-blue-600 active:scale-[0.98]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
