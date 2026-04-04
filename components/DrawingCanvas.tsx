"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ScratchpadStroke } from "@/lib/attachment-store";

interface DrawingCanvasProps {
  /** Background image (photo, PDF page render, or null for blank white) */
  backgroundSrc: string | null;
  /** Previously saved strokes to restore */
  initialStrokes: ScratchpadStroke[];
  /** Called whenever strokes change (for auto-save) */
  onStrokesChange: (strokes: ScratchpadStroke[], canvasDataUrl: string) => void;
}

const COLORS = [
  "#000000", "#EF4444", "#3B82F6", "#22C55E", "#F59E0B", "#8B5CF6", "#FFFFFF",
];
const WIDTHS = [2, 4, 8, 14];

export default function DrawingCanvas({
  backgroundSrc,
  initialStrokes,
  onStrokesChange,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState("#EF4444");
  const [lineWidth, setLineWidth] = useState(4);
  const [strokes, setStrokes] = useState<ScratchpadStroke[]>(initialStrokes);

  const isDrawing = useRef(false);
  const currentStroke = useRef<{ x: number; y: number }[]>([]);
  const bgImageLoaded = useRef(false);
  const onStrokesChangeRef = useRef(onStrokesChange);
  onStrokesChangeRef.current = onStrokesChange;

  // Canvas dimensions — match container
  const [dims, setDims] = useState({ w: 600, h: 800 });

  // Measure container on mount and resize
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = Math.max(w * 1.3, 500); // ~letter ratio, min 500px
      setDims({ w, h });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Load background image
  useEffect(() => {
    const bgCanvas = bgCanvasRef.current;
    if (!bgCanvas) return;
    const ctx = bgCanvas.getContext("2d");
    if (!ctx) return;

    bgCanvas.width = dims.w * (window.devicePixelRatio || 1);
    bgCanvas.height = dims.h * (window.devicePixelRatio || 1);
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);

    // White background
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, dims.w, dims.h);
    bgImageLoaded.current = false;

    if (backgroundSrc) {
      const img = new Image();
      img.onload = () => {
        // Fit image to canvas, centered
        const scale = Math.min(dims.w / img.width, dims.h / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        const ix = (dims.w - iw) / 2;
        const iy = (dims.h - ih) / 2;
        ctx.drawImage(img, ix, iy, iw, ih);
        bgImageLoaded.current = true;
        redrawStrokes(strokes);
      };
      img.src = backgroundSrc;
    } else {
      redrawStrokes(strokes);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backgroundSrc, dims]);

  // Set up drawing canvas dimensions
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.w * dpr;
    canvas.height = dims.h * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);
    redrawStrokes(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims]);

  // Replay strokes onto the drawing canvas
  const redrawStrokes = useCallback((stks: ScratchpadStroke[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (const stroke of stks) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.tool === "eraser" ? "rgba(0,0,0,0)" : stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }, []);

  // Re-render when strokes change (undo)
  useEffect(() => {
    redrawStrokes(strokes);
  }, [strokes, redrawStrokes]);

  // Get position relative to canvas
  const getPos = useCallback((e: React.TouchEvent | React.PointerEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ("touches" in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Only draw with pen or touch, not mouse hover
    e.preventDefault();
    isDrawing.current = true;
    currentStroke.current = [getPos(e)];

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.strokeStyle = tool === "eraser" ? "rgba(0,0,0,1)" : color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    const pos = getPos(e);
    ctx.moveTo(pos.x, pos.y);
  }, [tool, color, lineWidth, getPos]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const pos = getPos(e);
    currentStroke.current.push(pos);

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [getPos]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.globalCompositeOperation = "source-over";

    if (currentStroke.current.length >= 2) {
      const newStroke: ScratchpadStroke = {
        points: currentStroke.current,
        color,
        width: lineWidth,
        tool,
      };
      const updated = [...strokes, newStroke];
      setStrokes(updated);

      // Build composite for save
      const composite = buildComposite();
      onStrokesChangeRef.current(updated, composite);
    }
    currentStroke.current = [];
  }, [color, lineWidth, tool, strokes]);

  // Compose background + drawing into a single image
  const buildComposite = useCallback((): string => {
    const bg = bgCanvasRef.current;
    const fg = canvasRef.current;
    if (!bg || !fg) return "";
    const temp = document.createElement("canvas");
    temp.width = bg.width;
    temp.height = bg.height;
    const ctx = temp.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(bg, 0, 0);
    ctx.drawImage(fg, 0, 0);
    return temp.toDataURL("image/png");
  }, []);

  const handleUndo = useCallback(() => {
    if (strokes.length === 0) return;
    const updated = strokes.slice(0, -1);
    setStrokes(updated);
    const composite = buildComposite();
    // Need to redraw then composite after next render
    setTimeout(() => {
      const comp = buildComposite();
      onStrokesChangeRef.current(updated, comp);
    }, 50);
  }, [strokes, buildComposite]);

  const handleClear = useCallback(() => {
    setStrokes([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      if (ctx) ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    }
    setTimeout(() => {
      const comp = buildComposite();
      onStrokesChangeRef.current([], comp);
    }, 50);
  }, [buildComposite]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-border bg-gray-50 shrink-0 flex-wrap">
        {/* Pen / Eraser toggle */}
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setTool("pen")}
            className={`px-2.5 py-1.5 text-[10px] font-medium ${tool === "pen" ? "bg-accent text-white" : "text-muted hover:bg-gray-100"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            onClick={() => setTool("eraser")}
            className={`px-2.5 py-1.5 text-[10px] font-medium border-l border-border ${tool === "eraser" ? "bg-gray-700 text-white" : "text-muted hover:bg-gray-100"}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" /><path d="m5 11 9 9" />
            </svg>
          </button>
        </div>

        {/* Colors */}
        {tool === "pen" && (
          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-5 h-5 rounded-full border-2 ${color === c ? "border-accent scale-110" : "border-gray-300"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        )}

        {/* Line width */}
        <div className="flex items-center gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setLineWidth(w)}
              className={`w-6 h-6 rounded flex items-center justify-center ${lineWidth === w ? "bg-accent/10 ring-1 ring-accent" : "hover:bg-gray-100"}`}
            >
              <div
                className="rounded-full bg-current"
                style={{ width: Math.min(w + 1, 12), height: Math.min(w + 1, 12), color: tool === "pen" ? color : "#666" }}
              />
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Undo / Clear */}
        <button
          onClick={handleUndo}
          disabled={strokes.length === 0}
          className="text-[10px] px-2 py-1 rounded border border-border text-muted hover:bg-gray-100 active:scale-95 disabled:opacity-30"
        >
          Undo
        </button>
        <button
          onClick={handleClear}
          disabled={strokes.length === 0}
          className="text-[10px] px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 active:scale-95 disabled:opacity-30"
        >
          Clear
        </button>
      </div>

      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-200 relative">
        <div className="relative" style={{ width: dims.w, height: dims.h }}>
          {/* Background layer (white + optional image) */}
          <canvas
            ref={bgCanvasRef}
            style={{ width: dims.w, height: dims.h, position: "absolute", top: 0, left: 0 }}
          />
          {/* Drawing layer */}
          <canvas
            ref={canvasRef}
            style={{ width: dims.w, height: dims.h, position: "absolute", top: 0, left: 0, touchAction: "none" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
        </div>
      </div>
    </div>
  );
}
