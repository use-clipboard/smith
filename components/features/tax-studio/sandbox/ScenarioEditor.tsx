'use client';

import { useState } from 'react';
import { Plus, Trash2, Info, Calculator, ArrowUpRight } from 'lucide-react';
import { fmtMoney } from '../data';
import { scenarioResult } from './data';
import { cgtCalcSummary, cgtCalcToSa108 } from '../calc';
import CgtCalculator from '../CgtCalculator';
import type { Sa100Income, Scenario, CgtCalcState, ReturnTypeId } from '../types';

export type EditCategory = 'income' | 'capital' | 'pensions' | 'investments' | 'property' | 'business' | 'other';

export default function ScenarioEditor({
  scenario, category, baseIncome, taxYear, taxpayerName, returnType, onChange, onPushCgtToMain,
}: {
  scenario: Scenario;
  category: EditCategory;
  baseIncome: Sa100Income;
  taxYear: string;
  taxpayerName: string;
  returnType?: ReturnTypeId;
  onChange: (income: Sa100Income) => void;
  onPushCgtToMain?: (calc: CgtCalcState) => void;
}) {
  const income = scenario.income;
  const set = (u: (i: Sa100Income) => Sa100Income) => onChange(u(income));

  const base = scenarioResult(baseIncome, taxYear);
  const cur = scenarioResult(income, taxYear);
  const saving = base.totalTaxAndNic - cur.totalTaxAndNic;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4">
        <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Editing “{scenario.name}”</h3>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">Adjust the figures below — the impact updates live.</p>

        <div className="mt-4 space-y-3">
          {category === 'income' && <IncomeFields income={income} set={set} />}
          {category === 'pensions' && (
            <NumField label="Personal pension contributions (net)" value={income.pensionContributions} onChange={v => set(i => ({ ...i, pensionContributions: v }))} help="Extends the basic-rate band; higher-rate relief via Self Assessment." />
          )}
          {category === 'investments' && (
            <>
              <NumField label="Dividends" value={income.dividends} onChange={v => set(i => ({ ...i, dividends: v }))} />
              <NumField label="Savings interest" value={income.savingsInterest} onChange={v => set(i => ({ ...i, savingsInterest: v }))} />
            </>
          )}
          {category === 'property' && <PropertyFields income={income} set={set} />}
          {category === 'other' && (
            <>
              <NumField label="Gift Aid donations (net)" value={income.giftAid} onChange={v => set(i => ({ ...i, giftAid: v }))} />
              <NumField label="Other income" value={income.otherIncome} onChange={v => set(i => ({ ...i, otherIncome: v }))} />
              <NumField label="Pensions income" value={income.pensionsIncome} onChange={v => set(i => ({ ...i, pensionsIncome: v }))} />
            </>
          )}
          {category === 'capital' && <CapitalGainsScenario income={income} set={set} taxYear={taxYear} taxpayerName={taxpayerName} returnType={returnType} onPushCgtToMain={onPushCgtToMain} />}
          {category === 'business' && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-4 text-[12.5px] text-[var(--text-secondary)]">
              <Info size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <div>
                <p className="font-semibold text-[var(--text-primary)]">Business structure modelling</p>
                <p className="mt-0.5 text-[var(--text-muted)]">Incorporation / salary-vs-dividend structural modelling arrives in a later increment. For now, use the Investments and Pensions levers to approximate the effect.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Live impact */}
      <div className="rounded-xl border border-[var(--border)] bg-white/60 p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Live impact</p>
        <div className="mt-3 space-y-1">
          <Line label="Total income" value={fmtMoney(cur.totalIncome)} />
          <Line label="Total tax" value={fmtMoney(cur.incomeTax)} />
          <Line label="National Insurance" value={fmtMoney(cur.nic)} />
          <Line label="Total tax & NIC" value={fmtMoney(cur.totalTaxAndNic)} bold />
        </div>
        <div className={`mt-3 rounded-xl px-3 py-2.5 text-center ${saving > 0 ? 'bg-emerald-50' : saving < 0 ? 'bg-rose-50' : 'bg-slate-50'}`}>
          <p className="text-[11px] font-medium text-[var(--text-muted)]">vs Current Plan</p>
          <p className={`text-[16px] font-extrabold ${saving > 0 ? 'text-emerald-600' : saving < 0 ? 'text-rose-500' : 'text-[var(--text-muted)]'}`}>
            {saving > 0 ? `Save ${fmtMoney(saving)}` : saving < 0 ? `${fmtMoney(Math.abs(saving))} more` : 'No change'}
          </p>
        </div>
      </div>
    </div>
  );
}

