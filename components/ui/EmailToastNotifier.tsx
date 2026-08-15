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
  email?: RecentEmail; // present only for single-email toasts → enables deep-link
}

/** Event + sessionStorage handoff used to tell a (possibly not-yet-mounted)
 * Email Triage page which thread to open when a single-email toast is clicked. */
export const EMAIL_OPEN_THREAD_EVENT = 'smith:email-open-thread';
export const EMAIL_OPEN_THREAD_KEY = 'smith:open-email-thread';
export interface OpenEmailThreadPayload {
  threadId: string;
  id: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  internalDate: number;
  isUnread: boolean;
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
  // High-water mark of the newest email arrival time we've seen. Only emails
  // that arrive AFTER this notify — see the filter below.
  const latestDateRef = useRef(0);

  const dismiss = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  // The app uses a custom tabbed-tool system that overlays Next.js routing —
  // when a tool tab is active, navigating via router.push alone changes the URL
  // but the tab system keeps showing the previously active tool. We need to
  // both open the email tab *and* push the URL.
  const openEmailTool = useCallback((key: string) => {
    dismiss(key);
    openTab({ id: 'email-triage', title: 'Email', route: '/email', icon: Mail });
    router.push('/email');
  }, [dismiss, openTab, router]);

  // Single-email toast: open the email tool *and* the specific thread. The
  // page may not be mounted yet, so we hand off via sessionStorage (drained on
  // mount) AND dispatch an event (caught if it's already mounted).
  const openSingleEmail = useCallback((key: string, email: RecentEmail) => {
    dismiss(key);
    const payload: OpenEmailThreadPayload = {
      threadId: email.threadId,
      id: email.id,
      fromName: email.fromName,
      fromEmail: email.fromEmail,
      subject: email.subject,
      snippet: email.snippet,
      internalDate: email.internalDate,
      isUnread: email.isUnread,
    };
    try { sessionStorage.setItem(EMAIL_OPEN_THREAD_KEY, JSON.stringify(payload)); } catch { /* ignore */ }
    openTab({ id: 'email-triage', title: 'Email', route: '/email', icon: Mail });
    router.push('/email');
    window.dispatchEvent(new CustomEvent<OpenEmailThreadPayload>(EMAIL_OPEN_THREAD_EVENT, { detail: payload }));
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

        // First poll establishes the baseline — never notify on the initial set,
        // and record the newest arrival time as the high-water mark.
        if (!initialisedRef.current) {
          emails.forEach(e => seenIdsRef.current.add(e.id));
          latestDateRef.current = emails.reduce((m, e) => Math.max(m, e.internalDate), 0);
          initialisedRef.current = true;
          return;
        }

        // Only TRUE new arrivals notify — an email whose arrival time is newer
        // than anything we've seen. This excludes old unread emails that merely
        // bubbled into the "10 most recent unread" window because you read newer
        // ones above them (reading the top pulls older unread mail up into it).
        const fresh = emails.filter(e => !seenIdsRef.current.has(e.id) && e.internalDate > latestDateRef.current);
        emails.forEach(e => seenIdsRef.current.add(e.id));
        latestDateRef.current = emails.reduce((m, e) => Math.max(m, e.internalDate), latestDateRef.current);
        if (fresh.length === 0) return;

        if (!notificationsEnabled()) return;

        if (fresh.length > 3) {
          const key = `group-${Date.now()}`;
          setToasts(prev => [...prev, {
            key,
            fromName: 'Email',
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
              email: e,
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
          onClick={() => t.email ? openSingleEmail(t.key, t.email) : openEmailTool(t.key)}
          className="glass pointer-events-auto w-[26rem] text-left rounded-xl text-[var(--text-primary)] shadow-dropdown p-4 flex items-start gap-3 hover:bg-white/55 transition-all"
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
