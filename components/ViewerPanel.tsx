"use client";

import { useState } from "react";
import { Transcript, ActionItem, CallItem, ErrandItem, Client } from "@/lib/types";
import { formatDuration, getTagColor, formatDate } from "@/lib/utils";

type Tab = "transcript" | "todos" | "calls" | "errands";

interface ViewerPanelProps {
  selectedTranscript: Transcript | null;
  actionItems: ActionItem[];
  callItems: CallItem[];
  errandItems: ErrandItem[];
  clients: Client[];
  onClose: () => void;
  onAssignClient: (transcriptId: string, clientName: string | undefined) => void;
}

export default function ViewerPanel({
  selectedTranscript,
  actionItems,
  callItems,
  errandItems,
  clients,
  onClose,
  onAssignClient,
}: ViewerPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(selectedTranscript ? "transcript" : "todos");

  // Switch to transcript tab when a transcript is selected
  const effectiveTab = selectedTranscript && activeTab === "transcript" ? "transcript" : activeTab;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "transcript", label: "Transcript" },
    { key: "todos", label: "To-Do", count: actionItems.filter((a) => !a.done).length },
    { key: "calls", label: "Calls", count: callItems.filter((c) => !c.done).length },
    { key: "errands", label: "Errands", count: errandItems.filter((e) => !e.done).length },
  ];

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Tab bar */}
      <div className="flex border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 text-center text-xs font-medium transition-colors relative ${
              effectiveTab === tab.key
                ? "text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`ml-1 inline-flex items-center justify-center w-4 h-4 text-[9px] font-bold rounded-full ${
                effectiveTab === tab.key ? "bg-accent text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {tab.count}
              </span>
            )}
            {effectiveTab === tab.key && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === "transcript" && (
          <TranscriptView
            transcript={selectedTranscript}
            clients={clients}
            onClose={onClose}
            onAssignClient={onAssignClient}
          />
        )}
        {effectiveTab === "todos" && <TodoList items={actionItems} />}
        {effectiveTab === "calls" && <CallList items={callItems} />}
        {effectiveTab === "errands" && <ErrandList items={errandItems} />}
      </div>
    </div>
  );
}

