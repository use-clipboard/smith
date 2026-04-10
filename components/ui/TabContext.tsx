'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { LucideIcon, Plus } from 'lucide-react';

export interface Tab {
  id: string;
  title: string;
  route: string;
  icon: LucideIcon;
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
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

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
