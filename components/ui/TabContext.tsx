'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { LucideIcon, Plus, X, AlertTriangle, User } from 'lucide-react';
import { TOOL_NAV_ITEMS, WORKSPACE_NAV_ITEMS, DASHBOARD_ITEM } from '@/config/navItems';

export interface Tab {
  id: string;
  title: string;
  /** Canonical tool route — `/bookkeeping`, `/tasks`, etc. Used for tab
   *  identity, the icon/title lookup, and duplicate detection. Never
   *  changes once the tab is opened. */
  route: string;
  /** Most-recently-visited URL inside this tool (pathname + search). When
   *  the user clicks the tab in the tab bar, we navigate here rather than
   *  to `route` — so coming back to Bookkeeping after dipping into another
   *  tool lands you back on `/bookkeeping/<bookId>?tab=…`, not the books
   *  list. Falls back to `route` if we've never tracked a deeper URL. */
  currentRoute?: string;
  icon: LucideIcon;
}

// ── Persistence helpers ─────────────────────────────────────────────────────
// Tabs are stored in React state which wipes on refresh — we serialise to
// localStorage so the user's tab bar survives reloads. Icons are React
// components so we save only {id, title, route} and look the icon back up
// by route on restore.
const STORAGE_KEY = 'smith_tabs_v1';

const ROUTE_TO_NAV = new Map<string, { label: string; icon: LucideIcon }>();
for (const item of [DASHBOARD_ITEM, ...TOOL_NAV_ITEMS, ...WORKSPACE_NAV_ITEMS]) {
  ROUTE_TO_NAV.set(item.href, { label: item.label, icon: item.icon as LucideIcon });
}
ROUTE_TO_NAV.set('/newtab', { label: 'New Tab', icon: Plus });

interface SerialisedTab { id: string; title: string; route: string; currentRoute?: string }

function loadPersisted(): { tabs: Tab[]; activeTabId: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs: SerialisedTab[]; activeTabId: string | null };
    // Dedup by route as we go — older app versions had a race condition that
    // could leave two tabs pointing at the same route (most commonly two
    // Dashboard tabs). Keep the FIRST occurrence so the active tab id (which
    // usually points at the older one) stays valid.
    const seenRoutes = new Set<string>();
    const tabs: Tab[] = [];
    for (const t of parsed.tabs ?? []) {
      // Team-member profile tabs are dynamic (`/team/<id>`) — not in the nav
      // map — so restore them with the stored title + a generic person icon.
      const isTeam = t.route.startsWith('/team/');
      const nav = ROUTE_TO_NAV.get(t.route);
      if (!nav && !isTeam) continue; // unknown route — skip (probably an old/removed module)
      if (t.route === '/dashboard') continue; // Dashboard is rendered as a permanent tab in TabBar; never store it in the tab list
      if (seenRoutes.has(t.route)) continue; // collapse duplicates
      seenRoutes.add(t.route);
      tabs.push({
        id: t.id,
        // Nav-driven tabs (tools, etc.) always take the CURRENT nav label, so a
        // tool rename shows up on the next load without needing to close/reopen
        // the tab. Only dynamic profile tabs keep their stored custom title.
        title: isTeam ? (t.title || 'Profile') : nav!.label,
        route: t.route,
        currentRoute: t.currentRoute,
        icon: isTeam ? User : nav!.icon,
      });
    }
    const activeTabId = parsed.activeTabId && tabs.some(t => t.id === parsed.activeTabId)
      ? parsed.activeTabId
      : null;
    return { tabs, activeTabId };
  } catch { return null; }
}

function persist(tabs: Tab[], activeTabId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = {
      tabs: tabs.map(t => ({ id: t.id, title: t.title, route: t.route, currentRoute: t.currentRoute })),
      activeTabId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* quota / disabled — non-critical */ }
}

interface TabContextValue {
  tabs: Tab[];
  activeTabId: string | null; // null = dashboard is active
  openTab: (tab: Tab) => void;        // opens or switches to tool; replaces current tab if one is active
  /** Always opens in a fresh slot; never replaces the current tab. Returns
   *  false when the tab limit blocked it (a warning toast is shown) — callers
   *  that navigate afterwards should skip the navigation in that case. */
  openInNewTab: (tab: Tab) => boolean;
  addTab: () => string;               // opens a blank new-tab picker
  closeTab: (id: string) => string;   // returns route to navigate to after close
  reorderTab: (fromIndex: number, toIndex: number) => void; // drag-to-rearrange tool tabs
  setActiveTabId: (id: string | null) => void;
  /** Imperatively update the active tab's `currentRoute` (the URL it should
   *  return to). Tool-tab components use this when they swap views via
   *  history.replaceState — that bypasses Next.js's router so the pathname
   *  reconcile effect can't catch it on its own. */
  setActiveTabCurrentRoute: (route: string) => void;
}

