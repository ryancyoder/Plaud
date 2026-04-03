"use client";

import { Transcript, Attachment } from "./types";
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
 * Match a photo's timestamp to the transcript whose recording window it falls within.
 * A photo matches a transcript if it was taken between startTime and startTime + duration,
 * with a configurable buffer (default 15 min before/after).
 */
export function matchPhotoToTranscript(
  photoDate: Date,
  transcripts: Transcript[],
  bufferMinutes = 15,
): Transcript | null {
  const photoTime = photoDate.getTime();
  const photoDateStr = `${photoDate.getFullYear()}-${String(photoDate.getMonth() + 1).padStart(2, "0")}-${String(photoDate.getDate()).padStart(2, "0")}`;

  // Only consider transcripts from the same day
  const sameDayTranscripts = transcripts.filter((t) => t.date === photoDateStr);
  if (sameDayTranscripts.length === 0) return null;

  let bestMatch: Transcript | null = null;
  let bestDistance = Infinity;

  for (const t of sameDayTranscripts) {
    const [h, m] = t.startTime.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) continue;

    const startDate = new Date(photoDate);
    startDate.setHours(h, m, 0, 0);
    const startMs = startDate.getTime() - bufferMinutes * 60 * 1000;
    const endMs = startDate.getTime() + t.duration * 60 * 1000 + bufferMinutes * 60 * 1000;

    if (photoTime >= startMs && photoTime <= endMs) {
      // Within window — pick closest to center of recording
      const center = startDate.getTime() + (t.duration * 60 * 1000) / 2;
      const dist = Math.abs(photoTime - center);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = t;
      }
    }
  }

  return bestMatch;
}

export interface PhotoMatchResult {
  transcriptId: string;
  transcriptTitle: string;
  attachments: Attachment[];
}

export interface UnmatchedPhoto {
  attachment: Attachment;
  timestamp: Date;
  reason: string;
}

/**
 * Process a batch of photo files: extract timestamps, resize, match to transcripts.
 */
export async function batchMatchPhotos(
  files: FileList,
  transcripts: Transcript[],
): Promise<{ matched: PhotoMatchResult[]; unmatched: UnmatchedPhoto[] }> {
  const matched: Map<string, PhotoMatchResult> = new Map();
  const unmatched: UnmatchedPhoto[] = [];

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

    const match = matchPhotoToTranscript(timestamp, transcripts);
    if (match) {
      const existing = matched.get(match.id);
      if (existing) {
        existing.attachments.push(attachment);
      } else {
        matched.set(match.id, {
          transcriptId: match.id,
          transcriptTitle: match.title,
          attachments: [attachment],
        });
      }
    } else {
      const dateStr = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, "0")}-${String(timestamp.getDate()).padStart(2, "0")}`;
      const hasSameDay = transcripts.some((t) => t.date === dateStr);
      unmatched.push({
        attachment,
        timestamp,
        reason: hasSameDay ? "Outside any recording window" : "No recordings on this date",
      });
    }
  }

  return {
    matched: Array.from(matched.values()),
    unmatched,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
