import { Transcript, Tag } from "./types";

/**
 * Merge all transcripts for a given date into a single synthetic "daily summary" transcript.
 * The summary combines all summaries, participants, tags, action items, calls, and errands.
 */
export function createDailySummary(date: string, transcripts: Transcript[]): Transcript {
  if (transcripts.length === 0) {
    return {
      id: `summary-${date}`,
      title: `No recordings`,
      date,
      startTime: "",
      duration: 0,
      summary: "",
      participants: [],
      tags: [],
      actionItems: [],
      calls: [],
      errands: [],
    };
  }

  const sorted = [...transcripts].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Merge unique participants
  const participantSet = new Set<string>();
  sorted.forEach((t) => t.participants.forEach((p) => participantSet.add(p)));

  // Merge unique tags
  const tagSet = new Set<Tag>();
  sorted.forEach((t) => t.tags.forEach((tag) => tagSet.add(tag)));

  // Build combined summary with section headers
  const combinedSummary = sorted
    .map((t) => {
      const time = t.startTime ? `[${t.startTime}] ` : "";
      return `${time}${t.title}\n${t.summary}`;
    })
    .join("\n\n");

  // Build combined full transcript
  const combinedFull = sorted
    .filter((t) => t.fullTranscript)
    .map((t) => {
      const time = t.startTime ? `[${t.startTime}] ` : "";
      return `--- ${time}${t.title} ---\n${t.fullTranscript}`;
    })
    .join("\n\n");

  // Determine time range
  const firstTime = sorted[0].startTime || "";
  const lastEnd = sorted[sorted.length - 1];
  const totalDuration = sorted.reduce((sum, t) => sum + t.duration, 0);

  // Determine client — use most common, or undefined if mixed
  const clientCounts: Record<string, number> = {};
  sorted.forEach((t) => {
    if (t.clientName) {
      clientCounts[t.clientName] = (clientCounts[t.clientName] || 0) + 1;
    }
  });
  const clients = Object.keys(clientCounts);
  const clientName = clients.length === 1 ? clients[0] : undefined;

  return {
    id: `summary-${date}`,
    title: `Daily Summary — ${sorted.length} recording${sorted.length !== 1 ? "s" : ""}`,
    date,
    startTime: firstTime,
    duration: totalDuration,
    summary: combinedSummary,
    fullTranscript: combinedFull || undefined,
    participants: Array.from(participantSet),
    clientName,
    tags: Array.from(tagSet),
    actionItems: sorted.flatMap((t) => t.actionItems),
    calls: sorted.flatMap((t) => t.calls),
    errands: sorted.flatMap((t) => t.errands),
  };
}
