'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, X } from 'lucide-react';
import { useModules } from './ModulesProvider';

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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const dismiss = useCallback((key: string) => {
    setToasts(prev => prev.filter(t => t.key !== key));
  }, []);

  const openEmailTool = useCallback((key: string) => {
    dismiss(key);
    router.push('/email-triage');
  }, [dismiss, router]);

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
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map(t => (
        <button
          key={t.key}
          onClick={() => openEmailTool(t.key)}
          className="pointer-events-auto w-80 text-left rounded-xl bg-white shadow-2xl border border-gray-200 p-3 flex items-start gap-3 hover:shadow-xl hover:border-[var(--accent)]/30 transition-all animate-[slide-in-right_0.25s_ease-out]"
          style={{ animation: 'slideInRight 0.25s ease-out' }}
        >
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Mail size={14} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-900 truncate">{t.fromName}</p>
              <span
                onClick={e => { e.stopPropagation(); dismiss(t.key); }}
                className="shrink-0 p-0.5 rounded hover:bg-gray-100 cursor-pointer"
                role="button"
                aria-label="Dismiss"
              >
                <X size={12} className="text-gray-400" />
              </span>
            </div>
            <p className="text-xs font-medium text-gray-700 truncate mt-0.5">{t.subject}</p>
            <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.snippet}</p>
          </div>
        </button>
      ))}
      <style jsx>{`
        @keyframes slideInRight {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
