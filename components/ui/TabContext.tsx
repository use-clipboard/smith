'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { LucideIcon, Plus } from 'lucide-react';
import { TOOL_NAV_ITEMS, WORKSPACE_NAV_ITEMS, DASHBOARD_ITEM } from '@/config/navItems';

export interface Tab {
  id: string;
  title: string;
  route: string;
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

interface SerialisedTab { id: string; title: string; route: string }

function loadPersisted(): { tabs: Tab[]; activeTabId: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { tabs: SerialisedTab[]; activeTabId: string | null };
    const tabs: Tab[] = [];
    for (const t of parsed.tabs ?? []) {
      const nav = ROUTE_TO_NAV.get(t.route);
      if (!nav) continue; // unknown route — skip (probably an old/removed module)
      tabs.push({ id: t.id, title: t.title || nav.label, route: t.route, icon: nav.icon });
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
      tabs: tabs.map(t => ({ id: t.id, title: t.title, route: t.route })),
      activeTabId,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch { /* quota / disabled — non-critical */ }
}

interface TabContextValue {
  tabs: Tab[];
  activeTabId: string | null; // null = dashboard is active
  openTab: (tab: Tab) => void;        // opens or switches to tool; replaces current tab if one is active
  openInNewTab: (tab: Tab) => void;   // always opens in a fresh slot; never replaces current tab
  addTab: () => string;               // opens a blank new-tab picker
  closeTab: (id: string) => string;   // returns route to navigate to after close
  setActiveTabId: (id: string | null) => void;
}

const TabContext = createContext<TabContextValue>({
  tabs: [],
  activeTabId: null,
  openTab: () => {},
  openInNewTab: () => {},
  addTab: () => '/dashboard',
  closeTab: () => '/dashboard',
  setActiveTabId: () => {},
});

export function useTabContext() {
  return useContext(TabContext);
}

const MAX_TABS = 8;

export default function TabProvider({ children }: { children: ReactNode }) {
  // Lazy initial state: restore from localStorage on the very first render so
  // the tab bar appears immediately after refresh without a flash of "empty".
  const initial = typeof window !== 'undefined' ? loadPersisted() : null;
  const [tabs, setTabs] = useState<Tab[]>(initial?.tabs ?? []);
  const [activeTabId, setActiveTabId] = useState<string | null>(initial?.activeTabId ?? null);
  const pathname = usePathname();

  // Reconcile saved state with the URL on mount: if the user refreshed at
  // /email but the saved active tab is /tasks, switch to whatever the URL
  // says (the URL is the source of truth post-refresh).
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    reconciledRef.current = true;
    if (!pathname) return;
    const nav = ROUTE_TO_NAV.get(pathname);
    if (!nav) return; // pathname isn't a tool/tab route — let it be (e.g. /settings)
    // Try to find an existing tab for this route
    const existing = tabs.find(t => t.route === pathname);
    if (existing) {
      if (activeTabId !== existing.id) setActiveTabId(existing.id);
      return;
    }
    // No tab for the URL — create one and make it active
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, title: nav.label, route: pathname, icon: nav.icon }]);
    setActiveTabId(newId);
  // Intentionally only on mount — tabs/activeTabId are restored from storage
  // before this runs, and we never want to reset the active tab on later
  // pathname changes (the tab system itself drives those).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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
      if (tabs.length >= MAX_TABS) return; // at limit; navigation still happens via Link
      const newId = `tab-${Date.now()}`;
      setTabs(prev => [...prev, { ...tab, id: newId }]);
      setActiveTabId(newId);
      return;
    }

    // An existing tool tab is active — replace its content in-place
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...tab, id: t.id } : t));
    // activeTabId stays the same — same tab slot, new tool
  }, [tabs, activeTabId]);

  // Always open in a fresh tab slot — never replaces the currently active tab.
  // If the tool is already open, just switch to it (no duplicates).
  const openInNewTab = useCallback((tab: Tab) => {
    const existing = tabs.find(t => t.route === tab.route);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    if (tabs.length >= MAX_TABS) return;
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { ...tab, id: newId }]);
    setActiveTabId(newId);
  }, [tabs]);

  // Open a new blank tab (route: /newtab) — the user picks a tool from there.
  // If a New Tab is already open, switch to it rather than creating a duplicate.
  const addTab = useCallback((): string => {
    const existingNewTab = tabs.find(t => t.route === '/newtab');
    if (existingNewTab) {
      setActiveTabId(existingNewTab.id);
      return '/newtab';
    }
    if (tabs.length >= MAX_TABS) {
      return tabs.find(t => t.id === activeTabId)?.route ?? '/dashboard';
    }
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [...prev, { id: newId, title: 'New Tab', route: '/newtab', icon: Plus }]);
    setActiveTabId(newId);
    return '/newtab';
  }, [tabs, activeTabId]);

  // Remove a tab and return the route to navigate to
  const closeTab = useCallback((id: string): string => {
    const idx = tabs.findIndex(t => t.id === id);
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      const next = newTabs[idx] ?? newTabs[idx - 1] ?? null;
      setActiveTabId(next?.id ?? null);
      return next?.route ?? '/dashboard';
    }
    return tabs.find(t => t.id === activeTabId)?.route ?? '/dashboard';
  }, [tabs, activeTabId]);

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openTab, openInNewTab, addTab, closeTab, setActiveTabId }}>
      {children}
    </TabContext.Provider>
  );
}
