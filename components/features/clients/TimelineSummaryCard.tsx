'use client';

/**
 * TimelineSummaryCard — AI "state of play" summary for a client's timeline.
 *
 * On mount it loads the last saved summary (instant, no AI call). The user
 * generates / regenerates on demand; each run is saved server-side so the next
 * visit shows it immediately. Highlights are grouped by category (outstanding
 * actions, deadlines, financial figures, awaiting-reply threads).
 */

import { useEffect, useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, ChevronDown, ChevronUp,
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
  const [loading, setLoading] = useState(true);   // initial cache lookup
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  // Load the last saved summary (no AI call).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/clients/${clientId}/timeline-summary`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setSummary((d?.summary as SummaryData) ?? null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
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
      setCollapsed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a summary.');
    } finally {
      setGenerating(false);
    }
  }

  // Avoid a flash during the quick cache lookup.
  if (loading) return null;

  // ── Empty state — slim invitation banner ──────────────────────────────────
  if (!summary) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] px-4 py-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
            <Sparkles size={15} className="text-[var(--accent)] mt-0.5 shrink-0" />
            <span>Get an AI summary of this client&apos;s timeline — outstanding actions, deadlines, figures and open threads.</span>
          </div>
          <button
            onClick={generate}
            disabled={generating || noteCount === 0}
            className="btn-primary text-xs whitespace-nowrap disabled:opacity-50"
          >
            {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            {generating ? 'Summarising…' : 'Summarise timeline'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    );
  }

  // ── Summary card ───────────────────────────────────────────────────────────
  const ordered = [...summary.highlights].sort(
    (a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category),
  );

  return (
    <div className="rounded-xl border border-[var(--accent)]/25 bg-[var(--bg-card-solid)] overflow-hidden shadow-sm">
      {/* Header — solid accent tint so the pill stands out whether collapsed or open */}
      <div className={`flex items-center justify-between gap-2 px-4 py-2.5 bg-[var(--accent-light)] ${collapsed ? '' : 'border-b border-[var(--accent)]/20'}`}>
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
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand summary' : 'Collapse summary'}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-3 space-y-3">
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

          <div className="flex items-center gap-2 flex-wrap text-[11px] text-[var(--text-muted)] pt-1 border-t border-[var(--accent)]/10">
            <span>Generated {fmtDateTime(summary.generatedAt)}</span>
            <span>·</span>
            <span>based on {summary.noteCount} timeline item{summary.noteCount === 1 ? '' : 's'}{summary.truncated ? ' (most recent)' : ''}</span>
            <span className="text-[var(--text-muted)]/70">· AI-generated — verify against the timeline</span>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
