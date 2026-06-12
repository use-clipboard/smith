'use client';
import { useState, useEffect } from 'react';
import MeetingNotesClient, { type MeetingNotesSeed } from '@/components/features/meeting-notes/MeetingNotesClient';
import MeetingNotesHistory from '@/components/features/meeting-notes/MeetingNotesHistory';
import { peekPendingClient } from '@/lib/pendingClient';

// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function MeetingNotesPage() {
  // If the user reached this page via a Quick Launch pill on the client page,
  // skip the history dashboard and land directly on the new-analysis form.
  const [view, setView] = useState<'history' | 'tool'>(
    () => peekPendingClient('/meeting-notes') ? 'tool' : 'history',
  );
  const [seed, setSeed] = useState<MeetingNotesSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  // If the tab is already open and the user clicks the pill again, the
  // setPendingClient() call dispatches this event — switch to tool view.
  useEffect(() => {
    function onPending(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/meeting-notes') return;
      setSeed(null);
      setView('tool');
    }
    window.addEventListener('smith:pending-client', onPending);
    return () => window.removeEventListener('smith:pending-client', onPending);
  }, []);

  if (view === 'history') {
    return (
      <MeetingNotesHistory
        currentUserId={me.userId}
        isAdmin={me.userRole === 'admin'}
        onNew={() => { setSeed(null); setView('tool'); }}
        onOpen={s => { setSeed(s); setView('tool'); }}
      />
    );
  }

  return <MeetingNotesClient seed={seed} onBack={() => { setSeed(null); setView('history'); }} />;
}
