'use client';

import { useState } from 'react';
import {
  ArrowRight, Plus, Trash2, Briefcase, Home, PiggyBank, Sparkles,
  AlertTriangle, Info, CheckCircle2, Beaker, ChevronRight,
} from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { fmtMoney } from '../data';
import { computeSa100Full } from '../calc';
import type { TaxReturn, Sa100Income, ReviewPoint, TaxSuggestion } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export default function StageReview({ ret, patch, advance }: { ret: TaxReturn; patch: Patch; advance: () => void }) {
  const openPoints = ret.reviewPoints.filter(p => !p.resolved && p.severity !== 'info').length;

  function setIncome(u: (i: Sa100Income) => Sa100Income) {
    patch(r => ({ ...r, income: u(r.income) }));
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      {/* Left — editor + review points */}
      <div className="space-y-4">
        <IncomeEditor income={ret.income} setIncome={setIncome} />

        <StudioCard className="p-5">
          <SectionTitle title="Review points" sub={openPoints ? `${openPoints} to resolve before approval` : 'Everything checks out'} />
          {ret.reviewPoints.length === 0 ? (
            <p className="text-[12.5px] text-[var(--text-muted)]">No review points raised. Run the analysis or adjust figures to re-check.</p>
          ) : (
            <div className="space-y-2">
              {ret.reviewPoints.map(p => (
                <ReviewPointRow key={p.id} point={p}
                  onToggle={() => patch(r => ({ ...r, reviewPoints: r.reviewPoints.map(x => x.id === p.id ? { ...x, resolved: !x.resolved } : x) }))} />
              ))}
            </div>
          )}
        </StudioCard>

        <SuggestionsCard ret={ret} patch={patch} />
      </div>

      {/* Right — live computation */}
      <div className="space-y-4">
        <ComputationCard ret={ret} />
        <div className="flex justify-end">
          <button onClick={advance} className="btn-primary">
            Send for approval <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Income editor ───────────────────────────────────────────────────────────
function IncomeEditor({ income, setIncome }: { income: Sa100Income; setIncome: (u: (i: Sa100Income) => Sa100Income) => void }) {
  return (
    <StudioCard className="p-5">
      <SectionTitle title="Income & reliefs" sub="Adjust any figure — the computation updates live." />

      {/* Employment */}
      <Group icon={Briefcase} title="Employment"
        onAdd={() => setIncome(i => ({ ...i, employment: [...i.employment, { id: `e${i.employment.length + 1}`, employer: '', pay: 0, taxDeducted: 0, benefits: 0 }] }))}>
        {income.employment.map((e, idx) => (
          <div key={e.id} className="grid grid-cols-[1.6fr_1fr_1fr_1fr_auto] items-center gap-2">
            <TextIn value={e.employer} placeholder="Employer" onChange={v => setIncome(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, employer: v } : x) }))} />
            <NumIn value={e.pay} label="Pay" onChange={v => setIncome(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, pay: v } : x) }))} />
            <NumIn value={e.taxDeducted} label="Tax" onChange={v => setIncome(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, taxDeducted: v } : x) }))} />
            <NumIn value={e.benefits} label="BIK" onChange={v => setIncome(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, benefits: v } : x) }))} />
            <RemoveBtn onClick={() => setIncome(i => ({ ...i, employment: i.employment.filter((_, j) => j !== idx) }))} />
          </div>
        ))}
      </Group>

      {/* Self-employment */}
      <Group icon={Briefcase} title="Self-employment"
        onAdd={() => setIncome(i => ({ ...i, selfEmployment: [...i.selfEmployment, { id: `s${i.selfEmployment.length + 1}`, name: '', profit: 0 }] }))}>
        {income.selfEmployment.map((s, idx) => (
          <div key={s.id} className="grid grid-cols-[1.5fr_1fr_1fr_1fr_auto] items-center gap-2">
            <TextIn value={s.name} placeholder="Trade" onChange={v => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, name: v } : x) }))} />
            <NumIn value={s.profit} label="Profit" onChange={v => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, profit: v } : x) }))} />
            <NumIn value={s.addBacks ?? 0} label="Add-backs" onChange={v => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, addBacks: v } : x) }))} />
            <NumIn value={s.capitalAllowances ?? 0} label="Cap. allow." onChange={v => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, capitalAllowances: v } : x) }))} />
            <RemoveBtn onClick={() => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.filter((_, j) => j !== idx) }))} />
          </div>
        ))}
      </Group>
      {income.selfEmployment.length > 0 && (
        <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Profit + add-backs (disallowables/depreciation) − capital allowances = taxable trade profit.</p>
      )}

      {/* Property */}
      <Group icon={Home} title="Property"
        onAdd={() => setIncome(i => ({ ...i, property: [...i.property, { id: `p${i.property.length + 1}`, address: '', profit: 0 }] }))}>
        {income.property.map((p, idx) => (
          <div key={p.id} className="grid grid-cols-[2fr_1fr_auto] items-center gap-2">
            <TextIn value={p.address} placeholder="Property address" onChange={v => setIncome(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, address: v } : x) }))} />
            <NumIn value={p.profit} label="Profit" onChange={v => setIncome(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, profit: v } : x) }))} />
            <RemoveBtn onClick={() => setIncome(i => ({ ...i, property: i.property.filter((_, j) => j !== idx) }))} />
          </div>
        ))}
      </Group>

      {/* Other income + reliefs */}
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-black/5 pt-4 sm:grid-cols-3">
        <LabelledNum icon={PiggyBank} label="Dividends" value={income.dividends} onChange={v => setIncome(i => ({ ...i, dividends: v }))} />
        <LabelledNum label="Savings interest" value={income.savingsInterest} onChange={v => setIncome(i => ({ ...i, savingsInterest: v }))} />
        <LabelledNum label="Pensions income" value={income.pensionsIncome} onChange={v => setIncome(i => ({ ...i, pensionsIncome: v }))} />
        <LabelledNum label="Other income" value={income.otherIncome} onChange={v => setIncome(i => ({ ...i, otherIncome: v }))} />
        <LabelledNum label="Gift Aid (net)" value={income.giftAid} onChange={v => setIncome(i => ({ ...i, giftAid: v }))} />
        <LabelledNum label="Pension contrib. (net)" value={income.pensionContributions} onChange={v => setIncome(i => ({ ...i, pensionContributions: v }))} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Marriage Allowance</label>
          <select
            value={income.marriageAllowance ?? 'none'}
            onChange={e => setIncome(i => ({ ...i, marriageAllowance: e.target.value as 'none' | 'received' | 'transferred' }))}
            className="input-base py-1 text-[12.5px]"
          >
            <option value="none">None</option>
            <option value="received">Received (£252 reducer)</option>
            <option value="transferred">Transferred to spouse</option>
          </select>
        </div>
      </div>
    </StudioCard>
  );
}

