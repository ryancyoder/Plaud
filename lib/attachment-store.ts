"use client";

import { Attachment } from "./types";

const DB_NAME = "plaud-attachments";
const DB_VERSION = 1;
const STORE_NAME = "attachments";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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
