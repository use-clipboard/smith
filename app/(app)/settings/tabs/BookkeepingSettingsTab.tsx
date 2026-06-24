'use client';

import { BookCopy, Wrench, Hash } from 'lucide-react';
import { useAccountCodesToggle } from '@/lib/bookkeeping/useAccountCodes';

// Phase 0 placeholder for the Bookkeeping settings tab. The real firm-wide
// settings (Chart of Accounts editor, default roles, period-lock policy, VAT
// scheme defaults, etc.) land in later phases. The one live control today is a
// per-user display preference (account numbers).
export default function BookkeepingSettingsTab() {
  const [showCodes, setShowCodes] = useAccountCodesToggle();

  return (
    <div className="space-y-6">
      <div className="glass-solid rounded-xl p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--accent-light)]">
            <BookCopy size={18} className="text-[var(--accent)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Bookkeeping</h3>
            <p className="text-xs text-[var(--text-muted)]">Tool in development — settings will land in later phases.</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
          <Wrench size={12} />
          Phase 0 — gating shell only. Firm-wide Chart of Accounts, default permissions, VAT defaults and period-lock policy will appear here as those phases ship.
        </div>
      </div>

      {/* ── Per-user display preferences ─────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Display</h3>
        <p className="text-xs text-[var(--text-muted)] mb-5">
          These only affect your own view of the bookkeeping tool, not your colleagues&apos;.
        </p>

        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
              <Hash size={15} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Show account numbers</p>
              <p className="text-xs text-[var(--text-muted)]">
                Display the ranged code (e.g. 1000, 6000) next to each account in pickers, ledgers and reports.
              </p>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showCodes}
            aria-label="Show account numbers"
            onClick={() => setShowCodes(!showCodes)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              showCodes ? 'bg-[var(--accent)]' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                showCodes ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
