const KEY = "plaud-selected-client-id";

export function getPersistedClientId(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(KEY);
}

export function setPersistedClientId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) {
    sessionStorage.setItem(KEY, id);
  } else {
    sessionStorage.removeItem(KEY);
  }
}
