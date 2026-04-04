"use client";

import { useEffect, useCallback } from "react";

export default function NavButtons() {
  const goBack = useCallback(() => window.history.back(), []);
  const goForward = useCallback(() => window.history.forward(), []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return;
      // Don't intercept when typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goBack, goForward]);

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={goBack}
        className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
        title="Back (Cmd+Left)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        onClick={goForward}
        className="p-1.5 rounded-lg text-muted hover:bg-gray-100 active:scale-95"
        title="Forward (Cmd+Right)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </button>
    </div>
  );
}
