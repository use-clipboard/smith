'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, X } from 'lucide-react';
import { useModules } from './ModulesProvider';
import { useTabContext } from './TabContext';

interface RecentEmail {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  internalDate: number;
  isUnread: boolean;
}

interface Toast {
  key: string;
  fromName: string;
  subject: string;
  snippet: string;
  count: number; // >1 for grouped
}

const POLL_INTERVAL_MS = 60_000;
const AUTO_DISMISS_MS = 10_000;
const STORAGE_FLAG = 'smith:email_desktop_notifications';

function notificationsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  const v = localStorage.getItem(STORAGE_FLAG);
  return v === null ? true : v === 'true';
}

export default function EmailToastNotifier() {
  const router = useRouter();
  const { isModuleActive } = useModules();
  const { openTab } = useTabContext();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const dismiss = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  // The app uses a custom tabbed-tool system that overlays Next.js routing —
  // when a tool tab is active, navigating via router.push alone changes the URL
  // but the tab system keeps showing the previously active tool. We need to
  // both open the email tab *and* push the URL.
  const openEmailTool = useCallback((key: string) => {
    dismiss(key);
    openTab({ id: 'email-triage', title: 'Email Triage', route: '/email', icon: Mail });
    router.push('/email');
  }, [dismiss, openTab, router]);

  useEffect(() => {
    if (!isModuleActive('email-triage')) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      try {
        const res = await fetch('/api/email/recent', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { emails?: RecentEmail[] };
        const emails = data.emails ?? [];
        if (cancelled) return;

        // First poll establishes baseline — never notify on initial set
        if (!initialisedRef.current) {
          emails.forEach(e => seenIdsRef.current.add(e.id));
          initialisedRef.current = true;
          return;
        }

        const fresh = emails.filter(e => !seenIdsRef.current.has(e.id));
        fresh.forEach(e => seenIdsRef.current.add(e.id));
        if (fresh.length === 0) return;

        if (!notificationsEnabled()) return;

        if (fresh.length > 3) {
          const key = `group-${Date.now()}`;
          setToasts(prev => [...prev, {
            key,
            fromName: 'Email Triage',
            subject: `${fresh.length} new emails`,
            snippet: fresh.slice(0, 3).map(e => e.fromName).join(', ') + (fresh.length > 3 ? '…' : ''),
            count: fresh.length,
          }]);
          setTimeout(() => dismiss(key), AUTO_DISMISS_MS);
        } else {
          fresh.forEach((e, i) => {
            const key = `${e.id}-${Date.now()}-${i}`;
            setToasts(prev => [...prev, {
              key,
              fromName: e.fromName,
              subject: e.subject,
              snippet: e.snippet,
              count: 1,
            }]);
            setTimeout(() => dismiss(key), AUTO_DISMISS_MS);
          });
        }
      } catch {
        // Network/Gmail errors are silent — polling will retry
      }
    }

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [isModuleActive, dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(t => (
        <button
          key={t.key}
          onClick={() => openEmailTool(t.key)}
          className="pointer-events-auto w-[26rem] text-left rounded-xl bg-violet-50 dark:bg-violet-950/60 text-[var(--text-primary)] shadow-2xl ring-1 ring-violet-300/70 dark:ring-violet-700/60 p-4 flex items-start gap-3 hover:bg-violet-100 dark:hover:bg-violet-900/60 hover:ring-violet-400 transition-all"
          style={{ animation: 'emailToastIn 0.3s ease-out' }}
        >
          <div className="w-10 h-10 rounded-xl bg-violet-200 dark:bg-violet-800/70 flex items-center justify-center shrink-0">
            {t.count > 1 ? (
              <span className="text-sm font-bold text-violet-700 dark:text-violet-200">{t.count}</span>
            ) : (
              <Mail size={18} className="text-violet-600 dark:text-violet-300" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-violet-700 dark:text-violet-300">
                {t.count > 1 ? 'New emails' : 'New email'}
              </p>
              <span
                onClick={e => { e.stopPropagation(); dismiss(t.key); }}
                className="shrink-0 p-1 -m-1 rounded hover:bg-violet-200/60 dark:hover:bg-violet-800/60 cursor-pointer"
                role="button"
                aria-label="Dismiss"
              >
                <X size={14} className="text-violet-700/70 dark:text-violet-300/70" />
              </span>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate mt-0.5">{t.fromName}</p>
            <p className="text-sm font-medium text-[var(--text-secondary)] truncate">{t.subject}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{t.snippet}</p>
          </div>
        </button>
      ))}
      <style jsx>{`
        @keyframes emailToastIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
