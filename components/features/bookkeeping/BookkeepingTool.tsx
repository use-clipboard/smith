'use client';

/**
 * BookkeepingTool — the always-mounted client wrapper used by TabPanels.
 *
 * Why this exists:
 *   The bookkeeping module has two top-level views (the books list and an
 *   open book's BookView). Previously each lived on its own Next.js route
 *   (`/bookkeeping` and `/bookkeeping/<id>`), so flipping between tabs in
 *   the app's tab bar unmounted the whole subtree — losing the sub-tab the
 *   user was on, any open ledger drill-downs, a half-typed input row, etc.
 *
 *   This wrapper holds the "currently-open book id" in React state and
 *   swaps views internally, never unmounting. TabPanels keeps the wrapper
 *   mounted (display:none when inactive), so all of BookView's state
 *   survives tab switches.
 *
 *   The URL is kept in sync via window.history.replaceState so deep-link
 *   sharing and the browser back/forward stack still behave sensibly. We
 *   also listen for external pathname changes (e.g. someone clicking a
 *   `/bookkeeping/<id>` link from another tool) so the wrapper jumps to
 *   the right book.
 *
 *   The standalone /bookkeeping/[id] page is kept in place for cold direct
 *   access (refreshes, deep-linked emails) — it still does the server-side
 *   auth gate and renders BookView directly.
 */

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import BookkeepingDashboard from './BookkeepingDashboard';
import BookView from './BookView';
import { useTabContext } from '@/components/ui/TabContext';

interface MeResponse {
  userId: string;
  userName: string | null;
  userRole: 'admin' | 'staff';
}

/** Pulls the `<bookId>` out of a `/bookkeeping/<bookId>` URL, or `null` for
 *  the bare `/bookkeeping` books-list URL. */
function bookIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/bookkeeping\/([^/?#]+)/);
  return m?.[1] ?? null;
}

export default function BookkeepingTool() {
  const pathname = usePathname();
  const { setActiveTabCurrentRoute } = useTabContext();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState(false);

  // Initial book id is derived from whatever URL we were mounted at — so the
  // first paint after a refresh lands on the right view.
  const [openBookId, setOpenBookId] = useState<string | null>(() => bookIdFromPath(pathname));

  // ── Fetch the current user once on mount ────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then(r => r.ok ? r.json() as Promise<MeResponse> : Promise.reject(r))
      .then(d => { if (!cancelled) setMe(d); })
      .catch(() => { if (!cancelled) setMeError(true); });
    return () => { cancelled = true; };
  }, []);

  // ── Keep internal state in sync with the URL ────────────────────────────
  // Catches external navigation INSIDE the bookkeeping tool: clicking a
  // `/bookkeeping/<id>` link from another tool, or browser back/forward
  // between two bookkeeping URLs.
  //
  // IMPORTANT: ignore pathname changes that leave the bookkeeping module
  // entirely (e.g. clicking the Dashboard tab takes pathname to `/dashboard`).
  // TabPanels keeps us mounted via display:none while another tool is
  // active — if we reset openBookId on every pathname change we'd close
  // the open book the moment the user switched tabs, taking BookView's
  // internal state (sub-tab, dynamic drill-downs, drafts) with it.
  useEffect(() => {
    if (!pathname || !pathname.startsWith('/bookkeeping')) return;
    const urlBookId = bookIdFromPath(pathname);
    if (urlBookId !== openBookId) setOpenBookId(urlBookId);
  }, [pathname, openBookId]);

  // ── Internal navigation — no unmount ────────────────────────────────────
  // Both helpers update the URL via history.replaceState (so we don't
  // trigger Next.js navigation that would unmount us) AND push the new
  // URL into the tab's `currentRoute` (so clicking back on this tab from
  // elsewhere returns to the same book / books-list view).
  const openBook = useCallback((bookId: string) => {
    setOpenBookId(bookId);
    const route = `/bookkeeping/${bookId}`;
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', route);
    }
    setActiveTabCurrentRoute(route);
  }, [setActiveTabCurrentRoute]);

  const closeBook = useCallback(() => {
    setOpenBookId(null);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/bookkeeping');
    }
    setActiveTabCurrentRoute('/bookkeeping');
  }, [setActiveTabCurrentRoute]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (meError) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Couldn&apos;t load your account details. Please refresh the page.
      </div>
    );
  }
  if (!me) {
    return (
      <div className="p-8 text-sm text-[#5b21b6] inline-flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading bookkeeping…
      </div>
    );
  }

  if (openBookId) {
    return (
      <BookView
        bookId={openBookId}
        userRole={me.userRole}
        currentUserId={me.userId}
        currentUserName={me.userName}
        onCloseBook={closeBook}
      />
    );
  }
  return <BookkeepingDashboard onOpenBook={openBook} />;
}
