"use client";

import { useState } from "react";
import { Transcript } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getBlockColor, getTagColor } from "@/lib/utils";
import TranscriptBlock from "./TranscriptBlock";

interface WeekCalendarProps {
  weekDates: string[];
  onSelectTranscript: (transcript: Transcript) => void;
  getTranscriptsForDate: (date: string) => Transcript[];
}

const SHORT_THRESHOLD = 30; // minutes

// Time axis config
const START_HOUR = 6;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const PX_PER_HOUR = 80;
const TOTAL_HEIGHT = TOTAL_HOURS * PX_PER_HOUR;

function timeToOffset(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  const hours = h + m / 60 - START_HOUR;
  return Math.max(0, Math.min(hours * PX_PER_HOUR, TOTAL_HEIGHT));
}

function durationToHeight(minutes: number): number {
  return Math.max(50, (minutes / 60) * PX_PER_HOUR);
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export default function WeekCalendar({ weekDates, onSelectTranscript, getTranscriptsForDate }: WeekCalendarProps) {
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i);

  function toggleShortList(date: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border">
        <div className="px-2 py-2 text-center" />
        {weekDates.map((date) => {
          const today = isToday(date);
          const past = isPast(date);
          const allTranscripts = getTranscriptsForDate(date);
          const shortCount = allTranscripts.filter((t) => t.duration < SHORT_THRESHOLD).length;

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
              {shortCount > 0 && (
                <button
                  onClick={() => toggleShortList(date)}
                  className={`mt-1 text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                    expandedDays.has(date)
                      ? today
                        ? "bg-white/30 text-white"
                        : "bg-accent-light text-accent"
                      : today
                        ? "bg-white/20 text-white/80 hover:bg-white/30"
                        : "bg-gray-100 text-muted hover:bg-gray-200"
                  }`}
                >
                  {shortCount} short
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Short transcripts list (expandable per day) */}
      {weekDates.some((d) => expandedDays.has(d)) && (
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-border bg-gray-50/50">
          <div className="px-2 py-2 flex items-start justify-end">
            <span className="text-[10px] text-muted uppercase font-semibold">Quick</span>
          </div>
          {weekDates.map((date) => {
            const allTranscripts = getTranscriptsForDate(date);
            const shortTranscripts = allTranscripts
              .filter((t) => t.duration < SHORT_THRESHOLD)
              .sort((a, b) => a.startTime.localeCompare(b.startTime));
            const isExpanded = expandedDays.has(date);

            return (
              <div key={date} className="border-l border-border px-1 py-1.5">
                {isExpanded && shortTranscripts.length > 0 ? (
                  <div className="space-y-1">
                    {shortTranscripts.map((t) => {
                      const primaryTag = t.tags[0];
                      const tagColor = primaryTag ? getTagColor(primaryTag) : { bg: "bg-gray-100", text: "text-gray-700" };
                      return (
                        <button
                          key={t.id}
                          onClick={() => onSelectTranscript(t)}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-white active:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tagColor.bg.replace("100", "500")}`} />
                            <span className="text-[11px] font-medium truncate">{t.title}</span>
                          </div>
                          <div className="flex items-center gap-1 ml-3 mt-0.5">
                            <span className="text-[10px] text-muted">{t.startTime}</span>
                            <span className="text-[10px] text-muted">· {formatDuration(t.duration)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-4" />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Scrollable time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
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
            const allTranscripts = getTranscriptsForDate(date);
            const longTranscripts = allTranscripts.filter((t) => t.duration >= SHORT_THRESHOLD);
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

                {/* Only plot transcripts >= 30 min on the time grid */}
                {longTranscripts.map((t) => {
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
