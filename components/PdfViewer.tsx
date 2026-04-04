"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PdfViewerProps {
  /** Blob URL or data URL pointing to a PDF */
  src: string;
  /** Max width for rendering pages (default: container width) */
  maxWidth?: number;
}

/**
 * Renders all pages of a PDF using pdf.js canvas rendering.
 * Works on iOS Safari (which can't scroll PDFs in iframes).
 * Pages are rendered lazily as they scroll into view.
 */
export default function PdfViewer({ src, maxWidth }: PdfViewerProps) {
  const [pageCount, setPageCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedPages = useRef<Set<number>>(new Set());

  // Load the PDF document
  useEffect(() => {
    let cancelled = false;
    renderedPages.current.clear();

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const pdfjsLib = await import("pdfjs-dist");

        // Set up worker — use bundled worker
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.min.mjs",
            import.meta.url,
          ).toString();
        }

        const loadingTask = pdfjsLib.getDocument(src);
        const pdf = await loadingTask.promise;

        if (cancelled) return;
        pdfDocRef.current = pdf;
        setPageCount(pdf.numPages);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [src]);

  // Render a single page into its canvas
  const renderPage = useCallback(async (pageNum: number) => {
    const pdf = pdfDocRef.current;
    if (!pdf || renderedPages.current.has(pageNum)) return;
    renderedPages.current.add(pageNum);

    try {
      const page = await pdf.getPage(pageNum);
      const canvas = document.getElementById(`pdf-page-${pageNum}`) as HTMLCanvasElement | null;
      if (!canvas) return;

      const containerWidth = maxWidth || containerRef.current?.clientWidth || 600;
      const unscaledViewport = page.getViewport({ scale: 1 });
      const scale = (containerWidth / unscaledViewport.width) * (window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / (window.devicePixelRatio || 1)}px`;
      canvas.style.height = `${viewport.height / (window.devicePixelRatio || 1)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch {
      // Silently fail for individual pages
    }
  }, [maxWidth]);

  // Render visible pages using IntersectionObserver
  useEffect(() => {
    if (pageCount === 0) return;

    // Render first 2 pages immediately
    for (let i = 1; i <= Math.min(2, pageCount); i++) {
      renderPage(i);
    }

    // Lazy-render the rest as they scroll into view
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.getAttribute("data-page") || "0");
            if (pageNum > 0) renderPage(pageNum);
          }
        }
      },
      { root: containerRef.current?.parentElement, rootMargin: "200px" },
    );

    const canvases = containerRef.current?.querySelectorAll("canvas[data-page]");
    canvases?.forEach((c) => observer.observe(c));

    return () => observer.disconnect();
  }, [pageCount, renderPage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-muted">
        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-accent rounded-full animate-spin mr-2" />
        Loading PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-xs text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-2 py-2">
      {Array.from({ length: pageCount }, (_, i) => (
        <canvas
          key={i + 1}
          id={`pdf-page-${i + 1}`}
          data-page={i + 1}
          className="shadow-sm rounded bg-white max-w-full"
        />
      ))}
      {pageCount > 0 && (
        <div className="text-[10px] text-muted py-1">
          {pageCount} page{pageCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
