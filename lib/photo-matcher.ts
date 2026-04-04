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
 * Supports JPEG (direct EXIF) and HEIC/HEIF (EXIF embedded in ISOBMFF).
 * Falls back to file.lastModified for timestamp.
 */
export async function getPhotoMetadata(file: File): Promise<PhotoMetadata> {
  try {
    const exif = await readExifData(file);
    if (exif.date || exif.gps) {
      return {
        timestamp: exif.date || new Date(file.lastModified),
        gps: exif.gps,
      };
    }
  } catch {
    // fall through
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

/**
 * Unified EXIF reader. Works for JPEG, HEIC, and any format that
 * contains a TIFF-structured EXIF block. Uses brute-force scan for
 * the "Exif\0\0" + TIFF header pattern anywhere in the first 512KB.
 * This handles JPEG APP1, HEIC ISOBMFF, and edge cases like
 * multiple APP1 markers or non-standard containers.
 */
async function readExifData(file: File): Promise<ExifData> {
  const buffer = await file.slice(0, 512 * 1024).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fullView = new DataView(buffer);

  // Strategy 1: Brute-force scan for "Exif\0\0" pattern
  // Works for JPEG, HEIC, and any container
  for (let i = 0; i < bytes.length - 20; i++) {
    if (bytes[i] === 0x45 && bytes[i + 1] === 0x78 &&
        bytes[i + 2] === 0x69 && bytes[i + 3] === 0x66 &&
        bytes[i + 4] === 0x00 && bytes[i + 5] === 0x00) {
      const result = parseTiffBlock(fullView, i + 6);
      if (result.date || result.gps) return result;
    }
  }

  // Strategy 2: For JPEG, try each APP1 marker properly
  // (some JPEGs skip the "Exif\0\0" header)
  if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let offset = 2;
    while (offset < bytes.length - 4) {
      const marker = fullView.getUint16(offset);
      if (marker === 0xFFE1) {
        const segLen = fullView.getUint16(offset + 2);
        const segStart = offset + 4;
        // Check if this APP1 has TIFF header directly (II or MM)
        if (segStart + 8 < bytes.length) {
          const bo = fullView.getUint16(segStart);
          if (bo === 0x4949 || bo === 0x4D4D) {
            const result = parseTiffBlock(fullView, segStart);
            if (result.date || result.gps) return result;
          }
          // Also try offset +6 (after "Exif\0\0" which we may have missed)
          if (segStart + 14 < bytes.length) {
            const bo2 = fullView.getUint16(segStart + 6);
            if (bo2 === 0x4949 || bo2 === 0x4D4D) {
              const result = parseTiffBlock(fullView, segStart + 6);
              if (result.date || result.gps) return result;
            }
          }
        }
        offset += 2 + segLen;
      } else if ((marker & 0xFF00) === 0xFF00) {
        const segLen = fullView.getUint16(offset + 2);
        offset += 2 + segLen;
      } else {
        break;
      }
    }
  }

  // Strategy 3: Brute-force scan for TIFF header ("II*\0" or "MM\0*")
  // Last resort — some files embed TIFF without "Exif" marker
  for (let i = 0; i < bytes.length - 20; i++) {
    const bo = fullView.getUint16(i);
    if (bo !== 0x4949 && bo !== 0x4D4D) continue;
    const le = bo === 0x4949;
    const magic = fullView.getUint16(i + 2, le);
    if (magic !== 42) continue;
    // Found a TIFF header — try parsing
    const result = parseTiffBlock(fullView, i);
    if (result.date || result.gps) return result;
  }

  return { date: null, gps: null };
}

/**
 * Parse a TIFF block starting at tiffStart in the DataView.
 * Returns date and GPS if found.
 */
function parseTiffBlock(view: DataView, tiffStart: number): ExifData {
  if (tiffStart + 8 > view.byteLength) return { date: null, gps: null };

  const byteOrder = view.getUint16(tiffStart);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4D4D) return { date: null, gps: null };
  const le = byteOrder === 0x4949;

  const magic = view.getUint16(tiffStart + 2, le);
  if (magic !== 42) return { date: null, gps: null };

  const ifdOffset = view.getUint32(tiffStart + 4, le);
  const ifd0Start = tiffStart + ifdOffset;
  if (ifd0Start + 2 > view.byteLength) return { date: null, gps: null };

  // Date from IFD0
  let date: Date | null = null;
  const dateStr = findDateInIFD(view, tiffStart, ifd0Start, le);
  if (dateStr) date = parseExifDateString(dateStr);

  // Date from Exif sub-IFD
  if (!date) {
    const exifIfdOff = findTagValue(view, tiffStart, ifd0Start, le, 0x8769);
    if (exifIfdOff !== null) {
      const dateStr2 = findDateInIFD(view, tiffStart, tiffStart + exifIfdOff, le);
      if (dateStr2) date = parseExifDateString(dateStr2);
    }
  }

  // GPS from GPS IFD
  let gps: GpsCoords | null = null;
  const gpsIfdOff = findTagValue(view, tiffStart, ifd0Start, le, 0x8825);
  if (gpsIfdOff !== null) {
    gps = readGpsFromIFD(view, tiffStart, tiffStart + gpsIfdOff, le);
  }

  return { date, gps };
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
  maxMeters = 2000,
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
 * Normalize an address string for fuzzy comparison.
 * Strips punctuation, lowercases, collapses whitespace, expands common abbreviations.
 */
function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase().trim();
  // Remove punctuation first, collapse whitespace
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  // Expand common street-type abbreviations (applied after punctuation removal)
  const abbrevs: [RegExp, string][] = [
    [/\bstreet\b/g, "st"], // normalize to short form
    [/\bavenue\b/g, "ave"],
    [/\bboulevard\b/g, "blvd"],
    [/\bdrive\b/g, "dr"],
    [/\blane\b/g, "ln"],
    [/\broad\b/g, "rd"],
    [/\bcourt\b/g, "ct"],
    [/\bplace\b/g, "pl"],
    [/\bparkway\b/g, "pkwy"],
    [/\bcircle\b/g, "cir"],
    [/\bnorth\b/g, "n"],
    [/\bsouth\b/g, "s"],
    [/\beast\b/g, "e"],
    [/\bwest\b/g, "w"],
  ];
  for (const [pat, rep] of abbrevs) {
    s = s.replace(pat, rep);
  }
  return s.trim();
}

