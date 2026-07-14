'use client';

/**
 * PersonSettingsPanel — per-owner tax settings for the personal reports.
 *
 * The £1,000 property income allowance, losses brought forward and the
 * finance-cost restriction are PERSONAL reliefs: two co-owners of the same
 * portfolio can have different entity types, different losses, and one may be
 * better off claiming the allowance while the other isn't. So each owner gets
 * their own settings, and their report is computed on their share with their
 * reliefs — not as a slice of the portfolio's answer.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Users, Sparkles } from 'lucide-react';
import type { RentComputation } from '@/utils/landlordComputation';
import type { LandlordPersonSettings } from '@/lib/landlord/landlordPackHtml';
import { DEFAULT_PERSON_SETTINGS } from '@/lib/landlord/landlordPackHtml';

const fmt = (n: number) => n.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Person { key: string; name: string }

export default function PersonSettingsPanel({
  people, settings, onChange, compFor,
}: {
  people: Person[];
  settings: Record<string, LandlordPersonSettings>;
  onChange: (key: string, patch: Partial<LandlordPersonSettings>) => void;
  compFor: (key: string) => RentComputation;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="glass-solid rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-[var(--surface-hover)] transition-colors">
        {open ? <ChevronDown size={15} className="text-[var(--text-muted)]" /> : <ChevronRight size={15} className="text-[var(--text-muted)]" />}
        <Users size={15} className="text-[var(--accent)]" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Per-person tax settings</p>
          <p className="text-[11px] text-[var(--text-muted)]">
            The allowance, losses and the finance-cost restriction are personal — set them per owner for the individual reports.
          </p>
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-3 border-t border-[var(--border)]">
          {people.map(p => {
            const s = settings[p.key] ?? DEFAULT_PERSON_SETTINGS;
            const c = compFor(p.key);
            return (
              <div key={p.key} className="rounded-lg border border-[var(--border)] p-3.5">
                <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2.5">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{p.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {fmt(c.totalIncome)} income · {fmt(c.totalExpenses)} {c.allowanceUsed ? 'deduction' : 'expenses'} ·{' '}
                    <span className={`font-medium ${c.netProfit < 0 ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
                      {c.netProfit >= 0 ? 'profit' : 'loss'} {fmt(Math.abs(c.netProfit))}
                    </span>
                  </p>
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => onChange(p.key, { entityType: 'individual' })}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${s.entityType === 'individual' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Individual</button>
                    <button onClick={() => onChange(p.key, { entityType: 'company' })}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${s.entityType === 'company' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Company</button>
                  </div>

                  {s.entityType === 'individual' && (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={s.useAllowance} onChange={e => onChange(p.key, { useAllowance: e.target.checked })} className="rounded" />
                      £1,000 allowance
                    </label>
                  )}

                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    Losses b/f
                    <input type="number" min="0" step="0.01" value={s.broughtForwardLoss || ''}
                      onChange={e => onChange(p.key, { broughtForwardLoss: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00" className="input-base text-xs w-24 py-1" />
                  </label>

                  {s.entityType === 'individual' && !s.useAllowance && c.allowanceWouldHelp && (
                    <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                      <Sparkles size={10} /> The allowance may beat their {fmt(c.totalExpenses)} of expenses
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-[var(--text-muted)]">
            These apply to each person&rsquo;s own report only. The combined report uses the portfolio settings from step 4.
          </p>
        </div>
      )}
    </div>
  );
}
