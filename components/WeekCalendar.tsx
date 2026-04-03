"use client";

import { Transcript } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast } from "@/lib/utils";
import TranscriptBlock from "./TranscriptBlock";

interface WeekCalendarProps {
  weekDates: string[];
  onSelectTranscript: (transcript: Transcript) => void;
  getTranscriptsForDate: (date: string) => Transcript[];
}

export default function WeekCalendar({ weekDates, onSelectTranscript, getTranscriptsForDate }: WeekCalendarProps) {
  return (
    <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden shadow-sm">
      {weekDates.map((date) => {
        const transcripts = getTranscriptsForDate(date);
        const today = isToday(date);
        const past = isPast(date);

        return (
          <div
            key={date}
            className={`bg-surface min-h-[280px] flex flex-col ${today ? "ring-2 ring-accent ring-inset" : ""}`}
          >
            {/* Day header */}
            <div className={`px-3 py-2 text-center border-b border-border ${today ? "bg-accent text-white" : past ? "bg-gray-50" : ""}`}>
              <div className={`text-xs font-medium uppercase ${today ? "text-white/80" : "text-muted"}`}>
                {getDayName(date)}
              </div>
              <div className={`text-lg font-bold ${today ? "text-white" : ""}`}>
                {getDayNumber(date)}
              </div>
            </div>

            {/* Transcript blocks */}
            <div className="p-2 flex-1 overflow-y-auto">
              {transcripts.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <span className="text-xs text-gray-300">No recordings</span>
                </div>
              ) : (
                transcripts.map((t) => (
                  <TranscriptBlock key={t.id} transcript={t} onSelect={onSelectTranscript} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
