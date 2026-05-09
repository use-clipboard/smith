'use client';
import { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import MeetingNotesClient, { type MeetingNotesSeed } from '@/components/features/meeting-notes/MeetingNotesClient';
import MeetingNotesHistory from '@/components/features/meeting-notes/MeetingNotesHistory';

// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function MeetingNotesPage() {
  const [view, setView] = useState<'history' | 'tool'>('history');
  const [seed, setSeed] = useState<MeetingNotesSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
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

  return (
    <div className="relative">
      <div className="px-6 pt-4">
        <button
          onClick={() => { setSeed(null); setView('history'); }}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          <ArrowLeft size={13} />
          Back to history
        </button>
      </div>
      <MeetingNotesClient seed={seed} />
    </div>
  );
}
