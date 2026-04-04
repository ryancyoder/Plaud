"use client";

import { AppEvent, Attachment, Client } from "./types";
import { resizeImage } from "./attachment-store";

// --- GPS / Geocoding types ---

export interface GpsCoords {
  lat: number;
  lng: number;
}

export interface PhotoMetadata {
  timestamp: Date;
  gps: GpsCoords | null;
}

/**
 * Extract timestamp and GPS from a photo file.
 * Tries EXIF first, falls back to file.lastModified for timestamp.
 */
export async function getPhotoMetadata(file: File): Promise<PhotoMetadata> {
  if (file.type === "image/jpeg" || file.type === "image/jpg") {
    try {
      const exif = await readExifData(file);
      return {
        timestamp: exif.date || new Date(file.lastModified),
        gps: exif.gps,
      };
    } catch {
      // fall through
    }
  }
  return { timestamp: new Date(file.lastModified), gps: null };
}

// Keep old API for backward compat
export async function getPhotoTimestamp(file: File): Promise<Date> {
  return (await getPhotoMetadata(file)).timestamp;
}

// --- EXIF Parser ---

interface ExifData {
  date: Date | null;
  gps: GpsCoords | null;
}

async function readExifData(file: File): Promise<ExifData> {
  const buffer = await file.slice(0, 128 * 1024).arrayBuffer();
  const view = new DataView(buffer);

  if (view.getUint16(0) !== 0xffd8) return { date: null, gps: null };

  let offset = 2;
  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    if (marker === 0xffe1) {
      const exifStart = offset + 4;
      const exifHeader = String.fromCharCode(
        view.getUint8(exifStart),
        view.getUint8(exifStart + 1),
        view.getUint8(exifStart + 2),
        view.getUint8(exifStart + 3),
      );
      if (exifHeader !== "Exif") return { date: null, gps: null };

      const tiffStart = exifStart + 6;
      const byteOrder = view.getUint16(tiffStart);
      const le = byteOrder === 0x4949;

      const ifdOffset = view.getUint32(tiffStart + 4, le);
      const ifd0Start = tiffStart + ifdOffset;

      // Date from IFD0
      let date: Date | null = null;
      const dateStr = findDateInIFD(view, tiffStart, ifd0Start, le);
      if (dateStr) date = parseExifDateString(dateStr);

      // Date from Exif sub-IFD (has DateTimeOriginal)
      if (!date) {
        const exifIfdOff = findTagValue(view, tiffStart, ifd0Start, le, 0x8769);
        if (exifIfdOff !== null) {
          const dateStr2 = findDateInIFD(view, tiffStart, tiffStart + exifIfdOff, le);
          if (dateStr2) date = parseExifDateString(dateStr2);
        }
      }

      // GPS from GPS IFD (tag 0x8825 in IFD0)
      let gps: GpsCoords | null = null;
      const gpsIfdOff = findTagValue(view, tiffStart, ifd0Start, le, 0x8825);
      if (gpsIfdOff !== null) {
        gps = readGpsFromIFD(view, tiffStart, tiffStart + gpsIfdOff, le);
      }

      return { date, gps };
    } else if ((marker & 0xff00) === 0xff00) {
      const segLen = view.getUint16(offset + 2);
      offset += 2 + segLen;
    } else {
      break;
    }
  }
  return { date: null, gps: null };
}

/**
 * Read GPS coordinates from the GPS IFD.
 * Tags: 0x0001 = LatRef (N/S), 0x0002 = Lat, 0x0003 = LngRef (E/W), 0x0004 = Lng
 * Lat/Lng are stored as 3 RATIONALs (degrees, minutes, seconds).
 */
function readGpsFromIFD(
  view: DataView,
  tiffStart: number,
  ifdStart: number,
  le: boolean,
): GpsCoords | null {
  if (ifdStart + 2 > view.byteLength) return null;
  const count = view.getUint16(ifdStart, le);

  let latRef = "N";
  let lngRef = "E";
  let latRationals: [number, number, number] | null = null;
  let lngRationals: [number, number, number] | null = null;

  for (let i = 0; i < count; i++) {
    const entryOff = ifdStart + 2 + i * 12;
    if (entryOff + 12 > view.byteLength) break;
    const tag = view.getUint16(entryOff, le);
    const type = view.getUint16(entryOff + 2, le);

    if (tag === 0x0001) {
      // GPSLatitudeRef — ASCII, 2 bytes
      latRef = String.fromCharCode(view.getUint8(entryOff + 8));
    } else if (tag === 0x0003) {
      // GPSLongitudeRef
      lngRef = String.fromCharCode(view.getUint8(entryOff + 8));
    } else if (tag === 0x0002 && type === 5) {
      // GPSLatitude — 3 RATIONALs
      latRationals = readThreeRationals(view, tiffStart, entryOff, le);
    } else if (tag === 0x0004 && type === 5) {
      // GPSLongitude — 3 RATIONALs
      lngRationals = readThreeRationals(view, tiffStart, entryOff, le);
    }
  }

  if (!latRationals || !lngRationals) return null;

  let lat = latRationals[0] + latRationals[1] / 60 + latRationals[2] / 3600;
  let lng = lngRationals[0] + lngRationals[1] / 60 + lngRationals[2] / 3600;
  if (latRef === "S") lat = -lat;
  if (lngRef === "W") lng = -lng;

  if (lat === 0 && lng === 0) return null; // likely no real GPS
  return { lat, lng };
}

