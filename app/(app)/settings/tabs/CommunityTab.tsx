'use client';

import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Loader2, MessagesSquare } from 'lucide-react';

export default function CommunityTab() {
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [saved, setSaved]                   = useState(false);
  const [notificationsEnabled, setEnabled]  = useState(true);

  useEffect(() => {
    fetch('/api/community/preferences')
      .then(r => r.ok ? r.json() : { notifications_enabled: true })
      .then((d: { notifications_enabled: boolean }) => setEnabled(d.notifications_enabled))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    setSaving(true);
    try {
      const res = await fetch('/api/community/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifications_enabled: next }),
      });
      if (!res.ok) {
        setEnabled(!next); // revert
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
            <MessagesSquare size={16} className="text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Community</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed max-w-2xl">
              The Community board is a cross-firm space for SMITH users to share, ask, and help
              each other. Your name appears as <span className="font-medium">first name + last initial</span>{' '}
              (e.g. &ldquo;Christos M.&rdquo;) — your firm is never exposed to other users.
            </p>
          </div>
        </div>
      </div>

      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            {notificationsEnabled
              ? <Bell size={16} className="text-amber-600 dark:text-amber-400" />
              : <BellOff size={16} className="text-[var(--text-muted)]" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Reply notifications</h3>
              {saved && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check size={11} /> Saved
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Send a notification to the bell icon when someone replies to one of your posts.
              Turn this off if you&rsquo;d rather check the Community page manually.
            </p>
          </div>
          <button
            onClick={() => toggle(!notificationsEnabled)}
            disabled={saving}
            aria-label={notificationsEnabled ? 'Turn community notifications off' : 'Turn community notifications on'}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50 shrink-0
              ${notificationsEnabled ? 'bg-amber-500' : 'bg-[var(--border-input)]'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
              ${notificationsEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
