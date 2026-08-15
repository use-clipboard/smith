'use client';

/**
 * NotificationsProvider — the single app-wide owner of the signed-in user's
 * notifications. Pushed in real time: it subscribes to Supabase Realtime on the
 * notifications table (scoped to this user by RLS + a user_id filter), so a new
 * notification, a read, or a dismiss reflects the instant it happens — the bell,
 * its toasts, and the dashboard briefing tile all read from here.
 *
 * Replaces the old 30-second poll in TopBar. A long fallback poll remains purely
 * as a safety net in case the realtime socket drops.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

interface NotificationsValue {
  notifications: NotificationItem[];
  unreadCount: number;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<NotificationsValue>({
  notifications: [], unreadCount: 0,
  markAllRead: async () => {}, dismiss: async () => {}, refresh: () => {},
});

/** Shared notifications. Safe to call anywhere under the app shell. */
export function useNotifications(): NotificationsValue {
  return useContext(Ctx);
}

export default function NotificationsProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const supabase = createClient();

  const refresh = useCallback(() => {
    fetch('/api/notifications')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(d => { if (d?.notifications) setNotifications(d.notifications as NotificationItem[]); });
  }, []);

  // Initial load + a safety-net poll (realtime is the primary path; this just
  // covers a dropped socket or the pre-migration window before realtime is on).
  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  // Realtime: any change to my notifications → refetch the (small, capped) list.
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => refresh(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, supabase, refresh]);

  // Whenever the (realtime-driven) notification list changes, nudge the
  // count badges that derive from it — the HR sidebar/tool badge and the
  // timesheets approvals marker — so they update live instead of on a 2-min poll.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('smith:badge-refresh'));
  }, [notifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAllRead = useCallback(async () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    await fetch('/api/notifications', { method: 'PATCH' }).catch(() => {});
  }, []);

  const dismiss = useCallback(async (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
    await fetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
  }, []);

  return (
    <Ctx.Provider value={{ notifications, unreadCount, markAllRead, dismiss, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
