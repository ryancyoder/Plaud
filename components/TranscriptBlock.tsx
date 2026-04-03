"use client";

import { Transcript } from "@/lib/types";
import { formatDuration, getBlockColor, getTagColor } from "@/lib/utils";

interface TranscriptBlockProps {
  transcript: Transcript;
  onSelect: (transcript: Transcript) => void;
  compact?: boolean;
}

export default function TranscriptBlock({ transcript, onSelect, compact = false }: TranscriptBlockProps) {
  const primaryTag = transcript.tags[0];
  const blockColor = primaryTag ? getBlockColor(primaryTag) : "border-l-gray-400 bg-gray-50";

  if (compact) {
    return (
      <button
        onClick={() => onSelect(transcript)}
        className={`w-full h-full text-left border-l-4 rounded-lg px-2 py-1 transition-shadow active:shadow-md hover:shadow-sm overflow-hidden ${blockColor}`}
      >
        <div className="flex items-center justify-between gap-1">
          <h4 className="font-semibold text-xs leading-tight truncate">{transcript.title}</h4>
          <span className="text-[10px] text-muted whitespace-nowrap shrink-0">
            {formatDuration(transcript.duration)}
          </span>
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={() => onSelect(transcript)}
      className={`w-full h-full text-left border-l-4 rounded-lg p-2.5 transition-shadow active:shadow-md hover:shadow-sm overflow-hidden flex flex-col ${blockColor}`}
    >
      <div className="flex items-start justify-between gap-1">
        <h4 className="font-semibold text-xs leading-tight truncate">{transcript.title}</h4>
        <span className="text-[10px] text-muted whitespace-nowrap shrink-0">
          {transcript.startTime}
        </span>
      </div>
      <p className="text-[11px] text-muted mt-1 line-clamp-2 flex-1">{transcript.summary}</p>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-[10px] text-muted">{formatDuration(transcript.duration)}</span>
        {transcript.participants.length > 0 && (
          <span className="text-[10px] text-muted">
            · {transcript.participants.length}p
          </span>
        )}
        <div className="flex gap-0.5 ml-auto">
          {transcript.tags.slice(0, 2).map((tag) => {
            const color = getTagColor(tag);
            return (
              <span key={tag} className={`text-[9px] px-1 py-0.5 rounded-full ${color.bg} ${color.text}`}>
                {tag}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}
