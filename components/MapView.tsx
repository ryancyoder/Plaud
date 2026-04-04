"use client";

import { useEffect, useRef, useMemo, useCallback } from "react";
import { Client, CLIENT_STATUSES } from "@/lib/types";
import {
  STATUS_PIN_COLORS,
  DEFAULT_PIN_COLOR,
  pinSvgDataUrl,
  NW_INDIANA_CENTER,
  DEFAULT_ZOOM,
} from "@/lib/map-utils";

interface MapViewProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (id: string | null) => void;
  placingClientId: string | null;
  onPlaceClient: (clientId: string, lat: number, lng: number) => void;
  previewCoords: { lat: number; lng: number } | null;
  onPreviewCoordsChange: (coords: { lat: number; lng: number } | null) => void;
}

export default function MapView({
  clients,
  selectedClientId,
  onSelectClient,
  placingClientId,
  onPlaceClient,
  previewCoords,
  onPreviewCoordsChange,
}: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const placingRef = useRef<string | null>(null);
  const previewMarkerRef = useRef<L.Marker | null>(null);
  const onPlaceRef = useRef(onPlaceClient);
  onPlaceRef.current = onPlaceClient;
  const onPreviewCoordsChangeRef = useRef(onPreviewCoordsChange);
  onPreviewCoordsChangeRef.current = onPreviewCoordsChange;

  // Keep placing ref in sync
  useEffect(() => {
    placingRef.current = placingClientId;
  }, [placingClientId]);

  // Clients with coordinates
  const mappableClients = useMemo(
    () => clients.filter((c) => c.lat != null && c.lng != null),
    [clients],
  );

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled) return;
      leafletRef.current = L;

      // Leaflet CSS
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      const map = L.map(mapContainerRef.current!, {
        center: NW_INDIANA_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Click to place a client pin
      map.on("click", (e: L.LeafletMouseEvent) => {
        if (placingRef.current) {
          onPlaceRef.current(placingRef.current, e.latlng.lat, e.latlng.lng);
        }
      });

      mapRef.current = map;

      // Add initial markers
      addMarkers(L, map, mappableClients, selectedClientId, onSelectClient);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when clients or selection changes
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;

    // Clear old markers
    for (const marker of markersRef.current.values()) {
      marker.remove();
    }
    markersRef.current.clear();

    addMarkers(L, map, mappableClients, selectedClientId, onSelectClient);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappableClients, selectedClientId]);

  // Fly to selected client
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedClientId) return;

    const client = mappableClients.find((c) => c.id === selectedClientId);
    if (client && client.lat != null && client.lng != null) {
      map.flyTo([client.lat, client.lng], 15, { duration: 0.8 });
      const marker = markersRef.current.get(client.id);
      if (marker) marker.openPopup();
    }
  }, [selectedClientId, mappableClients]);

  // Change cursor when in placing mode
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;
    container.style.cursor = placingClientId ? "crosshair" : "";
  }, [placingClientId]);

  // Manage preview marker (draggable)
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;

    // Remove old preview marker
    if (previewMarkerRef.current) {
      previewMarkerRef.current.remove();
      previewMarkerRef.current = null;
    }

    if (!L || !map || !previewCoords) return;

    const icon = L.icon({
      iconUrl: pinSvgDataUrl("#3B82F6", true),
      iconSize: [36, 47],
      iconAnchor: [18, 47],
      popupAnchor: [0, -36],
    });

    const marker = L.marker([previewCoords.lat, previewCoords.lng], {
      icon,
      draggable: true,
      zIndexOffset: 1000,
    })
      .bindTooltip("Drag to adjust", { direction: "top", offset: [0, -47], permanent: true })
      .addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onPreviewCoordsChangeRef.current({ lat: pos.lat, lng: pos.lng });
    });

    previewMarkerRef.current = marker;
    map.flyTo([previewCoords.lat, previewCoords.lng], 15, { duration: 0.8 });

    return () => {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
    };
  }, [previewCoords]);

  function addMarkers(
    L: typeof import("leaflet"),
    map: L.Map,
    clients: Client[],
    selectedId: string | null,
    onSelect: (id: string | null) => void,
  ) {
    for (const client of clients) {
      if (client.lat == null || client.lng == null) continue;

      const color = STATUS_PIN_COLORS[client.status || "lead"] || DEFAULT_PIN_COLOR;
      const isSelected = client.id === selectedId;
      const iconSize = isSelected ? 36 : 28;

      const icon = L.icon({
        iconUrl: pinSvgDataUrl(color, isSelected),
        iconSize: [iconSize, iconSize * 1.3],
        iconAnchor: [iconSize / 2, iconSize * 1.3],
        popupAnchor: [0, -iconSize],
      });

      const statusInfo = CLIENT_STATUSES.find((s) => s.key === client.status);

      const marker = L.marker([client.lat, client.lng], { icon })
        .bindPopup(
          `<div style="min-width:140px">
            <strong style="font-size:13px">${escapeHtml(client.name)}</strong>
            ${client.company ? `<br><span style="font-size:11px;color:#666">${escapeHtml(client.company)}</span>` : ""}
            ${statusInfo ? `<br><span style="display:inline-block;margin-top:4px;padding:1px 8px;border-radius:9px;font-size:10px;font-weight:600;background:${color}20;color:${color}">${statusInfo.label}</span>` : ""}
            ${client.address ? `<br><span style="font-size:10px;color:#888;margin-top:4px;display:block">${escapeHtml(client.address)}</span>` : ""}
          </div>`,
          { closeButton: false },
        )
        .bindTooltip(client.name, { direction: "top", offset: [0, -iconSize] })
        .on("click", () => onSelect(client.id))
        .addTo(map);

      markersRef.current.set(client.id, marker);
    }
  }

  return (
    <div ref={mapContainerRef} className="w-full h-full" style={{ minHeight: "100%" }} />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
