'use client';

import { User, Calendar, FileText, RotateCcw, CheckCircle2, Sparkles } from 'lucide-react';
import { returnType, fmtMoney } from '../data';
import { estimateSa100 } from '../calc';
import { EstimateChip } from '../primitives';
import { ROLL_CATEGORIES, entityLabelForBusinessType, type RollKey, type WizardClient } from './wizardData';
import type { ReturnTypeId, Sa100Income } from '../types';

export default function StepConfirm({
  returnTypeId, client, taxYear, seededIncome, roll, hasPrior,
}: {
  returnTypeId: ReturnTypeId;
  client: WizardClient | null;
  taxYear: string;
  seededIncome: Sa100Income;
  roll: Record<RollKey, boolean>;
  hasPrior: boolean;
}) {
  const rt = returnType(returnTypeId);
  const est = estimateSa100(seededIncome, taxYear);
  const rolled = ROLL_CATEGORIES.filter(c => roll[c.key] && (c.mapsToIncome || c.key === 'personal'));

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <h3 className="text-[16px] font-bold text-[var(--text-primary)]">5. Review &amp; Confirm</h3>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">Check the details, then create the return to open the workspace.</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Summary icon={FileText} label="Return type" value={`${rt.form} · ${rt.label}`} />
          <Summary icon={User} label="Client" value={client?.name ?? '—'} sub={client ? `${client.client_ref ?? ''} · ${entityLabelForBusinessType(client.business_type)}` : ''} />
          <Summary icon={Calendar} label="Tax year" value={taxYear} />
        </div>

        <div className="mt-4 rounded-xl border border-[var(--border)] bg-white/60 p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-primary)]"><RotateCcw size={13} className="text-[var(--accent)]" /> Rolling forward</p>
          {hasPrior ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rolled.length ? rolled.map(c => (
                <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
                  <CheckCircle2 size={11} /> {c.label}
                </span>
              )) : <span className="text-[12px] text-[var(--text-muted)]">Nothing selected — starting fresh.</span>}
            </div>
          ) : (
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">First return in Tax Studio — you&apos;ll build the figures in the workspace.</p>
          )}
        </div>
      </div>

      {/* Estimate preview */}
      <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Opening estimate</p>
          <EstimateChip />
        </div>
        {est.totalIncome > 0 ? (
          <div className="space-y-1">
            <Row label="Total income" value={fmtMoney(est.totalIncome)} />
            <Row label="Estimated tax" value={fmtMoney(est.totalTax)} />
            <Row label="Balancing payment" value={fmtMoney(est.balancingPayment)} bold />
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">No figures yet — SMITH will help you bring them in on the Analyse step.</p>
        )}
        <div className="mt-3 rounded-xl bg-[var(--accent)]/[0.05] p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-primary)]"><Sparkles size={13} className="text-[var(--accent)]" /> What happens on create</p>
          <p className="mt-1 text-[11.5px] text-[var(--text-secondary)]">The return opens in the workspace at the Analyse stage, with connected data ready and your rolled-forward figures in place.</p>
        </div>
      </div>
    </div>
  );
}

function Summary({ icon: Icon, label, value, sub }: { icon: typeof User; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <p className="mt-1.5 truncate text-[13px] font-bold text-[var(--text-primary)]">{value}</p>
      {sub && <p className="truncate text-[11px] text-[var(--text-muted)]">{sub}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[12px] ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
      <span className={`text-[12.5px] ${bold ? 'font-bold text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}
