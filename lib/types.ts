// --- Attachments ---

export interface Attachment {
  id: string;
  name: string;
  type: "photo" | "document" | "note";
  mimeType: string;
  dataUrl: string; // base64 data URL
  timestamp?: string; // ISO date-time
}

// --- Event Types ---

export type EventType =
  | "recording"
  | "photo"
  | "site-visit"
  | "phone-call"
  | "text-message"
  | "email"
  | "status-change"
  | "proposal"
  | "contract"
  | "delivery"
  | "payment"
  | "note"
  | "next-action";

export const EVENT_TYPES: { key: EventType; label: string }[] = [
  { key: "recording", label: "Recording" },
  { key: "photo", label: "Photo" },
  { key: "site-visit", label: "Site Visit" },
  { key: "phone-call", label: "Phone Call" },
  { key: "text-message", label: "Text Message" },
  { key: "email", label: "Email" },
  { key: "status-change", label: "Status Change" },
  { key: "proposal", label: "Proposal" },
  { key: "contract", label: "Contract" },
  { key: "delivery", label: "Delivery" },
  { key: "payment", label: "Payment" },
  { key: "note", label: "Note" },
  { key: "next-action", label: "Next Action" },
];

/**
 * Unified event — the core data entity.
 *
 * Every piece of client-related data is an event. The `type` field
 * determines which optional fields are relevant.
 *
 * - clientId: the primary contact. Null/undefined = unassigned.
 * - mentions: client names found in context but not the primary contact.
 */
export interface AppEvent {
  id: string;
  type: EventType;
  clientId?: string; // primary contact (nullable = unassigned)
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  duration?: number; // minutes
  label: string; // display title

  // Context / mentions
  mentions?: string[]; // client names mentioned but not primary

  // Recording-specific
  summary?: string;
  fullTranscript?: string;
  participants?: string[];
  tags?: Tag[];

  // Attachments — photos/docs on recordings, or standalone photo batches
  attachments?: Attachment[];

  // Simple event extras
  notes?: string;

  // System-generated flag
  auto?: boolean;
}

export type Tag = "meeting" | "call" | "personal" | "medical" | "errand" | "brainstorm" | "interview" | "discussion" | "advertisement";

// --- Client Status ---

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

// --- Project Status ---

export type ProjectStatus = "to-do" | "wip" | "waiting" | "done";

export const PROJECT_STATUSES: { key: ProjectStatus; label: string; color: string }[] = [
  { key: "to-do", label: "To Do", color: "bg-gray-100 text-gray-600 border-gray-200" },
  { key: "wip", label: "Work in Progress", color: "bg-blue-50 text-blue-700 border-blue-200" },
  { key: "waiting", label: "Waiting", color: "bg-amber-50 text-amber-700 border-amber-200" },
  { key: "done", label: "Done", color: "bg-green-50 text-green-700 border-green-200" },
];

// --- Client ---

export type ClientKind = "client" | "contact" | "project";

export type ContactSubtype = "client" | "rlm" | "supplier" | "family" | "other";

export const CONTACT_SUBTYPES: { key: ContactSubtype; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "rlm", label: "RLM" },
  { key: "supplier", label: "Supplier" },
  { key: "family", label: "Family" },
  { key: "other", label: "Other" },
];

export interface Client {
  id: string;
  name: string;
  company?: string;
  kind: ClientKind;
  contactSubtype?: ContactSubtype;
  type: "client" | "contact"; // legacy — use `kind` instead
  status?: ClientStatus;
  projectStatus?: ProjectStatus;
  phone?: string;
  email?: string;
  address?: string;
  lat?: number;
  lng?: number;
  notes?: string;
  appointmentDate?: string;
  nextAction?: string;
}
