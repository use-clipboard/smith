'use client';

import { CreditCard, Info, Receipt, CalendarClock, Layers } from 'lucide-react';
import { PLAN_PRICE_PENCE, PLAN_LABELS } from '@/config/modules.config';

function formatPrice(pence: number): string {
  return `£${(pence / 100).toLocaleString('en-GB')}`;
}

interface Props {
  initialActiveModules: string[];
  initialSeatCount: number;
  subscriptionTier: string;
}

export default function BillingTab({ initialSeatCount, subscriptionTier }: Props) {
  const plan = subscriptionTier;
  const isInternal = plan === 'internal';
  const perUser = plan === 'compliance' ? PLAN_PRICE_PENCE.compliance : plan === 'practice' ? PLAN_PRICE_PENCE.practice : 0;
  const nextAmount = perUser * initialSeatCount;

  return (
    <div className="space-y-5">
      {/* Not-yet-active notice */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>
          Your SMITH subscription isn&apos;t active yet — you won&apos;t be charged. Card payments go live in Phase 2 (Stripe).
          To change your plan or seats, use <strong>Settings → Plan &amp; Tiers</strong>. (This is what SMITH charges your
          firm — to invoice <em>your own</em> clients, use the Billing tool.)
        </span>
      </div>

      {isInternal ? (
        <div className="glass-solid rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <Layers size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Internal plan</h3>
          </div>
          <p className="text-sm text-[var(--text-muted)]">Your firm has full access to every tool and isn&apos;t billed.</p>
        </div>
      ) : (
        <>
          {/* Next invoice */}
          <div className="glass-solid rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <CalendarClock size={15} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Next Invoice</h3>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-[var(--text-primary)] tabular-nums">{formatPrice(nextAmount)}<span className="text-sm font-normal text-[var(--text-muted)]"> + VAT</span></p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  {PLAN_LABELS[plan] ?? plan} · {initialSeatCount} {initialSeatCount === 1 ? 'seat' : 'seats'} × {formatPrice(perUser)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Due</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">— <span className="font-normal text-[var(--text-muted)]">(set when billing goes live)</span></p>
              </div>
            </div>
          </div>

          {/* Payment method */}
          <div className="glass-solid rounded-xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <CreditCard size={15} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Payment Method</h3>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-4">No payment method on file. You&apos;ll add a card when billing is activated.</p>
            <button disabled className="btn-secondary text-sm opacity-60 cursor-not-allowed">
              Manage billing details
            </button>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">Card management opens in the Stripe customer portal once billing is live.</p>
          </div>
        </>
      )}

      {/* Invoice history */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={15} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Invoices</h3>
        </div>
        <div className="text-center py-6">
          <p className="text-sm text-[var(--text-muted)]">No invoices yet.</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Your SMITH invoices will appear here once billing is active.</p>
        </div>
      </div>
    </div>
  );
}
