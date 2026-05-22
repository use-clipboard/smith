'use client';

import { BookCopy, Wrench } from 'lucide-react';

// Phase 0 placeholder for the Bookkeeping settings tab. The real settings
// (firm-wide Chart of Accounts editor, default roles, period-lock policy,
// VAT scheme defaults, etc.) land in later phases.
export default function BookkeepingSettingsTab() {
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
    </div>
  );
}
