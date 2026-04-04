export interface Attachment {
  id: string;
  name: string;
  type: "photo" | "document" | "note";
  mimeType: string;
  dataUrl: string; // base64 data URL
  timestamp?: string; // ISO date-time
}

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
  attachments?: Attachment[];
  pinned?: boolean;
}

export type Tag = "meeting" | "call" | "personal" | "medical" | "errand" | "brainstorm" | "interview" | "discussion" | "advertisement";

export type ClientStatus = "lead" | "contacted" | "meeting" | "proposal" | "active" | "follow-up" | "closed";

export const CLIENT_STATUSES: { key: ClientStatus; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "bg-gray-100 text-gray-600 border-gray-200" },
  { key: "contacted", label: "Contacted", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "meeting", label: "Meeting", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "proposal", label: "Proposal", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "active", label: "Active", color: "bg-green-50 text-green-700 border-green-200" },
  { key: "follow-up", label: "Follow-Up", color: "bg-orange-50 text-orange-700 border-orange-200" },
  { key: "closed", label: "Closed", color: "bg-red-50 text-red-600 border-red-200" },
];

export interface Client {
  id: string;
  name: string;
  company?: string;
  type: "client" | "contact";
  status?: ClientStatus;
  transcriptCount: number;
  lastSeen?: string;
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
