"use client";

import { Transcript } from "@/lib/types";
import { getDayName, getDayNumber, isToday, isPast, formatDuration, getBlockColor, getTagColor, formatDate } from "@/lib/utils";

interface WeekCalendarProps {
  weekDates: string[]; // Mon-Sun, 7 dates
  onSelectTranscript: (transcript: Transcript) => void;
  getTranscriptsForDate: (date: string) => Transcript[];
  selectedTranscriptId?: string;
}

const WEEKDAY_DATES = (dates: string[]) => dates.slice(0, 5); // Mon-Fri
const WEEKEND_DATES = (dates: string[]) => dates.slice(5, 7); // Sat-Sun

export default function WeekCalendar({ weekDates, onSelectTranscript, getTranscriptsForDate, selectedTranscriptId }: WeekCalendarProps) {
  const weekdays = WEEKDAY_DATES(weekDates);
  const weekend = WEEKEND_DATES(weekDates);

  return (
    <div className="flex flex-col gap-3">
      {/* Weekdays */}
      {weekdays.map((date) => (
        <DayRow
          key={date}
          date={date}
          transcripts={getTranscriptsForDate(date)}
          onSelect={onSelectTranscript}
          selectedId={selectedTranscriptId}
        />
      ))}

      {/* Weekend section */}
      {weekend.some((d) => getTranscriptsForDate(d).length > 0) && (
        <>
          <div className="text-xs font-semibold uppercase text-muted tracking-wider px-1 pt-2">
            Weekend
          </div>
          {weekend.map((date) => {
            const transcripts = getTranscriptsForDate(date);
            if (transcripts.length === 0) return null;
            return (
              <DayRow
                key={date}
                date={date}
                transcripts={transcripts}
                onSelect={onSelectTranscript}
                selectedId={selectedTranscriptId}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

interface DayRowProps {
  date: string;
  transcripts: Transcript[];
  onSelect: (transcript: Transcript) => void;
  selectedId?: string;
}

function DayRow({ date, transcripts, onSelect, selectedId }: DayRowProps) {
  const today = isToday(date);
  const past = isPast(date);
  const sorted = [...transcripts].sort((a, b) => a.startTime.localeCompare(b.startTime));

  return (
    <div className={`rounded-xl border overflow-hidden ${today ? "border-accent bg-blue-50/30" : "border-border bg-surface"}`}>
      {/* Day header */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${today ? "bg-accent text-white border-accent" : past ? "bg-gray-50 border-border" : "border-border"}`}>
        <div className={`text-2xl font-bold leading-none ${today ? "text-white" : ""}`}>
          {getDayNumber(date)}
        </div>
        <div>
          <div className={`text-sm font-medium ${today ? "text-white" : ""}`}>
            {getDayName(date)}
          </div>
          <div className={`text-[11px] ${today ? "text-white/70" : "text-muted"}`}>
            {formatDate(date)}
          </div>
        </div>
        <div className={`ml-auto text-xs ${today ? "text-white/70" : "text-muted"}`}>
          {sorted.length} recording{sorted.length !== 1 ? "s" : ""}
          {sorted.length > 0 && ` · ${formatDuration(sorted.reduce((s, t) => s + t.duration, 0))}`}
        </div>
      </div>

      {/* Transcript entries */}
      {sorted.length === 0 ? (
        <div className="px-4 py-3 text-sm text-gray-300">No recordings</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {sorted.map((t) => (
            <TranscriptRow
              key={t.id}
              transcript={t}
              onSelect={onSelect}
              isSelected={selectedId === t.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TranscriptRowProps {
  transcript: Transcript;
  onSelect: (transcript: Transcript) => void;
  isSelected: boolean;
}

function TranscriptRow({ transcript, onSelect, isSelected }: TranscriptRowProps) {
  const primaryTag = transcript.tags[0];
  const blockColor = primaryTag ? getBlockColor(primaryTag) : "border-l-gray-400 bg-gray-50";
  const tagColor = primaryTag ? getTagColor(primaryTag) : { bg: "bg-gray-100", text: "text-gray-700" };

  return (
    <button
      onClick={() => onSelect(transcript)}
      className={`w-full text-left flex items-start gap-3 px-4 py-2.5 transition-colors ${
        isSelected
          ? "bg-accent-light"
          : "hover:bg-gray-50 active:bg-gray-100"
      }`}
    >
      {/* Time column */}
      <div className="shrink-0 w-14 pt-0.5">
        <div className="text-sm font-semibold tabular-nums">{transcript.startTime}</div>
        <div className="text-[10px] text-muted">{formatDuration(transcript.duration)}</div>
      </div>

      {/* Color bar */}
      <div className={`shrink-0 w-1 self-stretch rounded-full ${tagColor.bg.replace("100", "500")}`} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold truncate">{transcript.title}</h4>
          {transcript.tags.map((tag) => {
            const c = getTagColor(tag);
            return (
              <span key={tag} className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${c.bg} ${c.text}`}>
                {tag}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-muted mt-0.5 line-clamp-2">{transcript.summary}</p>
        {transcript.participants.length > 0 && (
          <p className="text-[11px] text-muted mt-1">
            {transcript.participants.join(", ")}
          </p>
        )}
      </div>

      {/* Arrow */}
      <div className="shrink-0 self-center text-gray-300">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </button>
  );
}
