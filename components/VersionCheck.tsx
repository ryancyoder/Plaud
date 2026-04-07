"use client";

import { useEffect } from "react";

const CURRENT_VERSION = "2026-04-07T010";
const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

export default function VersionCheck() {
  useEffect(() => {
    async function check() {
      try {
        // Use relative URL to respect any basePath (e.g., /Plaud on GitHub Pages)
        const base = document.querySelector("base")?.href || window.location.origin + "/";
        const url = new URL("version.json?t=" + Date.now(), base);
        const res = await fetch(url.toString(), {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.v && data.v !== CURRENT_VERSION) {
          // New version available — reload
          window.location.reload();
        }
      } catch {
        // offline or fetch failed — ignore
      }
    }

    // Check on mount (slight delay to avoid blocking initial render)
    const initialTimeout = setTimeout(check, 3000);
    // Check periodically
    const interval = setInterval(check, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return null;
}
