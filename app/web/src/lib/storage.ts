// localStorage wrapper with in-memory fallback for browsers that block storage access.
// Falls back to a module-level Map — data persists for the tab session only.

const mem = new Map<string, string>();

function ls(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function storageGet(key: string): string | null {
  const store = ls();
  if (store) {
    try { return store.getItem(key); } catch { /* fall through */ }
  }
  return mem.get(key) ?? null;
}

export function storageSet(key: string, value: string): void {
  const store = ls();
  if (store) {
    try { store.setItem(key, value); return; } catch { /* fall through */ }
  }
  mem.set(key, value);
}

export function storageRemove(key: string): void {
  const store = ls();
  if (store) {
    try { store.removeItem(key); return; } catch { /* fall through */ }
  }
  mem.delete(key);
}
