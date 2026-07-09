'use client';

import { useState } from 'react';
import { X, TrendingUp } from 'lucide-react';

interface Props {
  onClose: () => void;
  onApplied: () => void;
}

const FILTERS = [
  { id: 'all', label: 'All schedules' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
] as const;

// Common inflation-linked presets (indicative — the actual index isn't fetched).
const PRESETS = [3, 5, 10];

export default function PriceIncreaseModal({ onClose, onApplied }: Props) {
  const [percent, setPercent] = useState('5');
  const [frequency, setFrequency] = useState<(typeof FILTERS)[number]['id']>('all');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    const pct = parseFloat(percent);
    if (!Number.isFinite(pct)) { setError('Enter a percentage.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/billing/recurring/price-increase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ percent: pct, frequency }),
    });
    setBusy(false);
    if (r.ok) {
      const d = await r.json();
      setResult(`${d.updated} schedule${d.updated !== 1 ? 's' : ''} updated.`);
      onApplied();
    } else {
      const d = await r.json().catch(() => null);
      setError(d?.error ?? 'Could not apply the increase.');
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><TrendingUp size={18} /></div>
            <h3 className="text-[16px] font-bold text-[var(--text-primary)]">Price increase</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        {result ? (
          <div className="py-4 text-center">
            <p className="text-[15px] font-semibold text-emerald-600">{result}</p>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">New prices apply to the next invoice each schedule generates.</p>
            <button onClick={onClose} className="btn-primary mx-auto mt-4">Done</button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-[13px] text-[var(--text-muted)]">
              Apply an across-the-board percentage change to the unit prices of your active recurring schedules.
            </p>

            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Increase by</label>
            <div className="mb-1 flex items-center gap-2">
              <input type="number" step="0.5" value={percent} onChange={e => setPercent(e.target.value)} className="h-10 w-28 rounded-lg border border-black/10 px-3 text-[15px] font-semibold outline-none focus:border-[var(--accent)]" />
              <span className="text-[15px] font-semibold text-[var(--text-muted)]">%</span>
              <div className="ml-2 flex gap-1">
                {PRESETS.map(p => (
                  <button key={p} onClick={() => setPercent(String(p))} className="rounded-lg bg-black/[0.04] px-2.5 py-1 text-[12px] font-semibold text-[var(--text-muted)] hover:bg-black/[0.08]">+{p}%</button>
                ))}
              </div>
            </div>
            <p className="mb-4 text-[11px] text-[var(--text-muted)]">Tip: for RPI/CPI-linked reviews, enter the published index figure.</p>

            <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Apply to</label>
            <div className="mb-5 flex flex-wrap gap-1.5">
              {FILTERS.map(f => (
                <button key={f.id} onClick={() => setFrequency(f.id)} className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition ${frequency === f.id ? 'bg-[var(--accent)] text-white' : 'bg-black/[0.04] text-[var(--text-muted)] hover:bg-black/[0.07]'}`}>{f.label}</button>
              ))}
            </div>

            {error && <p className="mb-3 text-[13px] text-[var(--danger)]">{error}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={apply} disabled={busy} className="btn-primary disabled:opacity-50">{busy ? 'Applying…' : 'Apply increase'}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
