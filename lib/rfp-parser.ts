"use client";

import { Client } from "./types";

export interface ParsedRfp {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  appointmentDate?: string;
  notes: string;
}

/**
 * Parse an RFP/appointment clipboard text into structured client data.
 *
 * Expected format (from Outlook appointment):
 *   Name Phone
 *   Scheduled: Date at Time to Time, TZ
 *   Location: Address line 1
 *   City, State, Country
 *   Phone (repeated)
 *   Email
 *
 *   Free-text notes...
 */
export function parseRfpClipboard(text: string): ParsedRfp {
  const lines = text.trim().split("\n").map((l) => l.trim());
  if (lines.length === 0) throw new Error("Empty clipboard");

  let name = "";
  let phone: string | undefined;
  let email: string | undefined;
  let address: string | undefined;
  let appointmentDate: string | undefined;
  const noteLines: string[] = [];

  const phonePattern = /(\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;
  const emailPattern = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i;
  const scheduledPattern = /^Scheduled:\s*(.+)/i;
  const locationPattern = /^Location:\s*(.+)/i;

  let pastHeader = false; // true once we've passed the structured header into notes
  let foundScheduled = false;
  let foundLocation = false;
  let addressLines: string[] = [];
  let collectingAddress = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip blank lines — they separate header from notes
    if (line === "") {
      if (foundScheduled || foundLocation || name) {
        pastHeader = true;
        collectingAddress = false;
      }
      continue;
    }

    // First line: Name (and possibly phone, parenthetical notes)
    if (i === 0) {
      let firstLine = line;
      // Strip parenthetical notes like (confirmed), (rescheduled), etc.
      firstLine = firstLine.replace(/\s*\([^)]*\)\s*/g, " ").trim();
      const phoneMatch = firstLine.match(phonePattern);
      if (phoneMatch) {
        phone = normalizePhone(phoneMatch[1]);
        name = firstLine.replace(phoneMatch[0], "").trim();
      } else {
        name = firstLine;
      }
      // Strip trailing dashes/separators left over after phone removal (e.g. "Name -- ")
      name = name.replace(/[-–—\s]+$/, "").trim();
      continue;
    }

    if (pastHeader) {
      // Still capture email/phone if not yet found, even after blank lines
      if (!email) {
        const cleanedLine = line.replace(/<mailto:[^>]*>/gi, "");
        const emailMatch = cleanedLine.match(emailPattern);
        if (emailMatch) {
          email = emailMatch[1].toLowerCase();
          continue;
        }
      }
      if (!phone) {
        const phoneMatch2 = line.match(phonePattern);
        if (phoneMatch2) {
          phone = normalizePhone(phoneMatch2[1]);
          continue;
        }
      }
      noteLines.push(line);
      continue;
    }

    // Scheduled line
    const schedMatch = line.match(scheduledPattern);
    if (schedMatch) {
      appointmentDate = parseScheduledDate(schedMatch[1]);
      foundScheduled = true;
      collectingAddress = false;
      continue;
    }

    // Location line
    const locMatch = line.match(locationPattern);
    if (locMatch) {
      addressLines = [locMatch[1]];
      foundLocation = true;
      collectingAddress = true;
      continue;
    }

    // If we're collecting address lines (city, state after Location:)
    if (collectingAddress) {
      // Check if this line looks like a continuation of address (has comma or is city/state)
      if (/[A-Z]/.test(line) && !emailPattern.test(line) && !phonePattern.test(line)) {
        addressLines.push(line);
        continue;
      }
      collectingAddress = false;
    }

    // Email line — strip <mailto:...> tags before matching
    const cleanedLine = line.replace(/<mailto:[^>]*>/gi, "");
    const emailMatch = cleanedLine.match(emailPattern);
    if (emailMatch) {
      email = emailMatch[1].toLowerCase();
      continue;
    }

    // Repeated phone line
    const phoneMatch2 = line.match(phonePattern);
    if (phoneMatch2) {
      if (!phone) phone = normalizePhone(phoneMatch2[1]);
      continue;
    }

    // Anything else in the header area goes to notes
    noteLines.push(line);
  }

  if (addressLines.length > 0) {
    address = addressLines.join(", ");
  }

  if (!name) throw new Error("Could not parse a name from the clipboard text");

  return {
    name: name.trim(),
    phone,
    email,
    address,
    appointmentDate,
    notes: noteLines.join("\n").trim(),
  };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}

function parseScheduledDate(raw: string): string {
  // "Mar 31, 2026 at 10:00 AM to 11:00 AM, CDT"
  // Extract the start date/time
  const match = raw.match(/^(.+?)\s+at\s+(\d{1,2}:\d{2}\s*[APap][Mm])/);
  if (match) {
    const dateStr = match[1].trim();
    const timeStr = match[2].trim();
    try {
      const d = new Date(`${dateStr} ${timeStr}`);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    } catch {
      // fall through
    }
    return `${dateStr} ${timeStr}`;
  }
  return raw.trim();
}

/**
 * Convert a parsed RFP into a Client object (without id — caller generates that).
 */
export function rfpToClientData(rfp: ParsedRfp): Omit<Client, "id"> {
  return {
    name: rfp.name,
    type: "client",
    status: "lead",
    phone: rfp.phone,
    email: rfp.email,
    address: rfp.address,
    notes: rfp.notes || undefined,
    appointmentDate: rfp.appointmentDate,
    transcriptCount: 0,
  };
}
