"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Client } from "@/lib/types";
import { getLastName } from "@/lib/utils";

interface QuickAssignProps {
  clients: Client[];
  currentClientId?: string;
  onAssign: (clientId: string | undefined) => void;
  onClose: () => void;
}

export default function QuickAssign({ clients, currentClientId, onAssign, onClose }: QuickAssignProps) {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() =>
    [...clients].sort((a, b) => {
      // Projects first, then contacts sorted by last name
      if (a.kind === "project" && b.kind !== "project") return -1;
      if (a.kind !== "project" && b.kind === "project") return 1;
      return getLastName(a.name).localeCompare(getLastName(b.name));
    }),
    [clients]
  );

  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
    );
  }, [sorted, search]);

  // Include "Unassign" option if currently assigned
  const hasUnassign = !!currentClientId;
  const totalItems = filtered.length + (hasUnassign ? 1 : 0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-assign-item]");
    const item = items[selectedIndex] as HTMLElement;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, totalItems - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hasUnassign && selectedIndex === 0) {
        onAssign(undefined);
      } else {
        const idx = hasUnassign ? selectedIndex - 1 : selectedIndex;
        if (filtered[idx]) onAssign(filtered[idx].id);
      }
      onClose();
    }
  }

  function handleSelect(clientId: string | undefined) {
    onAssign(clientId);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-80 max-h-[50vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="px-3 py-2.5 border-b border-border">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold text-muted">Assign to</span>
            <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">⌘A</kbd>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contacts & projects..."
            className="w-full px-2.5 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {hasUnassign && (
            <button
              data-assign-item
              onClick={() => handleSelect(undefined)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                selectedIndex === 0 ? "bg-accent-light text-accent" : "hover:bg-gray-50"
              }`}
            >
              <div className="w-6 h-6 rounded-full bg-red-100 text-red-500 flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <span className="font-medium text-red-600">Unassign</span>
            </button>
          )}

          {filtered.map((client, i) => {
            const idx = hasUnassign ? i + 1 : i;
            const isSelected = idx === selectedIndex;
            const isCurrent = client.id === currentClientId;
            const isProject = client.kind === "project";

            return (
              <button
                key={client.id}
                data-assign-item
                onClick={() => handleSelect(client.id)}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                  isSelected ? "bg-accent-light text-accent" : "hover:bg-gray-50"
                }`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                  isProject ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                }`}>
                  {isProject ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : (
                    client.name.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{client.name}</span>
                  {client.company && (
                    <span className="text-[10px] text-muted truncate block">{client.company}</span>
                  )}
                </div>
                {isCurrent && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent text-white shrink-0">current</span>
                )}
              </button>
            );
          })}

          {filtered.length === 0 && !hasUnassign && (
            <div className="text-xs text-gray-300 text-center py-6">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
