'use client';

/**
 * TimelineSummaryCard — AI "state of play" summary for a client's timeline.
 *
 * Renders a compact "Summarise timeline" button (meant to sit in the timeline
 * toolbar). Clicking it opens a lightbox showing the summary; the last saved
 * summary loads instantly on mount (no AI call), and the lightbox auto-generates
 * one on first open if none exists. The user can regenerate from inside it.
 * Highlights are grouped by category (actions, deadlines, figures, open threads).
 */

import { useEffect, useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, X,
  CheckSquare, CalendarClock, PoundSterling, MessageSquare,
} from 'lucide-react';

type Category = 'action' | 'deadline' | 'financial' | 'open';
interface Highlight { category: Category; text: string }
interface SummaryData {
  overview: string;
  highlights: Highlight[];
  generatedAt: string;
  noteCount: number;
  truncated: boolean;
}

const CAT_META: Record<Category, { label: string; icon: typeof CheckSquare; chip: string }> = {
  action:    { label: 'Action',         icon: CheckSquare,   chip: 'text-indigo-700 bg-indigo-100' },
  deadline:  { label: 'Deadline',       icon: CalendarClock, chip: 'text-rose-700 bg-rose-100' },
  financial: { label: 'Financial',      icon: PoundSterling, chip: 'text-emerald-700 bg-emerald-100' },
  open:      { label: 'Awaiting reply', icon: MessageSquare, chip: 'text-amber-700 bg-amber-100' },
};
const CAT_ORDER: Category[] = ['action', 'deadline', 'financial', 'open'];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function TimelineSummaryCard({ clientId, noteCount }: { clientId: string; noteCount: number }) {
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);

  // Load the last saved summary (no AI call) so the lightbox shows it instantly.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/timeline-summary`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setSummary((d?.summary as SummaryData) ?? null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clientId]);

  async function generate() {
    setGenerating(true);
    setError('');
    try {
      const r = await fetch(`/api/clients/${clientId}/timeline-summary`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not generate a summary.');
      setSummary(d.summary as SummaryData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a summary.');
    } finally {
      setGenerating(false);
    }
  }

  function handleOpen() {
    setOpen(true);
    // First open with no cached summary → generate one automatically.
    if (!summary && !generating) void generate();
  }

  // Close the lightbox on Escape.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const ordered = summary
    ? [...summary.highlights].sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category))
    : [];

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={noteCount === 0}
        title={noteCount === 0 ? 'No timeline items to summarise yet' : undefined}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/20 hover:bg-[var(--accent)]/15 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Sparkles size={13} />
        Summarise timeline
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-solid w-full max-w-lg rounded-2xl border border-[var(--border)] shadow-dropdown overflow-hidden animate-slide-up"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-[var(--border)] bg-[var(--accent-light)]">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Sparkles size={15} className="text-[var(--accent)]" />
                AI Timeline Summary
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
                >
                  {generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {generating ? 'Regenerating…' : 'Regenerate'}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-3">
              {generating && !summary ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-muted)]">
                  <Loader2 size={16} className="animate-spin" /> Summarising timeline…
                </div>
              ) : summary ? (
                <>
                  <p className="text-sm text-[var(--text-primary)] leading-relaxed">{summary.overview}</p>

                  {ordered.length > 0 && (
                    <ul className="space-y-1.5">
                      {ordered.map((h, i) => {
                        const meta = CAT_META[h.category] ?? CAT_META.action;
                        const Icon = meta.icon;
                        return (
                          <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                            <span className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${meta.chip}`}>
                              <Icon size={11} /> {meta.label}
                            </span>
                            <span className="leading-snug">{h.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-muted)] pt-2 border-t border-[var(--border)]">
                    <span>Generated {fmtDateTime(summary.generatedAt)}</span>
                    <span>·</span>
                    <span>based on {summary.noteCount} timeline item{summary.noteCount === 1 ? '' : 's'}{summary.truncated ? ' (most recent)' : ''}</span>
                    <span className="text-[var(--text-muted)]/70">· AI-generated — verify against the timeline</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)] py-10 text-center">No summary yet — use Regenerate to create one.</p>
              )}

              {error && <p className="text-xs text-red-600">{error}</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
