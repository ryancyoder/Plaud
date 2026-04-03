export interface Transcript {
  id: string;
  title: string;
  date: string; // ISO date string
  startTime: string; // HH:MM
  duration: number; // minutes
  summary: string;
  participants: string[];
  tags: Tag[];
  actionItems: ActionItem[];
  calls: CallItem[];
  errands: ErrandItem[];
}

export type Tag = "meeting" | "call" | "personal" | "medical" | "errand" | "brainstorm" | "interview";

export interface ActionItem {
  id: string;
  text: string;
  done: boolean;
  source: string; // transcript title
  dueDate?: string;
}

export interface CallItem {
  id: string;
  person: string;
  reason: string;
  done: boolean;
  source: string;
}

export interface ErrandItem {
  id: string;
  text: string;
  done: boolean;
  source: string;
  location?: string;
}

export interface WeekSummary {
  totalTranscripts: number;
  totalMinutes: number;
  topParticipants: string[];
  keyThemes: string[];
}