function CapitalGainsScenario({ income, set, taxYear, taxpayerName, returnType, onPushCgtToMain }: {
  income: Sa100Income; set: (u: (i: Sa100Income) => Sa100Income) => void; taxYear: string; taxpayerName: string; returnType?: ReturnTypeId; onPushCgtToMain?: (calc: CgtCalcState) => void;
}) {
  const calc = income.cgtCalc ?? {};
  const summary = cgtCalcSummary(calc);
  const n = (calc.disposals ?? []).length;
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-[var(--text-secondary)]">Model this scenario's disposals with the full calculator — reliefs, ownership splits, losses and the £3,000 exemption. When you're happy, add the result to the live return.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Disposals" value={String(n)} />
        <Stat label="Total gains" value={fmtMoney(summary.totalGains)} />
        <Stat label={`Taxable (after £${(3000).toLocaleString()})`} value={fmtMoney(summary.taxableGains)} />
        <Stat label="Est. CGT" value={fmtMoney(summary.estCgt)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setOpen(true)} className="btn-primary"><Calculator size={15} /> Open capital gains calculator</button>
        {onPushCgtToMain && n > 0 && <button onClick={() => onPushCgtToMain(calc)} className="btn-secondary bg-white"><ArrowUpRight size={14} /> Add to main return</button>}
      </div>
      {n === 0 && <p className="text-[11.5px] text-[var(--text-muted)]">No disposals yet — open the calculator to add or scan them.</p>}
      {open && <CgtCalculator state={calc} taxYear={taxYear} taxpayerName={taxpayerName} returnType={returnType} onChange={s => set(i => ({ ...i, cgtCalc: s, sa108: cgtCalcToSa108(s, i.sa108) }))} onClose={() => setOpen(false)} />}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="text-[14px] font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function IncomeFields({ income, set }: { income: Sa100Income; set: (u: (i: Sa100Income) => Sa100Income) => void }) {
  return (
    <>
      <Group title="Employment" onAdd={() => set(i => ({ ...i, employment: [...i.employment, { id: `e${i.employment.length + 1}`, employer: '', pay: 0, taxDeducted: 0, benefits: 0 }] }))}>
        {income.employment.map((e, idx) => (
          <div key={e.id} className="grid grid-cols-[1.6fr_1fr_1fr_auto] items-center gap-2">
            <Text value={e.employer} placeholder="Employer" onChange={v => set(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, employer: v } : x) }))} />
            <Num value={e.pay} label="Pay" onChange={v => set(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, pay: v } : x) }))} />
            <Num value={e.taxDeducted} label="Tax" onChange={v => set(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, taxDeducted: v } : x) }))} />
            <Remove onClick={() => set(i => ({ ...i, employment: i.employment.filter((_, j) => j !== idx) }))} />
          </div>
        ))}
      </Group>
      <Group title="Self-employment" onAdd={() => set(i => ({ ...i, selfEmployment: [...i.selfEmployment, { id: `s${i.selfEmployment.length + 1}`, name: '', profit: 0 }] }))}>
        {income.selfEmployment.map((s, idx) => (
          <div key={s.id} className="grid grid-cols-[2fr_1fr_auto] items-center gap-2">
            <Text value={s.name} placeholder="Trade" onChange={v => set(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, name: v } : x) }))} />
            <Num value={s.profit} label="Profit" onChange={v => set(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, profit: v } : x) }))} />
            <Remove onClick={() => set(i => ({ ...i, selfEmployment: i.selfEmployment.filter((_, j) => j !== idx) }))} />
          </div>
        ))}
      </Group>
      <NumField label="Gift Aid donations (net)" value={income.giftAid} onChange={v => set(i => ({ ...i, giftAid: v }))} />
    </>
  );
}

function PropertyFields({ income, set }: { income: Sa100Income; set: (u: (i: Sa100Income) => Sa100Income) => void }) {
  return (
    <Group title="Rental property" onAdd={() => set(i => ({ ...i, property: [...i.property, { id: `p${i.property.length + 1}`, address: '', profit: 0 }] }))}>
      {income.property.map((p, idx) => (
        <div key={p.id} className="grid grid-cols-[2fr_1fr_auto] items-center gap-2">
          <Text value={p.address} placeholder="Property address" onChange={v => set(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, address: v } : x) }))} />
          <Num value={p.profit} label="Profit" onChange={v => set(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, profit: v } : x) }))} />
          <Remove onClick={() => set(i => ({ ...i, property: i.property.filter((_, j) => j !== idx) }))} />
        </div>
      ))}
    </Group>
  );
}

function Group({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  const has = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-[12px] font-bold text-[var(--text-secondary)]">{title}</p>
        <button onClick={onAdd} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline"><Plus size={12} /> Add</button>
      </div>
      {has ? <div className="space-y-1.5">{children}</div> : <p className="text-[11.5px] text-[var(--text-muted)]">None</p>}
    </div>
  );
}

function NumField({ label, value, onChange, help }: { label: string; value: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">{label}</label>
      <Num value={value} onChange={onChange} />
      {help && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{help}</p>}
    </div>
  );
}

function Text({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />;
}
function Num({ value, label, onChange }: { value: number; label?: string; onChange: (v: number) => void }) {
  return <input type="number" value={value === 0 ? '' : value} placeholder={label} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12.5px]" />;
}
function Remove({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>;
}
function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[12px] ${bold ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>{label}</span>
      <span className={`text-[12.5px] ${bold ? 'font-bold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{value}</span>
    </div>
  );
}
