'use client';

import { Link2, Receipt, Info } from 'lucide-react';
import { StudioCard } from './primitives';
import MtdItImport from './MtdItImport';
import AccountsStudioImport from './AccountsStudioImport';
import BookkeepingImport from './BookkeepingImport';
import LandlordImport from './LandlordImport';
import type { TaxReturn } from './types';

export default function ConnectedImports({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">
        <Link2 size={15} className="text-[var(--accent)]" /> Pull figures from connected tools
      </p>
      <MtdItImport ret={ret} patch={patch} />
      <AccountsStudioImport ret={ret} patch={patch} />
      <BookkeepingImport ret={ret} patch={patch} />
      <LandlordImport ret={ret} patch={patch} />
      <PayrollNote />
    </div>
  );
}

// Payroll is not yet a usable source: SMITH stores no per-individual employment
// income (P32 holds only employer-level PAYE/NIC totals, and the people/entities
// salary model isn't built). Be honest rather than fabricate figures.
function PayrollNote() {
  return (
    <StudioCard className="flex items-start gap-3 px-5 py-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Receipt size={18} /></div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">Payroll <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">No data</span></p>
        <p className="mt-0.5 flex items-start gap-1.5 text-[11.5px] text-[var(--text-muted)]">
          <Info size={12} className="mt-0.5 shrink-0" />
          SMITH doesn’t hold per-employee pay yet — P32 only records employer-level PAYE/NIC. Enter employment income (pay, tax, benefits) in Review &amp; Adjust for now. This activates once the people &amp; payroll model lands.
        </p>
      </div>
    </StudioCard>
  );
}
