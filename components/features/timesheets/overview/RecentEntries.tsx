'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TimeEntry } from '@/lib/timesheets/types';
import { GlassCard, SectionHeader, TypeBadge } from '../shared/ui';
import { fmtDuration, fmtDateUK } from '@/lib/timesheets/format';
import EntryModal from '../shared/EntryModal';

export default function RecentEntries({ entries }: { entries: TimeEntry[] }) {
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = entries.slice(0, 8);

  return (
    <GlassCard>
      <SectionHeader
        title="Recent time entries"
        subtitle="Your latest logged work"
        right={
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)]/10 px-2.5 py-1.5 text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/15">
            <Plus size={14} /> Add
          </button>
        }
      />
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--text-muted)]">No entries yet.</p>
      ) : (
        <div className="-mx-2">
          {rows.map(e => (
            <button
              key={e.id}
              onClick={() => setEditing(e)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
            >
              <div className="w-16 shrink-0">
                <p className="text-[11px] font-medium text-[var(--text-secondary)]">{fmtDateUK(e.date).slice(0, 5)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{e.start}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{e.clientName}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">{e.activity}</p>
              </div>
              <TypeBadge type={e.type} />
              <span className="w-14 shrink-0 text-right text-[12.5px] font-bold text-[var(--text-primary)]">{fmtDuration(e.minutes)}</span>
            </button>
          ))}
        </div>
      )}
      {editing && <EntryModal entry={editing} onClose={() => setEditing(null)} />}
      {adding && <EntryModal onClose={() => setAdding(false)} />}
    </GlassCard>
  );
}
