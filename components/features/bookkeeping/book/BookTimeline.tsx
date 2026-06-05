'use client';

/**
 * BookTimeline — the "Timeline" tab of the book settings drawer.
 *
 * A vertical line with circular markers for each lifecycle event: book opened,
 * imports/migrations, VAT status changes, VAT submissions, year-end closes and
 * reopens. Newest first. Each row shows the date + who did it alongside the
 * marker, and the event title + description to the side.
 */

import { useEffect, useState } from 'react';
import {
  Loader2, BookOpen, Upload, Receipt, Landmark, Lock, Unlock, Clock,
} from 'lucide-react';

type TimelineKind =
  | 'book_opened' | 'import' | 'vat_status_change'
  | 'vat_submission' | 'year_end_closed' | 'year_end_reopened';

interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  title: string;
  description: string;
  userName: string | null;
}

const META: Record<TimelineKind, { icon: typeof Clock; ring: string; dot: string }> = {
  book_opened:        { icon: BookOpen, ring: 'border-indigo-200 bg-indigo-50', dot: 'text-indigo-600' },
  import:             { icon: Upload,   ring: 'border-sky-200 bg-sky-50',       dot: 'text-sky-600' },
  vat_status_change:  { icon: Receipt,  ring: 'border-amber-200 bg-amber-50',   dot: 'text-amber-600' },
  vat_submission:     { icon: Landmark, ring: 'border-emerald-200 bg-emerald-50', dot: 'text-emerald-600' },
  year_end_closed:    { icon: Lock,     ring: 'border-slate-300 bg-slate-100',  dot: 'text-slate-600' },
  year_end_reopened:  { icon: Unlock,   ring: 'border-violet-200 bg-violet-50', dot: 'text-violet-600' },
};

function ukDateTime(iso: string): string {
  const d = iso.slice(0, 10).split('-');
  return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : iso;
}

export default function BookTimeline({ bookId }: { bookId: string }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/bookkeeping/books/${bookId}/timeline`);
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok) { setError(d.error ?? 'Could not load the timeline.'); return; }
        setEvents((d.events ?? []) as TimelineEvent[]);
      } catch {
        if (alive) setError('Could not load the timeline.');
      }
    })();
    return () => { alive = false; };
  }, [bookId]);

  if (error) {
    return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>;
  }
  if (events === null) {
    return <p className="text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading timeline…</p>;
  }
  if (events.length === 0) {
    return <p className="text-xs text-slate-400">No events recorded yet.</p>;
  }

  return (
    <ol className="relative">
      {/* The vertical line */}
      <span aria-hidden className="absolute left-[15px] top-2 bottom-2 w-px bg-slate-200" />
      {events.map(ev => {
        const m = META[ev.kind] ?? META.book_opened;
        const Icon = m.icon;
        return (
          <li key={ev.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Marker */}
            <span className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full border flex items-center justify-center ${m.ring}`}>
              <Icon size={14} className={m.dot} />
            </span>
            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{ev.title}</p>
                <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">{ukDateTime(ev.at)}</span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5 break-words">{ev.description}</p>
              {ev.userName && <p className="text-[11px] text-slate-400 mt-0.5">by {ev.userName}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
