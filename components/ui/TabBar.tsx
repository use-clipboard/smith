'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { X, LayoutDashboard, Plus } from 'lucide-react';
import { useTabContext } from './TabContext';
import { TOOL_ROUTES } from './TabPanels';
import { useTabActivityContext } from './TabActivityContext';
import Tooltip from './Tooltip';

export default function TabBar() {
  const { tabs, activeTabId, setActiveTabId, addTab, closeTab, reorderTab } = useTabContext();
  const { resetIfDone, getActivity } = useTabActivityContext();
  const router = useRouter();

  // Pointer-based tab reorder (Chrome-style): click and drag to move a tab,
  // with live reordering — no HTML5 drag, so no inconsistent move-cursor.
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; dragging: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Latest tabs/reorder behind refs so the global listeners stay stable.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const reorderRef = useRef(reorderTab);
  reorderRef.current = reorderTab;

  const onPointerMove = useCallback((e: MouseEvent) => {
    const st = dragRef.current;
    if (!st) return;
    if (!st.dragging) {
      if (Math.abs(e.clientX - st.startX) < 5) return; // movement threshold → not a click
      st.dragging = true;
      setDraggingId(st.id);
      document.body.style.cursor = 'grabbing';
    }
    const strip = stripRef.current;
    if (!strip) return;
    const els = Array.from(strip.querySelectorAll('[data-tab-id]')) as HTMLElement[];
    if (els.length === 0) return;
    const mids = els.map(el => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; });
    let newIdx = mids.filter(m => m < e.clientX).length;
    newIdx = Math.max(0, Math.min(els.length - 1, newIdx));
    const curIdx = tabsRef.current.findIndex(t => t.id === st.id);
    if (curIdx >= 0 && newIdx !== curIdx) reorderRef.current(curIdx, newIdx);
  }, []);

  const onPointerUp = useCallback(() => {
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    document.body.style.cursor = '';
    const wasDragging = dragRef.current?.dragging ?? false;
    dragRef.current = null;
    setDraggingId(null);
    // Swallow the click that fires right after a drag so it doesn't re-activate.
    if (wasDragging) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    }
  }, [onPointerMove]);

  function onTabPointerDown(e: React.MouseEvent, id: string) {
    if (e.button !== 0) return; // left button only
    dragRef.current = { id, startX: e.clientX, dragging: false };
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
  }

  // Safety cleanup if the component unmounts mid-drag.
  useEffect(() => () => {
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', onPointerUp);
    document.body.style.cursor = '';
  }, [onPointerMove, onPointerUp]);

  // Keyboard reordering — Ctrl/Cmd+Shift+←/→ moves the active tool tab one slot.
  // Dashboard (activeTabId === null) can't be moved. Ignored while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (activeTabId === null) return;
      const idx = tabs.findIndex(t => t.id === activeTabId);
      if (idx === -1) return;
      const target = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
      if (target < 0 || target >= tabs.length) return;
      e.preventDefault();
      reorderTab(idx, target);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tabs, activeTabId, reorderTab]);

  function handleTabClick(tabId: string, route: string) {
    setActiveTabId(tabId);
    resetIfDone(route);
    // Prefer the tab's last-known deep URL so coming back to a tool returns
    // to where you left off (e.g. the specific book in /bookkeeping/<id>).
    // Fall back to the canonical tool route for tabs we've never tracked.
    const tab = tabs.find(t => t.id === tabId);
    const target = tab?.currentRoute ?? route;
    if (TOOL_ROUTES.has(route)) {
      // Tool tab — TabPanels handles rendering. Just update the URL bar.
      window.history.replaceState(null, '', target);
    } else {
      // Workspace / settings / help — these are rendered through Next.js {children}.
      // `replaceState` would leave Next.js unaware so the previous page would linger.
      router.push(target);
    }
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
    <div ref={stripRef} className="app-tab-bar flex items-end gap-0.5 px-4 border-b border-[var(--border)] bg-[var(--bg-topbar)] overflow-x-auto scrollbar-thin shrink-0">
      {/* Dashboard tab — always first, permanent (non-draggable), uses Next.js
          Link. Given a persistent faint fill + a right divider so it reads as a
          fixed "home" anchor, distinct from the rearrangeable tool tabs. */}
      <Link
        href="/dashboard"
        onClick={() => setActiveTabId(null)}
        className={`flex items-center gap-1.5 px-3 h-9 mr-1 pr-3.5 text-xs font-medium border-b-2 border-r border-r-[var(--border)] transition-all duration-150 shrink-0
          ${activeTabId === null
            ? 'border-b-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]'
            : 'border-b-transparent text-[var(--text-secondary)] bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
          }`}
      >
        <LayoutDashboard size={13} className="shrink-0" />
        <span>Dashboard</span>
      </Link>

      {/* Tool tabs — draggable to rearrange */}
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTabId === tab.id;
        const isDragging = draggingId === tab.id;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            onMouseDown={e => onTabPointerDown(e, tab.id)}
            className={`group relative flex items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2 transition-colors duration-150 shrink-0 max-w-[160px] select-none
              ${isActive
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent-light)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
              }
              ${isDragging ? 'opacity-50' : ''}`}
          >
            {/* Tab label — button instead of Link so Next.js doesn't remount the page */}
            <button
              onClick={() => { if (suppressClickRef.current) return; handleTabClick(tab.id, tab.route); }}
              className="flex items-center gap-1.5 min-w-0 flex-1"
            >
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{tab.title}</span>
            </button>
            <Tooltip label="Close tab" className="shrink-0">
              <button
                onClick={e => handleCloseTab(e, tab.id)}
                onMouseDown={e => e.stopPropagation()}
                aria-label="Close tab"
                className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-[var(--danger)] ml-0.5 p-0.5 rounded"
              >
                <X size={11} />
              </button>
            </Tooltip>
          </div>
        );
      })}

      {/* New tab button — still uses router.push since newtab is a normal Next.js page */}
      {tabs.length < 8 && (
        <Tooltip label="Open new tab">
          <button
            onClick={() => router.push(addTab())}
            aria-label="Open new tab"
            className="flex items-center justify-center w-7 h-9 mb-px text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] rounded transition-all duration-150 shrink-0"
          >
            <Plus size={13} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
