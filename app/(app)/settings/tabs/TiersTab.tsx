'use client';

import { useEffect, useState } from 'react';
import {
  Check, Loader2, AlertTriangle, Info, ChevronDown, Plus, Minus, Users, Layers,
} from 'lucide-react';
import { PLAN_MODULES, PLAN_PRICE_PENCE, getModule } from '@/config/modules.config';

function pounds(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB')}`;
}

// ─── Expandable tool list ────────────────────────────────────────────────────
function ToolAccordion({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)] overflow-hidden">
      {ids.map(id => {
        const m = getModule(id);
        if (!m) return null;
        const isOpen = open === id;
        return (
          <div key={id}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : id)}
              className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--bg-nav-hover)] transition-colors"
            >
              <Check size={13} className="text-[var(--accent)] shrink-0" />
              <span className="text-sm font-medium text-[var(--text-primary)] flex-1">{m.name}</span>
              <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              <p className="px-4 pb-3 pl-9 text-xs text-[var(--text-muted)] leading-relaxed">{m.description}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  subscriptionTier: string;
  initialActiveModules: string[];
  initialSeatCount: number;
}

const TIER_CARDS: { id: 'compliance' | 'practice'; name: string; blurb: string }[] = [
  { id: 'compliance', name: 'Compliance', blurb: 'Everything you need for your clients’ compliance work.' },
  { id: 'practice', name: 'Practice Suite', blurb: 'Everything in Compliance, plus tools to run your whole firm.' },
];

export default function TiersTab({ subscriptionTier, initialSeatCount }: Props) {
  const [plan, setPlan] = useState<string>(subscriptionTier);
  const [savingPlan, setSavingPlan] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const [seatCount, setSeatCount] = useState(initialSeatCount);
  const [inUse, setInUse] = useState<number | null>(null);
  const [savingSeats, setSavingSeats] = useState(false);
  const [seatMsg, setSeatMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const isInternal = plan === 'internal';
  const complianceIds = PLAN_MODULES.compliance;
  const practiceOnlyIds = PLAN_MODULES.practice.filter(id => !complianceIds.includes(id));

  // Load current seats + how many are actually in use.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/firms/seats')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setInUse(d.inUse ?? 0); if (typeof d.seatCount === 'number') setSeatCount(d.seatCount); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const minSeats = Math.max(1, inUse ?? 1);
  const seatsDirty = seatCount !== initialSeatCount;

  async function handleSelectPlan(next: 'compliance' | 'practice') {
    if (!confirm(`Switch your firm to the ${next === 'compliance' ? 'Compliance' : 'Practice Suite'} plan? This changes which tools your whole team can use.`)) return;
    setSavingPlan(next);
    setPlanError(null);
    try {
      const res = await fetch('/api/firms/plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || 'Failed to change plan');
      setPlan(next);
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Failed to change plan');
    } finally {
      setSavingPlan(null);
    }
  }

  async function handleSaveSeats() {
    setSavingSeats(true);
    setSeatMsg(null);
    try {
      const res = await fetch('/api/firms/seats', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatCount }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.message || d.error || 'Failed to update seats');
      setInUse(d.inUse ?? inUse);
      setSeatMsg({ type: 'ok', text: 'Seats updated.' });
    } catch (err) {
      setSeatMsg({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update seats' });
    } finally {
      setSavingSeats(false);
    }
  }

  const perUser = plan === 'compliance' ? PLAN_PRICE_PENCE.compliance : plan === 'practice' ? PLAN_PRICE_PENCE.practice : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Layers size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Your Plan</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Choose the tier that fits your firm. Your plan decides which tools your whole team can use — unlimited clients on every plan.
            </p>
          </div>
          {isInternal && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--accent-light)] text-[var(--accent)] shrink-0">
              Internal · full access
            </span>
          )}
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TIER_CARDS.map(tier => {
          const isCurrent = plan === tier.id;
          return (
            <div key={tier.id} className={`glass-solid rounded-xl border p-5 flex flex-col ${isCurrent ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--border)]'}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[var(--text-primary)]">{tier.name}</h4>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--accent-light)] text-[var(--accent)]">
                    <Check size={10} strokeWidth={2.5} /> Current plan
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-end gap-1">
                <span className="text-3xl font-bold text-[var(--text-primary)]">{pounds(PLAN_PRICE_PENCE[tier.id])}</span>
                <span className="mb-1 text-xs text-[var(--text-muted)]">/ user / month + VAT</span>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">{tier.blurb}</p>
              <button
                type="button"
                disabled={isCurrent || savingPlan !== null}
                onClick={() => handleSelectPlan(tier.id)}
                className={`mt-4 inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60
                  ${isCurrent ? 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)] cursor-default' : 'bg-[var(--accent)] text-white hover:opacity-90'}`}
              >
                {savingPlan === tier.id ? <Loader2 size={13} className="animate-spin" /> : null}
                {isCurrent ? 'Your plan' : `Switch to ${tier.name}`}
              </button>
            </div>
          );
        })}
      </div>
      {planError && (
        <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-lg">
          <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 dark:text-red-400">{planError}</p>
        </div>
      )}

      {/* Seats */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">User Seats</h3>
        </div>
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSeatCount(s => Math.max(minSeats, s - 1))}
              disabled={seatCount <= minSeats}
              className="w-9 h-9 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Decrease seats"
            >
              <Minus size={15} />
            </button>
            <span className="text-2xl font-bold text-[var(--text-primary)] tabular-nums w-10 text-center">{seatCount}</span>
            <button
              type="button"
              onClick={() => setSeatCount(s => Math.min(500, s + 1))}
              className="w-9 h-9 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]"
              aria-label="Increase seats"
            >
              <Plus size={15} />
            </button>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            <p>Paying for <strong className="text-[var(--text-primary)]">{seatCount}</strong> seat{seatCount === 1 ? '' : 's'}</p>
            <p>{inUse === null ? 'Checking…' : <><strong className="text-[var(--text-primary)]">{inUse}</strong> in use — you can&apos;t drop below this</>}</p>
          </div>
          {seatsDirty && (
            <button onClick={handleSaveSeats} disabled={savingSeats} className="btn-primary text-sm ml-auto">
              {savingSeats ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {savingSeats ? 'Saving…' : 'Save seats'}
            </button>
          )}
        </div>
        {seatMsg && (
          <p className={`text-xs flex items-center gap-1.5 ${seatMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {seatMsg.type === 'ok' ? <Check size={12} /> : <AlertTriangle size={12} />} {seatMsg.text}
          </p>
        )}
        {!isInternal && (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 pt-1 border-t border-[var(--border)]">
            <Info size={12} className="text-[var(--accent)] shrink-0" />
            At {pounds(perUser)}/user, that&apos;s <strong className="text-[var(--text-primary)] mx-1">{pounds(perUser * seatCount)}/mo</strong> + VAT. Managed in the Subscription tab.
          </p>
        )}
        {inUse !== null && seatCount < inUse && (
          <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> To reduce seats below {inUse}, remove a team member first (Settings → Team).
          </p>
        )}
      </div>

      {/* What's included — expandable tool lists */}
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2 px-1">Compliance — included tools</p>
          <ToolAccordion ids={complianceIds} />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-2 px-1">Practice Suite adds</p>
          <ToolAccordion ids={practiceOnlyIds} />
        </div>
      </div>
    </div>
  );
}
