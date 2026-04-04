"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { forwardGeocode } from "@/lib/photo-matcher";

interface MapSearchOverlayProps {
  clientName: string;
  clientAddress: string;
  previewCoords: { lat: number; lng: number } | null;
  onCoordsFound: (coords: { lat: number; lng: number } | null) => void;
  onConfirm: () => void;
  onTapInstead: () => void;
}

export default function MapSearchOverlay({
  clientName,
  clientAddress,
  previewCoords,
  onCoordsFound,
  onConfirm,
  onTapInstead,
}: MapSearchOverlayProps) {
  const [query, setQuery] = useState(clientAddress);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSearchedRef = useRef(false);

  // Reset when client changes
  useEffect(() => {
    setQuery(clientAddress);
    setError(null);
    onCoordsFound(null);
    autoSearchedRef.current = false;
  }, [clientName, clientAddress, onCoordsFound]);

  // Auto-search if client has an address
  useEffect(() => {
    if (clientAddress && !autoSearchedRef.current) {
      autoSearchedRef.current = true;
      handleSearch(clientAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientAddress, clientName]);

  // Focus input
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [clientName]);

  const handleSearch = useCallback(
    async (searchQuery?: string) => {
      const q = (searchQuery || query).trim();
      if (!q) return;

      setSearching(true);
      setError(null);
      onCoordsFound(null);

      try {
        const coords = await forwardGeocode(q);
        if (coords) {
          onCoordsFound(coords);
          setError(null);
        } else {
          setError("No results found. Try a different search or tap the map.");
        }
      } catch {
        setError("Search failed. Try again or tap the map.");
      } finally {
        setSearching(false);
      }
    },
    [query, onCoordsFound],
  );

  return (
    <div className="absolute top-3 left-3 right-3 z-[1000] pointer-events-none">
      <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg border border-gray-200 pointer-events-auto">
        {/* Header */}
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="text-xs font-semibold text-gray-700">
            Search location for <span className="text-blue-600">{clientName}</span>
          </div>
        </div>

        {/* Search input */}
        <div className="p-3">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              placeholder="Enter address or location..."
              className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            <button
              onClick={() => handleSearch()}
              disabled={searching || !query.trim()}
              className="px-4 py-2 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              {searching ? (
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                "Search"
              )}
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-2 text-xs text-red-500">{error}</div>
          )}

          {/* Preview coords info + confirm */}
          {previewCoords && (
            <div className="mt-2 flex items-center justify-between">
              <div className="text-[11px] text-gray-500">
                <span className="font-mono">
                  {previewCoords.lat.toFixed(5)}, {previewCoords.lng.toFixed(5)}
                </span>
                <span className="text-gray-400 ml-1.5">Drag pin to adjust</span>
              </div>
              <button
                onClick={onConfirm}
                className="px-4 py-1.5 text-sm font-semibold bg-green-500 text-white rounded-lg hover:bg-green-600 active:scale-95"
              >
                Confirm
              </button>
            </div>
          )}

          {/* Tap-to-place fallback */}
          <div className="mt-2 flex items-center justify-between">
            <button
              onClick={onTapInstead}
              className="text-[11px] text-gray-400 hover:text-blue-500 underline"
            >
              Or tap the map to place manually
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
