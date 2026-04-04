"use client";

import { AppEvent, Attachment } from "./types";
import { resizeImage } from "./attachment-store";

/**
 * Extract the date-time a photo was taken.
 * Tries EXIF DateTimeOriginal first, then falls back to file.lastModified.
 */
export async function getPhotoTimestamp(file: File): Promise<Date> {
  // Try to read EXIF from JPEG files
  if (file.type === "image/jpeg" || file.type === "image/jpg") {
    try {
      const exifDate = await readExifDate(file);
      if (exifDate) return exifDate;
    } catch {
      // fall through
    }
  }

  // Fallback: file.lastModified (set by the OS when photo was taken on iOS)
  return new Date(file.lastModified);
}

/**
 * Minimal EXIF parser — reads only DateTimeOriginal (tag 0x9003) or
 * DateTimeDigitized (0x9004) from a JPEG file. No external dependencies.
 */
async function readExifDate(file: File): Promise<Date | null> {
  const buffer = await file.slice(0, 128 * 1024).arrayBuffer(); // first 128KB
  const view = new DataView(buffer);

  // Check JPEG SOI marker
  if (view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      // APP1 (EXIF)
      const length = view.getUint16(offset + 2);
      const exifStart = offset + 4;

      // Check "Exif\0\0"
      const exifHeader = String.fromCharCode(
        view.getUint8(exifStart),
        view.getUint8(exifStart + 1),
        view.getUint8(exifStart + 2),
        view.getUint8(exifStart + 3),
      );
      if (exifHeader !== "Exif") return null;

      const tiffStart = exifStart + 6;
      const byteOrder = view.getUint16(tiffStart);
      const isLittleEndian = byteOrder === 0x4949; // "II"

      const ifdOffset = view.getUint32(tiffStart + 4, isLittleEndian);
      const dateStr = findDateInIFD(view, tiffStart, tiffStart + ifdOffset, isLittleEndian);
      if (dateStr) return parseExifDateString(dateStr);

      // Check for sub-IFD (Exif IFD) which contains DateTimeOriginal
      const exifIfdOffset = findTagValue(view, tiffStart, tiffStart + ifdOffset, isLittleEndian, 0x8769);
      if (exifIfdOffset !== null) {
        const dateStr2 = findDateInIFD(view, tiffStart, tiffStart + exifIfdOffset, isLittleEndian);
        if (dateStr2) return parseExifDateString(dateStr2);
      }

      void length;
      return null;
    } else if ((marker & 0xff00) === 0xff00) {
      // Other marker — skip
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    } else {
      break;
    }
  }
  return null;
}

function findDateInIFD(
  view: DataView,
  tiffStart: number,
  ifdStart: number,
  le: boolean,
): string | null {
  if (ifdStart + 2 > view.byteLength) return null;
  const count = view.getUint16(ifdStart, le);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, le);
    // 0x9003 = DateTimeOriginal, 0x9004 = DateTimeDigitized, 0x0132 = DateTime
    if (tag === 0x9003 || tag === 0x9004 || tag === 0x0132) {
      const valCount = view.getUint32(entryOffset + 4, le);
      const valueOffset = view.getUint32(entryOffset + 8, le);
      const strOffset = valCount <= 4 ? entryOffset + 8 : tiffStart + valueOffset;
      if (strOffset + 19 > view.byteLength) continue;
      let str = "";
      for (let j = 0; j < 19; j++) {
        str += String.fromCharCode(view.getUint8(strOffset + j));
      }
      return str;
    }
  }
  return null;
}

function findTagValue(
  view: DataView,
  tiffStart: number,
  ifdStart: number,
  le: boolean,
  targetTag: number,
): number | null {
  if (ifdStart + 2 > view.byteLength) return null;
  const count = view.getUint16(ifdStart, le);
  for (let i = 0; i < count; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOffset, le);
    if (tag === targetTag) {
      return view.getUint32(entryOffset + 8, le);
    }
  }
  return null;
}

