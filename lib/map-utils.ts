import type { ClientStatus } from "./types";

// Hex colors for map pins, matching the Tailwind status colors
export const STATUS_PIN_COLORS: Record<ClientStatus, string> = {
  lead: "#9CA3AF",
  propose: "#3B82F6",
  sent: "#8B5CF6",
  schedule: "#F59E0B",
  "project-management": "#06B6D4",
  collections: "#F97316",
  "paid-in-full": "#22C55E",
};

// Default color for clients with no status
export const DEFAULT_PIN_COLOR = "#9CA3AF";

/**
 * Generate an SVG pin as a data URL for use as a Leaflet icon.
 */
export function pinSvgDataUrl(color: string, selected: boolean): string {
  const size = selected ? 36 : 28;
  const stroke = selected ? 'stroke="white" stroke-width="2"' : 'stroke="#333" stroke-width="1"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" ${stroke}/>
    <circle cx="12" cy="12" r="5" fill="white" opacity="0.9"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Data model for future map region annotations.
 * Stored in localStorage key "plaud-map-regions".
 */
export interface MapRegion {
  id: string;
  name: string;
  color: string;
  coordinates: [number, number][]; // polygon vertices [lat, lng]
}

// NW Indiana center coordinates
export const NW_INDIANA_CENTER: [number, number] = [41.48, -87.35];
export const DEFAULT_ZOOM = 11;
