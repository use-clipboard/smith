'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, ArrowRight, ExternalLink, FileCheck2, AlertTriangle, ScrollText, Sparkles, ArrowLeftRight, Loader2, Inbox, X } from 'lucide-react';
import { useTabContext } from '@/components/ui/TabContext';
import { setPendingClient } from '@/lib/pendingClient';
import { StudioCard } from '../primitives';
import type { Engagement } from '../types';

interface ReviewRun {
  id: string;
  savedAt: string;
  businessName: string;
  periodEnd: string;
  reviewPoints: number;
  serious: number;
  journals: number;
  workingPapers: boolean;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export default function StageReview({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const router = useRouter();
  const { openTab } = useTabContext();
  const r = engagement.review;
  const complete = r.status === 'complete';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [picker, setPicker] = useState<ReviewRun[] | null>(null);

  function openReview() {
    if (engagement.clientId && engagement.clientRef) {
      setPendingClient('/final-accounts', {
        id: engagement.clientId,
        name: engagement.companyName,
        client_ref: engagement.clientRef,
        business_type: engagement.entityType,
        vat_number: null,
        status: 'active',
      });
    }
    openTab({ id: '', title: 'Accounts Review', route: '/final-accounts', icon: ClipboardCheck });
    router.push('/final-accounts');
  }

  function applyReview(run: ReviewRun) {
    patch(e => ({
      ...e,
      review: {
        status: 'complete',
        reviewPoints: run.reviewPoints,
        serious: run.serious,
        journalsApproved: run.journals,
        workingPapers: run.workingPapers,
        outputId: run.id,
      },
    }));
    setPicker(null);
    setError('');
  }

  async function receiveResults() {
    if (!engagement.clientId) { setError('Link a client to this engagement before receiving review results.'); return; }
    setLoading(true); setError(''); setPicker(null);
    try {
      const res = await fetch(`/api/accounts-studio/review-results?clientId=${engagement.clientId}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Could not load review results.');
      const runs = (d.reviews ?? []) as ReviewRun[];
      if (runs.length === 0) {
        setError('No saved Accounts Review found for this client yet. Run and save the review first.');
      } else if (runs.length === 1) {
        applyReview(runs[0]);
      } else {
        setPicker(runs); // let the user choose which review to link
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load review results.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-5">
      <StudioCard className="overflow-hidden lg:col-span-3">
        <div className="flex items-center gap-3 border-b border-black/5 px-6 py-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
            <ClipboardCheck size={22} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Accounts Review</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Validate the numbers before producing statutory accounts.</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            {complete ? 'Completed' : 'Not started'}
          </span>
        </div>

        {complete ? (
          <div className="px-6 py-5">
            <div className="grid grid-cols-4 gap-3">
              <Stat value={r.reviewPoints} label="Review points" />
              <Stat value={r.serious} label="Serious" tone="rose" />
              <Stat value={r.journalsApproved} label="Proposed journals" tone="emerald" />
              <Stat value={r.workingPapers ? '✓' : '—'} label="Working papers" tone="accent" />
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 text-[12.5px] text-emerald-800">
              <ArrowLeftRight size={15} className="shrink-0" />
              Linked to the saved Accounts Review. Apply any outstanding journals in Bookkeeping, then re-import if the figures change.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={openReview} className="btn-secondary">
                <ExternalLink size={14} /> Open Review
              </button>
              <button onClick={receiveResults} disabled={loading} className="btn-secondary disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Inbox size={14} />} Refresh
              </button>
              <button onClick={advance} className="btn-primary flex-1 justify-center">
                Continue to Notes &amp; Disclosures <ArrowRight size={15} />
              </button>
            </div>
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {picker && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/70 p-2">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Choose a review to link</p>
                  <button onClick={() => setPicker(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
                </div>
                {picker.map(run => (
                  <button key={run.id} onClick={() => applyReview(run)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--accent)]/5">
                    <FileCheck2 size={15} className="shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{run.businessName}{run.periodEnd ? ` · ${run.periodEnd}` : ''}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{run.reviewPoints} points · {run.serious} serious · {run.journals} journals · saved {fmtDate(run.savedAt)}</p>
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-6">
            <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              Accounts Studio doesn&apos;t duplicate the review. Launch the dedicated Accounts Review module to identify risks, review balances and approve journals — then return here and pull the saved results straight through.
            </p>
            <div className="flex gap-2">
              <button onClick={openReview} className="btn-primary flex-1 justify-center">
                <ExternalLink size={15} /> Open Accounts Review
              </button>
              <button onClick={receiveResults} disabled={loading} className="btn-secondary disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Inbox size={14} />} Receive results
              </button>
            </div>

            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {picker && (
              <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/70 p-2">
                <div className="flex items-center justify-between px-1 pb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Choose a review to link</p>
                  <button onClick={() => setPicker(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={13} /></button>
                </div>
                {picker.map(run => (
                  <button key={run.id} onClick={() => applyReview(run)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-[var(--accent)]/5">
                    <FileCheck2 size={15} className="shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">{run.businessName}{run.periodEnd ? ` · ${run.periodEnd}` : ''}</p>
                      <p className="text-[11px] text-[var(--text-muted)]">{run.reviewPoints} points · {run.serious} serious · {run.journals} journals · saved {fmtDate(run.savedAt)}</p>
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            )}

            <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
              Pulls the real review points, serious count, proposed journals and working papers from the saved Accounts Review.
            </p>
          </div>
        )}
      </StudioCard>

      {/* What flows back */}
      <StudioCard className="p-5 lg:col-span-2">
        <h4 className="mb-3 text-[13px] font-bold text-[var(--text-primary)]">What Accounts Review sends back</h4>
        <ul className="space-y-3">
          {[
            { icon: FileCheck2,  title: 'Updated balances', sub: 'Post-adjustment trial balance' },
            { icon: ArrowLeftRight, title: 'Approved journals', sub: 'Only journals you signed off' },
            { icon: AlertTriangle, title: 'Outstanding points', sub: 'Anything still flagged serious' },
            { icon: ScrollText, title: 'Working papers', sub: 'A1–H1 schedules for the file' },
          ].map(i => (
            <li key={i.title} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                <i.icon size={15} />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">{i.title}</p>
                <p className="text-[11.5px] text-[var(--text-muted)]">{i.sub}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5 text-[11.5px] text-[var(--accent)]">
          <Sparkles size={14} className="shrink-0" /> Analytical review lives in Accounts Review — Studio only produces the accounts.
        </div>
      </StudioCard>
    </div>
  );
}

function Stat({ value, label, tone = 'default' }: { value: number | string; label: string; tone?: 'default' | 'rose' | 'emerald' | 'accent' }) {
  const toneCls = {
    default: 'text-[var(--text-primary)]',
    rose: 'text-rose-600',
    emerald: 'text-emerald-600',
    accent: 'text-[var(--accent)]',
  }[tone];
  return (
    <div className="rounded-xl border border-black/5 bg-white/60 px-2 py-3 text-center">
      <p className={`text-2xl font-bold tabular-nums ${toneCls}`}>{value}</p>
      <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">{label}</p>
    </div>
  );
}
