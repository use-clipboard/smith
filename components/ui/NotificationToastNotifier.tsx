'use client';

/**
 * NotificationToastNotifier — slide-in toasts for newly-arrived notifications,
 * mirroring EmailToastNotifier (bottom-right, auto-dismiss, click to open) but
 * with a pale-red panel and the notification bell icon.
 *
 * Rendered at the app-shell top level — NOT inside the header — because the
 * header's `backdrop-filter` makes it a containing block for `position: fixed`,
 * which would anchor "bottom-right" to the header strip (i.e. the top-right of
 * the screen). At the shell level it anchors to the viewport, like the email one.
 *
 * Driven by the realtime NotificationsProvider: it watches the shared list and
 * pops a toast the instant a fresh unread notification appears.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, X } from 'lucide-react';
import { useNotifications, type NotificationItem } from './NotificationsProvider';

const AUTO_DISMISS_MS = 10_000;

export default function NotificationToastNotifier() {
  const router = useRouter();
  const { notifications } = useNotifications();
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initialisedRef = useRef(false);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Watch the shared list for fresh unread notifications. The first run seeds
  // the baseline so existing notifications don't all pop on load.
  useEffect(() => {
    if (!initialisedRef.current) {
      notifications.forEach(n => seenIdsRef.current.add(n.id));
      initialisedRef.current = true;
      return;
    }
    const fresh = notifications.filter(n => !seenIdsRef.current.has(n.id));
    fresh.forEach(n => seenIdsRef.current.add(n.id));
    const freshUnread = fresh.filter(n => !n.read);
    if (freshUnread.length === 0) return;
    setToasts(prev => [...prev, ...freshUnread]);
    freshUnread.forEach(n => setTimeout(() => dismiss(n.id), AUTO_DISMISS_MS));
  }, [notifications, dismiss]);

  const handleClick = useCallback((n: NotificationItem) => {
    dismiss(n.id);
    const taskLink = (n.data as { task_link?: string } | null)?.task_link ?? null;
    if (taskLink) {
      router.push(taskLink);
    } else {
      window.dispatchEvent(new CustomEvent('smith:open-notifications'));
    }
  }, [dismiss, router]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map(n => (
        <button
          key={n.id}
          onClick={() => handleClick(n)}
          className="glass pointer-events-auto w-[26rem] text-left rounded-xl text-[var(--text-primary)] shadow-dropdown p-4 flex items-start gap-3 transition-all hover:brightness-105"
          style={{ animation: 'notifToastIn 0.3s ease-out', background: 'rgba(239, 68, 68, 0.14)' }}
        >
          <div className="w-10 h-10 rounded-xl bg-red-200/80 flex items-center justify-center shrink-0">
            <Bell size={18} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-red-700">
                New notification
              </p>
              <span
                onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                className="shrink-0 p-1 -m-1 rounded hover:bg-red-200/60 cursor-pointer"
                role="button"
                aria-label="Dismiss"
              >
                <X size={14} className="text-red-700/70" />
              </span>
            </div>
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate mt-0.5">{n.title}</p>
            {n.body && <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{n.body}</p>}
          </div>
        </button>
      ))}
      <style jsx>{`
        @keyframes notifToastIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
