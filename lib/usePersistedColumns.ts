'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Per-user "show / hide columns" persistence for list/table views.
 *
 * The preference is stored in localStorage under a key scoped to the signed-in
 * user's id (`${baseKey}.${userId}`), so two people sharing a browser keep
 * their own column choices. If a user has no per-user preference yet but a
 * legacy shared value exists under the bare `baseKey`, it is migrated across
 * once so nobody loses their existing layout.
 *
 * Returns `[visibleCols, setVisibleCols]` where the setter persists on every
 * change — drop-in compatible with the previous `useState<Set<string>>`
 * pattern, so existing `toggleCol`/"reset"/"show all" handlers keep working.
 *
 *   const [visibleCols, setVisibleCols] = usePersistedColumns(
 *     COLUMN_PREF_KEY,
 *     COLUMNS.map(c => c.key),                       // all valid keys
 *     COLUMNS.filter(c => c.defaultVisible).map(c => c.key), // defaults
 *   );
 */

// The current user id is fetched once and shared across every table on the
// page (a single /me request, not one per list).
let cachedUserId: string | null | undefined; // undefined = not fetched yet
let inflight: Promise<string | null> | null = null;
function fetchUserId(): Promise<string | null> {
  if (cachedUserId !== undefined) return Promise.resolve(cachedUserId);
  if (!inflight) {
    inflight = fetch('/api/users/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { cachedUserId = (d?.userId as string | undefined) ?? null; return cachedUserId; })
      .catch(() => { cachedUserId = null; return cachedUserId; });
  }
  return inflight;
}

type ColSetter = (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;

export function usePersistedColumns(
  baseKey: string,
  allKeys: string[],
  defaultKeys: string[],
): [Set<string>, ColSetter] {
  const [visible, setVisibleRaw] = useState<Set<string>>(() => new Set(defaultKeys));
  const userIdRef = useRef<string | null>(null);

  // Hold the latest valid-key set in a ref so the one-shot hydration effect
  // doesn't depend on a new array identity each render.
  const allKeysRef = useRef(allKeys);
  allKeysRef.current = allKeys;

  const keyFor = useCallback(
    () => (userIdRef.current ? `${baseKey}.${userIdRef.current}` : baseKey),
    [baseKey],
  );

  // Hydrate once: resolve the user id, then read the per-user preference
  // (migrating the legacy shared key if needed).
  useEffect(() => {
    let cancelled = false;
    void fetchUserId().then(uid => {
      if (cancelled) return;
      userIdRef.current = uid;
      try {
        const valid = new Set(allKeysRef.current);
        const userKey = keyFor();
        let raw = window.localStorage.getItem(userKey);
        if (!raw && uid) {
          const legacy = window.localStorage.getItem(baseKey);
          if (legacy) { raw = legacy; window.localStorage.setItem(userKey, legacy); }
        }
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) setVisibleRaw(new Set((arr as string[]).filter(k => valid.has(k))));
      } catch { /* ignore corrupt JSON / disabled storage */ }
    });
    return () => { cancelled = true; };
  }, [baseKey, keyFor]);

  const setVisible = useCallback<ColSetter>((updater) => {
    setVisibleRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try { window.localStorage.setItem(keyFor(), JSON.stringify([...next])); } catch { /* quota / disabled */ }
      return next;
    });
  }, [keyFor]);

  return [visible, setVisible];
}
