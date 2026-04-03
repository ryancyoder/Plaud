"use client";

const API_KEY_STORAGE = "plaud-claude-api-key";
const SUMMARIES_STORAGE = "plaud-daily-summaries";
const SEGMENT_SUMMARIES_STORAGE = "plaud-segment-summaries";
const PROMPTS_STORAGE = "plaud-prompt-templates";
const API_LOG_STORAGE = "plaud-api-log";

// --- API Key ---

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

// --- Editable Prompt Templates ---

export interface PromptTemplates {
  segmentSummary: string;
  segmentProcess: string;
  dailySummary: string;
}

const DEFAULT_PROMPTS: PromptTemplates = {
  segmentSummary: `Summarize this voice recording transcript concisely. Highlight key points, decisions, action items, and people mentioned. Use markdown with bullet points. Keep it under 300 words.

TITLE: {{title}}

TRANSCRIPT:
{{text}}`,

  segmentProcess: `Analyze this voice recording transcript and provide:
1. A SHORT TITLE (max 60 characters) — a descriptive label for this recording segment
2. A CONCISE SUMMARY — key points, decisions, action items, and people mentioned. Use markdown with bullet points. Keep under 300 words.

Respond in this exact format:
TITLE: <your title here>
SUMMARY:
<your summary here>

TRANSCRIPT:
{{text}}`,

  dailySummary: `You are summarizing a day's worth of voice recordings from {{date}}. Below are the transcript segments from that day, each with a timestamp and duration.

Create a concise daily summary that:
1. Highlights the key events, meetings, and conversations
2. Notes any action items, decisions, or follow-ups mentioned
3. Identifies the people involved
4. Groups related activities together
5. Keeps the tone professional but readable

Format the summary with clear sections. Use bullet points where helpful. Keep it under 500 words.

TRANSCRIPT SEGMENTS:

{{segments}}`,
};

export function getDefaultPrompts(): PromptTemplates {
  return { ...DEFAULT_PROMPTS };
}

export function getPromptTemplates(): PromptTemplates {
  if (typeof window === "undefined") return { ...DEFAULT_PROMPTS };
  const stored = localStorage.getItem(PROMPTS_STORAGE);
  if (!stored) return { ...DEFAULT_PROMPTS };
  try {
    return { ...DEFAULT_PROMPTS, ...JSON.parse(stored) };
  } catch {
    return { ...DEFAULT_PROMPTS };
  }
}

export function savePromptTemplates(templates: PromptTemplates): void {
  localStorage.setItem(PROMPTS_STORAGE, JSON.stringify(templates));
}

export function resetPromptTemplates(): void {
  localStorage.removeItem(PROMPTS_STORAGE);
}

// --- API Call Log ---

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  type: "segment_summary" | "segment_process" | "daily_summary";
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: "success" | "error";
  error?: string;
}

export function getApiLog(): ApiLogEntry[] {
  if (typeof window === "undefined") return [];
  const stored = localStorage.getItem(API_LOG_STORAGE);
  return stored ? JSON.parse(stored) : [];
}

function appendApiLog(entry: ApiLogEntry): void {
  const log = getApiLog();
  log.unshift(entry); // newest first
  // Keep last 200 entries
  if (log.length > 200) log.length = 200;
  localStorage.setItem(API_LOG_STORAGE, JSON.stringify(log));
}

export function clearApiLog(): void {
  localStorage.removeItem(API_LOG_STORAGE);
}

// --- Shared Claude API call with logging ---

const MODEL = "claude-haiku-4-5-20251001";

async function callClaude(prompt: string, type: ApiLogEntry["type"]): Promise<string> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("No Claude API key configured");

  const start = performance.now();
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    appendApiLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      status: "error",
      error: err instanceof Error ? err.message : "Network error",
    });
    throw err;
  }

  const durationMs = Math.round(performance.now() - start);

  if (!response.ok) {
    const errText = await response.text();
    const errorMsg = response.status === 401 ? "Invalid API key"
      : response.status === 429 ? "Rate limited — try again in a moment"
      : `API error ${response.status}: ${errText}`;
    appendApiLog({
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
      status: "error",
      error: errorMsg,
    });
    throw new Error(errorMsg);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "";
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  appendApiLog({
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    type,
    model: MODEL,
    inputTokens,
    outputTokens,
    durationMs,
    status: "success",
  });

  return text;
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
  const templates = getPromptTemplates();
  const prompt = templates.segmentSummary
    .replace("{{title}}", title)
    .replace("{{text}}", text);

  const result = await callClaude(prompt, "segment_summary");
  saveSegmentSummaryToCache(transcriptId, result);
  return result;
}

/**
 * Process a transcript segment to generate both an AI title and summary.
 */
export async function processSegmentWithAI(
  text: string,
): Promise<{ title: string; summary: string } | null> {
  if (!hasApiKey()) return null;

  const templates = getPromptTemplates();
  const prompt = templates.segmentProcess.replace("{{text}}", text);

  const result = await callClaude(prompt, "segment_process");

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

  const templates = getPromptTemplates();
  const prompt = templates.dailySummary
    .replace("{{date}}", date)
    .replace("{{segments}}", segmentText);

  const text = await callClaude(prompt, "daily_summary");

  saveCachedSummary({
    date,
    summary: text,
    generatedAt: new Date().toISOString(),
    segmentCount: segments.length,
  });

  return text;
}
