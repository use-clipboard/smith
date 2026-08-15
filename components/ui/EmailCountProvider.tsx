'use client';

/**
 * EmailCountProvider — the single owner of the email "untriaged" (and unread)
 * counts for the whole app. Sits at the top of the shell so the sidebar badge,
 * the dashboard briefing and the dashboard widget all read ONE shared number
 * instead of each hitting /api/email/unread separately (that endpoint is slow —
 * it enumerates the whole inbox — so we never want it called more than once).
 *
 * Two sources, broadcast-first:
 *   • The Email Triage page broadcasts its live card count on every change / poll
 *     via the `smith:email-untriaged` event. While that's recent it owns the
 *     number — an exact mirror of what the user sees in the tool.
 *   • Otherwise this provider polls /api/email/unread itself (60s, paused when
 *     the tab is hidden) so the badge/dashboard stay fresh even when the tool
 *     isn't open.
 *
 * `untriaged` / `unread` are null until the first load resolves, so consumers
 * can show a loading state rather than a misleading 0.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useModules } from './ModulesProvider';

type EmailMode = 'triage' | 'traditional';

interface EmailCountValue {
  untriaged: number | null;  // uncategorised inbox emails
  unread: number | null;     // Gmail unread inbox messages
  mode: EmailMode;           // the user's email mode (drives which count to show)
  /** The mode-appropriate count: untriaged in triage mode, unread in traditional. */
  count: number | null;
  refresh: () => void;       // force a re-fetch (e.g. after a triage action elsewhere)
}

const Ctx = createContext<EmailCountValue>({ untriaged: null, unread: null, mode: 'triage', count: null, refresh: () => {} });

/** Shared email counts. Safe to call anywhere under the app shell. */
export function useEmailCount(): EmailCountValue {
  return useContext(Ctx);
}

export default function EmailCountProvider({ children }: { children: React.ReactNode }) {
  const { isModuleActive } = useModules();
  const active = isModuleActive('email-triage');

  const [untriaged, setUntriaged] = useState<number | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [mode, setMode] = useState<EmailMode>('triage');
  // Timestamp of the last broadcast from the (open) email page — while recent,
  // poll results are ignored so the two can never fight over the number.
  const lastBroadcastRef = useRef(0);

  // The user's email mode. Fetched once (settings changes reload the page, so
  // this is always fresh on mount). Decides which count the badge/widgets show.
  useEffect(() => {
    if (!active) { setMode('triage'); return; }
    let cancelled = false;
    fetch('/api/email/triage-settings')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => {
        if (cancelled || !d?.settings) return;
        setMode(d.settings.mode === 'traditional' ? 'traditional' : 'triage');
      });
    return () => { cancelled = true; };
  }, [active]);

  const refresh = useCallback(() => {
    if (!active) return;
    fetch('/api/email/unread')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => {
        if (!d) return;
        if (Date.now() - lastBroadcastRef.current < 90_000) return;
        if (typeof d.untriaged === 'number') setUntriaged(d.untriaged);
        if (typeof d.count === 'number') setUnread(d.count);
      });
  }, [active]);

  // Initial fetch + 60s poll (skipped while the tab is hidden, to save quota).
  useEffect(() => {
    if (!active) { setUntriaged(null); setUnread(null); return; }
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 60_000);
    return () => clearInterval(id);
  }, [active, refresh]);

  // Live updates pushed by the Email page while it's mounted — untriaged in
  // triage mode, unread in both modes — so the badge tracks reads/new mail in
  // real time instead of waiting for the 60s poll.
  useEffect(() => {
    function onUntriaged(e: Event) {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') { lastBroadcastRef.current = Date.now(); setUntriaged(n); }
    }
    function onUnread(e: Event) {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') { lastBroadcastRef.current = Date.now(); setUnread(n); }
    }
    window.addEventListener('smith:email-untriaged', onUntriaged);
    window.addEventListener('smith:email-unread', onUnread);
    return () => {
      window.removeEventListener('smith:email-untriaged', onUntriaged);
      window.removeEventListener('smith:email-unread', onUnread);
    };
  }, []);

  const count = mode === 'traditional' ? unread : untriaged;

  return <Ctx.Provider value={{ untriaged, unread, mode, count, refresh }}>{children}</Ctx.Provider>;
}
