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

export type ClientStatus = "lead" | "propose" | "sent" | "schedule" | "project-management" | "collections" | "paid-in-full";

export const CLIENT_STATUSES: { key: ClientStatus; label: string; color: string }[] = [
  { key: "lead", label: "Lead", color: "bg-gray-100 text-gray-600 border-gray-200" },
  { key: "propose", label: "Propose", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "sent", label: "Sent", color: "bg-purple-50 text-purple-700 border-purple-200" },
  { key: "schedule", label: "Schedule", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "project-management", label: "Project Management", color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  { key: "collections", label: "Collections", color: "bg-orange-50 text-orange-700 border-orange-200" },
  { key: "paid-in-full", label: "Paid in Full", color: "bg-green-50 text-green-700 border-green-200" },
];

export interface Client {
  id: string;
  name: string;
  company?: string;
  type: "client" | "contact";
  status?: ClientStatus;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  appointmentDate?: string;
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
