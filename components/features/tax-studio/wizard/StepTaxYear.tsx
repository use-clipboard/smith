'use client';

import { useState } from 'react';
import { Calendar, FileClock, Send, Hash, Sparkles, Loader2 } from 'lucide-react';
import { taxYearOptions, fmtDateUK, deriveStatus } from '../data';
import { StatusBadge } from '../primitives';
import type { WizardClient } from './wizardData';
import type { ReturnListItem } from '../persistence';

/** '2025/26' → '6 April 2025 – 5 April 2026'. */
function yearRange(label: string): string {
  const s = parseInt(label.slice(0, 4), 10);
  if (Number.isNaN(s)) return '';
  return `6 April ${s} – 5 April ${s + 1}`;
}

export default function StepTaxYear({
  taxYear, onChange, client, allReturns,
  returnTypeId, periodStart, periodEnd, onPeriodChange,
}: {
  taxYear: string;
  onChange: (y: string) => void;
  client: WizardClient | null;
  allReturns: ReturnListItem[];
  returnTypeId: string;
  periodStart: string;
  periodEnd: string;
  onPeriodChange: (start: string, end: string) => void;
}) {
  // Companies file for an accounting period, not a tax year — CT600 collects the
  // period dates directly (most foolproof; Accounts Studio / CH auto-fill later).
  const ct600 = returnTypeId === 'ct600';
  const periodInvalid = ct600 && !!periodStart && !!periodEnd && periodEnd <= periodStart;
  const [pulling, setPulling] = useState(false);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  async function pullPeriod() {
    if (!client) return;
    setPulling(true); setPullMsg(null);
    try {
      const res = await fetch(`/api/tax-studio/ct600/period?clientId=${client.id}`);
      const d = await res.json().catch(() => ({}));
      if (d?.found && d.periodStart && d.periodEnd) {
        onPeriodChange(d.periodStart, d.periodEnd);
        setPullMsg(`Pulled from ${d.source ?? 'the accounts'}.`);
      } else {
        setPullMsg('No accounting period found — enter it manually.');
      }
    } catch {
      setPullMsg('Could not fetch the period — enter it manually.');
    } finally { setPulling(false); }
  }
  const history = client
    ? allReturns.filter(r => r.ret.clientId === client.id).sort((a, b) => (a.ret.taxYear < b.ret.taxYear ? 1 : -1))
    : [];
  const lastReturn = history[0];
  const lastSubmitted = history.find(h => h.ret.approvalStatus === 'submitted');

  return (
    <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
      <h3 className="text-[16px] font-bold text-[var(--text-primary)]">3. {ct600 ? 'Accounting Period' : 'Tax Year'}</h3>
      <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
        {ct600
          ? 'Companies file for an accounting period, not a tax year — enter the period this return covers.'
          : 'Choose the year you’re preparing. SMITH will roll last year’s data forward next.'}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ct600 ? (
          /* Accounting period entry */
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] p-3.5 sm:col-span-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Calendar size={12} /> Accounting period</p>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Start</label>
                <input type="date" value={periodStart} onChange={e => onPeriodChange(e.target.value, periodEnd)} className="input-base py-1.5 text-sm font-semibold" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">End</label>
                <input type="date" value={periodEnd} onChange={e => onPeriodChange(periodStart, e.target.value)} className="input-base py-1.5 text-sm font-semibold" />
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={pullPeriod} disabled={pulling || !client}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.06] disabled:opacity-50">
                {pulling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Pull from Accounts Studio
              </button>
              {pullMsg && <span className="text-[11px] text-[var(--text-muted)]">{pullMsg}</span>}
            </div>
            {client?.year_end
              ? <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Client&apos;s year end: <span className="font-semibold text-[var(--text-secondary)]">{client.year_end}</span></p>
              : null}
            {periodInvalid && <p className="mt-1.5 text-[11px] font-medium text-rose-600">The end date must be after the start date.</p>}
          </div>
        ) : (
          /* Tax year selector */
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] p-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Calendar size={12} /> Tax year</p>
            <select value={taxYear} onChange={e => onChange(e.target.value)} className="input-base mt-1.5 py-1.5 text-sm font-semibold">
              {taxYearOptions().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{yearRange(taxYear)}</p>
          </div>
        )}

        {/* Last return */}
        <SummaryCard icon={FileClock} label="Last return">
          {lastReturn ? (
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-[var(--text-primary)]">{lastReturn.ret.taxYear}</span>
              <StatusBadge status={deriveStatus(lastReturn.ret)} />
            </div>
          ) : <span className="text-[13px] text-[var(--text-muted)]">No prior return</span>}
        </SummaryCard>

        {/* Last submitted */}
        <SummaryCard icon={Send} label="Last submitted">
          <span className="text-[13px] font-bold text-[var(--text-primary)]">
            {lastSubmitted?.ret.submittedAt ? fmtDateUK(lastSubmitted.ret.submittedAt) : '—'}
          </span>
        </SummaryCard>

        {/* Reference */}
        <SummaryCard icon={Hash} label="Reference">
          <span className="text-[13px] font-bold text-[var(--text-primary)]">
            {client?.utr_number || lastSubmitted?.ret.submissionRef || '—'}
          </span>
        </SummaryCard>
      </div>

      <p className="mt-4 text-[11.5px] text-[var(--text-muted)]">
        {ct600
          ? <>Accounting period <span className="font-semibold text-[var(--text-secondary)]">{periodStart ? fmtDateUK(periodStart) : '—'}</span> to <span className="font-semibold text-[var(--text-secondary)]">{periodEnd ? fmtDateUK(periodEnd) : '—'}</span>{client ? ` for ${client.name}` : ''}.</>
          : <>Preparing the <span className="font-semibold text-[var(--text-secondary)]">{taxYear}</span> return{client ? ` for ${client.name}` : ''}.</>}
      </p>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, children }: { icon: typeof Calendar; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
