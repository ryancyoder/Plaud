"use client";

import { Attachment } from "./types";

const DB_NAME = "plaud-attachments";
const DB_VERSION = 3;
const STORE_NAME = "attachments";
const PENDING_STORE = "pending-photos";
const SCRATCHPAD_STORE = "scratchpads";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(SCRATCHPAD_STORE)) {
        db.createObjectStore(SCRATCHPAD_STORE, { keyPath: "clientId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

interface StoredAttachment extends Attachment {
  transcriptId: string;
}

export async function saveAttachment(transcriptId: string, attachment: Attachment): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ ...attachment, transcriptId } as StoredAttachment);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAttachments(transcriptId: string, attachments: Attachment[]): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const att of attachments) {
      store.put({ ...att, transcriptId } as StoredAttachment);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAttachments(transcriptId: string): Promise<Attachment[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result as StoredAttachment[];
      const filtered = all
        .filter((a) => a.transcriptId === transcriptId)
        .map(({ transcriptId: _, ...rest }) => rest as Attachment);
      resolve(filtered);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function loadAllAttachments(): Promise<Record<string, Attachment[]>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const all = request.result as StoredAttachment[];
      const grouped: Record<string, Attachment[]> = {};
      for (const { transcriptId, ...att } of all) {
        if (!grouped[transcriptId]) grouped[transcriptId] = [];
        grouped[transcriptId].push(att as Attachment);
      }
      resolve(grouped);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function removeAttachment(attachmentId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(attachmentId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function removeAttachmentsForTranscript(transcriptId: string): Promise<void> {
  const attachments = await loadAttachments(transcriptId);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const att of attachments) {
      store.delete(att.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllAttachments(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Pending (unmatched) photos ---

export interface PendingPhoto extends Attachment {
  // timestamp is already on Attachment but is required here
  timestamp: string; // ISO date-time string, always set
}

export async function savePendingPhotos(photos: PendingPhoto[]): Promise<void> {
  if (photos.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readwrite");
    const store = tx.objectStore(PENDING_STORE);
    for (const p of photos) {
      store.put(p);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadPendingPhotos(): Promise<PendingPhoto[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readonly");
    const store = tx.objectStore(PENDING_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as PendingPhoto[]);
    request.onerror = () => reject(request.error);
  });
}

export async function removePendingPhotos(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readwrite");
    const store = tx.objectStore(PENDING_STORE);
    for (const id of ids) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPendingPhotos(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readwrite");
    const store = tx.objectStore(PENDING_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Resize an image to max dimensions before storing, to save space.
 * Returns a data URL.
 */
export function resizeImage(dataUrl: string, maxDim = 1200): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { width, height } = img;
      if (width <= maxDim && height <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(width, height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original
    img.src = dataUrl;
  });
}

// --- Scratchpad storage ---
// One scratchpad per client, stored as a PNG data URL of the canvas
// plus the strokes array for undo support.

export interface ScratchpadData {
  clientId: string;
  /** PNG data URL of the full canvas (for quick display) */
  imageDataUrl: string;
  /** Background image data URL (photo/PDF page), or null for blank */
  backgroundDataUrl: string | null;
  /** Serialized strokes for undo/redo */
  strokes: ScratchpadStroke[];
  updatedAt: string; // ISO timestamp
}

export interface ScratchpadStroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
  tool: "pen" | "eraser";
}

export async function saveScratchpad(data: ScratchpadData): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_STORE, "readwrite");
    tx.objectStore(SCRATCHPAD_STORE).put(data);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadScratchpad(clientId: string): Promise<ScratchpadData | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_STORE, "readonly");
    const req = tx.objectStore(SCRATCHPAD_STORE).get(clientId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteScratchpad(clientId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_STORE, "readwrite");
    tx.objectStore(SCRATCHPAD_STORE).delete(clientId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllScratchpads(): Promise<ScratchpadData[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SCRATCHPAD_STORE, "readonly");
    const req = tx.objectStore(SCRATCHPAD_STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}
