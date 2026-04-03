"use client";

import { Transcript } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast } from "@/lib/utils";
import TranscriptBlock from "./TranscriptBlock";

interface WeekCalendarProps {
  weekDates: string[];
  onSelectTranscript: (transcript: Transcript) => void;
  getTranscriptsForDate: (date: string) => Transcript[];
}

// Time axis config
const START_HOUR = 6; // 6 AM
const END_HOUR = 22; // 10 PM
const TOTAL_HOURS = END_HOUR - START_HOUR;
const PX_PER_HOUR = 80;
const TOTAL_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;
const MIN_BLOCK_HEIGHT = 40; // minimum height even for very short recordings

function timeToOffset(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const hours = h + m / 60 - START_HOUR;
  return Math.max(0, Math.min(hours * PX_PER_HOUR, TOTAL_HEIGHT));
}

function durationToHeight(minutes: number): number {
  return Math.max(MIN_BLOCK_HEIGHT, (minutes / 60) * PX_PER_HOUR);
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export default function WeekCalendar({ weekDates, onSelectTranscript, getTranscriptsForDate }: WeekCalendarProps) {
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
        <div className="px-2 py-2 text-center" />
        {weekDates.map((date) => {
          const today = isToday(date);
          const past = isPast(date);
          return (
            <div
              key={date}
              className={`px-2 py-2 text-center border-l border-border ${today ? "bg-accent text-white" : past ? "bg-gray-50" : ""}`}
            >
              <div className={`text-xs font-medium uppercase ${today ? "text-white/80" : "text-muted"}`}>
                {getDayName(date)}
              </div>
              <div className={`text-lg font-bold ${today ? "text-white" : ""}`}>
                {getDayNumber(date)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="grid grid-cols-[60px_repeat(7,1fr)] relative" style={{ height: TOTAL_HEIGHT }}>
          {/* Time axis */}
          <div className="relative">
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[11px] text-muted -translate-y-1/2"
                style={{ top: (hour - START_HOUR) * PX_PER_HOUR }}
              >
                {formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDates.map((date) => {
            const transcripts = getTranscriptsForDate(date);
            const today = isToday(date);

            return (
              <div
                key={date}
                className={`relative border-l border-border ${today ? "bg-blue-50/30" : ""}`}
              >
                {/* Hour grid lines */}
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-gray-100"
                    style={{ top: (hour - START_HOUR) * PX_PER_HOUR }}
                  />
                ))}

                {/* Transcript blocks */}
                {transcripts.map((t) => {
                  const top = timeToOffset(t.startTime);
                  const height = durationToHeight(t.duration);

                  return (
                    <div
                      key={t.id}
                      className="absolute left-1 right-1 z-10"
                      style={{ top, height }}
                    >
                      <TranscriptBlock
                        transcript={t}
                        onSelect={onSelectTranscript}
                        compact={height < 70}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