const TabContext = createContext<TabContextValue>({
  tabs: [],
  activeTabId: null,
  openTab: () => {},
  openInNewTab: () => false,
  addTab: () => '/dashboard',
  closeTab: () => '/dashboard',
  reorderTab: () => {},
  setActiveTabId: () => {},
  setActiveTabCurrentRoute: () => {},
});

export function useTabContext() {
  return useContext(TabContext);
}

const MAX_TABS = 8;

export default function TabProvider({ children }: { children: ReactNode }) {
  // Start empty so the first client render matches the server's HTML (which
  // has no localStorage). Then hydrate from localStorage in an effect — this
  // adds at most one frame of "empty tab bar" but avoids the React hydration
  // mismatch error you'd otherwise get whenever the user has persisted tabs.
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Flips to `true` once we've finished pulling the persisted tab list out
  // of localStorage. The reconcile effect below MUST wait for this — if it
  // runs while `tabs` is still the initial empty array, it'd think there
  // are no tabs and create a brand new Dashboard tab on top of whatever
  // the user already had persisted, leading to duplicate Dashboard tabs
  // appearing every time they log back in.
  const [hydrated, setHydrated] = useState(false);
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const restored = loadPersisted();
    if (restored?.tabs?.length) {
      setTabs(restored.tabs);
      if (restored.activeTabId) setActiveTabId(restored.activeTabId);
    }
    setHydrated(true);
  }, []);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams ? searchParams.toString() : '';

  // Shown when the MAX_TABS cap silently blocks a new tab — without it the
  // click appears to do nothing and the user has no idea why.
  const [limitWarning, setLimitWarning] = useState(false);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLimitWarning = useCallback(() => {
    setLimitWarning(true);
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    limitTimerRef.current = setTimeout(() => setLimitWarning(false), 6000);
  }, []);
  useEffect(() => () => { if (limitTimerRef.current) clearTimeout(limitTimerRef.current); }, []);

  // Reconcile saved state with the URL. Runs on every pathname change so that
  // when a sub-route loads (e.g. /mtd-it/abc/2026/1) we activate the parent
  // tool's tab (/mtd-it) instead of falling back to Dashboard. Tab CREATION
  // (auto-opening a tab the user has never opened) still only happens once at
  // mount via the reconciledRef guard — we don't want spurious tab creation
  // later in the session.
  const reconciledRef = useRef(false);
  const prevPathnameRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname) return;
    // Wait for the restore effect above to finish before trying to match
    // the current pathname against persisted tabs. Without this, the very
    // first render runs reconcile against an empty `tabs` state — which
    // means we'd never see the persisted Dashboard tab and would create a
    // duplicate on every fresh login. See `hydrated` declaration above.
    if (!hydrated) return;

    // Did the URL itself change this run? The effect also re-runs when `tabs`
    // change, and we must NOT treat a programmatic tab-open (which adds a tab
    // while the URL is still /dashboard) as a navigation back to the Dashboard.
    const pathnameChanged = prevPathnameRef.current !== pathname;
    prevPathnameRef.current = pathname;

    // Dashboard is rendered as a permanent leading tab in TabBar (activeTabId
    // === null means it's active). Never create or match a tool tab for it —
    // otherwise we get a second "Dashboard" pill next to the permanent one.
    if (pathname === '/dashboard') {
      // Only deactivate to the Dashboard on a genuine navigation to it — not
      // when a tab was just opened from the dashboard (URL still /dashboard),
      // which would instantly reset the tab we just switched to.
      if (pathnameChanged && activeTabId !== null) setActiveTabId(null);
      reconciledRef.current = true;
      return;
    }

    // Find an existing tab whose route matches the current URL. Try exact
    // first (cheap, common case), then prefix — so /mtd-it/abc/2026/1 still
    // matches the /mtd-it tab.
    const existing =
      tabs.find(t => t.route === pathname) ??
      tabs.find(t => t.route !== '/' && pathname.startsWith(t.route + '/'));

    if (existing) {
      // Remember the deep URL the user is currently on so that clicking back
      // on this tab from elsewhere returns to the same place (e.g. the
      // specific book they were working in, not the books list).
      const deep = searchString ? `${pathname}?${searchString}` : pathname;
      if (existing.currentRoute !== deep) {
        setTabs(prev => prev.map(t => t.id === existing.id ? { ...t, currentRoute: deep } : t));
      }
      // Only switch the active tab to match the URL on a GENUINE navigation.
      // When this effect re-runs merely because the tab LIST changed (e.g. a
      // tab was opened programmatically from inside another tool — "View
      // client" in Email Triage), the URL is still the old tool's route, so
      // matching it here would snap activeTabId back to that tool and silently
      // undo the open. Same guard as the Dashboard branch above.
      if (pathnameChanged && activeTabId !== existing.id) setActiveTabId(existing.id);
      reconciledRef.current = true;
      return;
    }

    // No matching tab. On first mount only, try to create one from the
    // canonical nav map (exact match — sub-routes won't auto-open a tab
    // because the user has to visit the parent first).
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    const nav = ROUTE_TO_NAV.get(pathname);
    if (!nav) return; // pathname isn't a tool/tab route — let it be
    const newId = `tab-${Date.now()}`;
    const deep = searchString ? `${pathname}?${searchString}` : pathname;
    setTabs(prev => [...prev, { id: newId, title: nav.label, route: pathname, currentRoute: deep, icon: nav.icon }]);
    setActiveTabId(newId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchString, tabs.length, hydrated]);

  // Persist on every change
  useEffect(() => { persist(tabs, activeTabId); }, [tabs, activeTabId]);

  const openTab = useCallback((tab: Tab) => {
    // If this tool is already open in any tab, switch to it — no duplicates allowed
    const existing = tabs.find(t => t.route === tab.route);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    if (activeTabId === null || tabs.length === 0) {
      // Dashboard is active (or no tabs yet) — create a new tab
      if (tabs.length >= MAX_TABS) { showLimitWarning(); return; } // at limit; navigation still happens via Link
      const newId = `tab-${Date.now()}`;
      setTabs(prev => [...prev, { ...tab, id: newId }]);
      setActiveTabId(newId);
      return;
    }

    // An existing tool tab is active — replace its content in-place
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...tab, id: t.id } : t));
    // activeTabId stays the same — same tab slot, new tool
  }, [tabs, activeTabId, showLimitWarning]);

  // Always open in a fresh tab slot — never replaces the currently active tab.
  // If the tool is already open, just switch to it (no duplicates).
  const openInNewTab = useCallback((tab: Tab): boolean => {
    const existing = tabs.find(t => t.route === tab.route);
    if (existing) {
      setActiveTabId(existing.id);
      return true;
    }
    if (tabs.length >= MAX_TABS) { showLimitWarning(); return false; }
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { ...tab, id: newId }]);
    setActiveTabId(newId);
    return true;
  }, [tabs, showLimitWarning]);

  // Open a new blank tab (route: /newtab) — the user picks a tool from there.
  // If a New Tab is already open, switch to it rather than creating a duplicate.
  const addTab = useCallback((): string => {
    const existingNewTab = tabs.find(t => t.route === '/newtab');
    if (existingNewTab) {
      setActiveTabId(existingNewTab.id);
      return '/newtab';
    }
    if (tabs.length >= MAX_TABS) {
      showLimitWarning();
      return tabs.find(t => t.id === activeTabId)?.route ?? '/dashboard';
    }
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, title: 'New Tab', route: '/newtab', icon: Plus }]);
    setActiveTabId(newId);
    return '/newtab';
  }, [tabs, activeTabId, showLimitWarning]);

  // Remove a tab and return the route to navigate to. Prefers each tab's
  // last-known deep URL so closing a tab returns the user to where they
  // left off in the next tab over.
  const closeTab = useCallback((id: string): string => {
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      const next = newTabs[idx] ?? newTabs[idx - 1] ?? null;
      setActiveTabId(next?.id ?? null);
      return next?.currentRoute ?? next?.route ?? '/dashboard';
    }
    const active = tabs.find(t => t.id === activeTabId);
    return active?.currentRoute ?? active?.route ?? '/dashboard';
  }, [tabs, activeTabId]);

  // Move a tool tab from one position to another (drag-to-rearrange). The
  // Dashboard tab lives outside `tabs` (it's a permanent leading tab), so all
  // indices here refer to tool tabs only and it can never be moved.
  const reorderTab = useCallback((fromIndex: number, toIndex: number) => {
    setTabs(prev => {
      if (
        fromIndex < 0 || fromIndex >= prev.length ||
        toIndex < 0 || toIndex >= prev.length ||
        fromIndex === toIndex
      ) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  // Imperative update used by tool-tab components when their internal nav
  // changes the URL via history.replaceState (which Next.js's pathname hook
  // doesn't observe). Keeps tab.currentRoute in sync so the next click on
  // this tab returns to the right deep URL.
  const setActiveTabCurrentRoute = useCallback((route: string) => {
    setTabs(prev => prev.map(t =>
      t.id === activeTabId && t.currentRoute !== route ? { ...t, currentRoute: route } : t
    ));
  }, [activeTabId]);

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openTab, openInNewTab, addTab, closeTab, reorderTab, setActiveTabId, setActiveTabCurrentRoute }}>
      {children}
      {/* Tab-limit warning — rendered here so every openTab/openInNewTab/addTab
          caller anywhere in the app gets it without wiring their own toast. */}
      {limitWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 bg-amber-600 text-white">
          <AlertTriangle size={15} className="shrink-0" />
          Tab limit reached ({MAX_TABS} max) — close a tab to open a new one.
          <button onClick={() => setLimitWarning(false)} className="ml-1 opacity-80 hover:opacity-100" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </TabContext.Provider>
  );
}
