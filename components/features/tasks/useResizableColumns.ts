'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Resizable column widths for the Tasks tool tables.
 *
 * Each view passes a stable `viewKey` plus its column definitions. Widths
 * persist in localStorage so the user's preferred layout survives reloads
 * and switching between tabs. A reset helper lets the user wipe back to
 * defaults from a context menu / button if needed.
 */
export interface ResizableColumnDef {
  id: string;
  defaultWidth: number;
  minWidth?: number;
  /** When true, this column is excluded from drag-resize (e.g. fixed icon cells). */
  fixed?: boolean;
}

interface UseResizableColumnsResult {
  widths: Record<string, number>;
  startDrag: (colId: string, e: React.MouseEvent) => void;
  reset: () => void;
}

const STORAGE_PREFIX = 'smith.tasks.columnWidths.v1.';

export function useResizableColumns(viewKey: string, columns: ResizableColumnDef[]): UseResizableColumnsResult {
  const storageKey = STORAGE_PREFIX + viewKey;
  const defaults = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of columns) m[c.id] = c.defaultWidth;
    return m;
  }, [columns]);

  const [widths, setWidths] = useState<Record<string, number>>(defaults);

  // Hydrate from localStorage on mount / when defaults change.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const stored = JSON.parse(raw) as Record<string, number>;
        // Merge — drop any keys not in the current schema, fall back to defaults
        // for any new columns introduced since the user last sized them.
        const merged: Record<string, number> = { ...defaults };
        for (const c of columns) {
          if (typeof stored[c.id] === 'number' && stored[c.id] > 0) merged[c.id] = stored[c.id];
        }
        setWidths(merged);
      } else {
        setWidths(defaults);
      }
    } catch {
      setWidths(defaults);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist whenever widths change (after user-driven resize).
  const lastSavedRef = useRef<string>('');
  useEffect(() => {
    try {
      const json = JSON.stringify(widths);
      if (json !== lastSavedRef.current) {
        window.localStorage.setItem(storageKey, json);
        lastSavedRef.current = json;
      }
    } catch { /* localStorage may be disabled — non-fatal */ }
  }, [widths, storageKey]);

  const startDrag = useCallback((colId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const col = columns.find(c => c.id === colId);
    if (!col || col.fixed) return;
    const minW = col.minWidth ?? 40;
    const startX = e.clientX;
    const startW = widths[colId] ?? col.defaultWidth;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = Math.max(minW, Math.round(startW + delta));
      setWidths(prev => prev[colId] === next ? prev : { ...prev, [colId]: next });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [columns, widths]);

  const reset = useCallback(() => {
    setWidths(defaults);
    try { window.localStorage.removeItem(storageKey); } catch { /* ignore */ }
  }, [defaults, storageKey]);

  return { widths, startDrag, reset };
}
