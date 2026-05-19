'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { TaskDeadlineLink } from './TaskDeadlineLinkBadge';

/**
 * Firm-wide CH deadline-link cache for the Tasks tool. Fetched once on
 * mount and refreshed on demand (e.g. after a manual CH refresh that
 * might have flipped statuses). Cards / rows / detail panels look up
 * their links via `useTaskDeadlineLinks(taskId)` rather than each
 * issuing its own HTTP fetch.
 */
interface ContextValue {
  /** task_id → links attached to that task (usually 0 or 1). */
  linksByTaskId: Map<string, TaskDeadlineLink[]>;
  /** Force a re-fetch. Call after creating/removing a link locally. */
  refetch: () => void;
}

const Ctx = createContext<ContextValue>({
  linksByTaskId: new Map(),
  refetch:       () => {},
});

export function useTaskDeadlineLinks(taskId: string | null | undefined): TaskDeadlineLink[] {
  const { linksByTaskId } = useContext(Ctx);
  if (!taskId) return [];
  return linksByTaskId.get(taskId) ?? [];
}

export function useTaskDeadlineLinksRefetch(): () => void {
  return useContext(Ctx).refetch;
}

export default function TaskDeadlineLinksProvider({ children }: { children: ReactNode }) {
  const [linksByTaskId, setLinksByTaskId] = useState<Map<string, TaskDeadlineLink[]>>(new Map());

  const refetch = useCallback(() => {
    void fetch('/api/ch-secretarial/deadline-links')
      .then(async r => {
        if (!r.ok) {
          console.warn('[TaskDeadlineLinksProvider] fetch failed', r.status, await r.text().catch(() => ''));
          return null;
        }
        return r.json();
      })
      .then((j: { links?: Array<TaskDeadlineLink & { task_id: string }> } | null) => {
        if (!j?.links) return;
        const next = new Map<string, TaskDeadlineLink[]>();
        for (const l of j.links) {
          const existing = next.get(l.task_id) ?? [];
          existing.push(l);
          next.set(l.task_id, existing);
        }
        if (typeof window !== 'undefined') {
          console.debug(`[TaskDeadlineLinksProvider] loaded ${j.links.length} link(s) across ${next.size} task(s)`);
        }
        setLinksByTaskId(next);
      })
      .catch(err => { console.warn('[TaskDeadlineLinksProvider] fetch error', err); });
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  // Allow any code outside the React tree (e.g. TasksPage's task-creation
  // handlers, which live above this provider in the render tree) to ask the
  // provider for a fresh fetch. Dispatching `smith:deadline-links-refetch`
  // on the window object triggers a reload — no prop drilling needed.
  useEffect(() => {
    function onEvt() { refetch(); }
    window.addEventListener('smith:deadline-links-refetch', onEvt);
    return () => window.removeEventListener('smith:deadline-links-refetch', onEvt);
  }, [refetch]);

  return <Ctx.Provider value={{ linksByTaskId, refetch }}>{children}</Ctx.Provider>;
}

/** Fire from anywhere (inside or outside the provider's React subtree) to
 *  force the provider to refetch its link cache. Safe no-op on the server. */
export function triggerDeadlineLinksRefetch(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('smith:deadline-links-refetch'));
  }
}
