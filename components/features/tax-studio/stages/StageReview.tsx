'use client';

import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, Plus, Trash2, Briefcase, Home, PiggyBank, Sparkles,
  AlertTriangle, Info, CheckCircle2, Beaker, ChevronRight, TrendingUp, Users,
  Globe2, GraduationCap, Landmark, FileText, Scale, MapPin, Loader2, Calculator, Check, Search, CornerDownLeft, X, ScanText, Link2,
} from 'lucide-react';
import DocumentExtract from '../DocumentExtract';
import { BreakdownField, type BreakdownColumn } from '../IncomeBreakdown';
import CapitalAllowancesCalculator from '../CapitalAllowancesCalculator';
import HelpDot from '../FieldHelp';
import Tooltip from '@/components/ui/Tooltip';
import { SA103_SHORT_TURNOVER_LIMIT, migrateTradeToFull, migrateTradeToShort } from '../tradeForm';
import { partnershipRequiresFull, migratePartnershipToFull, migratePartnershipToShort } from '../partnershipForm';
import { H, CH, EMP, PH } from '../tradeHelp';
import { searchReview, type SearchEntry } from '../reviewSearch';
import { StudioCard, SectionTitle } from '../primitives';
import { HealthScoreCard } from '../widgets';
import { fmtMoney, provenanceFor } from '../data';
import { computeSa100Full, employmentTaxable, tradeNetProfit, tradeAdjustedProfit, tradeExpensesTotal, tradeDisallowableTotal, tradeCapitalAllowancesTotal, tradeAdditions, tradeDeductions, tradeProfitForTax, tradeTaxableProfit, tradeAdjustedLoss, tradeLossCarriedForward, tradeTotalAssets, tradeNetBusinessAssets, tradeCapitalAccountEnd, computeCapitalAllowances, propertyNetProfit, propertyTaxable, partnershipTaxableProfit, partnershipAdjustedProfit, partnershipTaxableTradeProfit, partnershipTotalTaxableProfit, partnershipAdjustedLoss, partnershipLossCarryForward, partnershipAdjustedUkSavings, partnershipAdjustedForeignSavings, partnershipTotalUntaxedSavings, partnershipPropertyTaxable, partnershipOtherUkTaxable, partnershipOtherUkLossCarryForward, partnershipOffshoreTaxable, partnershipForeignTaxable, partnershipForeignLossCarryForward, partnershipTaxedIncome10, partnershipTaxedIncome20, partnershipOtherTaxedIncome, partnershipUntaxedOther, partnershipTaxTakenTotal, partnerAllocatedShare, statementTaxpayerShare, disposalGainLoss, foreignTotals, trustTotals } from '../calc';
import type { TaxReturn, Sa100Income, EmploymentSource, TradeSource, PropertySource, PartnershipSource, PartnershipStatement, PartnerAllocation, CgtDisposal, ForeignSource, TrustEstateSource, DividendItem, SavingsItem, TaxedInterestItem, LineItem, ReviewPoint, TaxSuggestion } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export type Reveal = { page: PageId; section?: string; nonce: number };
const RevealContext = createContext<Reveal | null>(null);

