'use client';

// Per-user "show account numbers" preference.
//
// Stored in localStorage (per-user-per-browser) and broadcast via a custom
// event so every mounted component — pickers, ledger views, reports — updates
// the moment the toggle flips, without a reload or prop-drilling. Mirrors the
// app's existing localStorage-pref pattern (smith.*.v1 keys). Default OFF.

import { useCallback, useEffect, useState } from 'react';

const KEY = 'smith.bookkeeping.showAccountCodes.v1';
const EVENT = 'smith:account-codes-pref';

export function getShowAccountCodes(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export function setShowAccountCodes(value: boolean): void {
  try { window.localStorage.setItem(KEY, String(value)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: value })); } catch { /* ignore */ }
}

/** Reactive read of the preference. SSR-safe (starts false, syncs on mount). */
export function useShowAccountCodes(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(getShowAccountCodes());
    const sync = () => setOn(getShowAccountCodes());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync); // cross-tab
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return on;
}

/** Read + setter together, for the settings toggle. */
export function useAccountCodesToggle(): [boolean, (v: boolean) => void] {
  const on = useShowAccountCodes();
  const set = useCallback((v: boolean) => setShowAccountCodes(v), []);
  return [on, set];
}

/**
 * Inline code tag shown before an account name. Renders nothing when the
 * preference is off or the account has no code, so it's safe to drop in
 * anywhere — each instance reacts to the toggle on its own.
 */
export function AccountCodeTag({ code, className }: { code?: string | null; className?: string }) {
  const show = useShowAccountCodes();
  if (!show || !code) return null;
  return <span className={`text-[var(--text-muted)] tabular-nums font-normal ${className ?? ''}`}>{code}</span>;
}