/**
 * Compute similarity between two addresses using multiple strategies:
 * 1. Token overlap (Jaccard on smaller set)
 * 2. Substring containment (one address contains the other's street)
 * Returns the highest score (0-1).
 */
export function addressSimilarity(a: string, b: string): number {
  const normA = normalizeAddress(a);
  const normB = normalizeAddress(b);
  const tokensA = new Set(normA.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(normB.split(" ").filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  // Token overlap score
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const minSize = Math.min(tokensA.size, tokensB.size);
  const tokenScore = intersection / minSize;

  // Substring containment: check if one normalized address contains the other
  let substringScore = 0;
  if (normA.includes(normB) || normB.includes(normA)) {
    substringScore = 0.8;
  }

  // Check if the street number + name match (first 2-3 tokens)
  const wordsA = normA.split(" ").filter((t) => t.length > 1);
  const wordsB = normB.split(" ").filter((t) => t.length > 1);
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    // If first token is a number and matches, and second token matches, strong signal
    if (/^\d+$/.test(wordsA[0]) && wordsA[0] === wordsB[0] && wordsA[1] === wordsB[1]) {
      substringScore = Math.max(substringScore, 0.7);
    }
  }

  return Math.max(tokenScore, substringScore);
}

/**
 * Match a reverse-geocoded photo address to a client's address using text similarity.
 * Returns the best-matching client if similarity exceeds threshold.
 */
export function findClientByAddress(
  photoAddress: string,
  clients: Client[],
  threshold = 0.4,
): Client | null {
  let best: Client | null = null;
  let bestScore = 0;
  for (const c of clients) {
    if (!c.address) continue;
    const score = addressSimilarity(photoAddress, c.address);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
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
  diagnostics: {
    fileTypes: Record<string, number>;
    gpsFound: number;
    gpsTotal: number;
    clientsWithCoords: number;
    clientsTotal: number;
    matchDetails: { segmentLabel: string; closestClient: string | null; distanceMeters: number | null }[];
  };
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
  const fileTypes: Record<string, number> = {};
  let gpsFound = 0;
  let gpsTotal = 0;

  const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
  gpsTotal = imageFiles.length;
  for (const f of imageFiles) {
    fileTypes[f.type] = (fileTypes[f.type] || 0) + 1;
  }

  // Process all photos in parallel (EXIF + resize)
  const processed = await Promise.all(
    imageFiles.map(async (file) => {
      const [meta, dataUrl] = await Promise.all([
        getPhotoMetadata(file),
        readFileAsDataUrl(file),
      ]);
      const resized = await resizeImage(dataUrl, 1200);
      return { file, meta, resized };
    }),
  );

  for (const { file, meta, resized } of processed) {
    if (meta.gps) gpsFound++;

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

  const clientsWithCoords = clients.filter((c) => c.lat != null && c.lng != null).length;
  const matchDetails: { segmentLabel: string; closestClient: string | null; distanceMeters: number | null }[] = [];

  // Reverse-geocode segments sequentially (Nominatim 1 req/sec rate limit)
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (!seg.gps) {
      matchDetails.push({ segmentLabel: "No GPS", closestClient: null, distanceMeters: null });
      continue;
    }

    // Rate-limit: wait 1.1s between geocode calls (skip first)
    if (si > 0) await new Promise((r) => setTimeout(r, 1100));

    try {
      seg.address = await reverseGeocode(seg.gps);
    } catch (err) {
      console.warn("[photo-matcher] reverseGeocode failed:", err);
    }

    console.log(`[photo-matcher] Segment ${si}: GPS=${seg.gps.lat.toFixed(5)},${seg.gps.lng.toFixed(5)} → address="${seg.address}"`);

    // Strategy 1: GPS coordinate matching (if clients have coordinates)
    seg.matchedClient = findClosestClient(seg.gps, clients);

    // Strategy 2: Text-based address matching (fallback when clients lack coordinates)
    if (!seg.matchedClient && seg.address) {
      seg.matchedClient = findClientByAddress(seg.address, clients);
      if (seg.matchedClient) {
        console.log(`[photo-matcher] Address match: "${seg.address}" → client "${seg.matchedClient.name}" (address: "${seg.matchedClient.address}")`);
      } else {
        // Log why no match was found
        for (const c of clients) {
          if (c.address) {
            const score = addressSimilarity(seg.address, c.address);
            console.log(`[photo-matcher] Address compare: photo="${seg.address}" vs client "${c.name}" addr="${c.address}" → score=${score.toFixed(2)}`);
          }
        }
      }
    }

    // Diagnostics
    let closestName: string | null = null;
    let closestDist: number | null = null;
    for (const c of clients) {
      if (c.lat == null || c.lng == null) continue;
      const d = haversineMeters(seg.gps, { lat: c.lat, lng: c.lng });
      if (closestDist === null || d < closestDist) {
        closestDist = d;
        closestName = c.name;
      }
    }
    if (!closestName && seg.matchedClient) {
      closestName = seg.matchedClient.name + " (address match)";
    }
    matchDetails.push({
      segmentLabel: seg.address || `${seg.gps.lat.toFixed(4)}, ${seg.gps.lng.toFixed(4)}`,
      closestClient: closestName,
      distanceMeters: closestDist !== null ? Math.round(closestDist) : null,
    });
  }

  return {
    matched: Array.from(matched.values()),
    unmatchedSegments: segments,
    diagnostics: { fileTypes, gpsFound, gpsTotal, clientsWithCoords, clientsTotal: clients.length, matchDetails },
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
