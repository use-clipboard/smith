'use client';

import { useRouter } from 'next/navigation';
import { ClipboardCheck, ArrowRight, ExternalLink, FileCheck2, AlertTriangle, ScrollText, Sparkles, ArrowLeftRight } from 'lucide-react';
import { useTabContext } from '@/components/ui/TabContext';
import { setPendingClient } from '@/lib/pendingClient';
import { StudioCard } from '../primitives';
import type { Engagement } from '../types';

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

  function receiveResults() {
    patch(e => ({
      ...e,
      review: { status: 'complete', reviewPoints: 17, serious: 4, journalsApproved: 3, workingPapers: true, outputId: null },
    }));
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
              <Stat value={r.journalsApproved} label="Journals approved" tone="emerald" />
              <Stat value={r.workingPapers ? '✓' : '—'} label="Working papers" tone="accent" />
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 text-[12.5px] text-emerald-800">
              <ArrowLeftRight size={15} className="shrink-0" />
              Approved journals and updated balances have been received. Statutory figures are now locked for disclosure.
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={openReview} className="btn-secondary">
                <ExternalLink size={14} /> Open Review
              </button>
              <button onClick={advance} className="btn-primary flex-1 justify-center">
                Continue to Notes &amp; Disclosures <ArrowRight size={15} />
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 py-6">
            <p className="mb-4 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              Accounts Studio doesn&apos;t duplicate the review. Launch the dedicated Accounts Review module to identify risks, review balances and approve journals — then return here and the updated figures flow straight through.
            </p>
            <div className="flex gap-2">
              <button onClick={openReview} className="btn-primary flex-1 justify-center">
                <ExternalLink size={15} /> Open Accounts Review
              </button>
              <button onClick={receiveResults} className="btn-secondary">
                Receive results
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-[var(--text-muted)]">
              Once the review is signed off, its approved journals return automatically.
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
