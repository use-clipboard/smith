'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X, LayoutDashboard, Plus } from 'lucide-react';
import { useTabContext } from './TabContext';
import { TOOL_ROUTES } from './TabPanels';
import { useTabActivityContext } from './TabActivityContext';

export default function TabBar() {
  const { tabs, activeTabId, setActiveTabId, addTab, closeTab } = useTabContext();
  const { resetIfDone, getActivity } = useTabActivityContext();
  const router = useRouter();

  function handleTabClick(tabId: string, route: string) {
    setActiveTabId(tabId);
    resetIfDone(route);
    // Tool tabs are rendered by TabPanels — update the URL without a Next.js navigation
    // so the mounted component is never destroyed
    window.history.replaceState(null, '', route);
  }

  function handleCloseTab(e: React.MouseEvent, tabId: string) {
    e.preventDefault();
    const tab = tabs.find(t => t.id === tabId);
    if (tab && getActivity(tab.route) === 'processing') {
      if (!confirm('This tab is still processing. Closing it will cancel the analysis. Continue?')) return;
    }
    const route = closeTab(tabId);
    if (TOOL_ROUTES.has(route)) {
      // Destination is another tool tab — just update the URL, TabPanels handles rendering
      window.history.replaceState(null, '', route);
    } else {
      // Destination is dashboard or newtab — use Next.js navigation
      router.push(route);
    }
  }

  return (
    <div className="flex items-end gap-0.5 px-4 border-b border-[var(--border)] bg-[var(--bg-topbar)] overflow-x-auto scrollbar-thin shrink-0">
      {/* Dashboard tab — always first, permanent, uses Next.js Link */}
      <Link
        href="/dashboard"
        onClick={() => setActiveTabId(null)}
        className={`flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2 transition-all duration-150 shrink-0
          ${activeTabId === null
            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]'
            : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
          }`}
      >
        <LayoutDashboard size={13} className="shrink-0" />
        <span>Dashboard</span>
      </Link>

      {/* Tool tabs */}
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            className={`group flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2 transition-all duration-150 shrink-0 max-w-[160px]
              ${isActive
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
              }`}
          >
            {/* Tab label — button instead of Link so Next.js doesn't remount the page */}
            <button
              onClick={() => handleTabClick(tab.id, tab.route)}
              className="flex items-center gap-1.5 min-w-0 flex-1"
            >
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{tab.title}</span>
            </button>
            <button
              onClick={e => handleCloseTab(e, tab.id)}
              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--danger)] ml-0.5 p-0.5 rounded"
              title="Close tab"
            >
              <X size={11} />
            </button>
          </div>
        );
      })}

      {/* New tab button — still uses router.push since newtab is a normal Next.js page */}
      {tabs.length < 8 && (
        <button
          onClick={() => router.push(addTab())}
          className="flex items-center justify-center w-7 h-9 mb-px text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] rounded transition-all duration-150 shrink-0"
          title="Open new tab"
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  );
}
