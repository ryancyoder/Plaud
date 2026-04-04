"use client";

/**
 * photo-matcher.ts — Photo import, EXIF extraction, and client matching.
 *
 * This module handles the full photo-import pipeline:
 *
 *   1. EXIF parsing  — Extract timestamp + GPS from JPEG/HEIC photos
 *   2. Geocoding     — Reverse-geocode GPS coords to street addresses
 *   3. Client match  — Match photos to clients using a two-tier strategy:
 *        Tier 1: GPS proximity (photo GPS ↔ client pin, ≤200m = high confidence)
 *        Tier 2: Address text similarity (reverse-geocoded address ↔ client address)
 *   4. Event match   — Match photos to recording events by timestamp overlap
 *   5. Segmentation  — Group unmatched photos by timestamp gaps into segments
 *
 * Client matching priority:
 *   - GPS proximity is always preferred (fast, reliable, no network needed).
 *   - Address matching is a fallback for clients without map pins.
 *   - A match requires confidence above threshold (GPS ≤200m, or address score ≥0.5).
 */

import { AppEvent, Attachment, Client } from "./types";
import { resizeImage } from "./attachment-store";

// ─── GPS / Geocoding types ──────────────────────────────────────────

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

// ─── Geocoding ──────────────────────────────────────────────────────
// All geocoding uses free, no-API-key providers. Reverse geocoding is
// used during photo import; forward geocoding is used by the map search.
// Results are cached in-memory to avoid redundant network requests.

const geocodeCache = new Map<string, string>();

/**
 * Reverse-geocode GPS coordinates to a short address string.
 * Returns "123 Main St, City" format. Cached per coordinate (5-decimal precision).
 * Uses OpenStreetMap Nominatim (1 req/sec rate limit enforced by caller).
 */
export async function reverseGeocode(coords: GpsCoords): Promise<string | null> {
  const key = `${coords.lat.toFixed(5)},${coords.lng.toFixed(5)}`;
  if (geocodeCache.has(key)) return geocodeCache.get(key)!;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=18&addressdetails=1`;
    const resp = await fetch(url);
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
 * Tries three free providers in order (geocode.maps.co → photon → nominatim).
 * Returns null if all providers fail or return no results.
 * Used by the map search overlay for placing client pins.
 */
export async function forwardGeocode(address: string): Promise<GpsCoords | null> {
  if (!address.trim()) return null;

  // Strategy 1: geocode.maps.co (free, CORS-friendly)
  try {
    const url1 = `https://geocode.maps.co/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const resp1 = await fetch(url1);
    if (resp1.ok) {
      const results = await resp1.json();
      if (results.length > 0) {
        console.log(`[forwardGeocode] maps.co success for "${address}"`);
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon || results[0].lng) };
      }
    } else {
      console.warn(`[forwardGeocode] maps.co HTTP ${resp1.status}`);
    }
  } catch (err) {
    console.warn(`[forwardGeocode] maps.co error:`, err);
  }

  // Strategy 2: photon.komoot.io (OSM-based, free, no key)
  try {
    const url2 = `https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`;
    const resp2 = await fetch(url2);
    if (resp2.ok) {
      const data = await resp2.json();
      if (data.features?.length > 0) {
        const [lng, lat] = data.features[0].geometry.coordinates;
        console.log(`[forwardGeocode] photon success for "${address}"`);
        return { lat, lng };
      }
    } else {
      console.warn(`[forwardGeocode] photon HTTP ${resp2.status}`);
    }
  } catch (err) {
    console.warn(`[forwardGeocode] photon error:`, err);
  }

  // Strategy 3: Nominatim (last resort)
  try {
    const url3 = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const resp3 = await fetch(url3);
    if (resp3.ok) {
      const results = await resp3.json();
      if (results.length > 0) {
        console.log(`[forwardGeocode] nominatim success for "${address}"`);
        return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
      }
    } else {
      console.warn(`[forwardGeocode] nominatim HTTP ${resp3.status}`);
    }
  } catch (err) {
    console.warn(`[forwardGeocode] nominatim error:`, err);
  }

  console.warn(`[forwardGeocode] All providers failed for "${address}"`);
  return null;
}

// ─── Distance / Client matching ─────────────────────────────────────
//
// Match confidence tiers:
//   HIGH   — GPS within 200m of client pin (almost certainly the right property)
//   MEDIUM — GPS within 500m (likely correct, but could be a neighbor)
//   LOW    — Address text similarity ≥0.5 (best-effort when GPS matching fails)
//
// The default GPS radius is 200m. For roofing jobs this covers the property
// and accounts for typical phone GPS drift (~5-30m). If a client's pin is
// placed at the correct property, 200m provides very high accuracy without
// false-matching nearby clients.