export default function StageReview({ ret, patch, advance, page, setPage, reveal }: { ret: TaxReturn; patch: Patch; advance: () => void; page: PageId; setPage: (p: PageId) => void; reveal: Reveal | null }) {
  const openPoints = ret.reviewPoints.filter(p => !p.resolved && p.severity !== 'info').length;
  const counts = pageCounts(ret.income);

  function setIncome(u: (i: Sa100Income) => Sa100Income) {
    patch(r => ({ ...r, income: u(r.income) }));
  }

  return (
    <div className="space-y-4">
      {/* Section tabs + panel */}
      <SectionPanel ret={ret} patch={patch} page={page} setPage={setPage} counts={counts} income={ret.income} setIncome={setIncome} reveal={reveal} />

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

      {/* Readiness snapshot — a health check just before sending for approval */}
      <HealthScoreCard ret={ret} />

      {/* Continue to the Client Approval stage (the actual send happens there) */}
      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to approval <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ─── "Jump to" search — find a section, field or box number ──────────────────
// Compact search that lives inline in the working-controls row (next to
// undo/redo). Focusing it expands the input; the results drop below, right-aligned.
export function ReviewSearch({ onGo }: { onGo: (e: SearchEntry) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const results = q ? searchReview(q) : [];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (e: SearchEntry) => { onGo(e); setQ(''); setOpen(false); };

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex h-8 w-52 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 transition-colors focus-within:border-[var(--accent)]">
        <Search size={13} className="shrink-0 text-[var(--text-muted)]" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => { if (q) setOpen(true); }}
          onKeyDown={e => {
            if (!results.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="Jump to…"
          aria-label="Jump to a section, field or box number"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--text-muted)]"
        />
        {q && <button onClick={() => { setQ(''); setOpen(false); }} aria-label="Clear search" className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><X size={13} /></button>}
      </div>
      {open && results.length > 0 && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-xl">
          {results.map((e, i) => (
            <button key={`${e.label}-${i}`} onMouseEnter={() => setActive(i)} onClick={() => pick(e)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${i === active ? 'bg-[var(--accent)]/[0.07]' : 'hover:bg-black/[0.02]'}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{e.label}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">{e.context}</p>
              </div>
              {i === active && <CornerDownLeft size={13} className="shrink-0 text-[var(--text-muted)]" />}
            </button>
          ))}
        </div>
      )}
      {open && q && results.length === 0 && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-[12px] text-[var(--text-muted)] shadow-xl">No matches — try a box number, field name or section.</div>
      )}
    </div>
  );
}

// ─── Income editor — tabbed SA-page shell ────────────────────────────────────
type SetIncome = (u: (i: Sa100Income) => Sa100Income) => void;
export type PageId = 'core' | 'employment' | 'selfemp' | 'partnership' | 'property' | 'foreign' | 'cgt' | 'trusts' | 'residence' | 'additional';

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
    core: coreSectionCounts(income).total,
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

/** Per-CoreSection populated-entry counts (breakdown items, or a set scalar = 1).
 *  Drives the (N) badge on each accordion title and the Income & reliefs tab. */
function coreSectionCounts(i: Sa100Income) {
  const len = (a?: unknown[]) => a?.length ?? 0;
  const fc = (a: unknown[] | undefined, scalar = 0) => (a && a.length ? a.length : (scalar ? 1 : 0));
  const interest =
    len(i.taxedInterestItems)
    + fc(i.savingsInterestItems, i.savingsInterest)
    + (i.untaxedForeignInterest ? 1 : 0)
    + fc(i.dividendItems, i.dividends)
    + fc(i.otherDividendsItems, i.otherDividends)
    + fc(i.foreignDividendsItems, i.foreignDividendsMain)
    + fc(i.foreignDividendsTaxItems, i.foreignDividendsTax);
  const pensions =
    fc(i.statePensionItems, i.statePension)
    + len(i.statePensionLumpSumItems)
    + len(i.statePensionLumpSumTaxItems)
    + fc(i.pensionsIncomeItems, i.pensionsIncome)
    + len(i.pensionsIncomeTaxItems)
    + (i.incapacityBenefit ? 1 : 0)
    + (i.incapacityBenefitTax ? 1 : 0)
    + (i.jobseekersAllowance ? 1 : 0)
    + (i.otherPensionsBenefits ? 1 : 0);
  const other =
    fc(i.otherIncomeItems, i.otherIncome)
    + len(i.otherIncomeExpensesItems)
    + len(i.otherIncomeTaxItems)
    + len(i.preOwnedAssetsItems)
    + (i.otherIncomeDescription ? 1 : 0);
  const pensionPayments =
    fc(i.pensionContributionsItems, i.pensionContributions)
    + (i.pensionOneOff ? 1 : 0)
    + len(i.pensionRetirementAnnuityItems)
    + len(i.pensionEmployerSchemeItems)
    + len(i.pensionOverseasItems);
  const charitable =
    fc(i.giftAidItems, i.giftAid)
    + len(i.giftAidOneOffItems)
    + len(i.giftAidCarryBackItems)
    + len(i.giftAidFutureItems)
    + len(i.giftAidSharesItems)
    + len(i.giftAidLandItems);
  const blindStudent =
    (i.registeredBlind ? 1 : 0)
    + (i.blindAuthority ? 1 : 0)
    + (i.blindSpouseSurplusClaim ? 1 : 0)
    + (i.blindSpouseSurplusSurrender ? 1 : 0)
    + (i.studentLoanRepaymentBegan ? 1 : 0)
    + (i.studentLoanDeducted ? 1 : 0)
    + (i.postgradLoan ? 1 : 0)
    + (i.postgradLoanDeducted ? 1 : 0)
    + (i.studentLoanPlan ? 1 : 0)
    + (i.region && i.region !== 'uk' ? 1 : 0);
  const childBenefit =
    (i.childBenefit ? 1 : 0)
    + (i.childBenefitChildren ? 1 : 0)
    + (i.childBenefitStopDate ? 1 : 0)
    + (i.winterFuelPayment ? 1 : 0);
  const marriage =
    (i.marriageAllowance && i.marriageAllowance !== 'none' ? 1 : 0)
    + (i.spouseFirstName ? 1 : 0)
    + (i.spouseLastName ? 1 : 0)
    + (i.spouseNino ? 1 : 0)
    + (i.spouseDob ? 1 : 0)
    + (i.marriageDate ? 1 : 0);
  const taxRefunded =
    (i.taxRefundedOrSetOff ? 1 : 0)
    + (i.noPayeCollectCurrentYear ? 1 : 0)
    + (i.noPayeCollectNextYear ? 1 : 0);
  const repayment =
    (i.repayBankName ? 1 : 0)
    + (i.repayAccountHolder ? 1 : 0)
    + (i.repaySortCode ? 1 : 0)
    + (i.repayAccountNumber ? 1 : 0)
    + (i.repayBuildingSocRef ? 1 : 0)
    + (i.repayNoUkAccount ? 1 : 0)
    + (i.repayNomineeNameEntered ? 1 : 0)
    + (i.repayNomineeIsAdviser ? 1 : 0)
    + (i.repayNomineeAddress ? 1 : 0)
    + (i.repayNomineePostcode ? 1 : 0);
  const adviser =
    (i.adviserName ? 1 : 0)
    + (i.adviserPhone ? 1 : 0)
    + (i.adviserAddress ? 1 : 0)
    + (i.adviserReference ? 1 : 0)
    + (i.adviserOtherInfo ? 1 : 0);
  const signing =
    (i.provisionalFigures ? 1 : 0)
    + (i.separateSupplementaryPages ? 1 : 0)
    + (i.dateSigned ? 1 : 0)
    + (i.signingCapacity ? 1 : 0)
    + (i.signedForPersonName ? 1 : 0)
    + (i.signatoryName ? 1 : 0)
    + (i.signatoryAddress ? 1 : 0);
  const total = interest + pensions + other + pensionPayments + charitable + blindStudent + childBenefit + marriage + taxRefunded + repayment + adviser + signing;
  return { interest, pensions, other, pensionPayments, charitable, blindStudent, childBenefit, marriage, taxRefunded, repayment, adviser, signing, total };
}

// Row ids feeding each SA-page's provenance summary.
function rowIdsForPage(page: PageId, income: Sa100Income): string[] {
  switch (page) {
    case 'employment': return income.employment.map(e => e.id);
    case 'selfemp': return income.selfEmployment.map(t => t.id);
    case 'partnership': return (income.partnerships ?? []).map(p => p.id);
    case 'property': return income.property.map(p => p.id);
    case 'core': return (income.dividendItems ?? []).map(d => d.id);
    default: return [];
  }
}
/** Aggregate provenance for a page — the distinct sources its rows came from. */
function pageProvenance(page: PageId, income: Sa100Income): { summary: string; via: 'scan' | 'link' } | null {
  const provs = rowIdsForPage(page, income).map(provenanceFor).filter((p): p is { label: string; via: 'scan' | 'link' } => !!p);
  if (!provs.length) return null;
  const labels = [...new Set(provs.map(p => p.label))];
  return { summary: labels.join(' · '), via: provs.some(p => p.via === 'link') ? 'link' : 'scan' };
}

/** A small badge marking a row/section as imported (scanned or tool-linked), with
 *  a hover tooltip naming the source. Nothing renders for hand-keyed rows. */
function ProvenanceBadge({ id, label, via }: { id?: string; label?: string; via?: 'scan' | 'link' }) {
  const p = id ? provenanceFor(id) : (label ? { label, via: via ?? 'link' } : null);
  if (!p) return null;
  const Icon = p.via === 'scan' ? ScanText : Link2;
  return (
    <Tooltip label={p.label} side="top">
      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-[var(--accent)]/10 text-[var(--accent)]" aria-label={p.label}><Icon size={10} /></span>
    </Tooltip>
  );
}

/** Tabbed section editor — horizontal tabs (icon · label · entry count · SA code)
 *  above the selected section's fields. */
function SectionPanel({ ret, patch, page, setPage, counts, income, setIncome, reveal }: {
  ret: TaxReturn; patch: Patch; page: PageId; setPage: (id: PageId) => void; counts: Record<PageId, number>; income: Sa100Income; setIncome: SetIncome; reveal: Reveal | null;
}) {
  const active = PAGES.find(p => p.id === page)!;
  const pv = pageValue(page, income);
  const [scanOpen, setScanOpen] = useState(false);
  return (
    <StudioCard className="overflow-hidden">
      {/* Section tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-black/5 px-4 py-3">
        {PAGES.map(p => {
          const on = p.id === page;
          const n = counts[p.id];
          const Icon = p.icon;
          const prov = pageProvenance(p.id, income);
          return (
            <button key={p.id} onClick={() => setPage(p.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${on ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--text-secondary)]'}`}>
              <Icon size={13} className="shrink-0" />
              {p.label}{n > 0 && <span className="font-bold"> ({n})</span>}
              <span className={`text-[9px] font-bold uppercase tracking-wide ${on ? 'text-[var(--accent)]/70' : 'text-slate-400'}`}>{p.code}</span>
              {prov && <ProvenanceBadge label={prov.summary} via={prov.via} />}
            </button>
          );
        })}
      </div>

      <div className="p-5">
      <div className="mb-3 flex items-center gap-2 border-b border-black/5 pb-3">
        <h4 className="text-[15px] font-bold text-[var(--text-primary)]">{active.label}</h4>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{active.code}</span>
        {pv && pv.value > 0 && (
          <span className="ml-auto text-[12px] text-[var(--text-muted)]">{pv.label} <span className="font-bold text-[var(--text-primary)]">{fmtMoney(pv.value)}</span></span>
        )}
        <Tooltip label="Scan a P60, dividend voucher, etc. — figures are added to this return">
          <button onClick={() => setScanOpen(true)} className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.06] ${pv && pv.value > 0 ? '' : 'ml-auto'}`}>
            <ScanText size={13} /> Scan a document
          </button>
        </Tooltip>
      </div>
      {scanOpen && <ScanDocumentsModal ret={ret} patch={patch} onClose={() => setScanOpen(false)} />}

      {page === 'core' && <CorePage ret={ret} income={income} setIncome={setIncome} reveal={reveal} />}
      {page === 'employment' && <EmploymentPage income={income} setIncome={setIncome} />}
      {page === 'selfemp' && <SelfEmploymentPage income={income} setIncome={setIncome} />}
      {page === 'partnership' && <PartnershipPage income={income} setIncome={setIncome} />}
      {page === 'property' && <PropertyPage income={income} setIncome={setIncome} />}
      {page === 'foreign' && <ForeignPage income={income} setIncome={setIncome} />}
      {page === 'cgt' && <CapitalGainsPage income={income} setIncome={setIncome} />}
      {page === 'trusts' && <TrustsPage income={income} setIncome={setIncome} />}
      {page === 'residence' && <ResidencePage income={income} setIncome={setIncome} />}
      {page === 'additional' && <AdditionalPage income={income} setIncome={setIncome} />}
      </div>
    </StudioCard>
  );
}

// Scan documents without leaving Review & Adjust — reuses the Analyse-step
// extractor. Imported figures are ADDED to the return (the merge is batch-keyed),
// so scanning a forgotten P60 here never overwrites what's already entered.
function ScanDocumentsModal({ ret, patch, onClose }: { ret: TaxReturn; patch: Patch; onClose: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-auto bg-black/45 p-4 py-10" onClick={onClose}>
      <div className="w-full max-w-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[14px] font-bold text-white">Scan a document</p>
          <button onClick={onClose} className="rounded-lg bg-white/15 p-1.5 text-white transition-colors hover:bg-white/25" aria-label="Close"><X size={16} /></button>
        </div>
        <DocumentExtract ret={ret} patch={patch} />
        <div className="mt-2 flex justify-end">
          <button onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-white/25">Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const DIVIDEND_COLS: BreakdownColumn<DividendItem>[] = [
  { key: 'company', label: 'Company name', kind: 'text' },
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'shares', label: 'No. of shares', kind: 'number' },
  { key: 'paymentDate', label: 'Payment date', kind: 'text' },
  { key: 'amount', label: 'Dividend', kind: 'number', total: true },
];
const TAXED_INT_COLS: BreakdownColumn<TaxedInterestItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'net', label: 'Net', kind: 'number', total: true },
  { key: 'tax', label: 'Tax', kind: 'number', total: true },
];
const SAVINGS_COLS: BreakdownColumn<SavingsItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'amount', label: 'Amount', kind: 'number', total: true },
];
const LINE_COLS: BreakdownColumn<LineItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'amount', label: 'Amount', kind: 'number', total: true },
];
const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

/** A description + amount itemised field (used across pensions & other income). */
function LineField({ box, label, title, items, onChange, fallbackTotal, help }: {
  box: number | string; label: string; title: string; items: LineItem[] | undefined;
  onChange: (items: LineItem[]) => void; fallbackTotal?: number; help?: string;
}) {
  return (
    <BreakdownField<LineItem>
      box={box} label={label} title={title} help={help}
      items={items ?? []} columns={LINE_COLS}
      blank={() => ({ id: rid('ln'), amount: 0 })}
      onChange={onChange} rowTotal={x => x.amount || 0} fallbackTotal={fallbackTotal}
    />
  );
}

/** Collapsible sub-section grouping the SA100 main-return boxes by form page.
 *  Opens, scrolls into view and briefly highlights when the "jump to" search
 *  targets it (via RevealContext). */
function CoreSection({ title, count, defaultOpen, children }: { title: string; count?: number; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reveal = useContext(RevealContext);
  useEffect(() => {
    if (!reveal || reveal.section !== title) return;
    setOpen(true);
    setFlash(true);
    const raf = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const t = setTimeout(() => setFlash(false), 1700);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [reveal, title]);
  return (
    <div ref={ref} className={`scroll-mt-24 rounded-xl border bg-white/60 transition-shadow ${flash ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--border)]'}`}>
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ChevronRight size={14} className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-[12.5px] font-bold text-[var(--text-primary)]">{title}{count != null && count > 0 && <span className="text-[var(--accent)]"> ({count})</span>}</span>
      </button>
      {open && <div className="border-t border-black/5 p-4">{children}</div>}
    </div>
  );
}

function CorePage({ ret, income, setIncome, reveal }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome; reveal: Reveal | null }) {
  const c = coreSectionCounts(income);
  return (
    <RevealContext.Provider value={reveal}>
    <div className="space-y-3">
      <CoreSection title="Interest & dividends" count={c.interest} defaultOpen>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <BreakdownField<TaxedInterestItem>
            box={1} label="Taxed UK interest" title="Taxed UK interest etc." help={CH.taxedInterest}
            items={income.taxedInterestItems ?? []} columns={TAXED_INT_COLS}
            blank={() => ({ id: rid('ti'), net: 0, tax: 0 })}
            onChange={items => setIncome(i => ({ ...i, taxedInterestItems: items }))}
            rowTotal={t => (t.net || 0) + (t.tax || 0)} />
          <BreakdownField<SavingsItem>
            box={2} label="Untaxed UK interest" title="Untaxed UK interest etc." help={CH.untaxedInterest}
            items={income.savingsInterestItems ?? []} columns={SAVINGS_COLS}
            blank={() => ({ id: rid('si'), amount: 0 })}
            onChange={items => setIncome(i => ({ ...i, savingsInterestItems: items }))}
            rowTotal={s => s.amount || 0} fallbackTotal={income.savingsInterest} />
          <LabelledNum box={3} label="Untaxed foreign interest" help={CH.untaxedForeignInterest} value={income.untaxedForeignInterest ?? 0} onChange={v => setIncome(i => ({ ...i, untaxedForeignInterest: v }))} />
          <BreakdownField<DividendItem>
            box={4} label="Dividends" title="Dividends from UK companies" help={CH.dividends}
            items={income.dividendItems ?? []} columns={DIVIDEND_COLS}
            blank={() => ({ id: rid('dv'), company: '', amount: 0 })}
            onChange={items => setIncome(i => ({ ...i, dividendItems: items }))}
            rowTotal={d => d.amount || 0} fallbackTotal={income.dividends} />
          <LineField box={5} label="Other dividends" title="Other dividends" help={CH.otherDividends} items={income.otherDividendsItems} fallbackTotal={income.otherDividends ?? 0} onChange={items => setIncome(i => ({ ...i, otherDividendsItems: items }))} />
          <LineField box={6} label="Foreign dividends (≤ £500)" title="Foreign dividends (≤ £500)" help={CH.foreignDividends} items={income.foreignDividendsItems} fallbackTotal={income.foreignDividendsMain ?? 0} onChange={items => setIncome(i => ({ ...i, foreignDividendsItems: items }))} />
          <LineField box={7} label="Tax off foreign dividends" title="Tax taken off foreign dividends" help={CH.foreignDividendsTax} items={income.foreignDividendsTaxItems} fallbackTotal={income.foreignDividendsTax ?? 0} onChange={items => setIncome(i => ({ ...i, foreignDividendsTaxItems: items }))} />
        </div>
      </CoreSection>

      <CoreSection title="UK pensions & benefits" count={c.pensions}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={8} label="State Pension" title="State Pension" help={CH.statePension} items={income.statePensionItems} fallbackTotal={income.statePension ?? 0} onChange={items => setIncome(i => ({ ...i, statePensionItems: items }))} />
          <LineField box={9} label="State Pension lump sum" title="State Pension lump sum" help={CH.statePensionLumpSum} items={income.statePensionLumpSumItems} onChange={items => setIncome(i => ({ ...i, statePensionLumpSumItems: items }))} />
          <LineField box={10} label="Tax taken off box 9" title="Tax taken off State Pension lump sum" items={income.statePensionLumpSumTaxItems} onChange={items => setIncome(i => ({ ...i, statePensionLumpSumTaxItems: items }))} />
          <LineField box={11} label="Pensions (other than State Pension)" title="Pensions (other than State Pension)" help={CH.pensionsIncome} items={income.pensionsIncomeItems} fallbackTotal={income.pensionsIncome} onChange={items => setIncome(i => ({ ...i, pensionsIncomeItems: items }))} />
          <LineField box={12} label="Tax taken off box 11" title="Tax taken off pensions" items={income.pensionsIncomeTaxItems} onChange={items => setIncome(i => ({ ...i, pensionsIncomeTaxItems: items }))} />
          <LabelledNum box={13} label="Incapacity Benefit & ESA" help={CH.incapacityBenefit} value={income.incapacityBenefit ?? 0} onChange={v => setIncome(i => ({ ...i, incapacityBenefit: v }))} />
          <LabelledNum box={14} label="Tax taken off box 13" value={income.incapacityBenefitTax ?? 0} onChange={v => setIncome(i => ({ ...i, incapacityBenefitTax: v }))} />
          <LabelledNum box={15} label="Jobseeker's Allowance" help={CH.jobseekersAllowance} value={income.jobseekersAllowance ?? 0} onChange={v => setIncome(i => ({ ...i, jobseekersAllowance: v }))} />
          <LabelledNum box={16} label="Other pensions & benefits" help={CH.otherPensionsBenefits} value={income.otherPensionsBenefits ?? 0} onChange={v => setIncome(i => ({ ...i, otherPensionsBenefits: v }))} />
        </div>
      </CoreSection>

      <CoreSection title="Other UK income" count={c.other}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={17} label="Other taxable income" title="Other taxable income" help={CH.otherIncome} items={income.otherIncomeItems} fallbackTotal={income.otherIncome} onChange={items => setIncome(i => ({ ...i, otherIncomeItems: items }))} />
          <LineField box={18} label="Total allowable expenses" title="Allowable expenses" items={income.otherIncomeExpensesItems} onChange={items => setIncome(i => ({ ...i, otherIncomeExpensesItems: items }))} />
          <LineField box={19} label="Any tax taken off box 17" title="Tax taken off other income" items={income.otherIncomeTaxItems} onChange={items => setIncome(i => ({ ...i, otherIncomeTaxItems: items }))} />
          <LineField box={20} label="Benefit from pre-owned assets" title="Benefit from pre-owned assets" help={CH.preOwnedAssets} items={income.preOwnedAssetsItems} onChange={items => setIncome(i => ({ ...i, preOwnedAssetsItems: items }))} />
        </div>
        <OtherIncomeDescription ret={ret} income={income} setIncome={setIncome} />
      </CoreSection>

      <CoreSection title="Pension payments" count={c.pensionPayments}>
        <p className="mb-3 text-[11px] font-semibold text-[var(--accent)]">Paying into registered pension schemes and overseas pension schemes</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={1} label="Payments & basic rate tax" title="Payments to registered pension schemes (relief at source)" help={CH.pensionContributions} items={income.pensionContributionsItems} fallbackTotal={income.pensionContributions} onChange={items => setIncome(i => ({ ...i, pensionContributionsItems: items }))} />
          <LabelledNum box="1.1" label="One-off payments in box 1" help={CH.pensionOneOff} value={income.pensionOneOff ?? 0} onChange={v => setIncome(i => ({ ...i, pensionOneOff: v }))} />
          <LineField box={2} label="Payments to a retirement annuity" title="Payments to a retirement annuity" help={CH.pensionRetirementAnnuity} items={income.pensionRetirementAnnuityItems} onChange={items => setIncome(i => ({ ...i, pensionRetirementAnnuityItems: items }))} />
          <LineField box={3} label="Payments to your employer's scheme" title="Payments to your employer's scheme" help={CH.pensionEmployerScheme} items={income.pensionEmployerSchemeItems} onChange={items => setIncome(i => ({ ...i, pensionEmployerSchemeItems: items }))} />
          <LineField box={4} label="Payments to an overseas scheme" title="Payments to an overseas pension scheme" help={CH.pensionOverseas} items={income.pensionOverseasItems} onChange={items => setIncome(i => ({ ...i, pensionOverseasItems: items }))} />
        </div>
      </CoreSection>

      <CoreSection title="Charitable giving" count={c.charitable}>
        <p className="mb-3 text-[11px] font-semibold text-[var(--accent)]">Gift Aid payments and gifts of assets to charity</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={5} label="Gift Aid payments in the year" title="Gift Aid payments made in the year to 5 April" help={CH.giftAid} items={income.giftAidItems} fallbackTotal={income.giftAid} onChange={items => setIncome(i => ({ ...i, giftAidItems: items }))} />
          <LineField box={6} label="One-off payments in box 5" title="Total of any 'one-off' payments in box 5" help={CH.giftAidOneOff} items={income.giftAidOneOffItems} onChange={items => setIncome(i => ({ ...i, giftAidOneOffItems: items }))} />
          <LineField box={7} label="Carried back to previous year" title="Payments to be carried back to the previous tax year" help={CH.giftAidCarryBack} items={income.giftAidCarryBackItems} onChange={items => setIncome(i => ({ ...i, giftAidCarryBackItems: items }))} />
          <LineField box={8} label="Future payments treated in this year" title="Future payments to be treated as paid in this year" help={CH.giftAidFuture} items={income.giftAidFutureItems} onChange={items => setIncome(i => ({ ...i, giftAidFutureItems: items }))} />
          <LineField box={9} label="Shares/securities gifted to charity" title="Value of qualifying shares or securities gifted to charity" help={CH.giftAidShares} items={income.giftAidSharesItems} onChange={items => setIncome(i => ({ ...i, giftAidSharesItems: items }))} />
          <LineField box={10} label="Land & buildings gifted to charity" title="Value of qualifying land and buildings gifted to charity" help={CH.giftAidLand} items={income.giftAidLandItems} onChange={items => setIncome(i => ({ ...i, giftAidLandItems: items }))} />
        </div>
      </CoreSection>

      <CoreSection title="Blind allowance & student loan" count={c.blindStudent}>
        <p className="mb-2 text-[11px] font-semibold text-[var(--accent)]">Blind Person's Allowance</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <CheckField box={13} label="Registered blind" help={CH.registeredBlind} checked={!!income.registeredBlind} onChange={v => setIncome(i => ({ ...i, registeredBlind: v }))} />
          <LabelledText box={14} label="Local authority / register name" help={CH.blindAuthority} value={income.blindAuthority ?? ''} onChange={v => setIncome(i => ({ ...i, blindAuthority: v }))} />
          <CheckField box={15} label="Claim spouse's surplus allowance" help={CH.spouseSurplusClaim} checked={!!income.blindSpouseSurplusClaim} onChange={v => setIncome(i => ({ ...i, blindSpouseSurplusClaim: v }))} />
          <CheckField box={16} label="Allow spouse to claim your surplus" help={CH.spouseSurplusSurrender} checked={!!income.blindSpouseSurplusSurrender} onChange={v => setIncome(i => ({ ...i, blindSpouseSurplusSurrender: v }))} />
        </div>
        <p className="mb-2 mt-4 flex items-center gap-1 text-[11px] font-semibold text-[var(--accent)]"><GraduationCap size={12} /> Student Loan repayments</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <CheckField box={1} label="Repayments began before end of tax year" checked={!!income.studentLoanRepaymentBegan} onChange={v => setIncome(i => ({ ...i, studentLoanRepaymentBegan: v }))} />
          <LabelledNum box={2} label="Repayments deducted by employer" help={CH.studentLoanDeducted} value={income.studentLoanDeducted ?? 0} onChange={v => setIncome(i => ({ ...i, studentLoanDeducted: v }))} />
          <LabelledNum box={3} label="Postgraduate Loan deducted by employer" value={income.postgradLoanDeducted ?? 0} onChange={v => setIncome(i => ({ ...i, postgradLoanDeducted: v }))} />
          <div>
            <BoxLabel label="Student Loan Plan type" help={CH.studentLoanPlan} />
            <select value={income.studentLoanPlan} onChange={e => setIncome(i => ({ ...i, studentLoanPlan: Number(e.target.value) as Sa100Income['studentLoanPlan'] }))} className="input-base py-1 text-[12.5px]">
              <option value={0}>None</option>
              <option value={1}>Plan 1</option>
              <option value={2}>Plan 2</option>
              <option value={4}>Plan 4 (Scotland)</option>
              <option value={5}>Plan 5</option>
            </select>
          </div>
          <div>
            <BoxLabel label="Postgraduate Loan" help={CH.postgradLoan} />
            <select value={income.postgradLoan ? 'yes' : 'no'} onChange={e => setIncome(i => ({ ...i, postgradLoan: e.target.value === 'yes' }))} className="input-base py-1 text-[12.5px]">
              <option value="no">None</option>
              <option value="yes">Has a Postgraduate Loan</option>
            </select>
          </div>
          <div>
            <BoxLabel label="Tax region" help={CH.region} />
            <select value={income.region ?? 'uk'} onChange={e => setIncome(i => ({ ...i, region: e.target.value as 'uk' | 'scotland' }))} className="input-base py-1 text-[12.5px]">
              <option value="uk">England / Wales / NI</option>
              <option value="scotland">Scotland</option>
            </select>
          </div>
        </div>
      </CoreSection>

      <CoreSection title="Child benefit" count={c.childBenefit}>
        <p className="mb-2 text-[11px] font-semibold text-[var(--accent)]">High Income Child Benefit Charge</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={1} label="Total amount received in the year" help={CH.childBenefit} value={income.childBenefit ?? 0} onChange={v => setIncome(i => ({ ...i, childBenefit: v }))} />
          <LabelledNum box={2} label="Number of children claimed for" help={CH.childBenefitChildren} value={income.childBenefitChildren ?? 0} onChange={v => setIncome(i => ({ ...i, childBenefitChildren: v }))} />
          <LabelledDate box={3} label="Date you stopped claiming" help={CH.childBenefitStopDate} value={income.childBenefitStopDate ?? ''} onChange={v => setIncome(i => ({ ...i, childBenefitStopDate: v }))} />
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold text-[var(--accent)]">Winter Fuel Payment (WFP) / PAWHP charge</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={1} label="Total WFP / PAWHP received in the year" help={CH.winterFuelPayment} value={income.winterFuelPayment ?? 0} onChange={v => setIncome(i => ({ ...i, winterFuelPayment: v }))} />
        </div>
      </CoreSection>

      <CoreSection title="Marriage allowance" count={c.marriage}>
        <p className="mb-2 text-[11px] font-semibold text-[var(--accent)]">Your spouse or civil partner</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledText box={1} label="First name" value={income.spouseFirstName ?? ''} onChange={v => setIncome(i => ({ ...i, spouseFirstName: v }))} />
          <LabelledText box={2} label="Last name" value={income.spouseLastName ?? ''} onChange={v => setIncome(i => ({ ...i, spouseLastName: v }))} />
          <LabelledText box={3} label="National Insurance number" value={income.spouseNino ?? ''} onChange={v => setIncome(i => ({ ...i, spouseNino: v }))} placeholder="e.g. AA123456B" />
          <LabelledDate box={4} label="Date of birth" value={income.spouseDob ?? ''} onChange={v => setIncome(i => ({ ...i, spouseDob: v }))} />
          <LabelledDate box={5} label="Date of marriage / civil partnership" value={income.marriageDate ?? ''} onChange={v => setIncome(i => ({ ...i, marriageDate: v }))} />
          <CheckField box={6} label="Marriage Allowance transferred IN (£252 reducer)" help={CH.marriageAllowance} checked={income.marriageAllowance === 'received'} onChange={v => setIncome(i => ({ ...i, marriageAllowance: v ? 'received' : 'none' }))} />
          <CheckField box={7} label="Marriage Allowance transferred OUT" help={CH.marriageAllowance} checked={income.marriageAllowance === 'transferred'} onChange={v => setIncome(i => ({ ...i, marriageAllowance: v ? 'transferred' : 'none' }))} />
        </div>
      </CoreSection>

      <CoreSection title="Tax refunded or set off" count={c.taxRefunded}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={1} label="Tax refunded or set off by HMRC / Jobcentre Plus" help={CH.taxRefundedOrSetOff} value={income.taxRefundedOrSetOff ?? 0} onChange={v => setIncome(i => ({ ...i, taxRefundedOrSetOff: v }))} />
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold text-[var(--accent)]">If you have not paid enough tax</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <CheckField box={2} label="Do not collect current-year tax through my PAYE code" help={CH.noPayeCollect} checked={!!income.noPayeCollectCurrentYear} onChange={v => setIncome(i => ({ ...i, noPayeCollectCurrentYear: v }))} />
          <CheckField box={3} label="Do not collect next-year tax through my PAYE code" help={CH.noPayeCollect} checked={!!income.noPayeCollectNextYear} onChange={v => setIncome(i => ({ ...i, noPayeCollectNextYear: v }))} />
        </div>
      </CoreSection>

      <CoreSection title="Paid too much tax — repayment details" count={c.repayment}>
        <p className="mb-2 text-[11px] font-semibold text-[var(--accent)]">Bank / building society for any repayment</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledText box={4} label="Name of bank or building society" value={income.repayBankName ?? ''} onChange={v => setIncome(i => ({ ...i, repayBankName: v }))} />
          <LabelledText box={5} label="Account holder (or nominee)" value={income.repayAccountHolder ?? ''} onChange={v => setIncome(i => ({ ...i, repayAccountHolder: v }))} />
          <LabelledText box={6} label="Branch sort code" value={income.repaySortCode ?? ''} onChange={v => setIncome(i => ({ ...i, repaySortCode: v }))} placeholder="00-00-00" />
          <LabelledText box={7} label="Account number" value={income.repayAccountNumber ?? ''} onChange={v => setIncome(i => ({ ...i, repayAccountNumber: v }))} />
          <LabelledText box={8} label="Building society reference" value={income.repayBuildingSocRef ?? ''} onChange={v => setIncome(i => ({ ...i, repayBuildingSocRef: v }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <CheckField box={9} label="No UK bank / building society account" checked={!!income.repayNoUkAccount} onChange={v => setIncome(i => ({ ...i, repayNoUkAccount: v }))} />
          <CheckField box={10} label="Nominee name entered in box 5" checked={!!income.repayNomineeNameEntered} onChange={v => setIncome(i => ({ ...i, repayNomineeNameEntered: v }))} />
          <CheckField box={11} label="Nominee is my tax adviser" checked={!!income.repayNomineeIsAdviser} onChange={v => setIncome(i => ({ ...i, repayNomineeIsAdviser: v }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabelledArea box={12} label="Nominee's address" value={income.repayNomineeAddress ?? ''} onChange={v => setIncome(i => ({ ...i, repayNomineeAddress: v }))} />
          <LabelledText box={13} label="Nominee's postcode" value={income.repayNomineePostcode ?? ''} onChange={v => setIncome(i => ({ ...i, repayNomineePostcode: v }))} />
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">Box 14 (signature to authorise the nominee) is not needed when filing online.</p>
      </CoreSection>

      <CoreSection title="Your tax adviser" count={c.adviser}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledText box={15} label="Tax adviser name (person, firm, company)" value={income.adviserName ?? ''} onChange={v => setIncome(i => ({ ...i, adviserName: v }))} />
          <LabelledText box={16} label="Their phone number" value={income.adviserPhone ?? ''} onChange={v => setIncome(i => ({ ...i, adviserPhone: v }))} />
          <LabelledText box={18} label="Reference your adviser uses for you" value={income.adviserReference ?? ''} onChange={v => setIncome(i => ({ ...i, adviserReference: v }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabelledArea box={17} label="First line of their address incl. postcode" value={income.adviserAddress ?? ''} onChange={v => setIncome(i => ({ ...i, adviserAddress: v }))} />
          <LabelledArea box={19} label="Any other information" value={income.adviserOtherInfo ?? ''} onChange={v => setIncome(i => ({ ...i, adviserOtherInfo: v }))} />
        </div>
      </CoreSection>

      <CoreSection title="Signing your form" count={c.signing}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <CheckField box={20} label="Return contains provisional figures" checked={!!income.provisionalFigures} onChange={v => setIncome(i => ({ ...i, provisionalFigures: v }))} />
          <CheckField box={21} label="Separate supplementary pages attached" checked={!!income.separateSupplementaryPages} onChange={v => setIncome(i => ({ ...i, separateSupplementaryPages: v }))} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledDate label="Date signed" value={income.dateSigned ?? ''} onChange={v => setIncome(i => ({ ...i, dateSigned: v }))} />
          <LabelledText box={23} label="Capacity in which signing (e.g. executor)" value={income.signingCapacity ?? ''} onChange={v => setIncome(i => ({ ...i, signingCapacity: v }))} />
          <LabelledText box={24} label="Name of the person you have signed for" value={income.signedForPersonName ?? ''} onChange={v => setIncome(i => ({ ...i, signedForPersonName: v }))} />
          <LabelledText box={25} label="If boxes 23 & 24 used, enter your name" value={income.signatoryName ?? ''} onChange={v => setIncome(i => ({ ...i, signatoryName: v }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <LabelledArea box={26} label="Your address" value={income.signatoryAddress ?? ''} onChange={v => setIncome(i => ({ ...i, signatoryAddress: v }))} />
        </div>
        <p className="mt-3 text-[11px] text-[var(--text-muted)]">Box 22 (signature) is not needed when filing online.</p>
      </CoreSection>
    </div>
    </RevealContext.Provider>
  );
}

// SA100 box 21 — free-text description of the other income, with an AI-suggest.
function OtherIncomeDescription({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box17 = income.otherIncomeItems?.length ? income.otherIncomeItems.reduce((a, x) => a + (x.amount || 0), 0) : (income.otherIncome || 0);
  const box20 = (income.preOwnedAssetsItems ?? []).reduce((a, x) => a + (x.amount || 0), 0);

  async function suggest() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/tax-studio/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { clientName: ret.clientName, returnForm: 'SA100', returnLabel: 'Personal Tax', taxYear: ret.taxYear, entity: ret.entityLabel, stage: 'review', context: ret.context ?? '' },
          messages: [{ role: 'user', content: `Write a concise description for SA100 box 21 (the description of the "other UK income" reported in boxes 17 and 20). Other taxable income (box 17): ${fmtMoney(box17)}. Benefit from pre-owned assets (box 20): ${fmtMoney(box20)}. Reply with ONLY the short description text — no preamble, no quotes.` }],
        }),
      });
      const d = await res.json();
      if (res.ok && d.reply) setIncome(i => ({ ...i, otherIncomeDescription: String(d.reply).trim() }));
      else setErr(d.error || 'Could not suggest a description.');
    } catch {
      setErr('Could not suggest a description.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-black/5 pt-4">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
          <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">21</span> Description of income in boxes 17 &amp; 20
        </label>
        <button onClick={suggest} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-[var(--accent)]/40 px-2 py-1 text-[11px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/5 disabled:opacity-50">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} AI suggest
        </button>
      </div>
      <textarea
        value={income.otherIncomeDescription ?? ''}
        onChange={e => setIncome(i => ({ ...i, otherIncomeDescription: e.target.value }))}
        rows={2} placeholder="Describe the source of the other income…"
        className="input-base resize-none py-2 text-[12.5px]" />
      {err && <p className="mt-1 text-[11px] text-rose-600">{err}</p>}
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

const EMPLOYMENT_TABS = ['Details', 'Income', 'Benefit', 'Expenses'] as const;
type EmploymentTab = typeof EMPLOYMENT_TABS[number];

function EmploymentCard({ e, idx, onChange, onRemove }: {
  e: EmploymentSource; idx: number; onChange: (p: Partial<EmploymentSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<EmploymentTab>('Details');
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={e.employer} placeholder={`Employer ${idx + 1}`} onChange={ev => onChange({ employer: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <ProvenanceBadge id={e.id} />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(employmentTaxable(e))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="border-t border-black/5">
          {/* Capium sub-tabs: Employment Details / Income / Benefit / Expenses */}
          <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {EMPLOYMENT_TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${tab === t ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="space-y-3 px-3 py-3">
            {tab === 'Details' && (
              <>
                <BoxSection title="Employment details">
                  <BoxText box={1} label="Employer's name" value={e.employer} onChange={v => onChange({ employer: v })} />
                  <BoxText box={2} label="Employer's PAYE reference (NNN/XXXXXX)" help={EMP.payeRef} value={e.payeRef ?? ''} onChange={v => onChange({ payeRef: v })} placeholder="068/AZ77194" />
                  <BoxYesNo box={3} label="Is the employee a company director?" help={EMP.director} value={!!e.isDirector} onChange={v => onChange({ isDirector: v })} />
                  <BoxDate box={4} label="Date ceased being a director" value={e.directorCeasedDate ?? ''} onChange={v => onChange({ directorCeasedDate: v })} />
                  <BoxYesNo box={5} label="Is this a close company?" help={EMP.closeCompany} value={!!e.isCloseCompany} onChange={v => onChange({ isCloseCompany: v })} />
                </BoxSection>
                {e.isCloseCompany && (
                  <BoxSection title="Close company">
                    <BoxText box="5.1" label="Name of this close company" value={e.closeCompanyName ?? ''} onChange={v => onChange({ closeCompanyName: v })} />
                    <BoxText box="5.2" label="Registration number" value={e.closeCompanyReg ?? ''} onChange={v => onChange({ closeCompanyReg: v })} />
                    <BoxNum box="5.3" label="Dividends received from this close company" help={EMP.closeCompanyDividends} value={e.closeCompanyDividends ?? 0} onChange={v => onChange({ closeCompanyDividends: v })} />
                    <BoxNum box="5.4" label="Percentage shareholding" help={EMP.closeCompanyShareholding} value={e.closeCompanyShareholding ?? 0} onChange={v => onChange({ closeCompanyShareholding: v })} />
                  </BoxSection>
                )}
                <BoxSection title="Other">
                  <BoxCheck box="5.5" label="Teachers' Loans scheme / off-payroll working engagements" help={EMP.teachersLoanOffPayroll} checked={!!e.teachersLoanOffPayroll} onChange={v => onChange({ teachersLoanOffPayroll: v })} />
                </BoxSection>
                {e.closeCompanyDividends ? <p className="text-[11px] text-[var(--text-muted)]">Box 5.3 is a declaration — enter the dividends themselves in the Interest &amp; dividends section so they're taxed once.</p> : null}
              </>
            )}
            {tab === 'Income' && (
              <BoxSection title="Employment income">
                <BoxNum box={6} label="Pay before tax was taken off" value={e.pay} onChange={v => onChange({ pay: v })} />
                <BoxNum box="6.1" label="Payrolled benefits in box 6 affecting student loan" help={EMP.payrolledBenefitsStudentLoan} value={e.payrolledBenefitsStudentLoan ?? 0} onChange={v => onChange({ payrolledBenefitsStudentLoan: v })} />
                <BoxNum box={7} label="UK tax taken off" value={e.taxDeducted} onChange={v => onChange({ taxDeducted: v })} />
                <BoxNum box={8} label="Tips & other payments not on P60" help={EMP.tips} value={e.tips ?? 0} onChange={v => onChange({ tips: v })} />
                <BoxNum label="Class 1 NIC" help={EMP.class1Nic} value={e.class1Nic ?? 0} onChange={v => onChange({ class1Nic: v })} />
              </BoxSection>
            )}
            {tab === 'Benefit' && (
              <BoxSection title="Employment benefits (P11D)">
                <BoxNum box={9} label="Company cars and vans" value={e.benCar ?? 0} onChange={v => onChange({ benCar: v })} />
                <BoxNum box={10} label="Fuel for company cars and vans" value={e.benFuel ?? 0} onChange={v => onChange({ benFuel: v })} />
                <BoxNum box={11} label="Private medical and dental insurance" value={e.benMedical ?? 0} onChange={v => onChange({ benMedical: v })} />
                <BoxNum box={12} label="Vouchers, credit cards & excess mileage" value={e.benVouchers ?? 0} onChange={v => onChange({ benVouchers: v })} />
                <BoxNum box={13} label="Goods and other assets provided" value={e.benAssets ?? 0} onChange={v => onChange({ benAssets: v })} />
                <BoxNum box={14} label="Accommodation provided by employer" value={e.benAccommodation ?? 0} onChange={v => onChange({ benAccommodation: v })} />
                <BoxNum box={15} label="Other benefits" value={e.benOther ?? 0} onChange={v => onChange({ benOther: v })} />
                <BoxNum box={16} label="Expenses payments received & balancing charges" help={EMP.benExpPayments} value={e.benExpPayments ?? 0} onChange={v => onChange({ benExpPayments: v })} />
              </BoxSection>
            )}
            {tab === 'Expenses' && (
              <BoxSection title="Employment expenses">
                <BoxNum box={17} label="Business travel and subsistence expenses" value={e.expTravel ?? 0} onChange={v => onChange({ expTravel: v })} />
                <BoxNum box={18} label="Fixed deductions for expenses" help={EMP.expFixed} value={e.expFixed ?? 0} onChange={v => onChange({ expFixed: v })} />
                <BoxNum box={19} label="Professional fees and subscriptions" help={EMP.expProfessional} value={e.expProfessional ?? 0} onChange={v => onChange({ expProfessional: v })} />
                <BoxNum box={20} label="Other expenses and capital allowances" help={EMP.expOther} value={e.expOther ?? 0} onChange={v => onChange({ expOther: v })} />
              </BoxSection>
            )}
          </div>
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

function BoxNum({ box, label, value, onChange, help }: { box?: number | string; label: string; value: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <NumIn value={value} onChange={onChange} />
    </div>
  );
}

function BoxText({ box, label, value, onChange, placeholder, required, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; help?: string }) {
  const missing = required && !value.trim();
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{required && <span className="text-rose-500">*</span>}{help && <HelpDot help={help} label={label} />}
      </label>
      <input value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`input-base py-1 text-[12.5px] ${missing ? 'border-rose-300' : ''}`} />
    </div>
  );
}

// SA102 box date (YYYY-MM-DD) with a box chip, matching BoxNum/BoxText.
function BoxDate({ box, label, value, onChange, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; help?: string }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <input type="date" value={value} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />
    </div>
  );
}

// Yes / No radio pair used by the SA102 Employment Details tab.
function BoxYesNo({ box, label, value, onChange, help }: { box?: number | string; label: string; value: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <div className="flex gap-3 py-1 text-[12px]">
        {[['Yes', true], ['No', false]].map(([lbl, val]) => (
          <label key={lbl as string} className="flex cursor-pointer items-center gap-1.5">
            <input type="radio" checked={value === val} onChange={() => onChange(val as boolean)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            {lbl as string}
          </label>
        ))}
      </div>
    </div>
  );
}

// Checkbox styled to sit in the BoxSection grid.
function BoxCheck({ box, label, checked, onChange, help }: { box?: number | string; label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-2 text-[11px] font-medium text-[var(--text-muted)]">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <span onClick={e => e.preventDefault()}><HelpDot help={help} label={label} /></span>}
    </label>
  );
}

// Read-only, auto-calculated box (blue chip) — mirrors Capium's computed fields.
function BoxCalc({ box, label, value, help }: { box?: number | string; label: string; value: number; help?: string }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-600">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <div className="input-base flex items-center justify-end rounded-md bg-sky-50/70 py-1 text-right text-[12.5px] font-semibold text-sky-700">{fmtMoney(value)}</div>
    </div>
  );
}

function SelfEmploymentPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const add = () => setIncome(i => ({ ...i, selfEmployment: [...i.selfEmployment, { id: `s-${i.selfEmployment.length}-${Date.now()}`, name: '', profit: 0, form: 'short' }] }));
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
    </div>
  );
}

const TRADE_TABS = ['Business details', 'Business Expenses', 'Net profit(loss)', 'Losses, CIS', 'Balance Sheet'] as const;
type TradeTab = typeof TRADE_TABS[number];
const TRADE_SUBTABS: Record<TradeTab, string[]> = {
  'Business details': ['Business Details', 'Other information', 'Business Income'],
  'Business Expenses': ['Total Expenses', 'Disallowable Expenses'],
  'Net profit(loss)': ['Net profit or loss', 'Capital allowance', 'Taxable profit or loss'],
  'Losses, CIS': ['Losses', 'CIS'],
  'Balance Sheet': ['Assets', 'Liabilities', 'NIC & other Info'],
};

// SA103S (short) — fewer tabs, no Balance Sheet, single-page Expenses & Losses.
const SHORT_TRADE_TABS = ['Business details', 'Business Expenses', 'Net profit(loss)', 'Losses, CIS'] as const;
const SHORT_TRADE_SUBTABS: Record<string, string[]> = {
  'Business details': ['Business Details', 'Business Income'],
  'Business Expenses': ['Allowable Expenses'],
  'Net profit(loss)': ['Net profit or loss', 'Tax allowances', 'Taxable profits', 'Total taxable profits'],
  'Losses, CIS': ['Losses, CIS'],
};

function TradeCard({ t, idx, onChange, onRemove }: {
  t: TradeSource; idx: number; onChange: (p: Partial<TradeSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<string>('Business details');
  const [sub, setSub] = useState(0);
  const [caOpen, setCaOpen] = useState(false);
  const [migratePrompt, setMigratePrompt] = useState(false);
  const [shortConfirm, setShortConfirm] = useState(false);
  const isShort = t.form === 'short';
  const TABS: readonly string[] = isShort ? SHORT_TRADE_TABS : TRADE_TABS;
  const SUBTABS: Record<string, string[]> = isShort ? SHORT_TRADE_SUBTABS : TRADE_SUBTABS;
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  // Over-threshold guard: prompt once when a short trade's turnover crosses the limit.
  const overThreshold = isShort && (t.turnover || 0) >= SA103_SHORT_TURNOVER_LIMIT;
  const prevOver = useRef(false);
  useEffect(() => {
    if (overThreshold && !prevOver.current) setMigratePrompt(true);
    prevOver.current = overThreshold;
  }, [overThreshold]);
  // Have the capital-allowance boxes been hand-edited away from what the
  // calculator last computed from the pools? (Only relevant once used.)
  const caRes = t.capitalAllowancesCalc ? computeCapitalAllowances(t.capitalAllowancesCalc) : null;
  const caDiverged = !!caRes && (
    (t.aia ?? 0) !== caRes.aia || (t.ca18 ?? 0) !== caRes.wdaMain || (t.ca6 ?? 0) !== caRes.wdaSpecial ||
    (t.enhancedCapitalAllowances ?? 0) !== caRes.fya || (t.allowancesOnSale ?? 0) !== caRes.balancingAllowance ||
    (t.balancingCharges ?? 0) !== caRes.balancingCharge
  );
  const activeTab = TABS.includes(tab) ? tab : TABS[0];
  const subList = SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  const set = (p: Partial<TradeSource>) => onChange(p);
  const switchForm = (form: 'full' | 'short') => { onChange(form === 'full' ? migrateTradeToFull(t) : migrateTradeToShort(t)); setMigratePrompt(false); setSub(0); };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={t.name} placeholder={`Trade ${idx + 1} — business name*`} onChange={ev => set({ name: ev.target.value })} className={`input-base flex-1 py-1 text-[12.5px] font-semibold ${!t.name.trim() ? 'border-rose-300' : ''}`} />
        <ProvenanceBadge id={t.id} />
        {/* SA103 full / short toggle */}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-[var(--border)] text-[10.5px] font-semibold">
          <button onClick={() => { if (isShort) switchForm('full'); }} className={`px-2 py-0.5 ${!isShort ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>Full</button>
          <button onClick={() => { if (!isShort) setShortConfirm(true); }} className={`px-2 py-0.5 ${isShort ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>Short</button>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(tradeTaxableProfit(t))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {migratePrompt && (
        <MigrateToFullModal turnover={t.turnover || 0} onConfirm={() => switchForm('full')} onKeep={() => setMigratePrompt(false)} />
      )}
      {shortConfirm && (
        <MigrateToShortModal onConfirm={() => { switchForm('short'); setShortConfirm(false); }} onCancel={() => setShortConfirm(false)} />
      )}
      {open && (
        <div className="border-t border-black/5">
          {/* Capium top tabs */}
          <div className="flex flex-wrap gap-1 border-b border-black/5 px-3 pt-2.5 pb-2">
            {TABS.map(tt => (
              <button key={tt} onClick={() => setTop(tt)}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${activeTab === tt ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {tt}
              </button>
            ))}
          </div>
          {/* Capium sub-tabs */}
          {subList.length > 1 && <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {subList.map((st, i) => (
              <button key={st} onClick={() => setSub(i)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${sub === i ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {st}
              </button>
            ))}
          </div>}
          <div className="space-y-3 px-3 py-3">
            {isShort && <TradeShortBody t={t} set={set} subName={subName} caDiverged={caDiverged} onOpenCa={() => setCaOpen(true)} />}
            {!isShort && (<>
            {/* ── Business details ── */}
            {subName === 'Business Details' && (
              <BoxSection title="Business details">
                <BoxText box={1} label="Business name" required value={t.name} onChange={v => set({ name: v })} />
                <BoxText box={2} label="Description of business" required value={t.description ?? ''} onChange={v => set({ description: v })} />
                <BoxText box={3} label="First line of business address" value={t.addressLine ?? ''} onChange={v => set({ addressLine: v })} />
                <BoxText box={4} label="Postcode of business address" value={t.postcode ?? ''} onChange={v => set({ postcode: v })} />
                <BoxCheck box={5} label="Name/address details changed in last 12 months" help={H.detailsChanged} checked={!!t.detailsChanged} onChange={v => set({ detailsChanged: v })} />
                <BoxYesNo box="6Q" label="Did this business start in the tax year?" help={H.startedInYear} value={!!t.startedInYear} onChange={v => set({ startedInYear: v })} />
                <BoxDate box={6} label="Date business started" value={t.dateStarted ?? ''} onChange={v => set({ dateStarted: v })} />
                <BoxYesNo box="7Q" label="Did this business cease in the tax year?" help={H.ceasedInYear} value={!!t.ceasedInYear} onChange={v => set({ ceasedInYear: v })} />
                <BoxDate box={7} label="Date business ceased" value={t.dateCeased ?? ''} onChange={v => set({ dateCeased: v })} />
                <BoxDate box={8} label="Start of accounting period" help={H.periodStart} value={t.periodStart ?? ''} onChange={v => set({ periodStart: v })} />
                <BoxDate box={9} label="End of accounting period" help={H.periodEnd} value={t.periodEnd ?? ''} onChange={v => set({ periodEnd: v })} />
                <BoxCheck box={10} label="Used traditional accounting (not cash basis)" help={H.traditionalAccounting} checked={!!t.traditionalAccounting} onChange={v => set({ traditionalAccounting: v })} />
              </BoxSection>
            )}
            {subName === 'Other information' && (
              <BoxSection title="Other information">
                <BoxCheck box={13} label="Do special arrangements apply?" help={H.specialArrangements} checked={!!t.specialArrangements} onChange={v => set({ specialArrangements: v })} />
                <BoxCheck box={14} label="Profit details provided on last year's return?" help={H.priorYearProfitDetails} checked={!!t.priorYearProfitDetails} onChange={v => set({ priorYearProfitDetails: v })} />
              </BoxSection>
            )}
            {subName === 'Business Income' && (
              <BoxSection title="Business income">
                <BoxNum box={15} label="Turnover" value={t.turnover ?? 0} onChange={v => set({ turnover: v })} />
                <BoxNum box={16} label="Any other business income not in box 15" help={H.otherBusinessIncome} value={t.otherBusinessIncome ?? 0} onChange={v => set({ otherBusinessIncome: v })} />
                <BoxNum box="16.1" label="Trading income allowance" help={H.tradingIncomeAllowance} value={t.tradingIncomeAllowance ?? 0} onChange={v => set({ tradingIncomeAllowance: v })} />
              </BoxSection>
            )}
            {/* ── Business Expenses ── */}
            {subName === 'Total Expenses' && (
              <BoxSection title="Business expenses">
                <BoxNum box={17} label="Cost of goods bought for resale or goods used" value={t.expCostOfGoods ?? 0} onChange={v => set({ expCostOfGoods: v })} />
                <BoxNum box={18} label="Construction industry — payments to subcontractors" value={t.expSubcontractors ?? 0} onChange={v => set({ expSubcontractors: v })} />
                <BoxNum box={19} label="Wages, salaries and other staff costs" value={t.expWages ?? 0} onChange={v => set({ expWages: v })} />
                <BoxNum box={20} label="Car, van and travel expenses" value={t.expCarVanTravel ?? 0} onChange={v => set({ expCarVanTravel: v })} />
                <BoxNum box={21} label="Rent, rates, power and insurance costs" value={t.expPremises ?? 0} onChange={v => set({ expPremises: v })} />
                <BoxNum box={22} label="Repairs and renewals of property and equipment" value={t.expRepairs ?? 0} onChange={v => set({ expRepairs: v })} />
                <BoxNum box={23} label="Phone, fax, stationery and other office costs" value={t.expOffice ?? 0} onChange={v => set({ expOffice: v })} />
                <BoxNum box={24} label="Advertising and business entertainment costs" value={t.expAdvertising ?? 0} onChange={v => set({ expAdvertising: v })} />
                <BoxNum box={25} label="Interest on bank and other loans" value={t.expInterest ?? 0} onChange={v => set({ expInterest: v })} />
                <BoxNum box={26} label="Bank, credit card and other financial charges" value={t.expBankCharges ?? 0} onChange={v => set({ expBankCharges: v })} />
                <BoxNum box={27} label="Irrecoverable debts written off" value={t.expBadDebts ?? 0} onChange={v => set({ expBadDebts: v })} />
                <BoxNum box={28} label="Accountancy, legal and other professional fees" value={t.expProfessional ?? 0} onChange={v => set({ expProfessional: v })} />
                <BoxNum box={29} label="Depreciation and loss/profit on sale of assets" value={t.expDepreciation ?? 0} onChange={v => set({ expDepreciation: v })} />
                <BoxNum box={30} label="Other business expense" value={t.expOtherCosts ?? 0} onChange={v => set({ expOtherCosts: v })} />
                <BoxCalc box={31} label="Total expenses" value={tradeExpensesTotal(t)} />
              </BoxSection>
            )}
            {subName === 'Disallowable Expenses' && (
              <BoxSection title="Disallowable expenses">
                <BoxNum box={32} label="Cost of goods (disallowable)" help={H.disallowables} value={t.disCostOfGoods ?? 0} onChange={v => set({ disCostOfGoods: v })} />
                <BoxNum box={33} label="Subcontractors (disallowable)" value={t.disSubcontractors ?? 0} onChange={v => set({ disSubcontractors: v })} />
                <BoxNum box={34} label="Wages & staff (disallowable)" value={t.disWages ?? 0} onChange={v => set({ disWages: v })} />
                <BoxNum box={35} label="Car, van & travel (disallowable)" value={t.disCarVanTravel ?? 0} onChange={v => set({ disCarVanTravel: v })} />
                <BoxNum box={36} label="Rent, rates, power, insurance (disallowable)" value={t.disPremises ?? 0} onChange={v => set({ disPremises: v })} />
                <BoxNum box={37} label="Repairs & renewals (disallowable)" value={t.disRepairs ?? 0} onChange={v => set({ disRepairs: v })} />
                <BoxNum box={38} label="Phone & office (disallowable)" value={t.disOffice ?? 0} onChange={v => set({ disOffice: v })} />
                <BoxNum box={39} label="Advertising & entertainment (disallowable)" value={t.disAdvertising ?? 0} onChange={v => set({ disAdvertising: v })} />
                <BoxNum box={40} label="Interest on loans (disallowable)" value={t.disInterest ?? 0} onChange={v => set({ disInterest: v })} />
                <BoxNum box={41} label="Bank & finance charges (disallowable)" value={t.disBankCharges ?? 0} onChange={v => set({ disBankCharges: v })} />
                <BoxNum box={42} label="Irrecoverable debts (disallowable)" value={t.disBadDebts ?? 0} onChange={v => set({ disBadDebts: v })} />
                <BoxNum box={43} label="Accountancy & professional (disallowable)" value={t.disProfessional ?? 0} onChange={v => set({ disProfessional: v })} />
                <BoxNum box={44} label="Depreciation (disallowable)" value={t.disDepreciation ?? 0} onChange={v => set({ disDepreciation: v })} />
                <BoxNum box={45} label="Other business expense (disallowable)" value={t.disOtherCosts ?? 0} onChange={v => set({ disOtherCosts: v })} />
                <BoxCalc box={46} label="Total disallowable expenses" help={H.disTotal} value={tradeDisallowableTotal(t)} />
              </BoxSection>
            )}
            {/* ── Net profit(loss) ── */}
            {subName === 'Net profit or loss' && (
              <BoxSection title="Net profit or loss">
                <BoxCalc box={47} label="Net profit" value={Math.max(0, tradeNetProfit(t))} />
                <BoxCalc box={48} label="Or net loss" value={Math.max(0, -tradeNetProfit(t))} />
              </BoxSection>
            )}
            {subName === 'Capital allowance' && (
              <>
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] px-3 py-2">
                <p className="text-[11.5px] text-[var(--text-secondary)]">Work out AIA, pool WDAs and balancing charges — closing balances carry to next year.</p>
                <button onClick={() => setCaOpen(true)} className="btn-primary shrink-0 py-1 text-[12px]"><Calculator size={14} /> {caRes ? 'Reopen calculator' : 'Capital Allowances Calculator'}</button>
              </div>
              {caDiverged && (
                <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>These boxes have been edited since the calculator was last run, so the carried-forward pool balances may be out of date. Reopen the calculator and Apply to recompute the pools before rolling this trade forward.</span>
                </div>
              )}
              <BoxSection title="Capital allowances">
                <BoxNum box={49} label="Annual Investment Allowance" help={H.aia} value={t.aia ?? 0} onChange={v => set({ aia: v })} />
                <BoxNum box={50} label="Capital allowances at 18% on equipment" help={H.ca18} value={t.ca18 ?? 0} onChange={v => set({ ca18: v })} />
                <BoxNum box={51} label="Capital allowances at 6% on equipment" help={H.ca6} value={t.ca6 ?? 0} onChange={v => set({ ca6: v })} />
                <BoxNum box={52} label="Zero-emission goods vehicle allowance" help={H.zeroEmissionGoods} value={t.zeroEmissionGoods ?? 0} onChange={v => set({ zeroEmissionGoods: v })} />
                <BoxNum box="52.1" label="Zero-emission car allowance" help={H.zeroEmissionCar} value={t.zeroEmissionCar ?? 0} onChange={v => set({ zeroEmissionCar: v })} />
                <BoxNum box={53} label="Structures and Buildings Allowance" help={H.sba} value={t.sba ?? 0} onChange={v => set({ sba: v })} />
                <BoxNum box="53.1" label="Freeport / Investment Zone SBA" help={H.sbaFreeport} value={t.sbaFreeport ?? 0} onChange={v => set({ sbaFreeport: v })} />
                <BoxNum box={54} label="Electric charge-point allowance" help={H.electricChargepoint} value={t.electricChargepoint ?? 0} onChange={v => set({ electricChargepoint: v })} />
                <BoxNum box={55} label="100% and other enhanced capital allowances" help={H.enhancedCapitalAllowances} value={t.enhancedCapitalAllowances ?? 0} onChange={v => set({ enhancedCapitalAllowances: v })} />
                <BoxNum box={56} label="Allowances on sale or cessation of business use" help={H.allowancesOnSale} value={t.allowancesOnSale ?? 0} onChange={v => set({ allowancesOnSale: v })} />
                <BoxCalc box={57} label="Total capital allowances" value={tradeCapitalAllowancesTotal(t)} />
                <BoxNum box={59} label="Balancing charge on disposals" help={H.balancingCharge} value={t.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} />
              </BoxSection>
              </>
            )}
            {subName === 'Taxable profit or loss' && (
              <BoxSection title="Calculating your taxable profit or loss">
                <BoxNum box={60} label="Goods and services for your own use" help={H.goodsOwnUse} value={t.goodsOwnUse ?? 0} onChange={v => set({ goodsOwnUse: v })} />
                <BoxCalc box={61} label="Total additions to net profit" value={tradeAdditions(t)} />
                <BoxNum box={62} label="Income/receipts taxable elsewhere" help={H.incomeReceiptsElsewhere} value={t.incomeReceiptsElsewhere ?? 0} onChange={v => set({ incomeReceiptsElsewhere: v })} />
                <BoxCalc box={63} label="Total deductions from net profit" value={tradeDeductions(t)} />
                <BoxCalc box={64} label="Net business profit for tax purposes" help={H.netProfitForTax} value={Math.max(0, tradeProfitForTax(t))} />
                <BoxCalc box={65} label="Net business loss for tax purposes" value={Math.max(0, -tradeProfitForTax(t))} />
                <BoxNum box={68} label="Adjustment for short/long accounting period" help={H.basisAdjustment} value={t.basisAdjustment ?? 0} onChange={v => set({ basisAdjustment: v })} />
                <BoxNum box={71} label="Adjustment for change of accounting practice" help={H.changeOfPractice} value={t.changeOfPracticeAdjustment ?? 0} onChange={v => set({ changeOfPracticeAdjustment: v })} />
                <BoxNum box={72} label="Averaging adjustment" help={H.averaging} value={t.averagingAdjustment ?? 0} onChange={v => set({ averagingAdjustment: v })} />
                <BoxCalc box={73} label="Adjusted profit" help={H.adjustedProfit} value={Math.max(0, tradeAdjustedProfit(t))} />
                <BoxNum box="73.3" label="Spread of transition profit arising this year" help={H.transitionProfit} value={t.transitionProfitSpread ?? 0} onChange={v => set({ transitionProfitSpread: v })} />
                <BoxNum box="73.4" label="Loss b/fwd set against transition profit spread" help={H.transitionLossBfwd} value={t.transitionLossBfwd ?? 0} onChange={v => set({ transitionLossBfwd: v })} />
                <BoxNum box={74} label="Loss brought forward from earlier years" help={H.lossBroughtForward} value={t.lossBroughtForward ?? 0} onChange={v => set({ lossBroughtForward: v })} />
                <BoxNum box="74.1" label="Unused loss to carry forward to next year" help={H.unusedLossCarriedForward} value={t.unusedLossCarriedForward ?? 0} onChange={v => set({ unusedLossCarriedForward: v })} />
                <BoxNum box={75} label="Any other business income" help={H.otherBusinessIncome75} value={t.otherBusinessIncome75 ?? 0} onChange={v => set({ otherBusinessIncome75: v })} />
                <BoxCalc box={76} label="Total taxable profits" help={H.totalTaxableProfit} value={tradeTaxableProfit(t)} />
                <BoxNum box="76.1" label="Amount claimed under the FIG regime" help={H.figClaim} value={t.figClaim ?? 0} onChange={v => set({ figClaim: v })} />
              </BoxSection>
            )}
            {/* ── Losses, CIS ── */}
            {subName === 'Losses' && (
              <>
              <BoxSection title="Losses">
                <BoxCalc box={77} label="Adjusted loss" help={H.adjustedLoss} value={tradeAdjustedLoss(t)} />
                <BoxNum box="77.1" label="Adjustment to losses under the FIG regime" value={t.adjustmentLossFig ?? 0} onChange={v => set({ adjustmentLossFig: v })} />
                <BoxNum box={78} label="Loss set off against other income" help={H.lossSetOff} value={t.lossSetOffOtherIncome ?? 0} onChange={v => set({ lossSetOffOtherIncome: v })} />
                <BoxNum box={79} label="Loss carried back" help={H.lossCarriedBack} value={t.lossCarriedBack ?? 0} onChange={v => set({ lossCarriedBack: v })} />
                <BoxCalc box={80} label="Loss carried forward" help={H.lossCarriedForward} value={tradeLossCarriedForward(t)} />
              </BoxSection>
              {(t.lossBroughtForward ?? 0) > 0 && (
                <p className="mt-2 text-[11px] text-[var(--text-secondary)]">Loss brought forward from earlier years (box 74): <span className="font-semibold">{fmtMoney(t.lossBroughtForward ?? 0)}</span> — set against this year's profit on the Net profit tab. Box 80 (incl. any unused b/fwd) carries to next year automatically.</p>
              )}
              </>
            )}
            {subName === 'CIS' && (
              <BoxSection title="CIS deductions and tax taken off">
                <BoxNum box={81} label="CIS deductions on payments from contractors" help={H.cisDeductions} value={t.cisDeductions ?? 0} onChange={v => set({ cisDeductions: v })} />
                <BoxNum box={82} label="Other tax taken off trading income" help={H.otherTaxTaken} value={t.otherTaxTaken ?? 0} onChange={v => set({ otherTaxTaken: v })} />
              </BoxSection>
            )}
            {/* ── Balance Sheet ── */}
            {subName === 'Assets' && (
              <BoxSection title="Assets">
                <BoxNum box={83} label="Equipment, machinery and vehicles" value={t.bsEquipment ?? 0} onChange={v => set({ bsEquipment: v })} />
                <BoxNum box={84} label="Other fixed assets" value={t.bsOtherFixedAssets ?? 0} onChange={v => set({ bsOtherFixedAssets: v })} />
                <BoxNum box={85} label="Stock and work in progress" value={t.bsStock ?? 0} onChange={v => set({ bsStock: v })} />
                <BoxNum box={86} label="Trade debtors" value={t.bsDebtors ?? 0} onChange={v => set({ bsDebtors: v })} />
                <BoxNum box={87} label="Bank/building society balances" value={t.bsBank ?? 0} onChange={v => set({ bsBank: v })} />
                <BoxNum box={88} label="Cash in hand" value={t.bsCash ?? 0} onChange={v => set({ bsCash: v })} />
                <BoxNum box={89} label="Other current assets and prepayments" value={t.bsOtherCurrentAssets ?? 0} onChange={v => set({ bsOtherCurrentAssets: v })} />
                <BoxCalc box={90} label="Total assets" value={tradeTotalAssets(t)} />
              </BoxSection>
            )}
            {subName === 'Liabilities' && (
              <>
                <BoxSection title="Liabilities">
                  <BoxNum box={91} label="Creditors" value={t.bsCreditors ?? 0} onChange={v => set({ bsCreditors: v })} />
                  <BoxNum box={92} label="Loans and overdrafts" value={t.bsLoans ?? 0} onChange={v => set({ bsLoans: v })} />
                  <BoxNum box={93} label="Other liabilities and accruals" value={t.bsOtherLiabilities ?? 0} onChange={v => set({ bsOtherLiabilities: v })} />
                  <BoxCalc box={94} label="Net business assets" value={tradeNetBusinessAssets(t)} />
                </BoxSection>
                <BoxSection title="Capital account">
                  <BoxNum box={95} label="Balance at start of period" value={t.caBalanceStart ?? 0} onChange={v => set({ caBalanceStart: v })} />
                  <BoxCalc box={96} label="Net profit or loss (box 47 or 48)" value={tradeNetProfit(t)} />
                  <BoxNum box={97} label="Capital introduced" value={t.caCapitalIntroduced ?? 0} onChange={v => set({ caCapitalIntroduced: v })} />
                  <BoxNum box={98} label="Drawings" value={t.caDrawings ?? 0} onChange={v => set({ caDrawings: v })} />
                  <BoxCalc box={99} label="Balance at end of period" value={tradeCapitalAccountEnd(t)} />
                </BoxSection>
              </>
            )}
            {subName === 'NIC & other Info' && (
              <>
                <BoxSection title="NIC">
                  <BoxCheck box={100} label="Choose to pay Class 2 NIC voluntarily" help={H.class2Voluntary} checked={!!t.class2Voluntary} onChange={v => set({ class2Voluntary: v })} />
                  <BoxCheck box={101} label="Exempt from paying Class 4 NIC" help={H.class4Exempt} checked={!!t.class4Exempt} onChange={v => set({ class4Exempt: v })} />
                  <BoxNum box={102} label="Adjustment to profit chargeable to Class 4 NIC" help={H.class4Adjustment} value={t.class4Adjustment ?? 0} onChange={v => set({ class4Adjustment: v })} />
                  <BoxYesNo label="Self-employed all year & willing to pay Class 2 for the full year?" help={H.willingClass2} value={!!t.willingPayClass2FullYear} onChange={v => set({ willingPayClass2FullYear: v })} />
                </BoxSection>
                <BoxSection title="Any other information">
                  <div className="col-span-full">
                    <textarea value={t.otherInformation ?? ''} rows={3} onChange={e => set({ otherInformation: e.target.value })} placeholder="Box 103 — any other information" className="input-base resize-none py-2 text-[12.5px]" />
                  </div>
                </BoxSection>
              </>
            )}
            </>)}
          </div>
        </div>
      )}
      {caOpen && (
        <CapitalAllowancesCalculator
          state={t.capitalAllowancesCalc}
          onClose={() => setCaOpen(false)}
          onApply={(caState, res) => {
            set({
              capitalAllowancesCalc: caState,
              aia: res.aia, ca18: res.wdaMain, ca6: res.wdaSpecial,
              enhancedCapitalAllowances: res.fya, allowancesOnSale: res.balancingAllowance,
              balancingCharges: res.balancingCharge,
            });
            setCaOpen(false);
          }}
        />
      )}
    </div>
  );
}

// SA103S (short) body — the slimmer Capium layout over the same trade data.
function TradeShortBody({ t, set, subName, caDiverged, onOpenCa }: {
  t: TradeSource; set: (p: Partial<TradeSource>) => void; subName: string; caDiverged: boolean; onOpenCa: () => void;
}) {
  const overThreshold = (t.turnover || 0) >= SA103_SHORT_TURNOVER_LIMIT;
  return (
    <>
      {subName === 'Business Details' && (
        <BoxSection title="Business details">
          <BoxText box={1} label="Description of business" required value={t.description ?? ''} onChange={v => set({ description: v })} />
          <BoxText box={2} label="Postcode of your business address" value={t.postcode ?? ''} onChange={v => set({ postcode: v })} />
          <BoxCheck box={3} label="Name/address details changed in last 12 months" help={H.detailsChanged} checked={!!t.detailsChanged} onChange={v => set({ detailsChanged: v })} />
          <BoxCheck box={4} label="If you are a foster carer" help={H.fosterCarer} checked={!!t.fosterCarer} onChange={v => set({ fosterCarer: v })} />
          <BoxYesNo box="5Q" label="Did this business start in the tax year?" help={H.startedInYear} value={!!t.startedInYear} onChange={v => set({ startedInYear: v })} />
          <BoxDate box={5} label="Date business started" value={t.dateStarted ?? ''} onChange={v => set({ dateStarted: v })} />
          <BoxYesNo box="6Q" label="Did this business cease in the tax year?" help={H.ceasedInYear} value={!!t.ceasedInYear} onChange={v => set({ ceasedInYear: v })} />
          <BoxDate box={6} label="Date business ceased" value={t.dateCeased ?? ''} onChange={v => set({ dateCeased: v })} />
          <BoxDate box={7} label="Accounts made up to" help={H.accountsMadeUpTo} value={t.periodEnd ?? ''} onChange={v => set({ periodEnd: v })} />
          <BoxCheck box={8} label="Used traditional accounting (not cash basis)" help={H.traditionalAccounting} checked={!!t.traditionalAccounting} onChange={v => set({ traditionalAccounting: v })} />
        </BoxSection>
      )}
      {subName === 'Business Income' && (
        <>
          <BoxSection title="Business income">
            <BoxNum box={9} label="Turnover" value={t.turnover ?? 0} onChange={v => set({ turnover: v })} />
            <BoxNum box={10} label="Any other business income not included in box 9" help={H.otherBusinessIncome} value={t.otherBusinessIncome ?? 0} onChange={v => set({ otherBusinessIncome: v })} />
            <BoxNum box="10.1" label="Trading income allowance" help={H.tradingIncomeAllowance} value={t.tradingIncomeAllowance ?? 0} onChange={v => set({ tradingIncomeAllowance: v })} />
          </BoxSection>
          <p className="text-[10.5px] text-[var(--text-muted)]">Short form: use it when turnover is under {fmtMoney(SA103_SHORT_TURNOVER_LIMIT)}.</p>
          {overThreshold && (
            <div className="mt-1 flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Turnover is {fmtMoney(t.turnover || 0)} — at or above {fmtMoney(SA103_SHORT_TURNOVER_LIMIT)} the full Self-employment pages are required. Use the <span className="font-semibold">Full</span> toggle above to switch (all entries are kept).</span>
            </div>
          )}
        </>
      )}
      {subName === 'Allowable Expenses' && (
        <BoxSection title="Allowable expenses">
          <BoxNum box={11} label="Cost of goods bought for resale or goods used" value={t.expCostOfGoods ?? 0} onChange={v => set({ expCostOfGoods: v })} />
          <BoxNum box={12} label="Car, van and travel expenses" value={t.expCarVanTravel ?? 0} onChange={v => set({ expCarVanTravel: v })} />
          <BoxNum box={13} label="Wages, salaries and other staff costs" value={t.expWages ?? 0} onChange={v => set({ expWages: v })} />
          <BoxNum box={14} label="Rent, rates, power and insurance costs" value={t.expPremises ?? 0} onChange={v => set({ expPremises: v })} />
          <BoxNum box={15} label="Repairs and renewals of property and equipment" value={t.expRepairs ?? 0} onChange={v => set({ expRepairs: v })} />
          <BoxNum box={16} label="Accountancy, legal and other professional fees" value={t.expProfessional ?? 0} onChange={v => set({ expProfessional: v })} />
          <BoxNum box={17} label="Interest and bank, credit card etc. financial charges" value={t.expInterest ?? 0} onChange={v => set({ expInterest: v })} />
          <BoxNum box={18} label="Phone, fax, stationery and other office costs" value={t.expOffice ?? 0} onChange={v => set({ expOffice: v })} />
          <BoxNum box={19} label="Other allowable business expenses" value={t.expOtherCosts ?? 0} onChange={v => set({ expOtherCosts: v })} />
          <BoxCalc box={20} label="Total allowable expenses" value={tradeExpensesTotal(t)} />
        </BoxSection>
      )}
      {subName === 'Net profit or loss' && (
        <BoxSection title="Net profit or loss">
          <BoxCalc box={21} label="Net profit" value={Math.max(0, tradeNetProfit(t))} />
          <BoxCalc box={22} label="Or net loss" value={Math.max(0, -tradeNetProfit(t))} />
        </BoxSection>
      )}
      {subName === 'Tax allowances' && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] px-3 py-2">
            <p className="text-[11.5px] text-[var(--text-secondary)]">Work out AIA, pool WDAs and balancing charges — closing balances carry to next year.</p>
            <button onClick={onOpenCa} className="btn-primary shrink-0 py-1 text-[12px]"><Calculator size={14} /> {t.capitalAllowancesCalc ? 'Reopen calculator' : 'Capital Allowances Calculator'}</button>
          </div>
          {caDiverged && (
            <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>These boxes have been edited since the calculator was last run — reopen and Apply to recompute the pools before rolling forward.</span>
            </div>
          )}
          <BoxSection title="Tax allowances for vehicles and equipment (capital allowances)">
            <BoxNum box={23} label="Annual Investment Allowance" help={H.aia} value={t.aia ?? 0} onChange={v => set({ aia: v })} />
            <BoxNum box={24} label="Allowance for small balance of unrelieved expenditure" help={H.smallBalance} value={t.ca18 ?? 0} onChange={v => set({ ca18: v })} />
            <BoxNum box="24.1" label="Zero-emission car allowance" help={H.zeroEmissionCar} value={t.zeroEmissionCar ?? 0} onChange={v => set({ zeroEmissionCar: v })} />
            <BoxNum box={25} label="Other capital allowances" help={H.otherCapitalAllowances} value={t.ca6 ?? 0} onChange={v => set({ ca6: v })} />
            <BoxNum box="25.1" label="Structures and Buildings Allowance" help={H.sba} value={t.sba ?? 0} onChange={v => set({ sba: v })} />
            <BoxNum box="25.2" label="Freeport / Investment Zone SBA" help={H.sbaFreeport} value={t.sbaFreeport ?? 0} onChange={v => set({ sbaFreeport: v })} />
            <BoxNum box={26} label="Total balancing charges" help={H.balancingCharge} value={t.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} />
          </BoxSection>
        </>
      )}
      {subName === 'Taxable profits' && (
        <BoxSection title="Calculating your taxable profits">
          <BoxNum box={27} label="Goods and/or services for your own use" help={H.goodsOwnUse} value={t.goodsOwnUse ?? 0} onChange={v => set({ goodsOwnUse: v })} />
          <BoxCalc box={28} label="Net business profit for tax purposes" help={H.netProfitForTax} value={Math.max(0, tradeProfitForTax(t))} />
          <BoxNum box={29} label="Loss brought forward" help={H.lossBroughtForward} value={t.lossBroughtForward ?? 0} onChange={v => set({ lossBroughtForward: v })} />
          <BoxNum box="29.1" label="Unused losses to carry forward to next year" help={H.unusedLossCarriedForward} value={t.unusedLossCarriedForward ?? 0} onChange={v => set({ unusedLossCarriedForward: v })} />
          <BoxNum box={30} label="Any other business income not in box 9 or 10" help={H.otherBusinessIncome75} value={t.otherBusinessIncome75 ?? 0} onChange={v => set({ otherBusinessIncome75: v })} />
        </BoxSection>
      )}
      {subName === 'Total taxable profits' && (
        <BoxSection title="Total taxable profits or net business loss">
          <BoxCalc box={31} label="Total taxable profits" help={H.totalTaxableProfit} value={tradeTaxableProfit(t)} />
          <BoxCalc box={32} label="Net business loss for tax purposes" help={H.adjustedLoss} value={tradeAdjustedLoss(t)} />
        </BoxSection>
      )}
      {subName === 'Losses, CIS' && (
        <>
          <BoxSection title="Losses, Class 2 & 4 NICs, CIS deductions">
            <BoxNum box={33} label="Loss set off against other income" help={H.lossSetOff} value={t.lossSetOffOtherIncome ?? 0} onChange={v => set({ lossSetOffOtherIncome: v })} />
            <BoxNum box={34} label="Loss carried back" help={H.lossCarriedBack} value={t.lossCarriedBack ?? 0} onChange={v => set({ lossCarriedBack: v })} />
            <BoxCalc box={35} label="Loss carried forward" help={H.lossCarriedForward} value={tradeLossCarriedForward(t)} />
            <BoxCheck box={36} label="Choose to pay Class 2 NIC voluntarily" help={H.class2Voluntary} checked={!!t.class2Voluntary} onChange={v => set({ class2Voluntary: v })} />
            <BoxCheck box={37} label="Exempt from paying Class 4 NIC" help={H.class4Exempt} checked={!!t.class4Exempt} onChange={v => set({ class4Exempt: v })} />
            <BoxNum box={38} label="Total CIS deductions taken from payments by contractors" help={H.cisDeductions} value={t.cisDeductions ?? 0} onChange={v => set({ cisDeductions: v })} />
            <BoxYesNo label="Self-employed all year & willing to pay Class 2 for the full year?" help={H.willingClass2} value={!!t.willingPayClass2FullYear} onChange={v => set({ willingPayClass2FullYear: v })} />
          </BoxSection>
        </>
      )}
    </>
  );
}

// Prompt to move a short trade up to the full form (lossless).
function MigrateToFullModal({ turnover, onConfirm, onKeep }: { turnover: number; onConfirm: () => void; onKeep: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onKeep}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <p className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><AlertTriangle size={16} className="text-amber-500" /> Full Self-employment pages required</p>
        <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">Turnover of {fmtMoney(turnover)} is at or above the {fmtMoney(SA103_SHORT_TURNOVER_LIMIT)} threshold, so this trade must use the full (SA103F) pages. Would you like SMITH to switch it to the full version now? Everything you've entered is kept.</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onKeep} className="btn-secondary">Keep short for now</button>
          <button onClick={onConfirm} className="btn-primary"><Check size={14} /> Switch to full</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Confirm moving a full trade down to short (drops detail).
function MigrateToShortModal({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <p className="flex items-center gap-1.5 text-[15px] font-bold text-[var(--text-primary)]"><AlertTriangle size={16} className="text-amber-500" /> Switch to the short form?</p>
        <p className="mt-2 text-[12.5px] text-[var(--text-secondary)]">The short (SA103S) form holds less detail. Disallowable-expense itemisation, the balance sheet, and the separate subcontractor / advertising / bad-debt / depreciation and bank-charge boxes will be folded into the short boxes or dropped, and the expenses shown net of disallowables. Turnover, allowances and losses are kept.</p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn-primary"><Check size={14} /> Switch to short</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PartnershipPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const list = income.partnerships ?? [];
  const add = () => setIncome(i => ({ ...i, partnerships: [...(i.partnerships ?? []), { id: `pt-${(i.partnerships ?? []).length}-${Date.now()}`, name: '', profit: 0, form: 'short' }] }));
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

// Capium Partnership (full) tab layout — mirrors the SA104F on-screen structure.
const PARTNERSHIP_TABS = ['Partnership details', 'Trading, NICs & Untaxed income', 'UK, Foreign Incomes & Offshore funds', "Partnership's taxed income"] as const;
type PartnershipTab = typeof PARTNERSHIP_TABS[number];
const PARTNERSHIP_SUBTABS: Record<PartnershipTab, string[]> = {
  'Partnership details': ['Partnership details', 'Professional profits', 'Professional profits (continue)'],
  'Trading, NICs & Untaxed income': ['Loss allocation', 'NICs', 'Untaxed savings income', 'Income from UK property'],
  'UK, Foreign Incomes & Offshore funds': ['UK income', 'Offshore funds', 'Foreign income'],
  "Partnership's taxed income": ['Total untaxed income', 'Taxed income', 'Tax paid and deductions'],
};

// SA104S (short) — 2 tabs, a subset of the same data. Shares the Partnership
// details and profit boxes 8–12; the tail reuses different box numbers.
const PARTNERSHIP_SHORT_TABS = ['Partnership detail and profit', 'Trading or professional losses'] as const;
const PARTNERSHIP_SHORT_SUBTABS: Record<string, string[]> = {
  'Partnership detail and profit': ['Partnership details', 'Trading or professional profit', 'Trading or professional profit (continue)'],
  'Trading or professional losses': ['Trading or professional losses', 'NICs & taxed interest', 'Tax paid and deductions'],
};

function PartnershipCard({ p, idx, onChange, onRemove }: {
  p: PartnershipSource; idx: number; onChange: (u: Partial<PartnershipSource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<string>('Partnership details');
  const [sub, setSub] = useState(0);
  const [shortConfirm, setShortConfirm] = useState(false);
  const [stmtOpen, setStmtOpen] = useState(false);
  const isShort = p.form === 'short';
  const TABS: readonly string[] = isShort ? PARTNERSHIP_SHORT_TABS : PARTNERSHIP_TABS;
  const SUBTABS: Record<string, string[]> = isShort ? PARTNERSHIP_SHORT_SUBTABS : PARTNERSHIP_SUBTABS;
  const set = (u: Partial<PartnershipSource>) => onChange(u);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = TABS.includes(tab) ? tab : TABS[0];
  const subList = SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  const switchForm = (form: 'full' | 'short') => { onChange(form === 'full' ? migratePartnershipToFull(p) : migratePartnershipToShort(p)); setSub(0); setTab(form === 'short' ? 'Partnership detail and profit' : 'Partnership details'); };
  const applyStatement = (stmt: PartnershipStatement) => { onChange({ statement: stmt, profit: statementTaxpayerShare(stmt) }); setStmtOpen(false); };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={p.name} placeholder={`Partnership ${idx + 1} — name`} onChange={ev => set({ name: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <ProvenanceBadge id={p.id} />
        {/* Partnership Statement — allocate partner shares */}
        <Tooltip label="Partnership Statement — split the profit between partners">
          <button onClick={() => setStmtOpen(true)} className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10.5px] font-semibold transition-colors ${p.statement ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
            <Users size={12} /> {p.statement ? `${p.statement.partners.length} partners` : 'Allocate'}
          </button>
        </Tooltip>
        {/* SA104 full / short toggle */}
        <div className="flex shrink-0 overflow-hidden rounded-md border border-[var(--border)] text-[10.5px] font-semibold">
          <button onClick={() => { if (isShort) switchForm('full'); }} className={`px-2 py-0.5 ${!isShort ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>Full</button>
          <button onClick={() => { if (!isShort) setShortConfirm(true); }} className={`px-2 py-0.5 ${isShort ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>Short</button>
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(partnershipTaxableProfit(p))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {shortConfirm && (
        <PartnershipToShortModal requiresFull={partnershipRequiresFull(p)}
          onConfirm={() => { switchForm('short'); setShortConfirm(false); }} onCancel={() => setShortConfirm(false)} />
      )}
      {stmtOpen && (
        <PartnershipStatementModal source={p} onApply={applyStatement} onClose={() => setStmtOpen(false)} />
      )}
      {open && (
        <div className="border-t border-black/5">
          {/* Capium top tabs */}
          <div className="flex flex-wrap gap-1 border-b border-black/5 px-3 pt-2.5 pb-2">
            {TABS.map(tt => (
              <button key={tt} onClick={() => setTop(tt)}
                className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${activeTab === tt ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {tt}
              </button>
            ))}
          </div>
          {/* Capium sub-tabs */}
          {subList.length > 1 && <div className="flex flex-wrap gap-1 px-3 pt-2.5">
            {subList.map((st, i) => (
              <button key={st} onClick={() => setSub(i)}
                className={`rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${sub === i ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {st}
              </button>
            ))}
          </div>}
          <div className="space-y-3 px-3 py-3">
            {/* ── Partnership details ── */}
            {subName === 'Partnership details' && (
              <BoxSection title="Partnership details">
                <BoxText box={1} label="Partnership reference number" required help={PH.utr} value={p.utr ?? ''} onChange={v => set({ utr: v })} />
                <BoxText box={2} label="Description of partnership trade or profession" value={p.description ?? ''} onChange={v => set({ description: v })} />
                <BoxYesNo box="3Q" label="Did you become a partner after 5 April 2025?" help={PH.becamePartner} value={!!p.becamePartner} onChange={v => set({ becamePartner: v })} />
                <BoxDate box={3} label="Date joined" value={p.dateJoined ?? ''} onChange={v => set({ dateJoined: v })} />
                <BoxYesNo box="4Q" label="Did you cease being a partner in the year?" help={PH.ceasedPartner} value={!!p.ceasedPartner} onChange={v => set({ ceasedPartner: v })} />
                <BoxDate box={4} label="Date left" value={p.dateLeft ?? ''} onChange={v => set({ dateLeft: v })} />
              </BoxSection>
            )}
            {(subName === 'Professional profits' || subName === 'Trading or professional profit') && (
              <BoxSection title="Your share of the partnership's trading or professional profits">
                <BoxNum box={8} label="Share of profit/(loss)" help={PH.shareOfProfit} value={p.profit} onChange={v => set({ profit: v })} />
                <BoxNum box={9} label="Adjustment for a short/long accounting period" help={PH.adjustmentPeriod} value={p.adjustmentPeriod ?? 0} onChange={v => set({ adjustmentPeriod: v })} />
                <BoxNum box={10} label="Accounting adjustment" help={PH.accountingAdjustment} value={p.accountingAdjustment ?? 0} onChange={v => set({ accountingAdjustment: v })} />
                <BoxNum box={11} label="Averaging adjustment" help={PH.averagingAdjustment} value={p.averagingAdjustment ?? 0} onChange={v => set({ averagingAdjustment: v })} />
                <BoxNum box={12} label="Foreign tax claimed by deduction" help={PH.foreignTaxDeduction} value={p.foreignTaxDeduction ?? 0} onChange={v => set({ foreignTaxDeduction: v })} />
              </BoxSection>
            )}
            {subName === 'Professional profits (continue)' && (
              <BoxSection title="Your share of the partnership's trading or professional profits (continued)">
                <BoxCalc box={16} label="Adjusted profit" help={PH.adjustedProfit} value={partnershipAdjustedProfit(p)} />
                <BoxNum box="16.3" label="Spread of the transition profit treated as arising this year" help={PH.transitionProfit} value={p.transitionProfit ?? 0} onChange={v => set({ transitionProfit: v })} />
                <BoxNum box="16.4" label="Loss b/fwd set off against this year's spread of the transition profit" help={PH.transitionLossBfwd} value={p.transitionLossBfwd ?? 0} onChange={v => set({ transitionLossBfwd: v })} />
                <BoxNum box={17} label="Loss b/fwd used" help={PH.lossBroughtForwardUsed} value={p.lossBroughtForward ?? 0} onChange={v => set({ lossBroughtForward: v })} />
                <BoxNum box="17.1" label="Unused losses b/fwd to carry forward to next year" help={PH.unusedLossCarriedForward} value={p.unusedLossCarriedForward ?? 0} onChange={v => set({ unusedLossCarriedForward: v })} />
                <BoxCalc box={18} label="Taxable profit" help={PH.taxableProfit} value={partnershipTaxableTradeProfit(p)} />
                <BoxNum box={19} label="Other business income" help={PH.otherBusinessIncome} value={p.otherBusinessIncome ?? 0} onChange={v => set({ otherBusinessIncome: v })} />
                <BoxCalc box={20} label="Total taxable profits" help={PH.totalTaxableProfits} value={partnershipTotalTaxableProfit(p)} />
                <BoxNum box="20.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.figClaim ?? 0} onChange={v => set({ figClaim: v })} />
              </BoxSection>
            )}
            {/* ── Trading, NICs & Untaxed income ── */}
            {subName === 'Loss allocation' && (
              <BoxSection title="Your share of the partnership's trading or professional losses">
                <BoxCalc box={21} label="Adjusted loss this year" help={PH.adjustedLoss} value={partnershipAdjustedLoss(p)} />
                <BoxNum box="21.1" label="Adjustment to losses under the FIG regime" value={p.lossFigAdjustment ?? 0} onChange={v => set({ lossFigAdjustment: v })} />
                <BoxNum box={22} label="Loss against other income" help={PH.lossAgainstOtherIncome} value={p.lossAgainstOtherIncome ?? 0} onChange={v => set({ lossAgainstOtherIncome: v })} />
                <BoxNum box={23} label="Loss to be carried back to previous year" help={PH.lossCarriedBack} value={p.lossCarriedBack ?? 0} onChange={v => set({ lossCarriedBack: v })} />
                <BoxCalc box={24} label="Total loss to carry forward" help={PH.totalLossCarryForward} value={partnershipLossCarryForward(p)} />
              </BoxSection>
            )}
            {subName === 'NICs' && (
              <BoxSection title="National Insurance contributions">
                <BoxCheck box={25} label="Pay Class 2 NICs voluntarily" help={PH.class2Voluntary} checked={!!p.class2Voluntary} onChange={v => set({ class2Voluntary: v })} />
                <BoxCheck box={26} label="Exempt from Class 4 NIC" help={PH.class4Exempt} checked={!!p.class4Exempt} onChange={v => set({ class4Exempt: v })} />
                <BoxNum box={27} label="Adjustment to profits chargeable to Class 4 NICs" help={PH.class4Adjustment} value={p.class4Adjustment ?? 0} onChange={v => set({ class4Adjustment: v })} />
                <BoxYesNo label="Partner for the full year & willing to pay Class 2 NIC for the full year?" help={PH.willingClass2} value={!!p.willingClass2} onChange={v => set({ willingClass2: v })} />
              </BoxSection>
            )}
            {subName === 'Untaxed savings income' && (
              <BoxSection title="Your share of the partnership's untaxed savings income">
                <BoxNum box={28} label="Share of UK untaxed savings income" help={PH.ukSavings} value={p.ukSavings ?? 0} onChange={v => set({ ukSavings: v })} />
                <BoxNum box={29} label="Adjustment to UK untaxed savings income" value={p.ukSavingsAdjustment ?? 0} onChange={v => set({ ukSavingsAdjustment: v })} />
                <BoxCalc box={30} label="Adjusted UK savings income" value={partnershipAdjustedUkSavings(p)} />
                <BoxNum box={31} label="Share of foreign untaxed savings income" help={PH.foreignSavings} value={p.foreignSavings ?? 0} onChange={v => set({ foreignSavings: v })} />
                <BoxNum box={32} label="Adjustment to foreign untaxed savings income" value={p.foreignSavingsAdjustment ?? 0} onChange={v => set({ foreignSavingsAdjustment: v })} />
                <BoxNum box={33} label="Total foreign tax taken off" help={PH.foreignSavingsTax} value={p.foreignSavingsTax ?? 0} onChange={v => set({ foreignSavingsTax: v })} />
                <BoxCalc box={34} label="Adjusted foreign savings income" value={partnershipAdjustedForeignSavings(p)} />
                <BoxCalc box={35} label="Total untaxed savings income" value={partnershipTotalUntaxedSavings(p)} />
                <BoxNum box="35.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.savingsFigClaim ?? 0} onChange={v => set({ savingsFigClaim: v })} />
              </BoxSection>
            )}
            {subName === 'Income from UK property' && (
              <BoxSection title="Income from UK property">
                <BoxNum box={36} label="Share of profit or loss from UK property" help={PH.propertyShare} value={p.propertyProfit ?? 0} onChange={v => set({ propertyProfit: v })} />
                <BoxNum box={37} label="Adjustment to UK property income" value={p.propertyAdjustment ?? 0} onChange={v => set({ propertyAdjustment: v })} />
                <BoxNum box={38} label="Losses brought forward" value={p.propertyLossBfwd ?? 0} onChange={v => set({ propertyLossBfwd: v })} />
                <BoxNum box={39} label="Loss used against other income" value={p.propertyLossAgainstOther ?? 0} onChange={v => set({ propertyLossAgainstOther: v })} />
                <BoxNum box={40} label="Loss to carry forward" value={p.propertyLossCarryForward ?? 0} onChange={v => set({ propertyLossCarryForward: v })} />
                <BoxCalc box={41} label="Taxable profit" value={partnershipPropertyTaxable(p)} />
                <BoxNum box="41.1" label="Residential property finance costs" help={PH.propertyFinanceCosts} value={p.propertyFinanceCosts ?? 0} onChange={v => set({ propertyFinanceCosts: v })} />
                <BoxNum box="41.2" label="Unused residential property finance costs brought forward" value={p.propertyFinanceCostsBfwd ?? 0} onChange={v => set({ propertyFinanceCostsBfwd: v })} />
              </BoxSection>
            )}
            {/* ── UK, Foreign Incomes & Offshore funds ── */}
            {subName === 'UK income' && (
              <BoxSection title="Other untaxed UK income">
                <BoxNum box={45} label="Share of other untaxed UK income" value={p.otherUkIncome ?? 0} onChange={v => set({ otherUkIncome: v })} />
                <BoxNum box={46} label="Adjustment to other untaxed UK income" value={p.otherUkIncomeAdjustment ?? 0} onChange={v => set({ otherUkIncomeAdjustment: v })} />
                <BoxNum box={47} label="Losses brought forward" value={p.otherUkLossBfwd ?? 0} onChange={v => set({ otherUkLossBfwd: v })} />
                <BoxCalc box={48} label="Taxable profit" value={partnershipOtherUkTaxable(p)} />
                <BoxNum box={49} label="Other untaxed UK income" value={p.otherUkIncomeB ?? 0} onChange={v => set({ otherUkIncomeB: v })} />
                <BoxNum box={50} label="Adjustment to loss for other untaxed UK income" value={p.otherUkLossAdjustment ?? 0} onChange={v => set({ otherUkLossAdjustment: v })} />
                <BoxCalc box={51} label="Total loss to carry forward after all other set-offs" value={partnershipOtherUkLossCarryForward(p)} />
              </BoxSection>
            )}
            {subName === 'Offshore funds' && (
              <BoxSection title="Income from offshore funds">
                <BoxNum box={52} label="Share of income from offshore funds" help={PH.offshoreIncome} value={p.offshoreIncome ?? 0} onChange={v => set({ offshoreIncome: v })} />
                <BoxNum box={53} label="Adjustment to offshore funds income" value={p.offshoreAdjustment ?? 0} onChange={v => set({ offshoreAdjustment: v })} />
                <BoxNum box={54} label="Foreign tax taken off" value={p.offshoreTax ?? 0} onChange={v => set({ offshoreTax: v })} />
                <BoxCalc box={55} label="Taxable profit" value={partnershipOffshoreTaxable(p)} />
                <BoxNum box="55.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.offshoreFigClaim ?? 0} onChange={v => set({ offshoreFigClaim: v })} />
              </BoxSection>
            )}
            {subName === 'Foreign income' && (
              <BoxSection title="Other untaxed foreign income">
                <BoxNum box={56} label="Share of other untaxed foreign income" help={PH.foreignIncome} value={p.foreignIncome ?? 0} onChange={v => set({ foreignIncome: v })} />
                <BoxNum box={57} label="Adjustment to other untaxed foreign income" value={p.foreignIncomeAdjustment ?? 0} onChange={v => set({ foreignIncomeAdjustment: v })} />
                <BoxNum box={58} label="Losses brought forward" value={p.foreignLossBfwd ?? 0} onChange={v => set({ foreignLossBfwd: v })} />
                <BoxNum box={59} label="Total foreign tax taken off" value={p.foreignTax ?? 0} onChange={v => set({ foreignTax: v })} />
                <BoxCalc box={60} label="Taxable profit" value={partnershipForeignTaxable(p)} />
                <BoxNum box="60.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.foreignFigClaim ?? 0} onChange={v => set({ foreignFigClaim: v })} />
                <BoxNum box={61} label="Other untaxed foreign income" value={p.foreignIncomeB ?? 0} onChange={v => set({ foreignIncomeB: v })} />
                <BoxNum box={62} label="Adjustment to loss for other untaxed foreign income" value={p.foreignLossAdjustment ?? 0} onChange={v => set({ foreignLossAdjustment: v })} />
                <BoxCalc box={63} label="Total loss to carry forward after all other set-offs" value={partnershipForeignLossCarryForward(p)} />
                <BoxNum box="63.1" label="Residential property finance costs" help={PH.propertyFinanceCosts} value={p.foreignFinanceCosts ?? 0} onChange={v => set({ foreignFinanceCosts: v })} />
                <BoxNum box="63.2" label="Unused residential property finance costs brought forward" value={p.foreignFinanceCostsBfwd ?? 0} onChange={v => set({ foreignFinanceCostsBfwd: v })} />
              </BoxSection>
            )}
            {/* ── Partnership's taxed income ── */}
            {subName === 'Total untaxed income' && (
              <BoxSection title="Total untaxed income">
                <BoxCalc box={67} label="Untaxed income from this business (other than that liable at 20%)" value={partnershipUntaxedOther(p)} />
              </BoxSection>
            )}
            {subName === 'Taxed income' && (
              <BoxSection title="Your share of the partnership's taxed income">
                <BoxNum box={68} label="Share of taxed income taxable at 10%" help={PH.taxedIncome10} value={p.taxedIncome10 ?? 0} onChange={v => set({ taxedIncome10: v })} />
                <BoxNum box={69} label="Total foreign tax taken off" value={p.taxedIncome10ForeignTax ?? 0} onChange={v => set({ taxedIncome10ForeignTax: v })} />
                <BoxCalc box={70} label="Taxed income taxable at 10%" value={partnershipTaxedIncome10(p)} />
                <BoxNum box="70.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.taxedIncome10Fig ?? 0} onChange={v => set({ taxedIncome10Fig: v })} />
                <BoxNum box={71} label="Share of taxed income taxable at 20%" help={PH.taxedIncome20} value={p.taxedIncome20 ?? 0} onChange={v => set({ taxedIncome20: v })} />
                <BoxNum box={72} label="Total foreign tax taken off" value={p.taxedIncome20ForeignTax ?? 0} onChange={v => set({ taxedIncome20ForeignTax: v })} />
                <BoxCalc box={73} label="Taxed income taxable at 20%" value={partnershipTaxedIncome20(p)} />
                <BoxNum box={74} label="Share of other taxed income" help={PH.otherTaxedIncome} value={p.otherTaxedIncome ?? 0} onChange={v => set({ otherTaxedIncome: v })} />
                <BoxNum box={75} label="Foreign tax taken off" value={p.otherTaxedIncomeForeignTax ?? 0} onChange={v => set({ otherTaxedIncomeForeignTax: v })} />
                <BoxNum box="75.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.otherTaxedFig ?? 0} onChange={v => set({ otherTaxedFig: v })} />
                <BoxCalc box={76} label="Other taxed income taxable" value={partnershipOtherTaxedIncome(p)} />
                <BoxNum box="76.1" label="Total amount claimed under the FIG regime" value={p.totalFig ?? 0} onChange={v => set({ totalFig: v })} />
              </BoxSection>
            )}
            {subName === 'Tax paid and deductions' && !isShort && (
              <BoxSection title="Your share of the partnership's tax paid and deductions">
                <BoxNum box={77} label="Share of income tax taken off partnership income" help={PH.incomeTaxTaken} value={p.incomeTaxTaken ?? 0} onChange={v => set({ incomeTaxTaken: v })} />
                <BoxNum box={78} label="Share of CIS deductions" help={PH.cisDeductions} value={p.cisDeductions ?? 0} onChange={v => set({ cisDeductions: v })} />
                <BoxNum box={79} label="Share of tax taken off trading income" help={PH.taxTakenTradingIncome} value={p.taxTakenTradingIncome ?? 0} onChange={v => set({ taxTakenTradingIncome: v })} />
                <BoxCalc box={80} label="Share of total tax taken off (boxes 77 to 79)" help={PH.totalTaxTaken} value={partnershipTaxTakenTotal(p)} />
              </BoxSection>
            )}

            {/* ── SA104S short — trading profit (continue) ── */}
            {subName === 'Trading or professional profit (continue)' && (
              <BoxSection title="Your share of the partnership's trading or professional profits (continued)">
                <BoxCalc box={16} label="Adjusted profit" help={PH.adjustedProfit} value={partnershipAdjustedProfit(p)} />
                <BoxNum box={17} label="Loss b/fwd used" help={PH.lossBroughtForwardUsed} value={p.lossBroughtForward ?? 0} onChange={v => set({ lossBroughtForward: v })} />
                <BoxNum box="17.1" label="Unused losses b/fwd to carry forward to next year" help={PH.unusedLossCarriedForward} value={p.unusedLossCarriedForward ?? 0} onChange={v => set({ unusedLossCarriedForward: v })} />
                <BoxCalc box={18} label="Taxable profit" help={PH.taxableProfit} value={partnershipTaxableTradeProfit(p)} />
                <BoxNum box={19} label="Other business income" help={PH.otherBusinessIncome} value={p.otherBusinessIncome ?? 0} onChange={v => set({ otherBusinessIncome: v })} />
                <BoxCalc box={20} label="Total taxable profits" help={PH.totalTaxableProfits} value={partnershipTotalTaxableProfit(p)} />
              </BoxSection>
            )}
            {/* ── SA104S short — losses ── */}
            {subName === 'Trading or professional losses' && (
              <BoxSection title="Your share of the partnership's trading or professional losses">
                <BoxCalc box={21} label="Adjusted loss this year" help={PH.adjustedLoss} value={partnershipAdjustedLoss(p)} />
                <BoxNum box={22} label="Loss against other income" help={PH.lossAgainstOtherIncome} value={p.lossAgainstOtherIncome ?? 0} onChange={v => set({ lossAgainstOtherIncome: v })} />
                <BoxNum box={23} label="Loss to be carried back to previous year" help={PH.lossCarriedBack} value={p.lossCarriedBack ?? 0} onChange={v => set({ lossCarriedBack: v })} />
                <BoxCalc box={24} label="Total loss to carry forward" help={PH.totalLossCarryForward} value={partnershipLossCarryForward(p)} />
              </BoxSection>
            )}
            {/* ── SA104S short — NICs & taxed interest ── */}
            {subName === 'NICs & taxed interest' && (<>
              <BoxSection title="National Insurance contributions">
                <BoxCheck box={25} label="Pay Class 2 NICs voluntarily" help={PH.class2Voluntary} checked={!!p.class2Voluntary} onChange={v => set({ class2Voluntary: v })} />
                <BoxCheck box={26} label="Exempt from Class 4 NIC" help={PH.class4Exempt} checked={!!p.class4Exempt} onChange={v => set({ class4Exempt: v })} />
                <BoxNum box={27} label="Adjustment to profits chargeable to Class 4 NICs" help={PH.class4Adjustment} value={p.class4Adjustment ?? 0} onChange={v => set({ class4Adjustment: v })} />
                <BoxYesNo label="Partner for the full year & willing to pay Class 2 NIC for the full year?" help={PH.willingClass2} value={!!p.willingClass2} onChange={v => set({ willingClass2: v })} />
              </BoxSection>
              <BoxSection title="Your share of the partnership's taxed interest etc.">
                <BoxNum box={28} label="Your share of taxed interest etc" help={PH.taxedInterestShort} value={p.taxedIncome20 ?? 0} onChange={v => set({ taxedIncome20: v })} />
              </BoxSection>
            </>)}
            {/* ── SA104S short — tax paid and deductions ── */}
            {subName === 'Tax paid and deductions' && isShort && (
              <BoxSection title="Your share of the partnership tax paid and deductions">
                <BoxNum box={30} label="Share of CIS deductions" help={PH.cisDeductions} value={p.cisDeductions ?? 0} onChange={v => set({ cisDeductions: v })} />
                <BoxNum box={31} label="Share of tax taken off trading income" help={PH.taxTakenTradingIncome} value={p.taxTakenTradingIncome ?? 0} onChange={v => set({ taxTakenTradingIncome: v })} />
                <BoxText box={32} label="Other information" help={PH.otherInformation} value={p.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} />
              </BoxSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Confirm dialog when switching a partnership to the short SA104S form.
function PartnershipToShortModal({ requiresFull, onConfirm, onCancel }: { requiresFull: boolean; onConfirm: () => void; onCancel: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <p className="text-[15px] font-bold text-[var(--text-primary)]">Switch to the short (SA104S) form?</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
          The short form only reports your share of trading profit, losses, NICs and taxed interest. UK property, foreign, offshore and other income boxes are hidden — your figures are kept and reappear if you switch back to full.
        </p>
        {requiresFull && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700">
            This partnership has property, foreign or other income that the short form can’t report. HMRC requires the full SA104F in that case — switch only if you’re sure.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn-primary">Switch to short</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Partnership Statement allocator — enter the partnership's total profit once and
// split it between the partners; applying sets this return's box 8 to the
// taxpayer partner's share and records the full split.
function PartnershipStatementModal({ source, onApply, onClose }: { source: PartnershipSource; onApply: (s: PartnershipStatement) => void; onClose: () => void }) {
  const seed: PartnershipStatement = source.statement ?? {
    profit: source.profit || 0,
    partners: [{ id: `pa-0-${idOf(source)}`, name: source.name || 'This partner', sharePct: 100, isTaxpayer: true }],
  };
  const [profit, setProfit] = useState(seed.profit);
  const [partners, setPartners] = useState<PartnerAllocation[]>(seed.partners);

  const total = partners.reduce((a, p) => a + (Number(p.sharePct) || 0), 0);
  const taxpayer = partners.find(p => p.isTaxpayer);
  const taxpayerShare = taxpayer ? partnerAllocatedShare(profit, taxpayer.sharePct) : 0;
  const sharesOk = Math.abs(total - 100) < 0.01;

  const upd = (id: string, u: Partial<PartnerAllocation>) => setPartners(ps => ps.map(p => p.id === id ? { ...p, ...u } : p));
  const setTaxpayer = (id: string) => setPartners(ps => ps.map(p => ({ ...p, isTaxpayer: p.id === id })));
  const add = () => setPartners(ps => [...ps, { id: `pa-${ps.length}-${Math.round(profit)}-${ps.length}`, name: '', sharePct: 0 }]);
  const del = (id: string) => setPartners(ps => ps.filter(p => p.id !== id));

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <div>
            <p className="text-[15px] font-bold text-[var(--text-primary)]">Partnership Statement</p>
            <p className="text-[11.5px] text-[var(--text-muted)]">Split the partnership’s profit between the partners — the taxpayer’s share fills box 8.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4">
          <div className="mb-4 max-w-xs">
            <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">Partnership total trade profit (100%)</label>
            <NumIn value={profit} onChange={setProfit} />
          </div>

          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-black/5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                <th className="pb-2 pr-2">Partner</th>
                <th className="pb-2 pr-2 text-right">Share %</th>
                <th className="pb-2 pr-2 text-right">Allocated</th>
                <th className="pb-2 pr-2 text-center">This return</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {partners.map(pt => (
                <tr key={pt.id} className="border-b border-black/5">
                  <td className="py-1.5 pr-2">
                    <input value={pt.name} placeholder="Partner name" onChange={e => upd(pt.id, { name: e.target.value })} className="input-base w-full py-1 text-[12px]" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" min={0} max={100} value={pt.sharePct || ''} onChange={e => upd(pt.id, { sharePct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className="input-base w-20 py-1 text-right text-[12px]" />
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[12.5px] font-semibold text-[var(--text-primary)]">{fmtMoney(partnerAllocatedShare(profit, pt.sharePct))}</td>
                  <td className="py-1.5 pr-2 text-center">
                    <input type="radio" name="tp" checked={!!pt.isTaxpayer} onChange={() => setTaxpayer(pt.id)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                  </td>
                  <td className="py-1.5"><button onClick={() => del(pt.id)} disabled={partners.length <= 1} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500 disabled:opacity-30"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="pt-3 pr-2 text-[12px] font-semibold text-[var(--text-muted)]">Total</td>
                <td className={`pt-3 pr-2 text-right text-[12.5px] font-bold ${sharesOk ? 'text-emerald-600' : 'text-rose-500'}`}>{total}%</td>
                <td className="pt-3 pr-2 text-right text-[12.5px] font-bold text-[var(--text-primary)]">{fmtMoney(partners.reduce((a, p) => a + partnerAllocatedShare(profit, p.sharePct), 0))}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>

          <button onClick={add} className="btn-secondary mt-3"><Plus size={14} /> Add partner</button>

          {!sharesOk && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700">Shares add up to {total}% — they should total 100% before allocating.</p>}
          {!taxpayer && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-700">Mark which partner is this return’s taxpayer to fill box 8.</p>}
        </div>

        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <p className="text-[12px] text-[var(--text-muted)]">This return’s share (box 8): <span className="font-bold text-[var(--text-primary)]">{fmtMoney(taxpayerShare)}</span></p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={() => onApply({ profit, partners })} disabled={!taxpayer} className="btn-primary disabled:opacity-40"><Check size={14} /> Apply to this return</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function idOf(p: PartnershipSource): string { return p.id.replace(/[^a-z0-9]/gi, '').slice(-6) || '0'; }

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
        <ProvenanceBadge id={p.id} />
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
function LabelledNum({ icon: Icon, box, label, value, onChange, help }: { icon?: typeof PiggyBank; box?: number | string; label: string; value: number; onChange: (v: number) => void; help?: string }) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {Icon && <Icon size={11} />}
        {box != null && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
        {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <NumIn value={value} onChange={onChange} />
    </div>
  );
}
function RemoveBtn({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>;
}
function BoxLabel({ box, label, help }: { box?: number | string; label: string; help?: string }) {
  return (
    <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
      {box != null && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
      {label}{help && <HelpDot help={help} label={label} />}
    </label>
  );
}
function LabelledText({ box, label, value, onChange, placeholder, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; help?: string }) {
  return (
    <div>
      <BoxLabel box={box} label={label} help={help} />
      <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />
    </div>
  );
}
function LabelledDate({ box, label, value, onChange, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; help?: string }) {
  return (
    <div>
      <BoxLabel box={box} label={label} help={help} />
      <input type="date" value={value} onChange={e => onChange(e.target.value)} className="input-base py-1 text-[12.5px]" />
    </div>
  );
}
function LabelledArea({ box, label, value, onChange, rows = 3, placeholder, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; help?: string }) {
  return (
    <div>
      <BoxLabel box={box} label={label} help={help} />
      <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base resize-none py-2 text-[12.5px]" />
    </div>
  );
}
function CheckField({ box, label, checked, onChange, help }: { box?: number | string; label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-2 text-[11px] font-medium text-[var(--text-muted)]">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      {box != null && <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>}
      {label}{help && <span onClick={e => e.preventDefault()}><HelpDot help={help} label={label} /></span>}
    </label>
  );
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
      {c.charityAssetGiftsDeduction > 0 && <Row label="Less: gifts of shares / land to charity" value={`(${fmtMoney(c.charityAssetGiftsDeduction)})`} />}
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
      {c.hicbc > 0 && <Row label="High income charge (Child Benefit / WFP)" value={fmtMoney(c.hicbc)} />}
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