function TranscriptView({
  transcript,
  clients,
  onClose,
  onAssignClient,
}: {
  transcript: Transcript | null;
  clients: Client[];
  onClose: () => void;
  onAssignClient: (transcriptId: string, clientName: string | undefined) => void;
}) {
  const [showAssign, setShowAssign] = useState(false);
  if (!transcript) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm p-8 text-center">
        <div>
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
          Select a transcript from the calendar to view details
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold leading-tight">{transcript.title}</h2>
          <p className="text-xs text-muted mt-1">
            {formatDate(transcript.date)} · {transcript.startTime} · {formatDuration(transcript.duration)}
          </p>
        </div>
        <button onClick={onClose} className="p-1.5 -mr-1 text-muted hover:text-foreground rounded-lg hover:bg-gray-100">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>

      {/* Tags */}
      <div className="flex gap-1.5 mb-3">
        {transcript.tags.map((tag) => {
          const color = getTagColor(tag);
          return (
            <span key={tag} className={`text-xs px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>
              {tag}
            </span>
          );
        })}
      </div>

      {/* Participants */}
      {transcript.participants.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Participants</h3>
          <p className="text-sm">{transcript.participants.join(", ")}</p>
        </div>
      )}

      {/* Summary */}
      <div className="mb-3">
        <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Summary</h3>
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{transcript.summary}</p>
      </div>

      {/* Full Transcript */}
      {transcript.fullTranscript && transcript.fullTranscript !== transcript.summary && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-0.5">Full Transcript</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-gray-700">{transcript.fullTranscript}</p>
        </div>
      )}

      {/* Client assignment */}
      <div className="mb-3">
        <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Client</h3>
        <div className="flex items-center gap-2">
          {transcript.clientName ? (
            <span className="text-sm font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
              {transcript.clientName}
            </span>
          ) : (
            <span className="text-xs text-gray-400">Unassigned</span>
          )}
          <button
            onClick={() => setShowAssign(!showAssign)}
            className="text-[10px] px-2 py-0.5 rounded border border-border text-muted hover:bg-gray-50 active:scale-95"
          >
            {transcript.clientName ? "Change" : "Assign"}
          </button>
          {transcript.clientName && (
            <button
              onClick={() => {
                onAssignClient(transcript.id, undefined);
                setShowAssign(false);
              }}
              className="text-[10px] px-2 py-0.5 rounded border border-red-200 text-red-500 hover:bg-red-50 active:scale-95"
            >
              Remove
            </button>
          )}
        </div>
        {showAssign && (
          <div className="mt-1.5 border border-border rounded-lg overflow-hidden bg-white max-h-40 overflow-y-auto">
            {clients.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No clients — add one in the roster</div>
            ) : (
              clients
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onAssignClient(transcript.id, c.name);
                      setShowAssign(false);
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 active:bg-gray-100 flex items-center gap-2"
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                      c.type === "client" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    }`}>
                      {c.name.charAt(0)}
                    </span>
                    <span>{c.name}</span>
                    {c.company && <span className="text-gray-400 ml-auto">{c.company}</span>}
                  </button>
                ))
            )}
          </div>
        )}
      </div>

      {/* Action Items from this transcript */}
      {transcript.actionItems.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Action Items</h3>
          <ul className="space-y-1">
            {transcript.actionItems.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${item.done ? "bg-accent border-accent" : "border-gray-300"}`}>
                  {item.done && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                      <path d="M2 5l2 2 4-4" />
                    </svg>
                  )}
                </span>
                <span className={item.done ? "line-through text-muted" : ""}>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Calls from this transcript */}
      {transcript.calls.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Calls to Make</h3>
          <ul className="space-y-1">
            {transcript.calls.map((call) => (
              <li key={call.id} className="text-sm flex items-center gap-2">
                <span className="text-green-600 text-xs">tel</span>
                <span className="font-medium">{call.person}</span>
                <span className="text-muted">— {call.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Errands from this transcript */}
      {transcript.errands.length > 0 && (
        <div className="mb-3">
          <h3 className="text-[10px] font-semibold uppercase text-muted mb-1">Errands</h3>
          <ul className="space-y-1">
            {transcript.errands.map((errand) => (
              <li key={errand.id} className="text-sm flex items-center gap-2">
                <span className="text-amber-600 text-xs">loc</span>
                <span>{errand.text}</span>
                {errand.location && <span className="text-muted text-xs">@ {errand.location}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TodoList({ items }: { items: ActionItem[] }) {
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  if (pending.length === 0 && done.length === 0) {
    return <EmptyState label="No to-do items" />;
  }

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-4 h-4 mt-0.5 rounded border-2 border-gray-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">{item.text}</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
          {item.dueDate && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">
              due {new Date(item.dueDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
            </span>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <>
          <div className="text-[10px] uppercase text-muted font-semibold tracking-wider px-2 pt-3 pb-1">
            Completed ({done.length})
          </div>
          {done.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg opacity-50">
              <div className="w-4 h-4 mt-0.5 rounded border-2 border-accent bg-accent shrink-0 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                  <path d="M2 5l2 2 4-4" />
                </svg>
              </div>
              <p className="text-sm leading-snug line-through text-muted">{item.text}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CallList({ items }: { items: CallItem[] }) {
  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return <EmptyState label="No calls to make" />;

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-xs">
            tel
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{item.person}</p>
            <p className="text-xs text-muted mt-0.5">{item.reason}</p>
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrandList({ items }: { items: ErrandItem[] }) {
  const pending = items.filter((i) => !i.done);
  if (pending.length === 0) return <EmptyState label="No errands" />;

  return (
    <div className="p-3 space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50">
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-xs">
            loc
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">{item.text}</p>
            {item.location && (
              <p className="text-xs text-muted mt-0.5">@ {item.location}</p>
            )}
            <p className="text-[10px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-32 text-sm text-gray-300">
      {label}
    </div>
  );
}
