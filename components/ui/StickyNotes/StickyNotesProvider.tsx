'use client';

import {
  createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode,
} from 'react';

export type StickyColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'gray';

export interface StickyNote {
  id:           string;
  user_id:      string;
  firm_id:      string;
  /** Tiptap document JSON. May be {} on a freshly-created note. */
  content:      Record<string, unknown>;
  position_x:   number;
  position_y:   number;
  width:        number;
  height:       number;
  color:        StickyColor;
  z_order:      number;
  /** Per-note minimise — hides this single note from the floating layer. */
  is_minimised: boolean;
  created_at:   string;
  updated_at:   string;
}

interface StickyNotesContextValue {
  notes: StickyNote[];
  loading: boolean;
  visible: boolean;
  /** Local toggle that hides the entire layer without deleting anything. */
  setVisible: (v: boolean) => void;
  toggleVisible: () => void;
  addNote: () => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  deleteAll: () => Promise<void>;
  /** Patch the in-memory state immediately and queue a debounced save. */
  patchNote: (id: string, patch: Partial<Omit<StickyNote, 'id' | 'user_id' | 'firm_id' | 'created_at' | 'updated_at'>>) => void;
  /** Bring a note to the front (bumps z_order). */
  bringToFront: (id: string) => void;
  /** Toggle the per-note minimised flag (persists server-side). */
  setMinimised: (id: string, value: boolean) => void;
  /** Bring everything back: global visible=true AND un-minimise every note. */
  showAll: () => void;
}

const StickyNotesContext = createContext<StickyNotesContextValue | null>(null);

export function useStickyNotes(): StickyNotesContextValue {
  const ctx = useContext(StickyNotesContext);
  if (!ctx) throw new Error('useStickyNotes must be used inside <StickyNotesProvider>');
  return ctx;
}

const VISIBILITY_KEY = 'smith_sticky_notes_visible';
const SAVE_DEBOUNCE_MS = 500;
const COLORS: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'];

