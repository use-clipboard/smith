'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Building2, Ruler, BookOpen, CalendarRange, Sparkles, TrendingUp, Scale, AlertCircle, Users, Plus, Check } from 'lucide-react';
import { ENTITY_LABELS, SIZE_LABELS } from '../data';
import { StudioCard } from '../primitives';
import StatementsView from '../StatementsView';
import { computePartners, blankPartner } from '@/lib/accounts-studio/partners';
import type { Engagement, PartnerRecord } from '../types';

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(£${abs})` : `£${abs}`;
}
function isoToUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

export default function StagePreparation({
  engagement, patch, advance,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
}) {
  const stmts = engagement.statements;

  if (!stmts || !engagement.importInfo) {
    return (
      <div className="mx-auto max-w-lg">
        <StudioCard className="p-6 text-center">
          <AlertCircle size={26} className="mx-auto mb-3 text-amber-500" />
          <h3 className="text-[15px] font-bold text-[var(--text-primary)]">No imported data yet</h3>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">Go back to Import Data and pull a trial balance from the client&apos;s bookkeeping book first.</p>
        </StudioCard>
      </div>
    );
  }

  const info = engagement.importInfo;
  const periodLabel = `For the period ${isoToUk(info.from)} to ${isoToUk(info.to)}`;
  const isPartnershipFamily = engagement.entityType === 'partnership' || engagement.entityType === 'llp';

  const detections = [
    { icon: Building2,     label: 'Entity type',      value: ENTITY_LABELS[engagement.entityType] },
    { icon: Ruler,         label: 'Company size',     value: SIZE_LABELS[engagement.size] },
    { icon: BookOpen,      label: 'Framework',        value: engagement.framework },
    { icon: CalendarRange, label: 'Reporting period', value: `${engagement.periodStart} – ${engagement.periodEnd}` },
  ];

  const headline = [
    { label: 'Turnover',         value: stmts.profitLoss.turnoverTotal },
    { label: 'Gross profit',     value: stmts.profitLoss.grossProfit },
    { label: 'Profit for year',  value: stmts.profitLoss.netProfit },
    { label: 'Total assets',     value: stmts.balanceSheet.totalAssets },
    { label: 'Net assets',       value: stmts.balanceSheet.netAssets },
  ];

  return (
    <div className="space-y-4">
      <StudioCard className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><Sparkles size={18} /></span>
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Statutory accounts prepared</h3>
            <p className="text-[12px] text-[var(--text-muted)]">
              Built from the imported trial balance — {info.bookName}, {periodLabel.toLowerCase()}.
              {stmts.hasPrior ? ' Comparatives included.' : ' No prior year found.'}
            </p>
          </div>
        </div>
      </StudioCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StudioCard className="p-5">
          <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><Building2 size={14} className="text-[var(--accent)]" /> What SMITH detected</h4>
          <div className="grid grid-cols-2 gap-2">
            {detections.map(d => (
              <div key={d.label} className="rounded-xl border border-black/5 bg-white/60 px-3 py-2.5">
                <p className="text-[11px] text-[var(--text-muted)]">{d.label}</p>
                <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{d.value}</p>
              </div>
            ))}
          </div>
        </StudioCard>

        <StudioCard className="p-5">
          <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><TrendingUp size={14} className="text-[var(--accent)]" /> Headline figures</h4>
          <div className="space-y-1.5">
            {headline.map(h => (
              <div key={h.label} className="flex items-center justify-between border-b border-black/5 py-1.5 last:border-0">
                <span className="text-[12.5px] text-[var(--text-secondary)]">{h.label}</span>
                <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{money(h.value)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <Scale size={12} /> A cash flow statement is omitted under the small-company / FRS 105 exemptions where applicable.
          </p>
        </StudioCard>
      </div>

      {/* Partner / member data — drives the appropriation account and the
          capital & current account schedules. */}
      {isPartnershipFamily && (
        <PartnersEditor engagement={engagement} patch={patch} />
      )}

      <StatementsView statements={stmts} periodLabel={periodLabel} />

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to Notes & Disclosures <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Partners / members editor ────────────────────────────────────────────────
const parseNum = (s: string) => { const n = parseFloat((s || '').replace(/[£,\s]/g, '')); return isNaN(n) ? 0 : n; };
const numStr = (n: number) => (n ? String(n) : '');

function PartnersEditor({ engagement, patch }: { engagement: Engagement; patch: (u: (e: Engagement) => Engagement) => void }) {
  const isLlp = engagement.entityType === 'llp';
  const ownerPlural = isLlp ? 'Members' : 'Partners';
  const netProfit = engagement.statements?.profitLoss.netProfit ?? 0;
  const netAssets = engagement.statements?.balanceSheet.netAssets ?? 0;

  const nextId = useRef(0);
  const [rows, setRows] = useState<PartnerRecord[]>(() => {
    if (engagement.partners?.length) return engagement.partners;
    const names = (engagement.directors ?? engagement.partners?.map(p => p.name) ?? []).filter(Boolean);
    if (names.length) return names.map((n, i) => ({ ...blankPartner(`p${i}`), name: n }));
    return [blankPartner('p0'), blankPartner('p1')];
  });

  const save = (next: PartnerRecord[]) => { setRows(next); patch(e => ({ ...e, partners: next })); };
  const setField = (id: string, field: keyof PartnerRecord, value: string) =>
    save(rows.map(r => r.id === id ? { ...r, [field]: field === 'name' ? value : parseNum(value) } : r));
  const addRow = () => save([...rows, blankPartner(`p-${nextId.current++}-${rows.length}`)]);
  const removeRow = (id: string) => save(rows.filter(r => r.id !== id));

  const comp = computePartners(rows, netProfit);
  const fundsMatch = Math.abs(comp.totals.partnersFunds - netAssets) < 1;

  const COLS: { key: keyof PartnerRecord; label: string }[] = [
    { key: 'profitShare', label: 'Profit share' },
    { key: 'salary', label: 'Salary' },
    { key: 'interestOnCapital', label: 'Int. on capital' },
    { key: 'openingCapital', label: 'Opening capital' },
    { key: 'capitalIntroduced', label: 'Capital in' },
    { key: 'capitalWithdrawn', label: 'Capital out' },
    { key: 'openingCurrent', label: 'Opening current' },
    { key: 'drawings', label: 'Drawings' },
  ];
  const amt = 'w-[74px] rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-[12px] tabular-nums';

  return (
    <StudioCard className="p-5">
      <div className="mb-1 flex items-center gap-1.5">
        <Users size={15} className="text-[var(--accent)]" />
        <h4 className="text-[13px] font-bold text-[var(--text-primary)]">{ownerPlural} — capital, current accounts &amp; profit share</h4>
      </div>
      <p className="mb-3 text-[11.5px] text-[var(--text-muted)]">
        Enter each {isLlp ? 'member' : 'partner'}&apos;s figures. SMITH allocates the profit for the year (interest on capital and salaries first, then the balance in the profit-share ratio) and reconciles the capital and current accounts into the Appropriation Account and the {isLlp ? 'members' : 'partners'}&apos; schedules.
      </p>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            <tr>
              <th className="px-2 py-1.5 text-left font-semibold">{isLlp ? 'Member' : 'Partner'}</th>
              {COLS.map(c => <th key={c.key} className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{c.label}</th>)}
              <th className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">Closing current</th>
              <th className="px-1 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const c = comp.partners.find(p => p.id === r.id);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-1">
                    <input value={r.name} onChange={e => setField(r.id, 'name', e.target.value)} placeholder="Name"
                      className="w-[130px] rounded border border-slate-200 bg-white px-1.5 py-1 text-[12px]" />
                  </td>
                  {COLS.map(col => (
                    <td key={col.key} className="px-2 py-1">
                      <input value={numStr(r[col.key] as number)} onChange={e => setField(r.id, col.key, e.target.value)} inputMode="decimal" className={amt} />
                    </td>
                  ))}
                  <td className="px-2 py-1 text-right tabular-nums text-[var(--text-secondary)]">{money(c?.closingCurrent ?? 0)}</td>
                  <td className="px-1 py-1 text-center">
                    <button onClick={() => removeRow(r.id)} aria-label="Remove" className="text-slate-300 hover:text-rose-600">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50/70 text-[11.5px] font-semibold text-[var(--text-secondary)]">
            <tr>
              <td className="px-2 py-1.5">Total</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{comp.totals && rows.reduce((s, r) => s + (r.profitShare || 0), 0)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.salary)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.interestOnCapital)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.openingCapital)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.capitalIntroduced)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.capitalWithdrawn)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.openingCurrent)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.drawings)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(comp.totals.closingCurrent)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={addRow} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"><Plus size={13} /> Add {isLlp ? 'member' : 'partner'}</button>
        <div className="flex-1" />
        <span className="text-[11.5px] text-[var(--text-muted)]">Profit for the year <strong className="text-[var(--text-secondary)]">{money(netProfit)}</strong></span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${fundsMatch ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {fundsMatch ? <><Check size={11} /> Funds tie to net assets</> : <><AlertCircle size={11} /> Funds {money(comp.totals.partnersFunds)} vs net assets {money(netAssets)}</>}
        </span>
      </div>
    </StudioCard>
  );
}
