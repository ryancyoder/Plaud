"use client";

import { Transcript } from "@/lib/types";
import { formatDuration, getTagColor, formatDate } from "@/lib/utils";

interface TranscriptDetailProps {
  transcript: Transcript;
  onClose: () => void;
}

export default function TranscriptDetail({ transcript, onClose }: TranscriptDetailProps) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle for iPad */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">{transcript.title}</h2>
              <p className="text-sm text-muted mt-1">
                {formatDate(transcript.date)} · {transcript.startTime} · {formatDuration(transcript.duration)}
              </p>
            </div>
            <button onClick={onClose} className="p-2 -mr-2 -mt-1 text-muted hover:text-foreground">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </button>
          </div>

          {/* Tags */}
          <div className="flex gap-1.5 mb-4">
            {transcript.tags.map((tag) => {
              const color = getTagColor(tag);
              return (
                <span key={tag} className={`text-xs px-2 py-1 rounded-full ${color.bg} ${color.text}`}>
                  {tag}
                </span>
              );
            })}
          </div>

          {/* Participants */}
          {transcript.participants.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold uppercase text-muted mb-1">Participants</h3>
              <p className="text-sm">{transcript.participants.join(", ")}</p>
            </div>
          )}

          {/* Summary */}
          <div className="mb-4">
            <h3 className="text-xs font-semibold uppercase text-muted mb-1">Summary</h3>
            <p className="text-sm leading-relaxed">{transcript.summary}</p>
          </div>

          {/* Action Items */}
          {transcript.actionItems.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold uppercase text-muted mb-2">Action Items</h3>
              <ul className="space-y-1.5">
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

          {/* Calls */}
          {transcript.calls.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold uppercase text-muted mb-2">Calls to Make</h3>
              <ul className="space-y-1.5">
                {transcript.calls.map((call) => (
                  <li key={call.id} className="text-sm flex items-center gap-2">
                    <span className="text-green-600">📞</span>
                    <span className="font-medium">{call.person}</span>
                    <span className="text-muted">— {call.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Errands */}
          {transcript.errands.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-semibold uppercase text-muted mb-2">Errands</h3>
              <ul className="space-y-1.5">
                {transcript.errands.map((errand) => (
                  <li key={errand.id} className="text-sm flex items-center gap-2">
                    <span className="text-amber-600">📍</span>
                    <span>{errand.text}</span>
                    {errand.location && <span className="text-muted text-xs">@ {errand.location}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
