"use client";

const API_KEY_STORAGE = "plaud-claude-api-key";
const SUMMARIES_STORAGE = "plaud-daily-summaries";
const SEGMENT_SUMMARIES_STORAGE = "plaud-segment-summaries";

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

// --- Shared Claude API call ---

async function callClaude(prompt: string): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Claude API key configured");

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
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) throw new Error("Invalid API key");
    if (response.status === 429) throw new Error("Rate limited — try again in a moment");
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

// --- Daily summary cache ---

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
  localStorage.removeItem(SEGMENT_SUMMARIES_STORAGE);
}

// --- Segment summary cache ---

function loadCachedSegmentSummaries(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const stored = localStorage.getItem(SEGMENT_SUMMARIES_STORAGE);
  return stored ? JSON.parse(stored) : {};
}

export function getCachedSegmentSummary(transcriptId: string): string | null {
  return loadCachedSegmentSummaries()[transcriptId] || null;
}

function saveSegmentSummaryToCache(transcriptId: string, summary: string): void {
  const cache = loadCachedSegmentSummaries();
  cache[transcriptId] = summary;
  localStorage.setItem(SEGMENT_SUMMARIES_STORAGE, JSON.stringify(cache));
}

// --- Segment summary generation ---

export async function generateSegmentSummary(
  transcriptId: string,
  title: string,
  text: string,
): Promise<string> {
  const prompt = `Summarize this voice recording transcript concisely. Highlight key points, decisions, action items, and people mentioned. Use markdown with bullet points. Keep it under 300 words.

TITLE: ${title}

TRANSCRIPT:
${text}`;

  const result = await callClaude(prompt);
  saveSegmentSummaryToCache(transcriptId, result);
  return result;
}

/**
 * Process a transcript segment to generate both an AI title and summary.
 * Returns { title, summary } or null if no API key.
 */
export async function processSegmentWithAI(
  text: string,
): Promise<{ title: string; summary: string } | null> {
  if (!hasApiKey()) return null;

  const prompt = `Analyze this voice recording transcript and provide:
1. A SHORT TITLE (max 60 characters) — a descriptive label for this recording segment
2. A CONCISE SUMMARY — key points, decisions, action items, and people mentioned. Use markdown with bullet points. Keep under 300 words.

Respond in this exact format:
TITLE: <your title here>
SUMMARY:
<your summary here>

TRANSCRIPT:
${text}`;

  const result = await callClaude(prompt);

  const titleMatch = result.match(/^TITLE:\s*(.+)/m);
  const summaryMatch = result.match(/SUMMARY:\n?([\s\S]+)/);

  return {
    title: titleMatch?.[1]?.trim().slice(0, 60) || "Untitled Segment",
    summary: summaryMatch?.[1]?.trim() || result,
  };
}

// --- Daily summary generation ---

interface Segment {
  startTime: string;
  duration: number;
  title: string;
  text: string;
}

export async function generateDailySummary(
  date: string,
  segments: Segment[],
): Promise<string> {
  const segmentText = segments
    .map((s) => `[${s.startTime}] (${s.duration}min) ${s.title}\n${s.text}`)
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

  const text = await callClaude(prompt);

  saveCachedSummary({
    date,
    summary: text,
    generatedAt: new Date().toISOString(),
    segmentCount: segments.length,
  });

  return text;
}
