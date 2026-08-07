'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, Plus, Trash2, Briefcase, Home, PiggyBank, Sparkles,
  AlertTriangle, Info, CheckCircle2, Beaker, ChevronRight, TrendingUp, Users,
  Globe2, GraduationCap, Landmark, FileText, Scale, MapPin,
} from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { fmtMoney } from '../data';
import { computeSa100Full, employmentTaxable, tradeNetProfit, tradeAdjustedProfit, propertyNetProfit, propertyTaxable, partnershipTaxableProfit, disposalGainLoss, foreignTotals, trustTotals } from '../calc';
import type { TaxReturn, Sa100Income, EmploymentSource, TradeSource, PropertySource, PartnershipSource, CgtDisposal, ForeignSource, TrustEstateSource, ReviewPoint, TaxSuggestion } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export default function StageReview({ ret, patch, advance }: { ret: TaxReturn; patch: Patch; advance: () => void }) {
  const [page, setPage] = useState<PageId>('core');
  const openPoints = ret.reviewPoints.filter(p => !p.resolved && p.severity !== 'info').length;
  const counts = pageCounts(ret.income);

  function setIncome(u: (i: Sa100Income) => Sa100Income) {
    patch(r => ({ ...r, income: u(r.income) }));
  }

  return (
    <div className="space-y-4">
      {/* Contents rail + section panel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[224px_minmax(0,1fr)]">
        <ContentsRail counts={counts} active={page} onSelect={setPage} />
        <SectionPanel page={page} income={ret.income} setIncome={setIncome} />
      </div>

      {/* Live computation (the AI assistant is docked on the right of the workspace) */}
      <ComputationCard ret={ret} />

      {/* Review points */}
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

      {/* Send for approval */}
      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Send for approval <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── Income editor — tabbed SA-page shell ────────────────────────────────────
type SetIncome = (u: (i: Sa100Income) => Sa100Income) => void;
type PageId = 'core' | 'employment' | 'selfemp' | 'partnership' | 'property' | 'foreign' | 'cgt' | 'trusts' | 'residence' | 'additional';

const PAGES: { id: PageId; label: string; code: string; icon: LucideIcon }[] = [
  { id: 'core',        label: 'Income & reliefs', code: 'SA100', icon: PiggyBank },
  { id: 'employment',  label: 'Employment',       code: 'SA102', icon: Briefcase },
  { id: 'selfemp',     label: 'Self-employment',  code: 'SA103', icon: Landmark },
  { id: 'partnership', label: 'Partnership',      code: 'SA104', icon: Users },
  { id: 'property',    label: 'Property',         code: 'SA105', icon: Home },
  { id: 'foreign',     label: 'Foreign',          code: 'SA106', icon: Globe2 },
  { id: 'cgt',         label: 'Capital gains',    code: 'SA108', icon: TrendingUp },
  { id: 'trusts',      label: 'Trusts',           code: 'SA107', icon: Scale },
  { id: 'residence',   label: 'Residence',        code: 'SA109', icon: MapPin },
  { id: 'additional',  label: 'Additional info',  code: 'SA101', icon: FileText },
];

/** The headline figure a page contributes to income — shown in the page header. */
function pageValue(id: PageId, income: Sa100Income): { value: number; label: string } | null {
  const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
  switch (id) {
    case 'employment': return { value: sum(income.employment, employmentTaxable), label: 'Employment income' };
    case 'selfemp': return { value: sum(income.selfEmployment, tradeAdjustedProfit), label: 'Adjusted trade profit' };
    case 'partnership': return { value: sum(income.partnerships ?? [], partnershipTaxableProfit), label: 'Partnership profit' };
    case 'property': return { value: sum(income.property, propertyTaxable), label: 'Property profit' };
    case 'foreign': { const f = foreignTotals(income); return { value: f.interest + f.dividends + f.other, label: 'Foreign income' }; }
    case 'cgt': {
      const cg = income.capitalGains; if (!cg) return { value: 0, label: 'Gains' };
      const d = cg.disposals ?? [];
      const g = d.length ? sum(d, x => disposalGainLoss(x).gain) : Math.max(0, (cg.residentialGains || 0) + (cg.otherGains || 0));
      return { value: g, label: 'Gains before AEA' };
    }
    case 'trusts': { const t = trustTotals(income); return { value: t.nonSavings + t.savings + t.dividend, label: 'Trust / estate income' }; }
    default: return null; // core / residence / additional — no single headline
  }
}

function pageCounts(income: Sa100Income): Record<PageId, number> {
  return {
    core: 0,
    employment: income.employment.length,
    selfemp: income.selfEmployment.length,
    partnership: (income.partnerships ?? []).length,
    property: income.property.length,
    foreign: income.foreign?.sources?.length
      || (income.foreign && ((income.foreign.income || 0) || (income.foreign.foreignTaxPaid || 0)) ? 1 : 0),
    cgt: income.capitalGains?.disposals?.length
      || (income.capitalGains && ((income.capitalGains.residentialGains || 0) || (income.capitalGains.otherGains || 0) || (income.capitalGains.losses || 0)) ? 1 : 0),
    trusts: (income.trusts ?? []).length,
    residence: income.residence && (income.residence.remittanceBasis || (income.residence.status && income.residence.status !== 'resident') || income.residence.domicile === 'non-uk' || (income.residence.daysInUk || 0) > 0) ? 1 : 0,
    additional: income.additional && [
      income.additional.chargeableEventGains, income.additional.eisSubscriptions, income.additional.seisSubscriptions,
      income.additional.vctSubscriptions, income.additional.citrInvestment, income.additional.maintenancePayments,
    ].some(v => (v || 0) > 0) ? 1 : 0,
  };
}

/** Left contents rail — a clickable table of contents for the SA pages, with a
 *  bracketed entry count next to any page that holds data. */
function ContentsRail({ counts, active, onSelect }: { counts: Record<PageId, number>; active: PageId; onSelect: (id: PageId) => void }) {
  return (
    <StudioCard className="h-fit p-2 lg:sticky lg:top-4">
      <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Sections</p>
      <nav className="space-y-0.5">
        {PAGES.map(p => {
          const on = p.id === active;
          const n = counts[p.id];
          const Icon = p.icon;
          return (
            <button key={p.id} onClick={() => onSelect(p.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${on ? 'bg-[var(--accent)]/10 font-bold text-[var(--accent)]' : 'font-semibold text-[var(--accent)]/90 hover:bg-[var(--accent)]/[0.06]'}`}>
              <Icon size={14} className="shrink-0 opacity-80" />
              <span className="flex-1 truncate">{p.label}{n > 0 && <span className="font-bold"> ({n})</span>}</span>
              <span className={`text-[9px] font-bold uppercase tracking-wide ${on ? 'text-[var(--accent)]/70' : 'text-slate-400'}`}>{p.code}</span>
            </button>
          );
        })}
      </nav>
    </StudioCard>
  );
}

/** The wide panel showing the selected section's fields. */
function SectionPanel({ page, income, setIncome }: { page: PageId; income: Sa100Income; setIncome: SetIncome }) {
  const active = PAGES.find(p => p.id === page)!;
  const pv = pageValue(page, income);
  return (
    <StudioCard className="p-5">
      <div className="mb-3 flex items-baseline gap-2 border-b border-black/5 pb-3">
        <h4 className="text-[15px] font-bold text-[var(--text-primary)]">{active.label}</h4>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{active.code}</span>
        {pv && pv.value > 0 && (
          <span className="ml-auto text-[12px] text-[var(--text-muted)]">{pv.label} <span className="font-bold text-[var(--text-primary)]">{fmtMoney(pv.value)}</span></span>
        )}
      </div>

      {page === 'core' && <CorePage income={income} setIncome={setIncome} />}
      {page === 'employment' && <EmploymentPage income={income} setIncome={setIncome} />}
      {page === 'selfemp' && <SelfEmploymentPage income={income} setIncome={setIncome} />}
      {page === 'partnership' && <PartnershipPage income={income} setIncome={setIncome} />}
      {page === 'property' && <PropertyPage income={income} setIncome={setIncome} />}
      {page === 'foreign' && <ForeignPage income={income} setIncome={setIncome} />}
      {page === 'cgt' && <CapitalGainsPage income={income} setIncome={setIncome} />}
      {page === 'trusts' && <TrustsPage income={income} setIncome={setIncome} />}
      {page === 'residence' && <ResidencePage income={income} setIncome={setIncome} />}
      {page === 'additional' && <AdditionalPage income={income} setIncome={setIncome} />}
    </StudioCard>
  );
}

function CorePage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <LabelledNum icon={PiggyBank} box={4} label="Dividends" value={income.dividends} onChange={v => setIncome(i => ({ ...i, dividends: v }))} />
      <LabelledNum box={2} label="Savings interest" value={income.savingsInterest} onChange={v => setIncome(i => ({ ...i, savingsInterest: v }))} />
      <LabelledNum box={11} label="Pensions income" value={income.pensionsIncome} onChange={v => setIncome(i => ({ ...i, pensionsIncome: v }))} />
      <LabelledNum box={8} label="State pension" value={income.statePension ?? 0} onChange={v => setIncome(i => ({ ...i, statePension: v }))} />
      <LabelledNum box={17} label="Other income" value={income.otherIncome} onChange={v => setIncome(i => ({ ...i, otherIncome: v }))} />
      <LabelledNum box="TR4.5" label="Gift Aid (net)" value={income.giftAid} onChange={v => setIncome(i => ({ ...i, giftAid: v }))} />
      <LabelledNum box="TR4.1" label="Pension contrib. (net)" value={income.pensionContributions} onChange={v => setIncome(i => ({ ...i, pensionContributions: v }))} />
      <LabelledNum box="TR5.3" label="Child benefit received" value={income.childBenefit ?? 0} onChange={v => setIncome(i => ({ ...i, childBenefit: v }))} />
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Marriage Allowance</label>
        <select value={income.marriageAllowance ?? 'none'} onChange={e => setIncome(i => ({ ...i, marriageAllowance: e.target.value as 'none' | 'received' | 'transferred' }))} className="input-base py-1 text-[12.5px]">
          <option value="none">None</option>
          <option value="received">Received (£252 reducer)</option>
          <option value="transferred">Transferred to spouse</option>
        </select>
      </div>
      <div>
        <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]"><GraduationCap size={11} /> Student loan plan</label>
        <select value={income.studentLoanPlan} onChange={e => setIncome(i => ({ ...i, studentLoanPlan: Number(e.target.value) as Sa100Income['studentLoanPlan'] }))} className="input-base py-1 text-[12.5px]">
          <option value={0}>None</option>
          <option value={1}>Plan 1</option>
          <option value={2}>Plan 2</option>
          <option value={4}>Plan 4 (Scotland)</option>
          <option value={5}>Plan 5</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Tax region</label>
        <select value={income.region ?? 'uk'} onChange={e => setIncome(i => ({ ...i, region: e.target.value as 'uk' | 'scotland' }))} className="input-base py-1 text-[12.5px]">
          <option value="uk">England / Wales / NI</option>
          <option value="scotland">Scotland</option>
        </select>
      </div>
    </div>
  );
}

function EmploymentPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const add = () => setIncome(i => ({ ...i, employment: [...i.employment, { id: `e-${i.employment.length}-${Date.now()}`, employer: '', pay: 0, taxDeducted: 0 }] }));
  return (
    <div className="space-y-3">
      {income.employment.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No employments yet — add one to enter the P60 and P11D figures.</p>
      )}
      {income.employment.map((e, idx) => (
        <EmploymentCard key={e.id} e={e} idx={idx}
          onChange={p => setIncome(i => ({ ...i, employment: i.employment.map((x, j) => j === idx ? { ...x, ...p } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, employment: i.employment.filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add employment</button>
    </div>
  );
}

function EmploymentCard({ e, idx, onChange, onRemove }: {
  e: EmploymentSource; idx: number; onChange: (p: Partial<EmploymentSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={e.employer} placeholder={`Employer ${idx + 1}`} onChange={ev => onChange({ employer: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(employmentTaxable(e))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          <BoxSection title="Pay & tax">
            <BoxNum box={1} label="Pay (P60/P45)" value={e.pay} onChange={v => onChange({ pay: v })} />
            <BoxNum box={2} label="UK tax taken off" value={e.taxDeducted} onChange={v => onChange({ taxDeducted: v })} />
            <BoxNum box={3} label="Tips & other pay" value={e.tips ?? 0} onChange={v => onChange({ tips: v })} />
            <BoxText box={4} label="PAYE reference" value={e.payeRef ?? ''} onChange={v => onChange({ payeRef: v })} />
          </BoxSection>
          <BoxSection title="Benefits (P11D)">
            <BoxNum box={9} label="Company cars & vans" value={e.benCar ?? 0} onChange={v => onChange({ benCar: v })} />
            <BoxNum box={10} label="Fuel for cars/vans" value={e.benFuel ?? 0} onChange={v => onChange({ benFuel: v })} />
            <BoxNum box={11} label="Medical & dental" value={e.benMedical ?? 0} onChange={v => onChange({ benMedical: v })} />
            <BoxNum box={12} label="Vouchers & mileage" value={e.benVouchers ?? 0} onChange={v => onChange({ benVouchers: v })} />
            <BoxNum box={13} label="Goods & assets" value={e.benAssets ?? 0} onChange={v => onChange({ benAssets: v })} />
            <BoxNum box={14} label="Accommodation" value={e.benAccommodation ?? 0} onChange={v => onChange({ benAccommodation: v })} />
            <BoxNum box={15} label="Other benefits & loans" value={e.benOther ?? 0} onChange={v => onChange({ benOther: v })} />
            <BoxNum box={16} label="Expenses payments received" value={e.benExpPayments ?? 0} onChange={v => onChange({ benExpPayments: v })} />
          </BoxSection>
          <BoxSection title="Allowable expenses">
            <BoxNum box={17} label="Business travel & subsistence" value={e.expTravel ?? 0} onChange={v => onChange({ expTravel: v })} />
            <BoxNum box={18} label="Fixed deductions" value={e.expFixed ?? 0} onChange={v => onChange({ expFixed: v })} />
            <BoxNum box={19} label="Professional fees & subs" value={e.expProfessional ?? 0} onChange={v => onChange({ expProfessional: v })} />
            <BoxNum box={20} label="Other expenses" value={e.expOther ?? 0} onChange={v => onChange({ expOther: v })} />
          </BoxSection>
        </div>
      )}
    </div>
  );
}

function BoxSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function BoxNum({ box, label, value, onChange }: { box: number; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> {label}
      </label>
      <NumIn value={value} onChange={onChange} />
    </div>
  );
}

function BoxText({ box, label, value, onChange }: { box?: number; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}
      </label>
      <TextIn value={value} onChange={onChange} />
    </div>
  );
}

function SelfEmploymentPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const add = () => setIncome(i => ({ ...i, selfEmployment: [...i.selfEmployment, { id: `s-${i.selfEmployment.length}-${Date.now()}`, name: '', profit: 0 }] }));
  return (
    <div className="space-y-3">
      {income.selfEmployment.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No trades yet — add one to enter the SA103 figures.</p>
      )}
      {income.selfEmployment.map((s, idx) => (
        <TradeCard key={s.id} t={s} idx={idx}
          onChange={p => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.map((x, j) => j === idx ? { ...x, ...p } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, selfEmployment: i.selfEmployment.filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add trade</button>
      <div className="mt-2 grid grid-cols-2 gap-3 border-t border-black/5 pt-4 sm:grid-cols-3">
        <LabelledNum box={78} label="Trade loss b/fwd" value={income.tradeLossBroughtForward ?? 0} onChange={v => setIncome(i => ({ ...i, tradeLossBroughtForward: v }))} />
      </div>
      <p className="text-[10.5px] text-[var(--text-muted)]">Brought-forward losses set against this year’s trade profit; an unrelieved in-year loss is relieved sideways against other income.</p>
    </div>
  );
}

function TradeCard({ t, idx, onChange, onRemove }: {
  t: TradeSource; idx: number; onChange: (p: Partial<TradeSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={t.name} placeholder={`Trade ${idx + 1}`} onChange={ev => onChange({ name: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Adjusted <span className="font-bold text-[var(--text-primary)]">{fmtMoney(tradeAdjustedProfit(t))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          <BoxSection title="Business details">
            <BoxText box={2} label="Description" value={t.description ?? ''} onChange={v => onChange({ description: v })} />
            <BoxText box={8} label="Period start (dd-mm-yyyy)" value={t.periodStart ?? ''} onChange={v => onChange({ periodStart: v })} />
            <BoxText box={9} label="Period end (dd-mm-yyyy)" value={t.periodEnd ?? ''} onChange={v => onChange({ periodEnd: v })} />
          </BoxSection>
          <BoxSection title="Business income">
            <BoxNum box={15} label="Turnover" value={t.turnover ?? 0} onChange={v => onChange({ turnover: v })} />
            <BoxNum box={16} label="Other business income" value={t.otherBusinessIncome ?? 0} onChange={v => onChange({ otherBusinessIncome: v })} />
          </BoxSection>
          <BoxSection title="Allowable expenses">
            <BoxNum box={17} label="Cost of goods" value={t.expCostOfGoods ?? 0} onChange={v => onChange({ expCostOfGoods: v })} />
            <BoxNum box={18} label="Subcontractors (CIS)" value={t.expSubcontractors ?? 0} onChange={v => onChange({ expSubcontractors: v })} />
            <BoxNum box={19} label="Wages & staff" value={t.expWages ?? 0} onChange={v => onChange({ expWages: v })} />
            <BoxNum box={20} label="Car, van & travel" value={t.expCarVanTravel ?? 0} onChange={v => onChange({ expCarVanTravel: v })} />
            <BoxNum box={21} label="Rent, rates, power, insurance" value={t.expPremises ?? 0} onChange={v => onChange({ expPremises: v })} />
            <BoxNum box={22} label="Repairs & renewals" value={t.expRepairs ?? 0} onChange={v => onChange({ expRepairs: v })} />
            <BoxNum box={23} label="Phone & office costs" value={t.expOffice ?? 0} onChange={v => onChange({ expOffice: v })} />
            <BoxNum box={24} label="Advertising & entertainment" value={t.expAdvertising ?? 0} onChange={v => onChange({ expAdvertising: v })} />
            <BoxNum box={25} label="Interest on loans" value={t.expInterest ?? 0} onChange={v => onChange({ expInterest: v })} />
            <BoxNum box={26} label="Bank & finance charges" value={t.expBankCharges ?? 0} onChange={v => onChange({ expBankCharges: v })} />
            <BoxNum box={27} label="Irrecoverable debts" value={t.expBadDebts ?? 0} onChange={v => onChange({ expBadDebts: v })} />
            <BoxNum box={28} label="Accountancy & professional" value={t.expProfessional ?? 0} onChange={v => onChange({ expProfessional: v })} />
            <BoxNum box={29} label="Depreciation & loss on assets" value={t.expDepreciation ?? 0} onChange={v => onChange({ expDepreciation: v })} />
            <BoxNum box={30} label="Other expenses" value={t.expOtherCosts ?? 0} onChange={v => onChange({ expOtherCosts: v })} />
          </BoxSection>
          <BoxSection title="Tax adjustments">
            <LabelledNum box={45} label="Disallowable expenses" value={t.addBacks ?? 0} onChange={v => onChange({ addBacks: v })} />
            <LabelledNum box={44} label="Goods for own use" value={t.goodsOwnUse ?? 0} onChange={v => onChange({ goodsOwnUse: v })} />
            <LabelledNum box={60} label="Balancing charges" value={t.balancingCharges ?? 0} onChange={v => onChange({ balancingCharges: v })} />
          </BoxSection>
          <BoxSection title="Capital allowances & CIS">
            <LabelledNum box={49} label="Annual investment allowance" value={t.aia ?? 0} onChange={v => onChange({ aia: v })} />
            <LabelledNum box={50} label="Other capital allowances" value={t.capitalAllowances ?? 0} onChange={v => onChange({ capitalAllowances: v })} />
            <LabelledNum box={81} label="CIS tax deducted" value={t.cisDeductions ?? 0} onChange={v => onChange({ cisDeductions: v })} />
          </BoxSection>
          <p className="text-[10.5px] text-[var(--text-muted)]">Net profit {fmtMoney(tradeNetProfit(t))} + add-backs − capital allowances = adjusted profit. CIS tax is credited against the liability.</p>
        </div>
      )}
    </div>
  );
}

function PartnershipPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const list = income.partnerships ?? [];
  const add = () => setIncome(i => ({ ...i, partnerships: [...(i.partnerships ?? []), { id: `pt-${(i.partnerships ?? []).length}-${Date.now()}`, name: '', profit: 0 }] }));
  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No partnerships yet — add one to enter the SA104 figures.</p>
      )}
      {list.map((p, idx) => (
        <PartnershipCard key={p.id} p={p} idx={idx}
          onChange={u => setIncome(i => ({ ...i, partnerships: (i.partnerships ?? []).map((x, j) => j === idx ? { ...x, ...u } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, partnerships: (i.partnerships ?? []).filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add partnership</button>
    </div>
  );
}

function PartnershipCard({ p, idx, onChange, onRemove }: {
  p: PartnershipSource; idx: number; onChange: (u: Partial<PartnershipSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={p.name} placeholder={`Partnership ${idx + 1}`} onChange={ev => onChange({ name: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(partnershipTaxableProfit(p))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          <BoxSection title="Partnership details">
            <BoxText box={1} label="Partnership UTR" value={p.utr ?? ''} onChange={v => onChange({ utr: v })} />
            <BoxText box={6} label="Period start (dd-mm-yyyy)" value={p.periodStart ?? ''} onChange={v => onChange({ periodStart: v })} />
            <BoxText box={7} label="Period end (dd-mm-yyyy)" value={p.periodEnd ?? ''} onChange={v => onChange({ periodEnd: v })} />
          </BoxSection>
          <BoxSection title="Share of profit">
            <LabelledNum box={8} label="Taxable profit share" value={p.profit} onChange={v => onChange({ profit: v })} />
            <LabelledNum box={10} label="Basis-period adjustment" value={p.adjustments ?? 0} onChange={v => onChange({ adjustments: v })} />
            <LabelledNum box={18} label="Loss brought forward" value={p.lossBroughtForward ?? 0} onChange={v => onChange({ lossBroughtForward: v })} />
          </BoxSection>
          <BoxSection title="Other income & tax">
            <LabelledNum box={26} label="Share of savings interest" value={p.savingsInterest ?? 0} onChange={v => onChange({ savingsInterest: v })} />
            <LabelledNum box={30} label="Share of dividends" value={p.dividends ?? 0} onChange={v => onChange({ dividends: v })} />
            <LabelledNum box={24} label="Tax deducted at source" value={p.taxTaken ?? 0} onChange={v => onChange({ taxTaken: v })} />
            <label className="flex cursor-pointer items-end gap-2 pb-1 text-[11.5px] text-[var(--text-secondary)]">
              <input type="checkbox" checked={p.class4Exempt ?? false} onChange={e => onChange({ class4Exempt: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--accent)]" /> Exempt from Class 4 NIC (box 4)
            </label>
          </BoxSection>
        </div>
      )}
    </div>
  );
}

function PropertyPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const add = () => setIncome(i => ({ ...i, property: [...i.property, { id: `p-${i.property.length}-${Date.now()}`, address: '', profit: 0 }] }));
  return (
    <div className="space-y-3">
      {income.property.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No properties yet — add one to enter the SA105 figures.</p>
      )}
      {income.property.map((p, idx) => (
        <PropertyCard key={p.id} p={p} idx={idx}
          onChange={u => setIncome(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, ...u } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, property: i.property.filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add property</button>
      <p className="text-[10.5px] text-[var(--text-muted)]">Furnished holiday lettings ended on 5 April 2025, so 2025/26 uses the single UK-property section. Residential finance costs are relieved as a 20% reducer, not deducted.</p>
    </div>
  );
}

function PropertyCard({ p, idx, onChange, onRemove }: {
  p: PropertySource; idx: number; onChange: (u: Partial<PropertySource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={p.address} placeholder={`Property ${idx + 1}`} onChange={ev => onChange({ address: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(propertyTaxable(p))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          <BoxSection title="Income">
            <BoxNum box={20} label="Rents & other income" value={p.rents ?? 0} onChange={v => onChange({ rents: v })} />
            <BoxNum box={21} label="Tax taken off" value={p.taxTaken ?? 0} onChange={v => onChange({ taxTaken: v })} />
            <BoxNum box={22} label="Lease premiums" value={p.premiums ?? 0} onChange={v => onChange({ premiums: v })} />
          </BoxSection>
          <BoxSection title="Allowable expenses">
            <BoxNum box={24} label="Rent, rates, insurance" value={p.expPremises ?? 0} onChange={v => onChange({ expPremises: v })} />
            <BoxNum box={25} label="Repairs & maintenance" value={p.expRepairs ?? 0} onChange={v => onChange({ expRepairs: v })} />
            <BoxNum box={26} label="Non-resi. loan interest" value={p.expLoanInterest ?? 0} onChange={v => onChange({ expLoanInterest: v })} />
            <BoxNum box={27} label="Legal & professional" value={p.expProfessional ?? 0} onChange={v => onChange({ expProfessional: v })} />
            <BoxNum box={28} label="Cost of services" value={p.expServices ?? 0} onChange={v => onChange({ expServices: v })} />
            <BoxNum box={29} label="Other expenses" value={p.expOther ?? 0} onChange={v => onChange({ expOther: v })} />
          </BoxSection>
          <BoxSection title="Adjustments & reliefs">
            <BoxNum box={36} label="Private use adjustment" value={p.privateUse ?? 0} onChange={v => onChange({ privateUse: v })} />
            <BoxNum box={37} label="Balancing charges" value={p.balancingCharges ?? 0} onChange={v => onChange({ balancingCharges: v })} />
            <BoxNum box={38} label="Annual investment allowance" value={p.aia ?? 0} onChange={v => onChange({ aia: v })} />
            <LabelledNum box={39} label="Other capital allowances" value={p.capitalAllowances ?? 0} onChange={v => onChange({ capitalAllowances: v })} />
            <BoxNum box={40} label="Replacing domestic items" value={p.domesticItems ?? 0} onChange={v => onChange({ domesticItems: v })} />
            <LabelledNum box={37} label="Rent a Room relief" value={p.rentARoom ?? 0} onChange={v => onChange({ rentARoom: v })} />
          </BoxSection>
          <BoxSection title="Finance costs & losses">
            <BoxNum box={44} label="Residential finance costs" value={p.residentialFinanceCosts ?? 0} onChange={v => onChange({ residentialFinanceCosts: v })} />
            <BoxNum box={43} label="Loss brought forward" value={p.lossBroughtForward ?? 0} onChange={v => onChange({ lossBroughtForward: v })} />
          </BoxSection>
          <p className="text-[10.5px] text-[var(--text-muted)]">Net profit {fmtMoney(propertyNetProfit(p))} + adjustments − reliefs − loss b/fwd = taxable. Residential finance costs give a separate 20% reducer.</p>
        </div>
      )}
    </div>
  );
}

function ForeignPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const f = income.foreign ?? {};
  const sources = f.sources ?? [];
  const patchForeign = (u: Partial<NonNullable<Sa100Income['foreign']>>) => setIncome(i => ({ ...i, foreign: { ...i.foreign, ...u } }));
  const setSources = (s: ForeignSource[]) => patchForeign({ sources: s });
  const add = () => setSources([...sources, { id: `f-${sources.length}-${Date.now()}`, country: '', category: 'interest', income: 0, foreignTaxPaid: 0, claimFtcr: true }]);
  return (
    <div className="space-y-3">
      {sources.length === 0 && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <LabelledNum icon={Globe2} label="Foreign income" value={f.income ?? 0} onChange={v => patchForeign({ income: v })} />
            <LabelledNum label="Foreign tax paid" value={f.foreignTaxPaid ?? 0} onChange={v => patchForeign({ foreignTaxPaid: v })} />
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Quick summary (taxed as other income) — or add itemised sources below (they take precedence).</p>
        </div>
      )}
      {sources.map((s, idx) => (
        <ForeignCard key={s.id} s={s} idx={idx}
          onChange={u => setSources(sources.map((x, j) => j === idx ? { ...x, ...u } : x))}
          onRemove={() => setSources(sources.filter((_, j) => j !== idx))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add foreign source</button>
      <p className="text-[10.5px] text-[var(--text-muted)]">Interest is taxed at savings rates, dividends at dividend rates, the rest as other income. Foreign Tax Credit Relief is applied automatically, capped at the UK tax on the same income.</p>
    </div>
  );
}

function ForeignCard({ s, idx, onChange, onRemove }: {
  s: ForeignSource; idx: number; onChange: (u: Partial<ForeignSource>) => void; onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input value={s.country ?? ''} placeholder={`Country ${idx + 1}`} onChange={ev => onChange({ country: ev.target.value })} className="input-base w-44 py-1 text-[12.5px] font-semibold" />
        <div className="flex-1" />
        <RemoveBtn onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Type</label>
          <select value={s.category} onChange={e => onChange({ category: e.target.value as ForeignSource['category'] })} className="input-base py-1 text-[12.5px]">
            <option value="interest">Interest</option>
            <option value="dividends">Dividends</option>
            <option value="pension">Pension</option>
            <option value="property">Property</option>
            <option value="other">Other</option>
          </select>
        </div>
        <LabelledNum box={FOREIGN_PAGES[s.category]} label="Income (£)" value={s.income} onChange={v => onChange({ income: v })} />
        <LabelledNum box={FOREIGN_PAGES[s.category]} label="Foreign tax (£)" value={s.foreignTaxPaid} onChange={v => onChange({ foreignTaxPaid: v })} />
        <label className="flex cursor-pointer items-end gap-2 pb-1 text-[11.5px] text-[var(--text-secondary)]">
          <input type="checkbox" checked={s.claimFtcr !== false} onChange={e => onChange({ claimFtcr: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--accent)]" /> Claim FTCR
        </label>
      </div>
    </div>
  );
}

// SA108 proceeds/cost boxes per asset section (residential, other, listed, unlisted).
const CGT_BOXES: Record<CgtDisposal['assetType'], { proceeds: number; cost: number; gains: number }> = {
  residential: { proceeds: 4, cost: 5, gains: 6 },
  other: { proceeds: 15, cost: 16, gains: 17 },
  listed: { proceeds: 24, cost: 25, gains: 26 },
  unlisted: { proceeds: 32, cost: 33, gains: 34 },
};

// SA106 page/section the income sits on, by category.
const FOREIGN_PAGES: Record<ForeignSource['category'], string> = {
  interest: 'F2', dividends: 'F2', pension: 'F2', property: 'F4', other: 'F3',
};

function CapitalGainsPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const cg = income.capitalGains ?? {};
  const disposals = cg.disposals ?? [];
  const patchCg = (u: Partial<NonNullable<Sa100Income['capitalGains']>>) => setIncome(i => ({ ...i, capitalGains: { ...i.capitalGains, ...u } }));
  const setDisposals = (d: CgtDisposal[]) => patchCg({ disposals: d });
  const add = () => setDisposals([...disposals, { id: `cg-${disposals.length}-${Date.now()}`, description: '', assetType: 'residential', proceeds: 0, cost: 0, relief: 'none' }]);
  return (
    <div className="space-y-3">
      {disposals.length === 0 && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <LabelledNum box={6} label="Residential gains" value={cg.residentialGains ?? 0} onChange={v => patchCg({ residentialGains: v })} />
            <LabelledNum box={17} label="Other gains" value={cg.otherGains ?? 0} onChange={v => patchCg({ otherGains: v })} />
            <LabelledNum label="Losses (in-year)" value={cg.losses ?? 0} onChange={v => patchCg({ losses: v })} />
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Quick summary — or add itemised disposals below (they take precedence).</p>
        </div>
      )}
      {disposals.map((d, idx) => (
        <DisposalCard key={d.id} d={d} idx={idx}
          onChange={u => setDisposals(disposals.map((x, j) => j === idx ? { ...x, ...u } : x))}
          onRemove={() => setDisposals(disposals.filter((_, j) => j !== idx))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add disposal</button>
      <div className="mt-2 grid grid-cols-2 gap-3 border-t border-black/5 pt-4 sm:grid-cols-3">
        <LabelledNum box={47} label="Losses brought forward" value={cg.lossesBroughtForward ?? 0} onChange={v => patchCg({ lossesBroughtForward: v })} />
      </div>
      <p className="text-[10.5px] text-[var(--text-muted)]">£3,000 annual exempt amount. Standard gains 18%/24% (band-dependent); BADR / Investors’ Relief gains 14%.</p>
    </div>
  );
}

function ResidencePage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const r = income.residence ?? {};
  const patchR = (u: Partial<NonNullable<Sa100Income['residence']>>) => setIncome(i => ({ ...i, residence: { ...i.residence, ...u } }));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Residence status</label>
          <select value={r.status ?? 'resident'} onChange={e => patchR({ status: e.target.value as NonNullable<Sa100Income['residence']>['status'] })} className="input-base py-1 text-[12.5px]">
            <option value="resident">UK resident</option>
            <option value="non-resident">Non-resident</option>
            <option value="split-year">Split year</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Domicile</label>
          <select value={r.domicile ?? 'uk'} onChange={e => patchR({ domicile: e.target.value as NonNullable<Sa100Income['residence']>['domicile'] })} className="input-base py-1 text-[12.5px]">
            <option value="uk">UK domiciled</option>
            <option value="non-uk">Non-UK domiciled</option>
          </select>
        </div>
        <LabelledNum label="Days spent in the UK" value={r.daysInUk ?? 0} onChange={v => patchR({ daysInUk: v })} />
        {r.status === 'split-year' && (
          <BoxText label="Split-year date (dd-mm-yyyy)" value={r.splitYearDate ?? ''} onChange={v => patchR({ splitYearDate: v })} />
        )}
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text-secondary)]">
        <input type="checkbox" checked={r.remittanceBasis ?? false} onChange={e => patchR({ remittanceBasis: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--accent)]" />
        Claim the remittance basis
      </label>
      <p className="text-[10.5px] text-[var(--text-muted)]">Claiming the remittance basis withdraws the personal allowance and the £3,000 CGT annual exempt amount. The remittance basis was replaced by the FIG regime from 6 April 2025 — transitional rules may apply. Split-year / non-resident income apportionment isn’t modelled here.</p>
    </div>
  );
}

function TrustsPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const list = income.trusts ?? [];
  const add = () => setIncome(i => ({ ...i, trusts: [...(i.trusts ?? []), { id: `tr-${(i.trusts ?? []).length}-${Date.now()}`, name: '', kind: 'discretionary', incomeType: 'nonSavings', amount: 0, taxPaid: 0 }] }));
  return (
    <div className="space-y-3">
      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No trust or estate income yet — add a source to enter the SA107 figures.</p>
      )}
      {list.map((t, idx) => (
        <TrustCard key={t.id} t={t} idx={idx}
          onChange={u => setIncome(i => ({ ...i, trusts: (i.trusts ?? []).map((x, j) => j === idx ? { ...x, ...u } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, trusts: (i.trusts ?? []).filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add trust / estate</button>
      <p className="text-[10.5px] text-[var(--text-muted)]">Discretionary trust income is entered net and grossed up at the 45% trust rate (the tax credit is set against your liability). Estate / interest-in-possession income is entered gross by type with the tax already paid.</p>
    </div>
  );
}

function TrustCard({ t, idx, onChange, onRemove }: {
  t: TrustEstateSource; idx: number; onChange: (u: Partial<TrustEstateSource>) => void; onRemove: () => void;
}) {
  const gross = t.kind === 'discretionary' ? (t.amount || 0) / 0.55 : (t.amount || 0);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input value={t.name} placeholder={`Trust / estate ${idx + 1}`} onChange={ev => onChange({ name: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Gross <span className="font-bold text-[var(--text-primary)]">{fmtMoney(gross)}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Kind</label>
          <select value={t.kind} onChange={e => onChange({ kind: e.target.value as TrustEstateSource['kind'] })} className="input-base py-1 text-[12.5px]">
            <option value="discretionary">Discretionary (45% credit)</option>
            <option value="estate">Estate / IIP</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Income type</label>
          <select value={t.incomeType} onChange={e => onChange({ incomeType: e.target.value as TrustEstateSource['incomeType'] })} disabled={t.kind === 'discretionary'} className="input-base py-1 text-[12.5px] disabled:opacity-50">
            <option value="nonSavings">Non-savings</option>
            <option value="savings">Savings</option>
            <option value="dividend">Dividend</option>
          </select>
        </div>
        <LabelledNum label={t.kind === 'discretionary' ? 'Net received' : 'Gross income'} value={t.amount} onChange={v => onChange({ amount: v })} />
        <LabelledNum label={t.kind === 'discretionary' ? 'Tax credit (auto)' : 'Tax paid'} value={t.kind === 'discretionary' ? Math.round(gross - (t.amount || 0)) : (t.taxPaid ?? 0)} onChange={v => onChange({ taxPaid: v })} />
      </div>
    </div>
  );
}

function AdditionalPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const a = income.additional ?? {};
  const patchA = (u: Partial<NonNullable<Sa100Income['additional']>>) => setIncome(i => ({ ...i, additional: { ...i.additional, ...u } }));
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Life insurance gains</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={4} label="Chargeable event gains" value={a.chargeableEventGains ?? 0} onChange={v => patchA({ chargeableEventGains: v })} />
          <label className="flex cursor-pointer items-end gap-2 pb-1 text-[11.5px] text-[var(--text-secondary)]">
            <input type="checkbox" checked={a.chargeableEventUkPolicy ?? false} onChange={e => patchA({ chargeableEventUkPolicy: e.target.checked })} className="h-3.5 w-3.5 rounded border-slate-300 text-[var(--accent)]" /> UK policy (basic rate treated as paid)
          </label>
        </div>
        <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Top-slicing relief isn’t modelled — review before filing.</p>
      </div>
      <div className="border-t border-black/5 pt-4">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Venture capital & other reliefs</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={2} label="EIS subscriptions (30%)" value={a.eisSubscriptions ?? 0} onChange={v => patchA({ eisSubscriptions: v })} />
          <LabelledNum box={10} label="SEIS subscriptions (50%)" value={a.seisSubscriptions ?? 0} onChange={v => patchA({ seisSubscriptions: v })} />
          <LabelledNum box={1} label="VCT subscriptions (30%)" value={a.vctSubscriptions ?? 0} onChange={v => patchA({ vctSubscriptions: v })} />
          <LabelledNum box={3} label="CITR investment (5%)" value={a.citrInvestment ?? 0} onChange={v => patchA({ citrInvestment: v })} />
          <LabelledNum box={6} label="Maintenance payments (10%)" value={a.maintenancePayments ?? 0} onChange={v => patchA({ maintenancePayments: v })} />
        </div>
        <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">Subscriptions give an income-tax reducer (EIS/VCT 30%, SEIS 50%, CITR 5%). Maintenance relief is 10%, capped at £401.</p>
      </div>
    </div>
  );
}

function DisposalCard({ d, idx, onChange, onRemove }: {
  d: CgtDisposal; idx: number; onChange: (u: Partial<CgtDisposal>) => void; onRemove: () => void;
}) {
  const { gain, loss } = disposalGainLoss(d);
  const b = CGT_BOXES[d.assetType];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <input value={d.description} placeholder={`Disposal ${idx + 1}`} onChange={ev => onChange({ description: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">{loss > 0 ? <span className="font-bold text-rose-600">Loss {fmtMoney(loss)}</span> : <>Gain <span className="font-bold text-[var(--text-primary)]">{fmtMoney(gain)}</span></>}</span>
        <RemoveBtn onClick={onRemove} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Asset type</label>
          <select value={d.assetType} onChange={e => onChange({ assetType: e.target.value as CgtDisposal['assetType'] })} className="input-base py-1 text-[12.5px]">
            <option value="residential">Residential property</option>
            <option value="listed">Listed shares</option>
            <option value="unlisted">Unlisted shares</option>
            <option value="other">Other assets</option>
          </select>
        </div>
        <LabelledNum box={b.proceeds} label="Proceeds" value={d.proceeds} onChange={v => onChange({ proceeds: v })} />
        <LabelledNum box={b.cost} label="Allowable cost" value={d.cost} onChange={v => onChange({ cost: v })} />
        <LabelledNum label="Reliefs (PRR/lettings)" value={d.reliefs ?? 0} onChange={v => onChange({ reliefs: v })} />
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[var(--text-muted)]">Special relief</label>
          <select value={d.relief ?? 'none'} onChange={e => onChange({ relief: e.target.value as CgtDisposal['relief'] })} className="input-base py-1 text-[12.5px]">
            <option value="none">None (18%/24%)</option>
            <option value="badr">BADR (14%)</option>
            <option value="investors">Investors’ Relief (14%)</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function TextIn({ value, placeholder, onChange }: { value: string; placeholder?: string; onChange: (v: string) => void }) {
  return <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />;
}
function NumIn({ value, label, onChange }: { value: number; label?: string; onChange: (v: number) => void }) {
  return <input type="number" value={value === 0 ? '' : value} placeholder={label} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12.5px]" />;
}
function LabelledNum({ icon: Icon, box, label, value, onChange }: { icon?: typeof PiggyBank; box?: number | string; label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {Icon && <Icon size={11} />}
        {box != null && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
        {label}
      </label>
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
      {c.foreignTaxCreditRelief > 0 && (
        <Row label="Less: Foreign Tax Credit Relief" value={`(${fmtMoney(c.foreignTaxCreditRelief)})`} />
      )}
      {c.additionalReliefs > 0 && (
        <Row label="Less: reliefs (EIS/SEIS/VCT/other)" value={`(${fmtMoney(c.additionalReliefs)})`} />
      )}
      <Row label="Income tax" value={fmtMoney(c.incomeTax)} bold />
      {c.class4Nic > 0 && <Row label="Class 4 NIC" value={fmtMoney(c.class4Nic)} />}
      {c.studentLoan > 0 && <Row label="Student loan" value={fmtMoney(c.studentLoan)} />}
      {c.hicbc > 0 && <Row label="High Income Child Benefit Charge" value={fmtMoney(c.hicbc)} />}
      {c.capitalGainsTax > 0 && <Row label={`Capital gains tax (on ${fmtMoney(c.taxableGains)})`} value={fmtMoney(c.capitalGainsTax)} />}
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
