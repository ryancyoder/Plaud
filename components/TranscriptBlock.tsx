"use client";

import { Transcript } from "@/lib/types";
import { formatDuration, getBlockColor, getTagColor } from "@/lib/utils";

interface TranscriptBlockProps {
  transcript: Transcript;
  onSelect: (transcript: Transcript) => void;
}

export default function TranscriptBlock({ transcript, onSelect }: TranscriptBlockProps) {
  const primaryTag = transcript.tags[0];
  const blockColor = primaryTag ? getBlockColor(primaryTag) : "border-l-gray-400 bg-gray-50";

  return (
    <button
      onClick={() => onSelect(transcript)}
      className={`w-full text-left border-l-4 rounded-lg p-3 mb-2 transition-shadow active:shadow-md hover:shadow-sm ${blockColor}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-semibold text-sm leading-tight truncate">{transcript.title}</h4>
        <span className="text-xs text-muted whitespace-nowrap shrink-0">
          {transcript.startTime}
        </span>
      </div>
      <p className="text-xs text-muted mt-1 line-clamp-2">{transcript.summary}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-muted">{formatDuration(transcript.duration)}</span>
        {transcript.participants.length > 0 && (
          <span className="text-xs text-muted">
            · {transcript.participants.length} participant{transcript.participants.length !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex gap-1 ml-auto">
          {transcript.tags.map((tag) => {
            const color = getTagColor(tag);
            return (
              <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded-full ${color.bg} ${color.text}`}>
                {tag}
              </span>
            );
          })}
        </div>
      </div>
    </button>
  );
}
