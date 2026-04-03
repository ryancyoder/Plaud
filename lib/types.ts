export interface Transcript {
  id: string;
  title: string;
  date: string; // ISO date string
  startTime: string; // HH:MM
  duration: number; // minutes
  summary: string;
  fullTranscript?: string;
  participants: string[];
  clientName?: string;
  tags: Tag[];
  actionItems: ActionItem[];
  calls: CallItem[];
  errands: ErrandItem[];
  pinned?: boolean;
}

export type Tag = "meeting" | "call" | "personal" | "medical" | "errand" | "brainstorm" | "interview" | "discussion" | "advertisement";

export interface Client {
  id: string;
  name: string;
  company?: string;
  type: "client" | "contact"; // external client vs in-house
  transcriptCount: number;
  lastSeen?: string; // ISO date
}

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
