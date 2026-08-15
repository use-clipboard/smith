'use client';

/**
 * NotificationToastNotifier — slide-in toasts for newly-arrived notifications.
 *
 * Rendered at the app-shell top level — NOT inside the header — because the
 * header's `backdrop-filter` makes it a containing block for `position: fixed`.
 * At the shell level it anchors to the viewport, like the email toaster.
 *
 * Driven by the realtime NotificationsProvider. Two behaviours worth knowing:
 *  - It pops at most ONE card; any extra pending toasts stack subtly behind it
 *    and reveal as you dismiss the front one, so a burst never fills the corner.
 *  - It never re-pops a notification you've already been shown, even across
 *    reloads: a per-browser "last toasted" high-water mark (newest created_at)
 *    is persisted, so only notifications that arrived AFTER it pop. The bell and
 *    its unread count are unaffected — this only governs the pop-up.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Bell, X } from 'lucide-react';
import { useNotifications, type NotificationItem } from './NotificationsProvider';
import { goToNotification } from '@/lib/notificationTarget';

const AUTO_DISMISS_MS = 10_000;
const MARK_KEY = 'smith:notif-last-toast';

function readMark(): number | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(MARK_KEY);
  return v == null ? null : (Number(v) || 0);
}
function writeMark(ms: number) {
  try { localStorage.setItem(MARK_KEY, String(ms)); } catch { /* ignore */ }
}
const created = (n: NotificationItem) => new Date(n.created_at).getTime() || 0;

export default function NotificationToastNotifier() {
  const { notifications, dismiss: dismissNotification } = useNotifications();
  const [toasts, setToasts] = useState<NotificationItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  // High-water mark of the newest notification we've toasted. null = not yet
  // seeded (brand-new browser); a number = returning user (from localStorage).
  const markRef = useRef<number | null>(readMark());

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    if (notifications.length === 0) return;
    const newest = Math.max(...notifications.map(created));

    // First ever run with no stored mark → seed the baseline silently so
    // existing notifications don't all pop the first time.
    if (markRef.current === null) {
      markRef.current = newest;
      writeMark(newest);
      notifications.forEach(n => seenIdsRef.current.add(n.id));
      return;
    }

    // Pop only genuinely-new, unread notifications: arrived after the high-water
    // mark AND not already shown this session.
    const fresh = notifications.filter(n =>
      !n.read && !seenIdsRef.current.has(n.id) && created(n) > markRef.current!,
    );
    if (fresh.length === 0) return;
    fresh.forEach(n => seenIdsRef.current.add(n.id));
    markRef.current = Math.max(markRef.current!, ...fresh.map(created));
    writeMark(markRef.current);
    setToasts(prev => [...prev, ...fresh]);
    fresh.forEach(n => setTimeout(() => dismiss(n.id), AUTO_DISMISS_MS));
  }, [notifications, dismiss]);

  const handleClick = useCallback((n: NotificationItem) => {
    goToNotification(n);
    dismiss(n.id);                 // remove the popup
    void dismissNotification(n.id); // dealt with → clear it from the bell too
  }, [dismiss, dismissNotification]);

  if (toasts.length === 0) return null;

  // Newest is the FRONT of the stack. Show up to 3; the rest just add to the
  // "+N" count. depth 0 = front (interactive), higher = peeking behind.
  const stack = toasts.slice(-3);
  const behindCount = toasts.length - 1;

  return (
    <div className="fixed bottom-5 right-5 z-[100] w-[26rem] pointer-events-none">
      <div className="relative">
        {stack.map((n, i) => {
          const depth = stack.length - 1 - i; // 0 = front
          const isFront = depth === 0;
          return (
            <div
              key={n.id}
              className={isFront ? 'relative' : 'absolute inset-x-0 top-0'}
              style={{
                transform: `translateY(${depth * -9}px) scale(${1 - depth * 0.05})`,
                opacity: isFront ? 1 : Math.max(0.35, 0.7 - depth * 0.18),
                zIndex: 10 - depth,
                pointerEvents: isFront ? 'auto' : 'none',
              }}
            >
              <button
                onClick={() => isFront && handleClick(n)}
                className="glass w-full text-left rounded-xl text-[var(--text-primary)] shadow-dropdown p-4 flex items-start gap-3 transition-all hover:brightness-105"
                style={{ animation: isFront ? 'notifToastIn 0.3s ease-out' : undefined, background: 'rgba(239, 68, 68, 0.14)' }}
                tabIndex={isFront ? 0 : -1}
              >
                <div className="w-10 h-10 rounded-xl bg-red-200/80 flex items-center justify-center shrink-0">
                  <Bell size={18} className="text-red-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-red-700">
                      {behindCount > 0 && isFront ? `New notification · +${behindCount} more` : 'New notification'}
                    </p>
                    {isFront && (
                      <span
                        onClick={e => { e.stopPropagation(); dismiss(n.id); }}
                        className="shrink-0 p-1 -m-1 rounded hover:bg-red-200/60 cursor-pointer"
                        role="button"
                        aria-label="Dismiss"
                      >
                        <X size={14} className="text-red-700/70" />
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate mt-0.5">{n.title}</p>
                  {n.body && <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{n.body}</p>}
                </div>
              </button>
            </div>
          );
        })}
      </div>
      <style jsx>{`
        @keyframes notifToastIn {
          from { transform: translateX(120%); opacity: 0; }
          to   { transform: translateX(0);     opacity: 1; }
        }
      `}</style>
    </div>
  );
}