function parseExifDateString(s: string): Date | null {
  // Format: "2026:03:30 14:25:00"
  const match = s.match(/(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, sec] = match;
  return new Date(
    parseInt(y),
    parseInt(mo) - 1,
    parseInt(d),
    parseInt(h),
    parseInt(mi),
    parseInt(sec),
  );
}

/**
 * Match a photo's timestamp to the recording event whose window it falls within.
 */
export function matchPhotoToEvent(
  photoDate: Date,
  events: AppEvent[],
  bufferMinutes = 15,
): AppEvent | null {
  const photoTime = photoDate.getTime();
  const photoDateStr = `${photoDate.getFullYear()}-${String(photoDate.getMonth() + 1).padStart(2, "0")}-${String(photoDate.getDate()).padStart(2, "0")}`;

  // Only consider recording events from the same day
  const sameDayEvents = events.filter((e) => e.date === photoDateStr && e.type === "recording");
  if (sameDayEvents.length === 0) return null;

  let bestMatch: AppEvent | null = null;
  let bestDistance = Infinity;

  for (const ev of sameDayEvents) {
    const [h, m] = (ev.startTime || "00:00").split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const startDate = new Date(photoDate);
    startDate.setHours(h, m, 0, 0);
    const startMs = startDate.getTime() - bufferMinutes * 60 * 1000;
    const endMs = startDate.getTime() + (ev.duration || 0) * 60 * 1000 + bufferMinutes * 60 * 1000;

    if (photoTime >= startMs && photoTime <= endMs) {
      const center = startDate.getTime() + ((ev.duration || 0) * 60 * 1000) / 2;
      const dist = Math.abs(photoTime - center);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = ev;
      }
    }
  }

  return bestMatch;
}

export interface PhotoMatchResult {
  eventId: string;
  eventTitle: string;
  attachments: Attachment[];
}

export interface UnmatchedPhoto {
  attachment: Attachment;
  timestamp: Date;
  reason: string;
}

/**
 * A segment of photos grouped by temporal proximity.
 * Photos within `gapMinutes` of each other belong to the same segment.
 */
export interface PhotoSegment {
  attachments: Attachment[];
  startTime: Date;
  endTime: Date;
  date: string; // YYYY-MM-DD
}

/**
 * Group photos into segments based on timestamp gaps.
 * Photos are sorted by time, then split whenever the gap between
 * consecutive photos exceeds `gapMinutes` (default 30).
 */
export function segmentPhotosByTime(
  photos: { attachment: Attachment; timestamp: Date }[],
  gapMinutes = 30,
): PhotoSegment[] {
  if (photos.length === 0) return [];

  const sorted = [...photos].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const gapMs = gapMinutes * 60 * 1000;
  const segments: PhotoSegment[] = [];

  let current: typeof sorted = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime();
    if (gap > gapMs) {
      segments.push(buildSegment(current));
      current = [sorted[i]];
    } else {
      current.push(sorted[i]);
    }
  }
  segments.push(buildSegment(current));

  return segments;
}

function buildSegment(photos: { attachment: Attachment; timestamp: Date }[]): PhotoSegment {
  const startTime = photos[0].timestamp;
  const endTime = photos[photos.length - 1].timestamp;
  const d = startTime;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return {
    attachments: photos.map((p) => p.attachment),
    startTime,
    endTime,
    date,
  };
}

export interface BatchMatchResult {
  matched: PhotoMatchResult[];
  unmatchedSegments: PhotoSegment[];
}

/**
 * Process a batch of photo files: extract timestamps, resize, match to recording events.
 * Unmatched photos are grouped into segments by timestamp gaps (default 30 min).
 */
export async function batchMatchPhotos(
  files: FileList,
  events: AppEvent[],
  gapMinutes = 30,
  bufferMinutes = 15,
): Promise<BatchMatchResult> {
  const matched: Map<string, PhotoMatchResult> = new Map();
  const unmatchedRaw: { attachment: Attachment; timestamp: Date }[] = [];

  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;

    const timestamp = await getPhotoTimestamp(file);
    const dataUrl = await readFileAsDataUrl(file);
    const resized = await resizeImage(dataUrl, 1200);

    const attachment: Attachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      type: "photo",
      mimeType: file.type,
      dataUrl: resized,
      timestamp: timestamp.toISOString(),
    };

    const match = matchPhotoToEvent(timestamp, events, bufferMinutes);
    if (match) {
      const existing = matched.get(match.id);
      if (existing) {
        existing.attachments.push(attachment);
      } else {
        matched.set(match.id, {
          eventId: match.id,
          eventTitle: match.label,
          attachments: [attachment],
        });
      }
    } else {
      unmatchedRaw.push({ attachment, timestamp });
    }
  }

  return {
    matched: Array.from(matched.values()),
    unmatchedSegments: segmentPhotosByTime(unmatchedRaw, gapMinutes),
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
