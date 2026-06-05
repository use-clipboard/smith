'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Incremental "visible batches" rendering for long lists.
 *
 * Instead of mounting every row up-front (slow first paint + heavy DOM on a
 * few-hundred-row list), we render `initial` rows, then append `batch` more
 * each time a sentinel near the end of the list scrolls into view. The DOM
 * grows as the user scrolls rather than all at once.
 *
 * Works for BOTH page-scrolled lists and bounded scroll containers: the
 * sentinel auto-detects its nearest *actually scrollable* ancestor and uses it
 * as the observer root (falling back to the viewport). IntersectionObserver
 * clips the target by intermediate scroll containers, so a viewport-rooted
 * observer still fires correctly inside a bounded container too.
 *
 * Usage:
 *   const { visible, sentinelRef, hasMore } = useIncrementalList(sortedRows);
 *   ...visible.map(renderRow)
 *   {hasMore && <tr ref={sentinelRef}><td/></tr>}
 *
 * Resets back to `initial` whenever the source list reference changes (e.g.
 * the user changes a filter or sort), so you never start a fresh list scrolled
 * deep into a stale window.
 */
export function useIncrementalList<T>(
  items: T[],
  initial = 40,
  batch = 30,
): { visible: T[]; sentinelRef: (el: HTMLElement | null) => void; hasMore: boolean } {
  const [limit, setLimit] = useState(initial);

  // Reset the window when the underlying list changes.
  useEffect(() => { setLimit(initial); }, [items, initial]);

  const hasMore = limit < items.length;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;

  const observerRef = useRef<IntersectionObserver | null>(null);

  // Only treat an ancestor as the scroll root if it is BOTH styled scrollable
  // AND actually taller than its viewport. This avoids false positives like an
  // `overflow-x-auto` wrapper (whose computed overflow-y resolves to `auto` but
  // which never scrolls vertically) — in that case we fall through to `null`
  // (the page viewport), which is correct for page-scrolled tables.
  function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    let node = el?.parentElement ?? null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
      node = node.parentElement;
    }
    return null;
  }

  const sentinelRef = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    const root = findScrollParent(el);
    const obs = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting) && hasMoreRef.current) {
          setLimit(l => l + batch);
        }
      },
      { root, rootMargin: '200px 0px' }, // pre-load a little before it's visible
    );
    obs.observe(el);
    observerRef.current = obs;
  }, [batch]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { visible: items.slice(0, limit), sentinelRef, hasMore };
}