/** Maximum GPS distance (meters) for auto-matching photos to clients. */
export const GPS_MATCH_RADIUS_M = 200;

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
 * Find the closest client to a GPS coordinate within the match radius.
 *
 * Only considers clients that have lat/lng set (i.e., pinned on the map).
 * Default radius is 200m — tight enough to avoid false positives between
 * neighboring properties, loose enough to handle GPS drift.
 *
 * @param coords  - Photo's GPS coordinates
 * @param clients - All clients (those without lat/lng are skipped)
 * @param maxMeters - Match radius in meters (default: GPS_MATCH_RADIUS_M)
 * @returns The closest client within radius, or null
 */
export function findClosestClient(
  coords: GpsCoords,
  clients: Client[],
  maxMeters = GPS_MATCH_RADIUS_M,
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

// ─── Address normalization & similarity ─────────────────────────────
// Used as a fallback when GPS proximity matching isn't possible
// (e.g., client has no map pin, or photo has no GPS).

/** Minimum address similarity score (0-1) to consider a match. */
export const ADDRESS_MATCH_THRESHOLD = 0.5;

/**
 * Normalize an address for comparison.
 * - Lowercases, strips punctuation, collapses whitespace
 * - Converts long forms to short: "Street" → "st", "North" → "n", etc.
 * - This ensures "123 North Main Street" matches "123 N Main St"
 */
function normalizeAddress(addr: string): string {
  let s = addr.toLowerCase().trim();
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // Normalize long forms → short forms (canonical direction)
  const abbrevs: [RegExp, string][] = [
    [/\bstreet\b/g, "st"],
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
 * Score how similar two address strings are (0 = no match, 1 = identical).
 *
 * Uses three strategies and returns the highest score:
 *   1. **Street number + name** — If both start with a house number and the
 *      number + first street word match, score 0.85. This is the strongest
 *      signal: "123 Main St, Gary" vs "123 Main Street" should match.
 *   2. **Token overlap** — Jaccard similarity over the smaller token set.
 *      Filters single-character tokens to avoid noise from directional
 *      abbreviations (N/S/E/W) inflating scores.
 *   3. **Substring containment** — If one normalized address fully contains
 *      the other, score 0.8.
 */
export function addressSimilarity(a: string, b: string): number {
  const normA = normalizeAddress(a);
  const normB = normalizeAddress(b);

  // Tokens for comparison — filter out single-char tokens (directional abbrevs)
  // to avoid "n" matching "s" inflating scores
  const tokensA = new Set(normA.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(normB.split(" ").filter((t) => t.length > 1));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  // Strategy 1: Street number + name match (strongest signal)
  const wordsA = normA.split(" ").filter((t) => t.length > 1);
  const wordsB = normB.split(" ").filter((t) => t.length > 1);
  let streetScore = 0;
  if (wordsA.length >= 2 && wordsB.length >= 2) {
    if (/^\d+$/.test(wordsA[0]) && wordsA[0] === wordsB[0] && wordsA[1] === wordsB[1]) {
      streetScore = 0.85;
    }
  }

  // Strategy 2: Token overlap (Jaccard on smaller set)
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const tokenScore = intersection / Math.min(tokensA.size, tokensB.size);

  // Strategy 3: Substring containment
  const substringScore = (normA.includes(normB) || normB.includes(normA)) ? 0.8 : 0;

  return Math.max(streetScore, tokenScore, substringScore);
}

/**
 * Find the best client match for a reverse-geocoded photo address.
 *
 * Compares the photo's address against all clients' address fields using
 * text similarity. Only returns a match above ADDRESS_MATCH_THRESHOLD (0.5).
 *
 * This is the Tier 2 fallback — used only when GPS proximity matching fails
 * (client has no map pin, or distance exceeds GPS_MATCH_RADIUS_M).
 *
 * @param photoAddress - Reverse-geocoded address from the photo's GPS
 * @param clients      - All clients to compare against
 * @param threshold    - Minimum similarity score (default: ADDRESS_MATCH_THRESHOLD)
 * @returns Best-matching client, or null if no match meets threshold
 */
export function findClientByAddress(
  photoAddress: string,
  clients: Client[],
  threshold = ADDRESS_MATCH_THRESHOLD,
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

// ─── Photo segmentation ─────────────────────────────────────────────
// Photos are grouped into "segments" — contiguous batches taken within
// a time gap of each other. Each segment represents one visit/stop.

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
 * Photos taken within `gapMinutes` of each other form one segment.
 * Each segment is reverse-geocoded and matched to a client.
 */
export interface PhotoSegment {
  attachments: Attachment[];
  startTime: Date;
  endTime: Date;
  date: string;                  // YYYY-MM-DD
  gps: GpsCoords | null;        // From first photo with GPS in the segment
  address: string | null;        // Reverse-geocoded address (filled by batchMatchPhotos)
  matchedClient: Client | null;  // Auto-matched client (filled by batchMatchPhotos)
}

interface RawPhoto {
  attachment: Attachment;
  timestamp: Date;
  gps: GpsCoords | null;
}

/**
 * Group raw photos into time-based segments.
 * A new segment starts when the gap between consecutive photos exceeds gapMinutes.
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

// ─── Batch processing pipeline ──────────────────────────────────────

export interface BatchMatchResult {
  matched: PhotoMatchResult[];
  unmatchedSegments: PhotoSegment[];
  diagnostics: {
    fileTypes: Record<string, number>;
    gpsFound: number;
    gpsTotal: number;
    clientsWithCoords: number;
    clientsTotal: number;
    matchDetails: SegmentDiagnostic[];
  };
}

interface SegmentDiagnostic {
  segmentLabel: string;
  closestClient: string | null;
  distanceMeters: number | null;
  matchMethod: "gps" | "address" | null;
}

/**
 * Full photo-import pipeline.
 *
 * 1. Read EXIF + resize all photos in parallel
 * 2. Match each photo to a recording event by timestamp (±bufferMinutes)
 * 3. Group unmatched photos into time-based segments
 * 4. For each segment with GPS:
 *    a. Reverse-geocode to get an address (for event naming)
 *    b. Try GPS proximity match against pinned clients (Tier 1)
 *    c. Fall back to address text similarity match (Tier 2)
 *
 * @param files         - FileList from an <input type="file"> element
 * @param events        - Existing recording events to match against
 * @param gapMinutes    - Max gap between photos in the same segment (default 30)
 * @param bufferMinutes - Time window around events for timestamp matching (default 15)
 * @param clients       - Clients to match segments against by location
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

  const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
  for (const f of imageFiles) {
    fileTypes[f.type] = (fileTypes[f.type] || 0) + 1;
  }

  // Step 1: Extract EXIF + resize all photos in parallel
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

  // Step 2: Match photos to recording events by timestamp
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

  // Step 3: Group unmatched photos into time-based segments
  const segments = segmentPhotosByTime(unmatchedRaw, gapMinutes);

  const clientsWithCoords = clients.filter((c) => c.lat != null && c.lng != null).length;
  const matchDetails: SegmentDiagnostic[] = [];

  // Step 4: Reverse-geocode + client-match each segment
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    if (!seg.gps) {
      matchDetails.push({ segmentLabel: "No GPS", closestClient: null, distanceMeters: null, matchMethod: null });
      continue;
    }

    // Rate-limit reverse geocoding: 1.1s between calls (Nominatim policy)
    if (si > 0) await new Promise((r) => setTimeout(r, 1100));

    try {
      seg.address = await reverseGeocode(seg.gps);
    } catch {
      // Non-critical: address is nice-to-have for event naming
    }

    // Tier 1: GPS proximity match (preferred — fast, accurate, no network)
    seg.matchedClient = findClosestClient(seg.gps, clients);
    let matchMethod: "gps" | "address" | null = seg.matchedClient ? "gps" : null;

    // Tier 2: Address text similarity (fallback for clients without map pins)
    if (!seg.matchedClient && seg.address) {
      seg.matchedClient = findClientByAddress(seg.address, clients);
      if (seg.matchedClient) matchMethod = "address";
    }

    // Build diagnostics — find closest pinned client for context
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
      closestName = seg.matchedClient.name + " (address)";
    }
    matchDetails.push({
      segmentLabel: seg.address || `${seg.gps.lat.toFixed(4)}, ${seg.gps.lng.toFixed(4)}`,
      closestClient: closestName,
      distanceMeters: closestDist !== null ? Math.round(closestDist) : null,
      matchMethod,
    });
  }

  return {
    matched: Array.from(matched.values()),
    unmatchedSegments: segments,
    diagnostics: {
      fileTypes,
      gpsFound,
      gpsTotal: imageFiles.length,
      clientsWithCoords,
      clientsTotal: clients.length,
      matchDetails,
    },
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