export default function StickyNotesProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [notes, setNotes] = useState<StickyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [visible, setVisibleState] = useState(true);

  // Per-note debounced save timers
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Pending patches that haven't been flushed yet
  const pendingPatches = useRef<Map<string, Partial<StickyNote>>>(new Map());

  // ── Mount: fetch notes + read visibility preference ──────────────────────
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/sticky-notes');
        if (!res.ok) return;
        const data = await res.json() as { notes: StickyNote[] };
        // Pre-migration safety: default is_minimised to false if the column
        // doesn't yet exist server-side.
        const safe = (data.notes ?? []).map(n => ({ ...n, is_minimised: n.is_minimised ?? false }));
        if (!cancelled) setNotes(safe);
      } catch { /* notes are non-critical */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    try {
      const raw = localStorage.getItem(VISIBILITY_KEY);
      if (raw !== null) setVisibleState(JSON.parse(raw) === true);
    } catch { /* ignore */ }
    return () => { cancelled = true; };
  }, [userId]);

  const setVisible = useCallback((v: boolean) => {
    setVisibleState(v);
    try { localStorage.setItem(VISIBILITY_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  }, []);

  const toggleVisible = useCallback(() => setVisible(!visible), [visible, setVisible]);

  // ── Add ───────────────────────────────────────────────────────────────────
  const addNote = useCallback(async () => {
    // Pick a colour we haven't used recently for some visual variety
    const recentColors = notes.slice(-3).map(n => n.color);
    const color = COLORS.find(c => !recentColors.includes(c)) ?? 'yellow';
    const z_order = notes.length === 0 ? 1 : Math.max(...notes.map(n => n.z_order)) + 1;

    // Cascading offset from top-right so a stack of new notes doesn't fully overlap
    const offset = (notes.length % 8) * 24;
    const fallbackX = typeof window !== 'undefined' ? Math.max(80, window.innerWidth - 320 - offset) : 100 + offset;
    const fallbackY = 100 + offset;

    try {
      const res = await fetch('/api/sticky-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          color,
          z_order,
          position_x: fallbackX,
          position_y: fallbackY,
          width: 280,
          height: 240,
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as { note: StickyNote };
      // Pre-migration safety: ensure is_minimised exists locally even if the
      // backend column hasn't been added yet.
      const note: StickyNote = { ...data.note, is_minimised: data.note.is_minimised ?? false };
      setNotes(prev => [...prev, note]);
      setVisible(true); // creating a note implicitly un-hides the layer
    } catch { /* non-critical */ }
  }, [notes, setVisible]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteNote = useCallback(async (id: string) => {
    // Cancel any pending save for this note
    const t = saveTimers.current.get(id);
    if (t) { clearTimeout(t); saveTimers.current.delete(id); }
    pendingPatches.current.delete(id);

    setNotes(prev => prev.filter(n => n.id !== id));
    try {
      await fetch(`/api/sticky-notes/${id}`, { method: 'DELETE' });
    } catch { /* non-critical — local state already updated */ }
  }, []);

  const deleteAll = useCallback(async () => {
    const all = [...notes];
    setNotes([]);
    saveTimers.current.forEach(t => clearTimeout(t));
    saveTimers.current.clear();
    pendingPatches.current.clear();
    await Promise.allSettled(
      all.map(n => fetch(`/api/sticky-notes/${n.id}`, { method: 'DELETE' }))
    );
  }, [notes]);

  // ── Patch (debounced server save) ────────────────────────────────────────
  const patchNote = useCallback((
    id: string,
    patch: Partial<Omit<StickyNote, 'id' | 'user_id' | 'firm_id' | 'created_at' | 'updated_at'>>,
  ) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));

    // Merge into pending patch set and re-debounce
    const existing = pendingPatches.current.get(id) ?? {};
    pendingPatches.current.set(id, { ...existing, ...patch });

    const prev = saveTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      const body = pendingPatches.current.get(id);
      pendingPatches.current.delete(id);
      saveTimers.current.delete(id);
      if (!body) return;
      fetch(`/api/sticky-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => { /* non-critical */ });
    }, SAVE_DEBOUNCE_MS);
    saveTimers.current.set(id, timer);
  }, []);

  // ── Per-note minimise ───────────────────────────────────────────────────
  const setMinimised = useCallback((id: string, value: boolean) => {
    // Reuse patchNote's debounced-save plumbing
    setNotes(prev => prev.map(n => n.id === id ? { ...n, is_minimised: value } : n));
    const existing = pendingPatches.current.get(id) ?? {};
    pendingPatches.current.set(id, { ...existing, is_minimised: value });
    const prev = saveTimers.current.get(id);
    if (prev) clearTimeout(prev);
    const timer = setTimeout(() => {
      const body = pendingPatches.current.get(id);
      pendingPatches.current.delete(id);
      saveTimers.current.delete(id);
      if (!body) return;
      fetch(`/api/sticky-notes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).catch(() => {});
    }, SAVE_DEBOUNCE_MS);
    saveTimers.current.set(id, timer);
  }, []);

  // ── Show all (globally visible + un-minimise every note) ────────────────
  const showAll = useCallback(() => {
    setVisible(true);
    setNotes(prev => {
      const toRestore: string[] = [];
      const next = prev.map(n => {
        if (n.is_minimised) {
          toRestore.push(n.id);
          return { ...n, is_minimised: false };
        }
        return n;
      });
      // Persist each restore via the existing debounced-save plumbing
      for (const id of toRestore) {
        const existing = pendingPatches.current.get(id) ?? {};
        pendingPatches.current.set(id, { ...existing, is_minimised: false });
        const t = saveTimers.current.get(id);
        if (t) clearTimeout(t);
        const timer = setTimeout(() => {
          const body = pendingPatches.current.get(id);
          pendingPatches.current.delete(id);
          saveTimers.current.delete(id);
          if (!body) return;
          fetch(`/api/sticky-notes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).catch(() => {});
        }, SAVE_DEBOUNCE_MS);
        saveTimers.current.set(id, timer);
      }
      return next;
    });
  }, [setVisible]);

  // ── Bring to front ───────────────────────────────────────────────────────
  const bringToFront = useCallback((id: string) => {
    setNotes(prev => {
      const max = prev.length === 0 ? 0 : Math.max(...prev.map(n => n.z_order));
      const target = prev.find(n => n.id === id);
      if (!target || target.z_order === max) return prev;
      const next = max + 1;
      // Persist via debounced patch
      const t = saveTimers.current.get(id);
      if (t) clearTimeout(t);
      const merged = { ...(pendingPatches.current.get(id) ?? {}), z_order: next };
      pendingPatches.current.set(id, merged);
      saveTimers.current.set(id, setTimeout(() => {
        const body = pendingPatches.current.get(id);
        pendingPatches.current.delete(id);
        saveTimers.current.delete(id);
        if (!body) return;
        fetch(`/api/sticky-notes/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => {});
      }, SAVE_DEBOUNCE_MS));
      return prev.map(n => n.id === id ? { ...n, z_order: next } : n);
    });
  }, []);

  // ── Flush pending saves on unload ────────────────────────────────────────
  useEffect(() => {
    function flush() {
      pendingPatches.current.forEach((patch, id) => {
        try {
          // Best-effort: keepalive lets fetch complete after unload in modern browsers
          fetch(`/api/sticky-notes/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
            keepalive: true,
          });
        } catch { /* ignore */ }
      });
    }
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  return (
    <StickyNotesContext.Provider value={{
      notes, loading, visible, setVisible, toggleVisible,
      addNote, deleteNote, deleteAll, patchNote, bringToFront, setMinimised, showAll,
    }}>
      {children}
    </StickyNotesContext.Provider>
  );
}
