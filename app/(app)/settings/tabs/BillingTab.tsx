'use client';

import { useState } from 'react';
import {
  CreditCard, Users, Loader2, AlertTriangle, Info, Check,
} from 'lucide-react';
import {
  MODULES, SEAT_PRICE_PENCE, type ModuleConfig,
} from '@/config/modules.config';

function formatPrice(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

interface LineItemProps {
  label: string;
  sublabel?: string;
  price: number;
}

function LineItem({ label, sublabel, price }: LineItemProps) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0">
      <div>
        <p className="text-sm text-[var(--text-primary)]">{label}</p>
        {sublabel && <p className="text-xs text-[var(--text-muted)] mt-0.5">{sublabel}</p>}
      </div>
      <p className="text-sm font-semibold text-[var(--text-primary)] tabular-nums">
        {formatPrice(price)}<span className="text-xs font-normal text-[var(--text-muted)]">/mo</span>
      </p>
    </div>
  );
}

interface Props {
  initialActiveModules: string[];
  initialSeatCount: number;
}

export default function BillingTab({ initialActiveModules, initialSeatCount }: Props) {
  const [seatCount, setSeatCount] = useState(initialSeatCount);
  const [savingSeats, setSavingSeats] = useState(false);
  const [seatSaved, setSeatSaved] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  // Only optional modules that are currently active
  const activeModuleDetails = MODULES.filter(
    m => !m.alwaysOn && initialActiveModules.includes(m.id)
  );

  const modulesTotal = activeModuleDetails.reduce((sum, m) => sum + m.monthlyPricePence, 0);
  const seatsTotal = seatCount * SEAT_PRICE_PENCE;
  const grandTotal = modulesTotal + seatsTotal;

  async function handleSaveSeats() {
    setSavingSeats(true);
    setSeatError(null);
    try {
      const res = await fetch('/api/firms/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeModules: initialActiveModules, seatCount }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.message || 'Failed to save');
      }
      setSeatSaved(true);
      setTimeout(() => setSeatSaved(false), 2500);
    } catch (err) {
      setSeatError(err instanceof Error ? err.message : 'Failed to save seat count');
    } finally {
      setSavingSeats(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Read-only notice */}
      <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
        <Info size={13} className="shrink-0 mt-0.5" />
        <span>
          This is a <strong>billing estimate only</strong> — actual payments are not configured yet.
          Stripe billing will be set up in Phase 2. Pricing shown is indicative and subject to change.
        </span>
      </div>

      {/* Seats */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">User Seats</h3>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          Set the number of staff seats for your firm. Each additional seat is{' '}
          <strong>{formatPrice(SEAT_PRICE_PENCE)}/month</strong>.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={500}
            value={seatCount}
            onChange={e => setSeatCount(Math.max(1, parseInt(e.target.value) || 1))}
            className="input-base w-24 text-center font-mono"
          />
          <button
            onClick={handleSaveSeats}
            disabled={savingSeats}
            className="btn-secondary text-sm"
          >
            {savingSeats ? (
              <><Loader2 size={13} className="animate-spin" /> Saving…</>
            ) : seatSaved ? (
              <><Check size={13} /> Saved</>
            ) : (
              'Update Seats'
            )}
          </button>
          {seatError && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
              <AlertTriangle size={12} />
              {seatError}
            </p>
          )}
        </div>
      </div>

      {/* Monthly cost breakdown */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard size={15} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Estimated Monthly Cost</h3>
        </div>

        <div className="space-y-0">
          {activeModuleDetails.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-2">No paid modules active.</p>
          ) : (
            activeModuleDetails.map(module => (
              <LineItem
                key={module.id}
                label={module.name}
                sublabel={module.category === 'integration' ? 'Integration' : 'Tool module'}
                price={module.monthlyPricePence}
              />
            ))
          )}
          <LineItem
            label="User Seats"
            sublabel={`${seatCount} seat${seatCount !== 1 ? 's' : ''} × ${formatPrice(SEAT_PRICE_PENCE)}`}
            price={seatsTotal}
          />
        </div>

        {/* Total */}
        <div className="flex items-center justify-between pt-3 mt-1 border-t-2 border-[var(--border)]">
          <p className="text-sm font-bold text-[var(--text-primary)]">Estimated Total</p>
          <p className="text-lg font-bold text-[var(--accent)] tabular-nums">
            {formatPrice(grandTotal)}<span className="text-xs font-normal text-[var(--text-muted)]">/mo</span>
          </p>
        </div>

        <p className="text-xs text-[var(--text-muted)] mt-3">
          Prices shown exclude VAT. Actual billing configuration and invoicing will be set up in Phase 2.
          Contact your account manager to discuss enterprise pricing.
        </p>
      </div>
    </div>
  );
}
