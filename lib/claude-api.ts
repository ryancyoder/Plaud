"use client";

const API_KEY_STORAGE = "plaud-claude-api-key";
const SUMMARIES_STORAGE = "plaud-daily-summaries";

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(API_KEY_STORAGE) || "";
}

export function setApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

interface CachedSummary {
  date: string;
  summary: string;
  generatedAt: string;
  segmentCount: number;
}

function loadCachedSummaries(): Record<string, CachedSummary> {
  if (typeof window === "undefined") return {};
  const stored = localStorage.getItem(SUMMARIES_STORAGE);
  return stored ? JSON.parse(stored) : {};
}

function saveCachedSummary(entry: CachedSummary): void {
  const cache = loadCachedSummaries();
  cache[entry.date] = entry;
  localStorage.setItem(SUMMARIES_STORAGE, JSON.stringify(cache));
}

export function getCachedSummary(date: string): string | null {
  const cache = loadCachedSummaries();
  return cache[date]?.summary || null;
}

export function getCachedSummaryMeta(date: string): CachedSummary | null {
  const cache = loadCachedSummaries();
  return cache[date] || null;
}

export function clearCachedSummaries(): void {
  localStorage.removeItem(SUMMARIES_STORAGE);
}

interface Segment {
  startTime: string;
  duration: number;
  title: string;
  text: string;
}

/**
 * Call the Claude API to generate a daily summary from transcript segments.
 * Uses the Messages API directly via fetch (no SDK needed for static site).
 */
export async function generateDailySummary(
  date: string,
  segments: Segment[],
): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Claude API key configured");

  const segmentText = segments
    .map((s, i) => `[${s.startTime}] (${s.duration}min) ${s.title}\n${s.text}`)
    .join("\n\n---\n\n");

  const prompt = `You are summarizing a day's worth of voice recordings from ${date}. Below are the transcript segments from that day, each with a timestamp and duration.

Create a concise daily summary that:
1. Highlights the key events, meetings, and conversations
2. Notes any action items, decisions, or follow-ups mentioned
3. Identifies the people involved
4. Groups related activities together
5. Keeps the tone professional but readable

Format the summary with clear sections. Use bullet points where helpful. Keep it under 500 words.

TRANSCRIPT SEGMENTS:

${segmentText}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) throw new Error("Invalid API key");
    if (response.status === 429) throw new Error("Rate limited — try again in a moment");
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";

  // Cache the result
  saveCachedSummary({
    date,
    summary: text,
    generatedAt: new Date().toISOString(),
    segmentCount: segments.length,
  });

  return text;
}
