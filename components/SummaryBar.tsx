"use client";

import { Transcript } from "@/lib/types";
import { formatDuration } from "@/lib/utils";

interface SummaryBarProps {
  label: string;
  transcripts: Transcript[];
  variant?: "this-week" | "next-week";
}

export default function SummaryBar({ label, transcripts, variant = "this-week" }: SummaryBarProps) {
  const totalMinutes = transcripts.reduce((sum, t) => sum + t.duration, 0);
  const totalActionItems = transcripts.reduce((sum, t) => sum + t.actionItems.filter((a) => !a.done).length, 0);
  const uniqueParticipants = new Set(transcripts.flatMap((t) => t.participants)).size;
  const themes = new Set(transcripts.flatMap((t) => t.tags));

  const isNext = variant === "next-week";

  return (
    <div className={`rounded-xl px-5 py-3 shadow-sm ${isNext ? "bg-gradient-to-r from-slate-50 to-slate-100 border border-border" : "bg-gradient-to-r from-accent to-blue-600 text-white"}`}>
      <div className="flex items-center justify-between">
        <h2 className={`text-sm font-bold uppercase tracking-wider ${isNext ? "text-muted" : "text-white/80"}`}>
          {label}
        </h2>
        <div className="flex items-center gap-4">
          <Stat
            value={transcripts.length.toString()}
            label="recordings"
            light={!isNext}
          />
          <Stat
            value={formatDuration(totalMinutes)}
            label="recorded"
            light={!isNext}
          />
          <Stat
            value={uniqueParticipants.toString()}
            label="people"
            light={!isNext}
          />
          <Stat
            value={totalActionItems.toString()}
            label="to-dos"
            light={!isNext}
          />
          <div className="flex gap-1 ml-2">
            {Array.from(themes).map((tag) => (
              <span
                key={tag}
                className={`text-[10px] px-2 py-0.5 rounded-full ${isNext ? "bg-gray-200 text-gray-600" : "bg-white/20 text-white"}`}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, light }: { value: string; label: string; light: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-lg font-bold leading-tight ${light ? "text-white" : ""}`}>{value}</div>
      <div className={`text-[10px] uppercase tracking-wide ${light ? "text-white/70" : "text-muted"}`}>{label}</div>
    </div>
  );
}
