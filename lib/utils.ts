import { Tag } from "./types";

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function getDayName(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

export function getDayNumber(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.getDate().toString();
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function isToday(dateStr: string): boolean {
  return dateStr === todayStr();
}

export function isPast(dateStr: string): boolean {
  return dateStr < todayStr();
}

const tagColors: Record<Tag, { bg: string; text: string }> = {
  meeting: { bg: "bg-blue-100", text: "text-blue-700" },
  call: { bg: "bg-green-100", text: "text-green-700" },
  personal: { bg: "bg-purple-100", text: "text-purple-700" },
  medical: { bg: "bg-red-100", text: "text-red-700" },
  errand: { bg: "bg-amber-100", text: "text-amber-700" },
  brainstorm: { bg: "bg-cyan-100", text: "text-cyan-700" },
  interview: { bg: "bg-indigo-100", text: "text-indigo-700" },
  discussion: { bg: "bg-orange-100", text: "text-orange-700" },
  advertisement: { bg: "bg-gray-100", text: "text-gray-700" },
};

export function getTagColor(tag: Tag): { bg: string; text: string } {
  return tagColors[tag] || { bg: "bg-gray-100", text: "text-gray-700" };
}

const tagBlockColors: Record<Tag, string> = {
  meeting: "border-l-blue-500 bg-blue-50",
  call: "border-l-green-500 bg-green-50",
  personal: "border-l-purple-500 bg-purple-50",
  medical: "border-l-red-500 bg-red-50",
  errand: "border-l-amber-500 bg-amber-50",
  brainstorm: "border-l-cyan-500 bg-cyan-50",
  interview: "border-l-indigo-500 bg-indigo-50",
  discussion: "border-l-orange-500 bg-orange-50",
  advertisement: "border-l-gray-400 bg-gray-50",
};

export function getBlockColor(tag: Tag): string {
  return tagBlockColors[tag] || "border-l-gray-500 bg-gray-50";
}
