"use client";

import { AppEvent } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration } from "@/lib/utils";

interface WeekNavProps {
  weekDates: string[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  getRecordingsForDate: (date: string) => AppEvent[];
}

export default function WeekNav({ weekDates, selectedDate, onSelectDate, getRecordingsForDate }: WeekNavProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {weekDates.map((date) => {
          const recordings = getRecordingsForDate(date);
          const today = isToday(date);
          const past = isPast(date);
          const selected = date === selectedDate;
          const totalDuration = recordings.reduce((s, e) => s + (e.duration || 0), 0);

          return (
            <button
              key={date}
              onClick={() => onSelectDate(date)}
              className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                selected
                  ? today ? "bg-accent text-white" : "bg-accent-light text-accent"
                  : today ? "bg-blue-50 hover:bg-blue-100" : "hover:bg-gray-50 active:bg-gray-100"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`text-xl font-bold leading-none tabular-nums ${
                  selected && today ? "text-white" : today ? "text-accent" : past ? "text-gray-400" : ""
                }`}>
                  {getDayNumber(date)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-xs font-semibold ${
                    selected && today ? "text-white" : selected ? "text-accent" : today ? "text-accent" : ""
                  }`}>
                    {getDayName(date)}
                  </div>
                  {recordings.length > 0 ? (
                    <div className={`text-[10px] ${selected && today ? "text-white/70" : selected ? "text-accent/70" : "text-muted"}`}>
                      {recordings.length} recording{recordings.length !== 1 ? "s" : ""} · {formatDuration(totalDuration)}
                    </div>
                  ) : (
                    <div className={`text-[10px] ${selected && today ? "text-white/50" : "text-gray-300"}`}>No recordings</div>
                  )}
                </div>
                {recordings.length > 0 && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                    selected && today ? "bg-white/20 text-white" : selected ? "bg-accent/10 text-accent" : "bg-gray-100 text-gray-500"
                  }`}>
                    {recordings.length}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