function readThreeRationals(
  view: DataView,
  tiffStart: number,
  entryOff: number,
  le: boolean,
): [number, number, number] | null {
  const valueOffset = tiffStart + view.getUint32(entryOff + 8, le);
  if (valueOffset + 24 > view.byteLength) return null;
  const r = (off: number) => {
    const num = view.getUint32(off, le);
    const den = view.getUint32(off + 4, le);
    return den === 0 ? 0 : num / den;
  };
  return [r(valueOffset), r(valueOffset + 8), r(valueOffset + 16)];
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
  const match = s.match(/(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, sec] = match;
  return new Date(parseInt(y), parseInt(mo) - 1, parseInt(d), parseInt(h), parseInt(mi), parseInt(sec));
}

// --- Geocoding (Nominatim — free, no API key) ---

const geocodeCache = new Map<string, string>();

/**
 * Reverse-geocode GPS coordinates to a short address string.
 * Uses OpenStreetMap Nominatim (1 req/sec rate limit).
 */
export async function reverseGeocode(coords: GpsCoords): Promise<string | null> {
  const key = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=18&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "PlaudApp/1.0" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address;
    if (!addr) return null;

    // Build short address: house_number + road, city
    const parts: string[] = [];
    const street = [addr.house_number, addr.road].filter(Boolean).join(" ");
    if (street) parts.push(street);
    const city = addr.city || addr.town || addr.village || addr.suburb || "";
    if (city) parts.push(city);

    const result = parts.join(", ") || data.display_name?.split(",").slice(0, 2).join(",") || null;
    if (result) geocodeCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Forward-geocode an address string to GPS coordinates.
 */
export async function forwardGeocode(address: string): Promise<GpsCoords | null> {
  if (!address.trim()) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "PlaudApp/1.0" },
    });
    if (!resp.ok) return null;
    const results = await resp.json();
    if (results.length === 0) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lng) };
  } catch {
    return null;
  }
}

// --- Distance / Client matching ---

/**
 * Haversine distance in meters between two GPS coordinates.
 */
export function haversineMeters(a: GpsCoords, b: GpsCoords): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Find the closest client to a GPS coordinate, within maxMeters.
 * Clients must have lat/lng set.
 */
export function findClosestClient(
  coords: GpsCoords,
  clients: Client[],
  maxMeters = 200,
): Client | null {
  let best: Client | null = null;
  let bestDist = Infinity;
  for (const c of clients) {
    if (c.lat == null || c.lng == null) continue;
    const dist = haversineMeters(coords, { lat: c.lat, lng: c.lng });
    if (dist < bestDist && dist <= maxMeters) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
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
  gps: GpsCoords | null; // from first photo with GPS
  address: string | null; // reverse-geocoded address (filled in by batchMatchPhotos)
  matchedClient: Client | null; // auto-matched by proximity
}

interface RawPhoto {
  attachment: Attachment;
  timestamp: Date;
  gps: GpsCoords | null;
}

/**
 * Group photos into segments based on timestamp gaps.
 */
export function segmentPhotosByTime(
  photos: RawPhoto[],
  gapMinutes = 30,
): PhotoSegment[] {
  if (photos.length === 0) return [];

  const sorted = [...photos].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const gapMs = gapMinutes * 60 * 1000;
  const segments: PhotoSegment[] = [];

  let current: RawPhoto[] = [sorted[0]];

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

function buildSegment(photos: RawPhoto[]): PhotoSegment {
  const startTime = photos[0].timestamp;
  const endTime = photos[photos.length - 1].timestamp;
  const d = startTime;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  // Use first GPS coordinate found in the segment
  const gps = photos.find((p) => p.gps)?.gps || null;
  return {
    attachments: photos.map((p) => p.attachment),
    startTime,
    endTime,
    date,
    gps,
    address: null, // filled in later by batchMatchPhotos
    matchedClient: null, // filled in later
  };
}

export interface BatchMatchResult {
  matched: PhotoMatchResult[];
  unmatchedSegments: PhotoSegment[];
}

/**
 * Process a batch of photo files: extract timestamps + GPS, resize,
 * match to recording events or group into segments.
 * Segments are reverse-geocoded and matched to clients by proximity.
 */
export async function batchMatchPhotos(
  files: FileList,
  events: AppEvent[],
  gapMinutes = 30,
  bufferMinutes = 15,
  clients: Client[] = [],
): Promise<BatchMatchResult> {
  const matched: Map<string, PhotoMatchResult> = new Map();
  const unmatchedRaw: RawPhoto[] = [];

  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) continue;

    const meta = await getPhotoMetadata(file);
    const dataUrl = await readFileAsDataUrl(file);
    const resized = await resizeImage(dataUrl, 1200);

    const attachment: Attachment = {
      id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      type: "photo",
      mimeType: file.type,
      dataUrl: resized,
      timestamp: meta.timestamp.toISOString(),
    };

    const match = matchPhotoToEvent(meta.timestamp, events, bufferMinutes);
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
      unmatchedRaw.push({ attachment, timestamp: meta.timestamp, gps: meta.gps });
    }
  }

  const segments = segmentPhotosByTime(unmatchedRaw, gapMinutes);

  // Reverse-geocode and match clients for each segment
  for (const seg of segments) {
    if (seg.gps) {
      // Reverse geocode for address label
      try {
        seg.address = await reverseGeocode(seg.gps);
      } catch {
        // skip — address stays null
      }
      // Match to closest client
      seg.matchedClient = findClosestClient(seg.gps, clients);
    }
  }

  return {
    matched: Array.from(matched.values()),
    unmatchedSegments: segments,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
