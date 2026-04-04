"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Client, ClientStatus, CLIENT_STATUSES } from "@/lib/types";
import { loadClients, updateClient } from "@/lib/clients";
import { forwardGeocode } from "@/lib/photo-matcher";
import { getLastName } from "@/lib/utils";
import { STATUS_PIN_COLORS, DEFAULT_PIN_COLOR } from "@/lib/map-utils";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type SortMode = "alpha" | "status";

export default function MapPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [placingClientId, setPlacingClientId] = useState<string | null>(null);
  const [activeStatuses, setActiveStatuses] = useState<Set<ClientStatus>>(
    new Set(CLIENT_STATUSES.map((s) => s.key)),
  );
  const [sortMode, setSortMode] = useState<SortMode>("alpha");
  const [mounted, setMounted] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null);
  const geocodingRef = useRef(false);

  useEffect(() => {
    setClients(loadClients());
    setMounted(true);
  }, []);

  const needsGeocodingCount = useMemo(
    () => clients.filter((c) => c.address && c.lat == null && c.lng == null).length,
    [clients],
  );

  const handleGeocodeAll = useCallback(async () => {
    if (geocodingRef.current) return;
    geocodingRef.current = true;
    const toGeocode = clients.filter(
      (c) => c.address && c.lat == null && c.lng == null,
    );
    let success = 0;
    let fail = 0;

    for (let i = 0; i < toGeocode.length; i++) {
      const c = toGeocode[i];
      setGeocodeStatus(`Geocoding ${i + 1}/${toGeocode.length}: ${c.name}...`);
      try {
        const coords = await forwardGeocode(c.address!);
        if (coords) {
          updateClient(c.id, { lat: coords.lat, lng: coords.lng });
          success++;
        } else {
          fail++;
        }
      } catch {
        fail++;
      }
      // Rate limit: 1 req/sec
      if (i < toGeocode.length - 1) {
        await new Promise((r) => setTimeout(r, 1100));
      }
    }

    setClients(loadClients());
    setGeocodeStatus(`Done: ${success} geocoded, ${fail} failed`);
    setTimeout(() => setGeocodeStatus(null), 5000);
    geocodingRef.current = false;
  }, [clients]);

  const filteredClients = useMemo(
    () => clients.filter((c) => activeStatuses.has(c.status || "lead")),
    [clients, activeStatuses],
  );

  const sortedClients = useMemo(() => {
    const sorted = [...filteredClients];
    if (sortMode === "alpha") {
      sorted.sort((a, b) => getLastName(a.name).localeCompare(getLastName(b.name)));
    } else {
      const statusOrder = CLIENT_STATUSES.map((s) => s.key);
      sorted.sort((a, b) => {
        const ai = statusOrder.indexOf(a.status || "lead");
        const bi = statusOrder.indexOf(b.status || "lead");
        if (ai !== bi) return ai - bi;
        return getLastName(a.name).localeCompare(getLastName(b.name));
      });
    }
    return sorted;
  }, [filteredClients, sortMode]);

  const mappableClients = useMemo(
    () => filteredClients.filter((c) => c.lat != null && c.lng != null),
    [filteredClients],
  );

  const unmappedCount = useMemo(
    () => filteredClients.filter((c) => c.lat == null || c.lng == null).length,
    [filteredClients],
  );

  const toggleStatus = useCallback((status: ClientStatus) => {
    setActiveStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const handleSelectClient = useCallback((id: string | null) => {
    // Don't cancel placing mode on regular client clicks
    if (!placingClientId) {
      setSelectedClientId((prev) => (prev === id ? null : id));
    }
  }, [placingClientId]);

  // Start placing mode for a client without coordinates
  const handleStartPlacing = useCallback((clientId: string) => {
    setPlacingClientId(clientId);
    setSelectedClientId(clientId);
  }, []);

  // Place a client on the map, then auto-advance to next unmapped client
  const handlePlaceClient = useCallback((clientId: string, lat: number, lng: number) => {
    updateClient(clientId, { lat, lng });
    const refreshed = loadClients();
    setClients(refreshed);

    // Find next unmapped client and auto-advance
    const unmapped = refreshed.filter(
      (c) => c.id !== clientId && c.lat == null && c.lng == null,
    );
    if (unmapped.length > 0) {
      setPlacingClientId(unmapped[0].id);
      setSelectedClientId(unmapped[0].id);
    } else {
      setPlacingClientId(null);
    }
  }, []);

  // Cancel placing mode
  const handleCancelPlacing = useCallback(() => {
    setPlacingClientId(null);
  }, []);

  if (!mounted) return null;

  const placingClient = placingClientId ? clients.find((c) => c.id === placingClientId) : null;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* Header */}
      <header className="shrink-0 px-4 py-2 flex items-center justify-between border-b border-border bg-surface">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80">
            <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </div>
            <h1 className="text-base font-bold tracking-tight">Plaud</h1>
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">
            Dashboard
          </Link>
          <Link href="/board" className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:bg-gray-50 active:scale-95">
            Board
          </Link>
          <span className="text-sm font-semibold">Client Map</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {mappableClients.length} pin{mappableClients.length !== 1 ? "s" : ""}
            {unmappedCount > 0 && <span className="text-gray-400"> · {unmappedCount} unmapped</span>}
          </span>
        </div>
      </header>

      {/* Placing mode banner */}
      {placingClient && (
        <div className="shrink-0 px-4 py-2 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <div>
            <span className="text-xs text-blue-800 font-medium">
              Tap the map to place <strong>{placingClient.name}</strong>
            </span>
            {placingClient.address && (
              <span className="text-[10px] text-blue-600 ml-2">({placingClient.address})</span>
            )}
            {unmappedCount > 1 && (
              <span className="text-[10px] text-blue-500 ml-2">· {unmappedCount - 1} more after this</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Skip this client, advance to next unmapped
                const unmapped = clients.filter(
                  (c) => c.id !== placingClientId && c.lat == null && c.lng == null,
                );
                if (unmapped.length > 0) {
                  setPlacingClientId(unmapped[0].id);
                  setSelectedClientId(unmapped[0].id);
                } else {
                  setPlacingClientId(null);
                }
              }}
              className="text-[10px] px-2.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-100 active:scale-95 font-medium"
            >
              Skip
            </button>
            <button
              onClick={handleCancelPlacing}
              className="text-[10px] px-2.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-100 active:scale-95 font-medium"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col bg-surface overflow-hidden">
          {/* Status filter toggles */}
          <div className="shrink-0 p-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase text-muted tracking-wider">Filter by Status</span>
              <button
                onClick={() => {
                  const allActive = activeStatuses.size === CLIENT_STATUSES.length;
                  setActiveStatuses(allActive ? new Set() : new Set(CLIENT_STATUSES.map((s) => s.key)));
                }}
                className="text-[10px] text-accent hover:underline"
              >
                {activeStatuses.size === CLIENT_STATUSES.length ? "None" : "All"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CLIENT_STATUSES.map((s) => {
                const active = activeStatuses.has(s.key);
                const color = STATUS_PIN_COLORS[s.key] || DEFAULT_PIN_COLOR;
                return (
                  <button
                    key={s.key}
                    onClick={() => toggleStatus(s.key)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-all ${
                      active ? "border-current opacity-100" : "border-gray-200 opacity-40"
                    }`}
                    style={active ? { color, borderColor: color, backgroundColor: `${color}15` } : {}}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Sort toggle */}
          <div className="shrink-0 px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase text-muted tracking-wider">Sort:</span>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setSortMode("alpha")}
                className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                  sortMode === "alpha" ? "bg-accent text-white" : "text-muted hover:bg-gray-50"
                }`}
              >
                A–Z
              </button>
              <button
                onClick={() => setSortMode("status")}
                className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors border-l border-border ${
                  sortMode === "status" ? "bg-accent text-white" : "text-muted hover:bg-gray-50"
                }`}
              >
                Status
              </button>
            </div>
          </div>

          {/* Unmapped client actions */}
          {geocodeStatus ? (
            <div className="shrink-0 px-3 py-1.5 bg-amber-50 border-b border-amber-200 text-[10px] text-amber-700">
              {geocodeStatus}
            </div>
          ) : needsGeocodingCount > 0 && !placingClientId ? (
            <div className="shrink-0 px-3 py-1.5 border-b border-border flex items-center justify-between">
              <span className="text-[10px] text-muted">{needsGeocodingCount} unmapped</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() => {
                    const unmapped = clients.filter((c) => c.lat == null && c.lng == null);
                    if (unmapped.length > 0) {
                      setPlacingClientId(unmapped[0].id);
                      setSelectedClientId(unmapped[0].id);
                    }
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-500 text-white hover:bg-blue-600 active:scale-95 font-medium"
                >
                  Place All
                </button>
                <button
                  onClick={handleGeocodeAll}
                  className="text-[10px] px-2 py-0.5 rounded border border-gray-300 text-muted hover:bg-gray-50 active:scale-95 font-medium"
                >
                  Auto-Geocode
                </button>
              </div>
            </div>
          ) : null}

          {/* Client list */}
          <div className="flex-1 overflow-y-auto">
            {sortedClients.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-gray-300">
                {clients.length === 0 ? "No clients yet" : "No clients match filters"}
              </div>
            ) : (
              sortedClients.map((client) => {
                const color = STATUS_PIN_COLORS[client.status || "lead"] || DEFAULT_PIN_COLOR;
                const hasCoords = client.lat != null && client.lng != null;
                const isSelected = client.id === selectedClientId;
                const isPlacing = client.id === placingClientId;
                return (
                  <div
                    key={client.id}
                    className={`border-b border-gray-50 transition-colors ${
                      isSelected ? "bg-accent/10 border-l-2 border-l-accent" : ""
                    }`}
                  >
                    <button
                      onClick={() => handleSelectClient(client.id)}
                      className={`w-full text-left px-3 py-2 transition-colors ${
                        !isSelected ? "hover:bg-gray-50 active:bg-gray-100" : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{client.name}</div>
                          {client.company && (
                            <div className="text-[10px] text-gray-400 truncate">{client.company}</div>
                          )}
                        </div>
                        {hasCoords && isSelected && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateClient(client.id, { lat: undefined, lng: undefined });
                              setClients(loadClients());
                            }}
                            className="text-[8px] px-1.5 py-0.5 rounded border border-red-200 text-red-400 hover:bg-red-50 active:scale-95 font-medium shrink-0"
                            title="Remove pin"
                          >
                            Unpin
                          </button>
                        )}
                        {!hasCoords && !isPlacing && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartPlacing(client.id);
                            }}
                            className="text-[8px] px-1.5 py-0.5 rounded border border-blue-200 text-blue-500 hover:bg-blue-50 active:scale-95 font-medium shrink-0"
                          >
                            Place
                          </button>
                        )}
                        {isPlacing && (
                          <span className="text-[8px] text-blue-500 font-medium shrink-0 animate-pulse">
                            Tap map...
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          <MapView
            clients={mappableClients}
            selectedClientId={selectedClientId}
            onSelectClient={handleSelectClient}
            placingClientId={placingClientId}
            onPlaceClient={handlePlaceClient}
          />
        </div>
      </div>
    </div>
  );
}