function Group({ icon: Icon, title, onAdd, children }: { icon: typeof Briefcase; title: string; onAdd: () => void; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-secondary)]"><Icon size={13} className="text-[var(--accent)]" /> {title}</p>
        <button onClick={onAdd} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add</button>
      </div>
      {hasRows ? <div className="space-y-1.5">{children}</div> : <p className="text-[11.5px] text-[var(--text-muted)]">None</p>}
    </div>
  );
}

function TextIn({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />;
}
function NumIn({ value, label, onChange }: { value: number; label?: string; onChange: (v: number) => void }) {
  return <input type="number" value={value === 0 ? '' : value} placeholder={label} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12.5px]" />;
}
function LabelledNum({ icon: Icon, label, value, onChange }: { icon?: typeof PiggyBank; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">{Icon && <Icon size={11} />} {label}</label>
      <NumIn value={value} onChange={onChange} />
    </div>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>;
}

// ─── Computation ─────────────────────────────────────────────────────────────
function ComputationCard({ ret }: { ret: TaxReturn }) {
  const c = computeSa100Full(ret.income, ret.taxYear);
  return (
    <StudioCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Tax computation</h3>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">{c.taxYear}</span>
      </div>
      <Row label="Total income" value={fmtMoney(c.totalIncome)} />
      <Row label={`Personal allowance${c.paTapered ? ' (tapered)' : ''}`} value={`(${fmtMoney(c.personalAllowance)})`} />
      <Row label="Taxable income" value={fmtMoney(c.taxableIncome)} bold />
      <div className="my-2 space-y-1 border-y border-black/5 py-2">
        {c.lines.filter(l => l.amount > 0).map((l, i) => (
          <div key={i} className="flex items-center justify-between text-[11.5px]">
            <span className="text-[var(--text-muted)]">{l.label} · {fmtMoney(l.amount)} @ {(l.rate * 100).toFixed(l.rate * 100 % 1 ? 2 : 0)}%</span>
            <span className="font-medium text-[var(--text-secondary)]">{fmtMoney(l.tax)}</span>
          </div>
        ))}
      </div>
      {c.financeCostReducer > 0 && (
        <Row label="Less: finance-cost reducer (20%)" value={`(${fmtMoney(c.financeCostReducer)})`} />
      )}
      {c.marriageAllowanceReducer > 0 && (
        <Row label="Less: Marriage Allowance" value={`(${fmtMoney(c.marriageAllowanceReducer)})`} />
      )}
      <Row label="Income tax" value={fmtMoney(c.incomeTax)} bold />
      {c.class4Nic > 0 && <Row label="Class 4 NIC" value={fmtMoney(c.class4Nic)} />}
      {c.studentLoan > 0 && <Row label="Student loan" value={fmtMoney(c.studentLoan)} />}
      <Row label="Total liability" value={fmtMoney(c.totalDue)} bold />
      <Row label="Tax deducted at source" value={`(${fmtMoney(c.taxDeductedAtSource)})`} />
      <div className="mt-2 rounded-xl bg-[var(--accent)]/5 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">Balancing payment</span>
          <span className="text-[17px] font-extrabold text-[var(--accent)]">{fmtMoney(c.balancingPayment)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Payment on account (×2)</span>
          <span>{c.poaApplies ? `${fmtMoney(c.paymentOnAccount)} each` : 'None due'}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>Effective rate</span>
          <span>{(c.effectiveRate * 100).toFixed(1)}%</span>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">{c.notes[c.notes.length - 1]}</p>
    </StudioCard>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[12px] ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
      <span className={`text-[12.5px] ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}

// ─── Review point row ────────────────────────────────────────────────────────
const SEV_STYLE: Record<ReviewPoint['severity'], { icon: typeof Info; cls: string }> = {
  serious: { icon: AlertTriangle, cls: 'text-rose-500' },
  minor:   { icon: AlertTriangle, cls: 'text-amber-500' },
  info:    { icon: Info, cls: 'text-sky-500' },
};
function ReviewPointRow({ point, onToggle }: { point: ReviewPoint; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const s = SEV_STYLE[point.severity];
  const Icon = s.icon;
  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${point.resolved ? 'border-emerald-200/70 bg-emerald-50/50' : 'border-[var(--border)] bg-white/60'}`}>
      <div className="flex items-start gap-2.5">
        <Icon size={15} className={`mt-0.5 shrink-0 ${point.resolved ? 'text-emerald-500' : s.cls}`} />
        <div className="min-w-0 flex-1">
          <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-1.5 text-left">
            <span className={`text-[12.5px] font-semibold ${point.resolved ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'}`}>{point.issue}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{point.area}</span>
            <ChevronRight size={13} className={`ml-auto text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
          {open && (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[12px] text-[var(--text-secondary)]">{point.explanation}</p>
              {point.suggestedFix && <p className="text-[11.5px] text-[var(--accent)]">Suggested: {point.suggestedFix}</p>}
            </div>
          )}
        </div>
        <button onClick={onToggle} className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${point.resolved ? 'text-emerald-600 hover:bg-emerald-100' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
          {point.resolved ? <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} /> Resolved</span> : 'Mark resolved'}
        </button>
      </div>
    </div>
  );
}

// ─── Suggestions (opportunities) ─────────────────────────────────────────────
function SuggestionsCard({ ret, patch }: { ret: TaxReturn; patch: Patch }) {
  if (ret.suggestions.length === 0) return null;
  const total = ret.suggestions.reduce((a, s) => a + s.estSaving, 0);
  return (
    <StudioCard className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle title="Tax-saving opportunities" sub={total > 0 ? `Up to ${fmtMoney(total)} of potential savings identified` : 'Planning ideas for this client'} />
        <Sparkles size={16} className="text-[var(--accent)]" />
      </div>
      <div className="space-y-2.5">
        {ret.suggestions.map(s => <SuggestionCard key={s.id} s={s}
          onApply={() => patch(r => ({ ...r, suggestions: r.suggestions.map(x => x.id === s.id ? { ...x, appliedToSandbox: !x.appliedToSandbox } : x) }))} />)}
      </div>
    </StudioCard>
  );
}

function SuggestionCard({ s, onApply }: { s: TaxSuggestion; onApply: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-bold text-[var(--text-primary)]">{s.title}</p>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{s.category}</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11.5px]">
            {s.estSaving > 0 && <span className="font-bold text-emerald-600">Save ~{fmtMoney(s.estSaving)}</span>}
            <span className="flex items-center gap-1 text-[var(--text-muted)]">
              <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${s.confidence}%` }} /></span>
              {s.confidence}% confidence
            </span>
          </div>
        </div>
        <button onClick={onApply}
          className={`shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors ${
            s.appliedToSandbox ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'border border-[var(--accent)]/40 text-[var(--accent)] hover:bg-[var(--accent)]/5'
          }`}>
          <Beaker size={13} /> {s.appliedToSandbox ? 'In sandbox' : 'Apply to sandbox'}
        </button>
      </div>
      <button onClick={() => setOpen(o => !o)} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} /> Reasoning & legislation
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 border-t border-black/5 pt-2">
          <p className="text-[12px] text-[var(--text-secondary)]">{s.reasoning}</p>
          <p className="text-[11px] font-medium text-[var(--text-muted)]">Legislation: {s.legislation}</p>
        </div>
      )}
    </div>
  );
}
