'use client';

import { useRef, useState } from 'react';
import { ArrowRight, Building2, Ruler, BookOpen, CalendarRange, Sparkles, TrendingUp, Scale, AlertCircle, Users, Plus, Check, SlidersHorizontal } from 'lucide-react';
import { ENTITY_LABELS, SIZE_LABELS } from '../data';
import { StudioCard } from '../primitives';
import StatementsView from '../StatementsView';
import { computePartners, blankPartner } from '@/lib/accounts-studio/partners';
import { buildDisclosures } from '@/lib/accounts-studio/disclosures';
import type { Engagement, PartnerRecord, CompanySize, DisclosureSection, EntityType } from '../types';

function money(n: number): string {
  const v = Math.round(n * 100) / 100;
  const abs = Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? `(£${abs})` : `£${abs}`;
}
function isoToUk(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

// Framework choices the user can override to, per entity type. The current
// framework is always included so a bespoke/detected value is never lost.
function frameworkOptions(entity: EntityType, current: string): string[] {
  let opts: string[];
  switch (entity) {
    case 'charity':     opts = ['FRS 102 (Charities SORP)']; break;
    case 'trust':       opts = ['FRS 102']; break;
    case 'sole_trader':
    case 'partnership': opts = ['FRS 105 (Micro-entity)', 'FRS 102']; break;
    case 'llp':         opts = ['FRS 105 (Micro-entity)', 'FRS 102 Section 1A (LLP SORP)', 'FRS 102 (LLP SORP)']; break;
    default:            opts = ['FRS 105 (Micro-entity)', 'FRS 102 Section 1A', 'FRS 102']; // company / CIC / dormant
  }
  return opts.includes(current) ? opts : [current, ...opts];
}

// Re-derive the note set for a changed framework, preserving anything the user
// has edited (completed / rewritten / excluded / added) and refreshing only the
// untouched, framework-specific defaults.
function rebuildDisclosures(e: Engagement, framework: string, size: CompanySize): DisclosureSection[] {
  const built = buildDisclosures({
    entityType: e.entityType, size, framework,
    statements: e.statements ?? null,
    priorYear: e.comparativePeriod ? e.comparativePeriod.slice(-4) : '',
    directors: e.directors,
  });
  const builtIds = new Set(built.map(b => b.id));
  const existing = new Map(e.disclosures.map(d => [d.id, d]));
  const touched = (s?: DisclosureSection) => !!s && (s.status === 'complete' || (s.history?.length ?? 0) > 1 || s.included === false);
  const merged = built.map(nb => {
    const old = existing.get(nb.id);
    return touched(old) ? { ...nb, content: old!.content, status: old!.status, history: old!.history, included: old!.included } : nb;
  });
  // Keep notes not in the built set (house-style + user-added).
  const extras = e.disclosures.filter(d => !builtIds.has(d.id));
  return [...merged, ...extras];
}

export default function StagePreparation({
  engagement, patch, advance, readOnly = false,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
  advance: () => void;
  readOnly?: boolean;
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

  const showComparatives = engagement.showComparatives ?? true;
  const amended = engagement.amended ?? false;

  // Override the detected framework — syncs size/micro flags and re-derives the
  // note set for the new framework (preserving edits).
  function changeFramework(fw: string) {
    patch(e => {
      const isMicro = /105/i.test(fw);
      const isSmall = /section 1a|\b1a\b/i.test(fw);
      let size: CompanySize = e.size;
      if (isMicro) size = 'micro';
      else if (isSmall) size = 'small';
      else if (e.size === 'micro') size = 'small'; // full FRS 102 is never micro
      return { ...e, framework: fw, size, microEligible: size === 'micro', disclosures: rebuildDisclosures(e, fw, size) };
    });
  }
  const toggleComparatives = () => patch(e => ({ ...e, showComparatives: !(e.showComparatives ?? true) }));
  const toggleAmended = () => patch(e => ({ ...e, amended: !e.amended }));

  const detections = [
    { icon: Building2,     label: 'Entity type',      value: ENTITY_LABELS[engagement.entityType] },
    { icon: Ruler,         label: 'Company size',     value: SIZE_LABELS[engagement.size] },
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
              {stmts.hasPrior ? (showComparatives ? ' Comparatives included.' : ' Comparatives excluded.') : ' No prior year found.'}
            </p>
          </div>
        </div>
      </StudioCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StudioCard className="p-5">
          <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><Building2 size={14} className="text-[var(--accent)]" /> What SMITH detected</h4>
          {/* Framework — overridable. Changing it re-derives the size + note set. */}
          <div className="mb-2">
            <label className="mb-1 flex items-center gap-1 text-[11px] text-[var(--text-muted)]"><BookOpen size={11} /> Framework</label>
            <select
              value={engagement.framework}
              onChange={e => changeFramework(e.target.value)}
              disabled={readOnly}
              className="w-full cursor-pointer rounded-xl border border-black/10 bg-white px-3 py-2 text-[13px] font-semibold text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {frameworkOptions(engagement.entityType, engagement.framework).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
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

      {/* Accounts options — user overrides for how the accounts are prepared. */}
      <StudioCard className="p-5">
        <h4 className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]"><SlidersHorizontal size={14} className="text-[var(--accent)]" /> Accounts options</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <OptionToggle
            label="Comparative figures"
            sub={stmts.hasPrior ? 'Show the prior-year column in the statements' : 'No prior year found in the import'}
            checked={showComparatives && stmts.hasPrior}
            disabled={!stmts.hasPrior || readOnly}
            onChange={toggleComparatives}
          />
          <OptionToggle
            label="Amended accounts"
            sub={'Mark as amended — adds “Amended” to the cover'}
            checked={amended}
            disabled={readOnly}
            onChange={toggleAmended}
          />
        </div>
      </StudioCard>

      {/* Partner / member data — drives the appropriation account and the
          capital & current account schedules. */}
      {isPartnershipFamily && (
        <PartnersEditor engagement={engagement} patch={patch} />
      )}

      <StatementsView statements={stmts} periodLabel={periodLabel} showComparatives={showComparatives} />

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to Notes & Disclosures <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Accounts-options toggle row ───────────────────────────────────────────────
function OptionToggle({ label, sub, checked, disabled, onChange }: {
  label: string; sub: string; checked: boolean; disabled?: boolean; onChange: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 ${disabled ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="text-[11px] text-[var(--text-muted)]">{sub}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${disabled ? 'cursor-not-allowed' : ''} ${checked ? 'bg-[var(--accent)]' : 'bg-slate-300'}`}
      >
        <span className={`mt-0.5 ml-0.5 inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
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
