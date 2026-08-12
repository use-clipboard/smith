'use client';

import { useState, useEffect, useRef, createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight, ArrowUpRight, Plus, Trash2, Briefcase, Home, PiggyBank, Sparkles,
  AlertTriangle, Info, CheckCircle2, Beaker, ChevronRight, TrendingUp, Users,
  Globe2, GraduationCap, Landmark, FileText, Scale, MapPin, Loader2, Calculator, Check, Search, CornerDownLeft, X, ScanText, Link2,
  Church, MoreHorizontal, ChevronDown, Building2, Vote, Flag, Umbrella,
} from 'lucide-react';
import DocumentExtract from '../DocumentExtract';
import { BreakdownField, BreakdownModal, type BreakdownColumn } from '../IncomeBreakdown';
import CapitalAllowancesCalculator from '../CapitalAllowancesCalculator';
import CgtCalculator from '../CgtCalculator';
import JointInterestField from '../JointInterestField';
import OwnershipEditor from '../OwnershipEditor';
import { propertyCoOwners, findCoOwnerReturn as findPropertyCoOwnerReturn, pushPropertyToCoOwner, type PropertyCoOwnerGroup } from '../propertyCoOwner';
import HelpDot from '../FieldHelp';
import Tooltip from '@/components/ui/Tooltip';
import { SA103_SHORT_TURNOVER_LIMIT, migrateTradeToFull, migrateTradeToShort } from '../tradeForm';
import { partnershipRequiresFull, migratePartnershipToFull, migratePartnershipToShort } from '../partnershipForm';
import { H, CH, EMP, PH, PROP, FGN, CGT, TRUST, RES, ADD, MIN, NIA, PAR, SCP, WAL, LLU } from '../tradeHelp';
import FilingPreview from '../filing/FilingPreview';
import { searchReview, type SearchEntry } from '../reviewSearch';
import { COUNTRIES } from '../countries';
import { StudioCard, SectionTitle } from '../primitives';
import { HealthScoreCard } from '../widgets';
import { fmtMoney, provenanceFor } from '../data';
import { computeSa100Full, employmentTaxable, tradeNetProfit, tradeAdjustedProfit, tradeExpensesTotal, tradeDisallowableTotal, tradeCapitalAllowancesTotal, tradeAdditions, tradeDeductions, tradeProfitForTax, tradeTaxableProfit, tradeAdjustedLoss, tradeLossCarriedForward, tradeTotalAssets, tradeNetBusinessAssets, tradeCapitalAccountEnd, computeCapitalAllowances, propertyNetProfit, propertyTaxable, propertyGrossIncome, propertyExpensesTotal, propertyAllowancesTotal, propertyAdjustedProfit, propertyAdjustedLoss, propertyLossCarryForward, partnershipTaxableProfit, partnershipAdjustedProfit, partnershipTaxableTradeProfit, partnershipTotalTaxableProfit, partnershipAdjustedLoss, partnershipLossCarryForward, partnershipAdjustedUkSavings, partnershipAdjustedForeignSavings, partnershipTotalUntaxedSavings, partnershipPropertyTaxable, partnershipOtherUkTaxable, partnershipOtherUkLossCarryForward, partnershipOffshoreTaxable, partnershipForeignTaxable, partnershipForeignLossCarryForward, partnershipTaxedIncome10, partnershipTaxedIncome20, partnershipOtherTaxedIncome, partnershipUntaxedOther, partnershipTaxTakenTotal, partnerAllocatedShare, statementTaxpayerShare, disposalGainLoss, foreignTotals, foreignTableTotals, foreignRowTaxable, foreignRowIncome, foreignRowForeignTax, foreignPropertyNet, foreignPropertyAdjusted, foreignPropertyTotals, foreignPropertyExpenses, foreignPropertyPrivateUse, trustTotals, sa108Gains, sa108HasData, cgtCalcToSa108, propertyTaxableShare, ownerShareFraction, ministerComputed, ministerHasData, assemblyComputed, assemblyHasData, parliamentComputed, parliamentHasData, scottishParliamentComputed, scottishParliamentHasData, welshAssemblyComputed, welshAssemblyHasData, lloydsComputed, lloydsHasData } from '../calc';
import type { TaxReturn, Sa100Income, EmploymentSource, TradeSource, PropertySource, PartnershipSource, PartnershipStatement, PartnerAllocation, CgtDisposal, ForeignSource, ForeignRow, ForeignProperty, ForeignIncomeItem, ForeignExpenseItem, Sa106, TrustEstateSource, Sa107, EstateForeignItem, Sa108, Sa109, Sa109Company, Sa101, Sa101GiltItem, Sa101LifeGainItem, Sa101VoidedIsaItem, Sa101AnnualAllowanceItem, Sa101UnauthPaymentItem, Sa101ForeignLumpItem, MinisterOfReligion, AssemblyOffice, ParliamentOffice, ScottishParliamentOffice, WelshAssemblyOffice, LloydsUnderwriter, DividendItem, SavingsItem, TaxedInterestItem, LineItem, ReviewPoint, TaxSuggestion } from '../types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

export type Reveal = { page: PageId; section?: string; nonce: number };
const RevealContext = createContext<Reveal | null>(null);

// Live, rule-based advisory review points (not stored) — currently the £1,000
// property / trading income allowance nudge: when income exists and allowable
// expenses are under £1,000 and the allowance isn't already claimed, claiming it
// gives a lower taxable profit. These self-resolve as soon as the user acts.
function advisoryReviewPoints(income: Sa100Income): ReviewPoint[] {
  const out: ReviewPoint[] = [];
  const ALLOWANCE = 1000;
  income.property.forEach((p, i) => {
    const gross = propertyGrossIncome(p);
    const exp = propertyExpensesTotal(p);
    if (gross > 0 && !(p.propertyIncomeAllowance) && exp < ALLOWANCE && exp < gross) {
      out.push({ id: `adv-prop-${p.id || i}`, area: 'Property', issue: `${p.address || `Property ${i + 1}`}: the £1,000 property income allowance may be better`, explanation: `Allowable expenses are ${fmtMoney(exp)} — under £1,000. Claiming the £1,000 property income allowance instead of actual expenses would give a lower taxable profit. You can claim one or the other, not both.`, severity: 'info', suggestedFix: 'Enter £1,000 in the property income allowance (box 20.1) and clear the expense boxes.', resolved: false });
    }
  });
  income.selfEmployment.forEach((t, i) => {
    const turnover = t.turnover || 0;
    const exp = tradeExpensesTotal(t);
    if (turnover > 0 && !(t.tradingIncomeAllowance) && exp < ALLOWANCE && exp < turnover) {
      out.push({ id: `adv-trade-${t.id || i}`, area: 'Self-employment', issue: `${t.name || `Trade ${i + 1}`}: the £1,000 trading income allowance may be better`, explanation: `Allowable expenses are ${fmtMoney(exp)} — under £1,000. Claiming the £1,000 trading income allowance instead of actual expenses would give a lower taxable profit. You can claim one or the other, not both.`, severity: 'info', suggestedFix: 'Enter £1,000 in the trading income allowance (box 16.1) and clear the expense boxes.', resolved: false });
    }
  });
  return out;
}

export default function StageReview({ ret, patch, advance, page, setPage, reveal }: { ret: TaxReturn; patch: Patch; advance: () => void; page: PageId; setPage: (p: PageId) => void; reveal: Reveal | null }) {
  const openPoints = ret.reviewPoints.filter(p => !p.resolved && p.severity !== 'info').length;
  const advisories = advisoryReviewPoints(ret.income);
  const allPoints = [...ret.reviewPoints, ...advisories];
  const counts = pageCounts(ret.income);
  const [previewOpen, setPreviewOpen] = useState(false);

  function setIncome(u: (i: Sa100Income) => Sa100Income) {
    patch(r => ({ ...r, income: u(r.income) }));
  }

  return (
    <div className="space-y-4">
      {/* Filing preview — box-for-box copy of the SA100 + populated supplementary pages */}
      <div className="flex justify-end">
        <button onClick={() => setPreviewOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10">
          <FileText size={14} /> Filing preview
        </button>
      </div>
      {previewOpen && <FilingPreview ret={ret} onClose={() => setPreviewOpen(false)} />}

      {/* Section tabs + panel */}
      <SectionPanel ret={ret} patch={patch} page={page} setPage={setPage} counts={counts} income={ret.income} setIncome={setIncome} reveal={reveal} />

      {/* Live computation (the AI assistant is docked on the right of the workspace) */}
      <ComputationCard ret={ret} />

      {/* Review points */}
      <StudioCard className="p-5">
        <SectionTitle title="Review points" sub={openPoints ? `${openPoints} to resolve before approval` : 'Everything checks out'} />
        {allPoints.length === 0 ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">No review points raised. Run the analysis or adjust figures to re-check.</p>
        ) : (
          <div className="space-y-2">
            {allPoints.map(p => (
              <ReviewPointRow key={p.id} point={p}
                onToggle={() => { if (!p.id.startsWith('adv-')) patch(r => ({ ...r, reviewPoints: r.reviewPoints.map(x => x.id === p.id ? { ...x, resolved: !x.resolved } : x) })); }} />
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
export type PageId = 'core' | 'employment' | 'selfemp' | 'partnership' | 'property' | 'foreign' | 'cgt' | 'trusts' | 'residence' | 'additional' | 'minister' | 'niassembly' | 'parliament' | 'scottishparliament' | 'welshassembly' | 'lloyds';

const PAGES: { id: PageId; label: string; code: string; icon: LucideIcon }[] = [
  { id: 'core',        label: 'Main Form', code: 'SA100', icon: PiggyBank },
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
// Rarely-used supplementary pages, tucked behind a "More ▾" overflow so they
// don't crowd the everyday page tabs.
const MORE_PAGES: { id: PageId; label: string; code: string; icon: LucideIcon }[] = [
  { id: 'minister',    label: 'Ministry of religion', code: 'SA102M', icon: Church },
  { id: 'niassembly',  label: 'Northern Ireland Assembly', code: 'SA102', icon: Landmark },
  { id: 'parliament',  label: 'Parliament (MPs)', code: 'SA102', icon: Building2 },
  { id: 'scottishparliament', label: 'Scottish Parliament', code: 'SA102', icon: Vote },
  { id: 'welshassembly', label: 'National Assembly for Wales', code: 'SA102', icon: Flag },
  { id: 'lloyds', label: "Lloyd's Underwriters", code: 'SA103L', icon: Umbrella },
];
const ALL_PAGES = [...PAGES, ...MORE_PAGES];

/** The headline figure a page contributes to income — shown in the page header. */
function pageValue(id: PageId, income: Sa100Income): { value: number; label: string } | null {
  const sum = <T,>(arr: T[], f: (x: T) => number) => arr.reduce((a, x) => a + f(x), 0);
  switch (id) {
    case 'employment': return { value: sum(income.employment, employmentTaxable), label: 'Employment income' };
    case 'selfemp': return { value: sum(income.selfEmployment, tradeAdjustedProfit), label: 'Adjusted trade profit' };
    case 'partnership': return { value: sum(income.partnerships ?? [], partnershipTaxableProfit), label: 'Partnership profit' };
    case 'property': return { value: sum(income.property, propertyTaxableShare), label: 'Property profit' };
    case 'foreign': { const f = foreignTotals(income); return { value: f.interest + f.dividends + f.other, label: 'Foreign income' }; }
    case 'cgt': {
      const d = income.capitalGains?.disposals ?? [];
      if (d.length) return { value: sum(d, x => disposalGainLoss(x).gain), label: 'Gains before AEA' };
      if (sa108HasData(income.sa108)) { const g = sa108Gains(income.sa108!); return { value: g.normalGains + g.badrGains, label: 'Gains before AEA' }; }
      const cg = income.capitalGains; if (!cg) return { value: 0, label: 'Gains' };
      return { value: Math.max(0, (cg.residentialGains || 0) + (cg.otherGains || 0)), label: 'Gains before AEA' };
    }
    case 'trusts': { const t = trustTotals(income); return { value: t.nonSavings + t.savings + t.dividend, label: 'Trust / estate income' }; }
    case 'minister': { const t = ministerComputed(income.minister).taxable; return t ? { value: t, label: 'Minister income' } : null; }
    case 'niassembly': { const t = assemblyComputed(income.niAssembly).taxable; return t ? { value: t, label: 'Assembly income' } : null; }
    case 'parliament': { const t = parliamentComputed(income.parliament).taxable; return t ? { value: t, label: 'MP office income' } : null; }
    case 'scottishparliament': { const t = scottishParliamentComputed(income.scottishParliament).taxable; return t ? { value: t, label: 'MSP office income' } : null; }
    case 'welshassembly': { const t = welshAssemblyComputed(income.welshAssembly).taxable; return t ? { value: t, label: 'Senedd office income' } : null; }
    case 'lloyds': { const t = lloydsComputed(income.lloyds).taxable; return t ? { value: t, label: "Lloyd's taxable profit" } : null; }
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
    foreign: (() => {
      const sa = income.foreign; if (!sa) return 0;
      const rows = [sa.interest, sa.dividends, sa.remittedExcl, sa.remittedDividends, sa.pensions, sa.otherDividend, sa.otherAll, sa.properties, sa.foreignTaxRows, sa.nrtSavings, sa.nrtDividends]
        .reduce((a, x) => a + (x?.length ?? 0), 0);
      if (rows) return rows;
      if (sa.sources?.length) return sa.sources.length;
      return [sa.unremittable, sa.ftcrOnIncome, sa.cgUkGain, sa.lifeGains, sa.income, sa.foreignTaxPaid].some(v => v) ? 1 : 0;
    })(),
    cgt: (income.capitalGains?.disposals?.length || 0)
      + (income.capitalGains && ((income.capitalGains.residentialGains || 0) || (income.capitalGains.otherGains || 0) || (income.capitalGains.losses || 0)) ? 1 : 0)
      + (income.sa108 ? (['Residential property (and carried interest)', 'Cryptoassets', 'Other property, assets and gains', 'Listed shares and securities', 'Unlisted shares and securities', 'Losses and adjustments', 'Non-resident Capital Gains Tax', 'Any other information'].reduce((a, k) => a + sa108Count(income.sa108!, k), 0)) : 0),
    trusts: (() => {
      const legacy = (income.trusts ?? []).length;
      const sa = income.sa107;
      if (!sa) return legacy;
      const boxes = [sa.discretionaryNet, sa.settlorInterestedPayments, sa.nonDiscNonSavings, sa.nonDiscSavings, sa.nonDiscDividend, sa.trusteesNonResident,
        sa.settlorNonSavingsBasic, sa.settlorSavingsBasic, sa.settlorDividend, sa.settlorNonSavingsTrust, sa.settlorSavingsTrust, sa.settlorDividendTrust,
        sa.settlorNonSavingsGross, sa.settlorSavingsGross, sa.lifeAssuranceTaxPaid, sa.estateNonSavings, sa.estateSavings, sa.estateDividend, sa.estateDividend75,
        sa.estateNonSavingsNonRepayable, sa.foreignEstateFig, sa.estateResiPropertyIncome, sa.estateResiFinanceBfwd, sa.otherInformation]
        .filter(v => (typeof v === 'number' ? v !== 0 : !!v)).length + (sa.foreignEstates?.length ?? 0);
      return legacy + boxes;
    })(),
    residence: income.residence ? sa109Count(income.residence) : 0,
    additional: income.additional ? sa101Count(income.additional) : 0,
    minister: income.minister ? (minSectionCount(income.minister, 'Income as a minister of religion') + minSectionCount(income.minister, 'Business expenses')) : 0,
    niassembly: income.niAssembly ? (assemblySectionCount(income.niAssembly, ASSEMBLY_TABS[0]) + assemblySectionCount(income.niAssembly, ASSEMBLY_TABS[1])) : 0,
    parliament: income.parliament ? PARLIAMENT_TABS.reduce((acc, t) => acc + parliamentSectionCount(income.parliament!, t), 0) : 0,
    scottishparliament: income.scottishParliament ? (scotSectionCount(income.scottishParliament, SCOT_TABS[0]) + scotSectionCount(income.scottishParliament, SCOT_TABS[1])) : 0,
    welshassembly: income.welshAssembly ? WELSH_TABS.reduce((acc, t) => acc + welshSectionCount(income.welshAssembly!, t), 0) : 0,
    lloyds: income.lloyds ? LLOYDS_TABS.reduce((acc, t) => acc + lloydsSectionCount(income.lloyds!, t), 0) : 0,
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
  const active = ALL_PAGES.find(p => p.id === page)!;
  const pv = pageValue(page, income);
  const [scanOpen, setScanOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreCount = MORE_PAGES.filter(p => counts[p.id] > 0).length;
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
        {/* More — rarely-used supplementary pages */}
        <div className="relative">
          <button onClick={() => setMoreOpen(o => !o)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${MORE_PAGES.some(p => p.id === page) ? 'border-[var(--accent)]/50 bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--text-secondary)]'}`}>
            <MoreHorizontal size={13} className="shrink-0" /> More{moreCount > 0 && <span className="font-bold"> ({moreCount})</span>}
            <ChevronDown size={12} className={`transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
          </button>
          {moreOpen && <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} />}
          {moreOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[230px] rounded-xl border border-[var(--border)] bg-white p-1 shadow-lg">
              {MORE_PAGES.map(p => {
                const Icon = p.icon; const n = counts[p.id];
                return (
                  <button key={p.id} onClick={() => { setPage(p.id); setMoreOpen(false); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-semibold transition-colors ${p.id === page ? 'bg-[var(--accent)]/10 text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-black/[0.03]'}`}>
                    <Icon size={13} className="shrink-0" /><span className="flex-1">{p.label}{n > 0 && <span className="font-bold"> ({n})</span>}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{p.code}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
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
      {page === 'property' && <PropertyPage ret={ret} income={income} setIncome={setIncome} />}
      {page === 'foreign' && <ForeignPage income={income} setIncome={setIncome} />}
      {page === 'cgt' && <Sa108Page ret={ret} income={income} setIncome={setIncome} />}
      {page === 'trusts' && <Sa107Page income={income} setIncome={setIncome} />}
      {page === 'residence' && <Sa109Page ret={ret} income={income} setIncome={setIncome} />}
      {page === 'additional' && <AdditionalPage income={income} setIncome={setIncome} />}
      {page === 'minister' && <MinisterPage income={income} setIncome={setIncome} />}
      {page === 'niassembly' && <NiAssemblyPage ret={ret} income={income} setIncome={setIncome} />}
      {page === 'parliament' && <ParliamentPage ret={ret} income={income} setIncome={setIncome} />}
      {page === 'scottishparliament' && <ScottishParliamentPage ret={ret} income={income} setIncome={setIncome} />}
      {page === 'welshassembly' && <WelshAssemblyPage ret={ret} income={income} setIncome={setIncome} />}
      {page === 'lloyds' && <LloydsPage ret={ret} income={income} setIncome={setIncome} />}
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
// One core sub-section, shown as a panel when its sub-tab is active. The level-3
// SubTab already labels it (+ count), so this is just the titled body. Flashes
// when the "jump to" search targets it.
function CoreSection({ title, active, children }: { title: string; count?: number; defaultOpen?: boolean; active: boolean; children: React.ReactNode }) {
  const [flash, setFlash] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reveal = useContext(RevealContext);
  useEffect(() => {
    if (!reveal || reveal.section !== title || !active) return;
    setFlash(true);
    const raf = requestAnimationFrame(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    const t = setTimeout(() => setFlash(false), 1700);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [reveal, title, active]);
  if (!active) return null;
  return (
    <div ref={ref} className={`scroll-mt-24 rounded-xl border bg-white/60 p-4 transition-shadow ${flash ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/40' : 'border-[var(--border)]'}`}>
      <p className="mb-3 text-[12.5px] font-bold text-[var(--text-primary)]">{title}</p>
      {children}
    </div>
  );
}

// The Main Form (SA100) grouped into three level-2 sections; each sub-section is
// a level-3 sub-tab. `key` maps to coreSectionCounts for the (N) badges.
const CORE_LAYOUT: { group: string; subs: { title: string; key: string }[] }[] = [
  { group: 'Income', subs: [
    { title: 'Interest & dividends', key: 'interest' },
    { title: 'UK pensions & benefits', key: 'pensions' },
    { title: 'Other UK income', key: 'other' },
  ] },
  { group: 'Tax Reliefs', subs: [
    { title: 'Pension payments', key: 'pensionPayments' },
    { title: 'Charitable giving', key: 'charitable' },
    { title: 'Blind allowance & student loan', key: 'blindStudent' },
    { title: 'Child benefit', key: 'childBenefit' },
    { title: 'Marriage allowance', key: 'marriage' },
  ] },
  { group: 'Finishing your tax return', subs: [
    { title: 'Tax refunded or set off', key: 'taxRefunded' },
    { title: 'Paid too much tax — repayment details', key: 'repayment' },
    { title: 'Your tax adviser', key: 'adviser' },
    { title: 'Signing your form', key: 'signing' },
  ] },
];

function CorePage({ ret, income, setIncome, reveal }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome; reveal: Reveal | null }) {
  const c = coreSectionCounts(income) as unknown as Record<string, number>;
  const [grp, setGrp] = useState('Income');
  const [sub, setSub] = useState(0);
  const activeGroup = CORE_LAYOUT.find(g => g.group === grp) ?? CORE_LAYOUT[0];
  const activeSub = activeGroup.subs[sub] ?? activeGroup.subs[0];
  // "Jump to" search → switch to the group + sub-tab that owns the target section.
  useEffect(() => {
    if (!reveal?.section) return;
    for (const g of CORE_LAYOUT) {
      const idx = g.subs.findIndex(s => s.title === reveal.section);
      if (idx >= 0) { setGrp(g.group); setSub(idx); break; }
    }
  }, [reveal]);
  return (
    <RevealContext.Provider value={reveal}>
    <div className="space-y-3">
      <SectionTabs tabs={CORE_LAYOUT.map(g => ({ label: g.group, count: g.subs.reduce((a, s) => a + (c[s.key] || 0), 0) }))} active={grp} onSelect={l => { setGrp(l); setSub(0); }} />
      <SubTabs tabs={activeGroup.subs.map(s => ({ label: s.title, count: c[s.key] || 0 }))} active={sub} onSelect={setSub} />
      <CoreSection active={activeSub.title === "Interest & dividends"} title="Interest & dividends" count={c.interest} defaultOpen>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <JointInterestField
            box={1} label="Taxed UK interest" title="Taxed UK interest etc." help={CH.taxedInterest} kind="taxed"
            items={income.taxedInterestItems ?? []}
            onChange={items => setIncome(i => ({ ...i, taxedInterestItems: items as TaxedInterestItem[] }))}
            taxYear={ret.taxYear} taxpayerName={ret.clientName ?? 'You'} returnType={ret.returnType} />
          <JointInterestField
            box={2} label="Untaxed UK interest" title="Untaxed UK interest etc." help={CH.untaxedInterest} kind="untaxed"
            items={income.savingsInterestItems ?? []}
            onChange={items => setIncome(i => ({ ...i, savingsInterestItems: items as SavingsItem[] }))}
            taxYear={ret.taxYear} taxpayerName={ret.clientName ?? 'You'} returnType={ret.returnType} />
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

      <CoreSection active={activeSub.title === "UK pensions & benefits"} title="UK pensions & benefits" count={c.pensions}>
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

      <CoreSection active={activeSub.title === "Other UK income"} title="Other UK income" count={c.other}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={17} label="Other taxable income" title="Other taxable income" help={CH.otherIncome} items={income.otherIncomeItems} fallbackTotal={income.otherIncome} onChange={items => setIncome(i => ({ ...i, otherIncomeItems: items }))} />
          <LineField box={18} label="Total allowable expenses" title="Allowable expenses" items={income.otherIncomeExpensesItems} onChange={items => setIncome(i => ({ ...i, otherIncomeExpensesItems: items }))} />
          <LineField box={19} label="Any tax taken off box 17" title="Tax taken off other income" items={income.otherIncomeTaxItems} onChange={items => setIncome(i => ({ ...i, otherIncomeTaxItems: items }))} />
          <LineField box={20} label="Benefit from pre-owned assets" title="Benefit from pre-owned assets" help={CH.preOwnedAssets} items={income.preOwnedAssetsItems} onChange={items => setIncome(i => ({ ...i, preOwnedAssetsItems: items }))} />
        </div>
        <OtherIncomeDescription ret={ret} income={income} setIncome={setIncome} />
      </CoreSection>

      <CoreSection active={activeSub.title === "Pension payments"} title="Pension payments" count={c.pensionPayments}>
        <p className="mb-3 text-[11px] font-semibold text-[var(--accent)]">Paying into registered pension schemes and overseas pension schemes</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LineField box={1} label="Payments & basic rate tax" title="Payments to registered pension schemes (relief at source)" help={CH.pensionContributions} items={income.pensionContributionsItems} fallbackTotal={income.pensionContributions} onChange={items => setIncome(i => ({ ...i, pensionContributionsItems: items }))} />
          <LabelledNum box="1.1" label="One-off payments in box 1" help={CH.pensionOneOff} value={income.pensionOneOff ?? 0} onChange={v => setIncome(i => ({ ...i, pensionOneOff: v }))} />
          <LineField box={2} label="Payments to a retirement annuity" title="Payments to a retirement annuity" help={CH.pensionRetirementAnnuity} items={income.pensionRetirementAnnuityItems} onChange={items => setIncome(i => ({ ...i, pensionRetirementAnnuityItems: items }))} />
          <LineField box={3} label="Payments to your employer's scheme" title="Payments to your employer's scheme" help={CH.pensionEmployerScheme} items={income.pensionEmployerSchemeItems} onChange={items => setIncome(i => ({ ...i, pensionEmployerSchemeItems: items }))} />
          <LineField box={4} label="Payments to an overseas scheme" title="Payments to an overseas pension scheme" help={CH.pensionOverseas} items={income.pensionOverseasItems} onChange={items => setIncome(i => ({ ...i, pensionOverseasItems: items }))} />
        </div>
      </CoreSection>

      <CoreSection active={activeSub.title === "Charitable giving"} title="Charitable giving" count={c.charitable}>
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

      <CoreSection active={activeSub.title === "Blind allowance & student loan"} title="Blind allowance & student loan" count={c.blindStudent}>
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

      <CoreSection active={activeSub.title === "Child benefit"} title="Child benefit" count={c.childBenefit}>
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

      <CoreSection active={activeSub.title === "Marriage allowance"} title="Marriage allowance" count={c.marriage}>
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

      <CoreSection active={activeSub.title === "Tax refunded or set off"} title="Tax refunded or set off" count={c.taxRefunded}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <LabelledNum box={1} label="Tax refunded or set off by HMRC / Jobcentre Plus" help={CH.taxRefundedOrSetOff} value={income.taxRefundedOrSetOff ?? 0} onChange={v => setIncome(i => ({ ...i, taxRefundedOrSetOff: v }))} />
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold text-[var(--accent)]">If you have not paid enough tax</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <CheckField box={2} label="Do not collect current-year tax through my PAYE code" help={CH.noPayeCollect} checked={!!income.noPayeCollectCurrentYear} onChange={v => setIncome(i => ({ ...i, noPayeCollectCurrentYear: v }))} />
          <CheckField box={3} label="Do not collect next-year tax through my PAYE code" help={CH.noPayeCollect} checked={!!income.noPayeCollectNextYear} onChange={v => setIncome(i => ({ ...i, noPayeCollectNextYear: v }))} />
        </div>
      </CoreSection>

      <CoreSection active={activeSub.title === "Paid too much tax — repayment details"} title="Paid too much tax — repayment details" count={c.repayment}>
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

      <CoreSection active={activeSub.title === "Your tax adviser"} title="Your tax adviser" count={c.adviser}>
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

      <CoreSection active={activeSub.title === "Signing your form"} title="Signing your form" count={c.signing}>
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
// Truthy test for section-count helpers (non-zero number / true / non-empty string).
const truthy = (v: unknown) => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!(v && String(v).trim()));
function employmentSectionCount(e: EmploymentSource, tab: string): number {
  switch (tab) {
    case 'Details': return [e.employer, e.payeRef, e.isDirector, e.directorCeasedDate, e.isCloseCompany, e.closeCompanyName, e.closeCompanyReg, e.closeCompanyDividends, e.closeCompanyShareholding, e.teachersLoanOffPayroll].filter(truthy).length;
    case 'Income': return [e.pay, e.payrolledBenefitsStudentLoan, e.taxDeducted, e.tips, e.class1Nic].filter(truthy).length;
    case 'Benefit': return [e.benCar, e.benFuel, e.benMedical, e.benVouchers, e.benAssets, e.benAccommodation, e.benOther, e.benExpPayments].filter(truthy).length;
    case 'Expenses': return [e.expTravel, e.expFixed, e.expProfessional, e.expOther].filter(truthy).length;
  }
  return 0;
}

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
          {/* Section tabs: Employment Details / Income / Benefit / Expenses */}
          <div className="px-3 pt-2.5">
            <SectionTabs tabs={EMPLOYMENT_TABS.map(t => ({ label: t, count: employmentSectionCount(e, t) }))} active={tab} onSelect={t => setTab(t as EmploymentTab)} />
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

// Small blue "your share" hint shown under a whole-property box so the user can
// see the proportion that actually gets filed on the SA105 for this client.
function ShareHint({ value }: { value: number }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-sky-600">
      <span className="rounded bg-sky-50 px-1 py-px uppercase tracking-wide text-[8.5px] text-sky-500">Your share</span>
      {fmtMoney(value)}
    </div>
  );
}

function BoxNum({ box, label, value, onChange, help, share }: { box?: number | string; label: string; value: number; onChange: (v: number) => void; help?: string; share?: number }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <NumIn value={value} onChange={onChange} />
      {share != null && share < 1 && value !== 0 && <ShareHint value={Math.round(value * share)} />}
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
function BoxCalc({ box, label, value, help, shareValue }: { box?: number | string; label: string; value: number; help?: string; shareValue?: number }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-sky-100 px-1 text-[9px] font-bold text-sky-600">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </label>
      <div className="input-base flex items-center justify-end rounded-md bg-sky-50/70 py-1 text-right text-[12.5px] font-semibold text-sky-700">{fmtMoney(value)}</div>
      {shareValue != null && value !== 0 && <ShareHint value={shareValue} />}
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

function tradeSectionCount(t: TradeSource, tab: string): number {
  switch (tab) {
    case 'Business details': return [t.name, t.description, t.addressLine, t.postcode, t.detailsChanged, t.startedInYear, t.dateStarted, t.ceasedInYear, t.dateCeased, t.periodStart, t.periodEnd, t.traditionalAccounting, t.fosterCarer, t.specialArrangements, t.priorYearProfitDetails, t.turnover, t.otherBusinessIncome, t.tradingIncomeAllowance].filter(truthy).length;
    case 'Business Expenses': return [t.expCostOfGoods, t.expSubcontractors, t.expWages, t.expCarVanTravel, t.expPremises, t.expRepairs, t.expOffice, t.expAdvertising, t.expInterest, t.expBankCharges, t.expBadDebts, t.expProfessional, t.expDepreciation, t.expOtherCosts, t.disCostOfGoods, t.disSubcontractors, t.disWages, t.disCarVanTravel, t.disPremises, t.disRepairs, t.disOffice, t.disAdvertising, t.disInterest, t.disBankCharges, t.disBadDebts, t.disProfessional, t.disDepreciation, t.disOtherCosts].filter(truthy).length;
    case 'Net profit(loss)': return [t.aia, t.ca18, t.ca6, t.zeroEmissionGoods, t.zeroEmissionCar, t.sba, t.sbaFreeport, t.electricChargepoint, t.enhancedCapitalAllowances, t.allowancesOnSale, t.balancingCharges, t.capitalAllowances, t.goodsOwnUse, t.incomeReceiptsElsewhere, t.basisAdjustment, t.changeOfPracticeAdjustment, t.averagingAdjustment, t.transitionProfitSpread, t.transitionLossBfwd, t.lossBroughtForward, t.unusedLossCarriedForward, t.otherBusinessIncome75, t.figClaim, t.profit].filter(truthy).length;
    case 'Losses, CIS': return [t.adjustmentLossFig, t.lossSetOffOtherIncome, t.lossCarriedBack, t.cisDeductions, t.otherTaxTaken].filter(truthy).length;
    case 'Balance Sheet': return [t.bsEquipment, t.bsOtherFixedAssets, t.bsStock, t.bsDebtors, t.bsBank, t.bsCash, t.bsOtherCurrentAssets, t.bsCreditors, t.bsLoans, t.bsOtherLiabilities, t.caBalanceStart, t.caCapitalIntroduced, t.caDrawings, t.class2Voluntary, t.class4Exempt, t.class4Adjustment, t.willingPayClass2FullYear, t.otherInformation].filter(truthy).length;
  }
  return 0;
}

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
          {/* Section tabs */}
          <div className="px-3 pt-2.5">
            <SectionTabs tabs={TABS.map(tt => ({ label: tt, count: tradeSectionCount(t, tt) }))} active={activeTab} onSelect={setTop} />
          </div>
          {/* Sub-tabs */}
          {subList.length > 1 && <div className="px-3 pt-2.5"><SubTabs tabs={subList.map(st => ({ label: st }))} active={sub} onSelect={setSub} /></div>}
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
            {subName === 'Total Expenses' && ((t.tradingIncomeAllowance || 0) > 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="flex items-start gap-1.5 text-[12px] font-semibold text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Claiming the £1,000 trading income allowance</p>
                <p className="mt-1 text-[11px] text-amber-700">Actual expenses aren’t used when you claim the allowance — it’s one or the other. To deduct actual expenses instead, clear the trading income allowance (box 16.1) on the Business Income tab.</p>
              </div>
            ) : (
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
            ))}
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
      {subName === 'Allowable Expenses' && ((t.tradingIncomeAllowance || 0) > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="flex items-start gap-1.5 text-[12px] font-semibold text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Claiming the £1,000 trading income allowance</p>
          <p className="mt-1 text-[11px] text-amber-700">Actual expenses aren’t used when you claim the allowance — it’s one or the other. Clear the trading income allowance (box 10.1) on the Business Income tab to deduct actual expenses instead.</p>
        </div>
      ) : (
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
      ))}
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
  'Trading or professional losses': ['Trading or professional losses', 'NICs & untaxed interest', 'Tax paid and deductions'],
};

function partnershipSectionCount(p: PartnershipSource, tab: string): number {
  const details = [p.utr, p.description, p.becamePartner, p.dateJoined, p.ceasedPartner, p.dateLeft, p.periodStart, p.periodEnd];
  const profits = [p.profit, p.adjustmentPeriod, p.accountingAdjustment, p.averagingAdjustment, p.foreignTaxDeduction, p.transitionProfit, p.transitionLossBfwd, p.lossBroughtForward, p.unusedLossCarriedForward, p.otherBusinessIncome, p.figClaim];
  const lossNicSavProp = [p.lossFigAdjustment, p.lossAgainstOtherIncome, p.lossCarriedBack, p.class2Voluntary, p.class4Exempt, p.class4Adjustment, p.willingClass2, p.ukSavings, p.ukSavingsAdjustment, p.foreignSavings, p.foreignSavingsAdjustment, p.foreignSavingsTax, p.savingsFigClaim, p.propertyProfit, p.propertyAdjustment, p.propertyLossBfwd, p.propertyLossAgainstOther, p.propertyLossCarryForward, p.propertyFinanceCosts, p.propertyFinanceCostsBfwd];
  const ukForeignOffshore = [p.otherUkIncome, p.otherUkIncomeAdjustment, p.otherUkLossBfwd, p.otherUkIncomeB, p.otherUkLossAdjustment, p.offshoreIncome, p.offshoreAdjustment, p.offshoreTax, p.offshoreFigClaim, p.foreignIncome, p.foreignIncomeAdjustment, p.foreignLossBfwd, p.foreignTax, p.foreignFigClaim, p.foreignIncomeB, p.foreignLossAdjustment, p.foreignFinanceCosts, p.foreignFinanceCostsBfwd];
  const taxed = [p.taxedIncome10, p.taxedIncome10ForeignTax, p.taxedIncome10Fig, p.taxedIncome20, p.taxedIncome20ForeignTax, p.otherTaxedIncome, p.otherTaxedIncomeForeignTax, p.otherTaxedFig, p.totalFig, p.incomeTaxTaken, p.cisDeductions, p.taxTakenTradingIncome, p.otherInformation];
  switch (tab) {
    case 'Partnership details': return [...details, ...profits].filter(truthy).length;
    case 'Trading, NICs & Untaxed income': return lossNicSavProp.filter(truthy).length;
    case 'UK, Foreign Incomes & Offshore funds': return ukForeignOffshore.filter(truthy).length;
    case "Partnership's taxed income": return taxed.filter(truthy).length;
    case 'Partnership detail and profit': return [...details, ...profits].filter(truthy).length;   // short form
    case 'Trading or professional losses': return [...lossNicSavProp, ...taxed].filter(truthy).length; // short form
  }
  return 0;
}

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
          {/* Section tabs */}
          <div className="px-3 pt-2.5">
            <SectionTabs tabs={TABS.map(tt => ({ label: tt, count: partnershipSectionCount(p, tt) }))} active={activeTab} onSelect={setTop} />
          </div>
          {/* Sub-tabs */}
          {subList.length > 1 && <div className="px-3 pt-2.5"><SubTabs tabs={subList.map(st => ({ label: st }))} active={sub} onSelect={setSub} /></div>}
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
                <BoxCalc box={70} label="Total dividend income (box 68 − box 69)" value={(p.taxedIncome10 ?? 0) - (p.taxedIncome10ForeignTax ?? 0)} />
                <BoxNum box="70.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.taxedIncome10Fig ?? 0} onChange={v => set({ taxedIncome10Fig: v })} />
                <BoxNum box={71} label="Share of taxed income taxable at 20%" help={PH.taxedIncome20} value={p.taxedIncome20 ?? 0} onChange={v => set({ taxedIncome20: v })} />
                <BoxNum box={72} label="Total foreign tax taken off" value={p.taxedIncome20ForeignTax ?? 0} onChange={v => set({ taxedIncome20ForeignTax: v })} />
                <BoxCalc box={73} label="Taxed income taxable at 20% (box 71 − box 72)" value={(p.taxedIncome20 ?? 0) - (p.taxedIncome20ForeignTax ?? 0)} />
                <BoxNum box={74} label="Share of other taxed income" help={PH.otherTaxedIncome} value={p.otherTaxedIncome ?? 0} onChange={v => set({ otherTaxedIncome: v })} />
                <BoxNum box={75} label="Foreign tax taken off" value={p.otherTaxedIncomeForeignTax ?? 0} onChange={v => set({ otherTaxedIncomeForeignTax: v })} />
                <BoxNum box="75.1" label="Amount claimed under the FIG regime" help={PH.fig} value={p.otherTaxedFig ?? 0} onChange={v => set({ otherTaxedFig: v })} />
                <BoxCalc box={76} label="Share of total taxed & untaxed income other than at 10%/20% (box 20 + 67 + 74 − 75)" value={partnershipTotalTaxableProfit(p) + partnershipUntaxedOther(p) + (p.otherTaxedIncome ?? 0) - (p.otherTaxedIncomeForeignTax ?? 0)} />
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
            {subName === 'NICs & untaxed interest' && (<>
              <BoxSection title="National Insurance contributions">
                <BoxCheck box={25} label="Pay Class 2 NICs voluntarily" help={PH.class2Voluntary} checked={!!p.class2Voluntary} onChange={v => set({ class2Voluntary: v })} />
                <BoxCheck box={26} label="Exempt from Class 4 NIC" help={PH.class4Exempt} checked={!!p.class4Exempt} onChange={v => set({ class4Exempt: v })} />
                <BoxNum box={27} label="Adjustment to profits chargeable to Class 4 NICs" help={PH.class4Adjustment} value={p.class4Adjustment ?? 0} onChange={v => set({ class4Adjustment: v })} />
                <BoxYesNo label="Partner for the full year & willing to pay Class 2 NIC for the full year?" help={PH.willingClass2} value={!!p.willingClass2} onChange={v => set({ willingClass2: v })} />
              </BoxSection>
              <BoxSection title="Your share of the partnership's untaxed interest">
                <BoxNum box={28} label="Your share of untaxed interest — from box 13 on the Partnership Statement" help={PH.ukSavings} value={p.ukSavings ?? 0} onChange={v => set({ ukSavings: v })} />
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
          The short form only reports your share of trading profit, losses, NICs and untaxed interest. UK property, foreign, offshore and other income boxes are hidden — your figures are kept and reappear if you switch back to full.
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

function PropertyPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const list = income.property;
  const add = () => setIncome(i => ({ ...i, property: [...i.property, { id: `p-${i.property.length}-${Date.now()}`, address: '', profit: 0 }] }));
  const set = (u: Partial<Sa100Income>) => setIncome(i => ({ ...i, ...u }));
  const taxpayerName = ret.clientName ?? 'You';

  // Co-owner push — a co-owner's share of a jointly-owned property → their return.
  const coOwners = propertyCoOwners(list);
  const [coBusy, setCoBusy] = useState<string | null>(null);
  const [coMsg, setCoMsg] = useState<string | null>(null);
  const [coConfirm, setCoConfirm] = useState<{ group: PropertyCoOwnerGroup; existing: TaxReturn | null } | null>(null);
  async function pushCo(group: PropertyCoOwnerGroup) {
    if (!ret.returnType) return;
    setCoBusy(group.clientId); setCoMsg(null);
    try {
      const { ret: co, hasProperty } = await findPropertyCoOwnerReturn(group.clientId, ret.taxYear);
      if (hasProperty && co) { setCoConfirm({ group, existing: co }); return; }
      const { created } = await pushPropertyToCoOwner({ group, taxYear: ret.taxYear, returnType: ret.returnType, existing: co, mode: 'replace' });
      setCoMsg(`${created ? 'Created a new return for' : 'Added to'} ${group.name}’s ${ret.taxYear} return — their ${fmtMoney(group.shareProfit)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }
  async function doCoPush(mode: 'replace' | 'add') {
    if (!coConfirm || !ret.returnType) return;
    const { group, existing } = coConfirm; setCoBusy(group.clientId); setCoConfirm(null);
    try {
      await pushPropertyToCoOwner({ group, taxYear: ret.taxYear, returnType: ret.returnType, existing, mode });
      setCoMsg(`${mode === 'replace' ? 'Replaced' : 'Added to'} ${group.name}’s ${ret.taxYear} return — their ${fmtMoney(group.shareProfit)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }
  // Smart guess: number of properties defaults to how many were added/found.
  const countGuess = list.length;
  const countShown = income.propertyCount ?? countGuess;
  // Aggregate SA105 (submitted as one) — sums across every property.
  const sum = (f: (p: PropertySource) => number) => list.reduce((a, p) => a + f(p), 0);
  const agg = {
    income: sum(propertyGrossIncome), adjProfit: sum(propertyAdjustedProfit),
    taxable: sum(propertyTaxable), lossCf: sum(propertyLossCarryForward), finance: sum(p => p.residentialFinanceCosts ?? 0),
    taxableShare: sum(propertyTaxableShare),
  };
  const anyJoint = list.some(p => !!p.owners);
  return (
    <div className="space-y-3">
      {/* Return-level details (SA105 boxes 1–4) */}
      <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">UK property details</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
              <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">1</span> Number of properties<HelpDot help={PROP.propertyCount} label="Number of properties" />
            </label>
            <div className="flex items-center gap-1.5">
              <NumIn value={countShown} onChange={v => set({ propertyCount: v })} />
              {income.propertyCount == null && countGuess > 0 && <span className="whitespace-nowrap text-[9.5px] font-semibold text-[var(--accent)]">auto</span>}
            </div>
          </div>
          <BoxYesNo box={2} label="Property income ceased in year?" help={PROP.ceased} value={!!income.propertyCeased} onChange={v => set({ propertyCeased: v })} />
          <BoxYesNo box={3} label="Is property let jointly?" help={PROP.letJointly} value={!!income.propertyLetJointly} onChange={v => set({ propertyLetJointly: v })} />
          <BoxYesNo box={4} label="Claim Rent a Room relief?" help={PROP.claimRentARoom} value={!!income.propertyRentARoom} onChange={v => set({ propertyRentARoom: v })} />
        </div>
      </div>

      {/* Aggregate SA105 — every property is summed into one submitted return */}
      {list.length > 0 && (
        <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] px-3 py-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]"><Home size={12} /> SA105 total — submitted as one ({list.length} propert{list.length === 1 ? 'y' : 'ies'})</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-4">
            <span className="text-[var(--text-muted)]">Income <span className="font-bold text-[var(--text-primary)]">{fmtMoney(agg.income)}</span></span>
            <span className="text-[var(--text-muted)]">Adjusted profit <span className="font-bold text-[var(--text-primary)]">{fmtMoney(agg.adjProfit)}</span></span>
            <span className="text-[var(--text-muted)]">Taxable profit <span className="font-bold text-[var(--text-primary)]">{fmtMoney(agg.taxable)}</span>{anyJoint && <span className="ml-1 text-sky-600">· your {fmtMoney(agg.taxableShare)}</span>}</span>
            <span className="text-[var(--text-muted)]">Loss to carry fwd <span className="font-bold text-[var(--text-primary)]">{fmtMoney(agg.lossCf)}</span></span>
          </div>
          {anyJoint && <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">Figures above are the <b>whole</b> property/properties. Only <b>your {fmtMoney(agg.taxableShare)}</b> taxable share is carried into this client’s tax calculation and filed on their SA105.</p>}
        </div>
      )}

      {list.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No properties yet — add one (or import from Landlord Analysis) to enter the SA105 figures.</p>
      )}
      {list.map((p, idx) => (
        <PropertyCard key={p.id} p={p} idx={idx} taxpayerName={taxpayerName}
          onChange={u => setIncome(i => ({ ...i, property: i.property.map((x, j) => j === idx ? { ...x, ...u } : x) }))}
          onRemove={() => setIncome(i => ({ ...i, property: i.property.filter((_, j) => j !== idx) }))} />
      ))}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add property</button>
      <p className="text-[10.5px] text-[var(--text-muted)]">Each property is entered separately and summed into one SA105. Mark a property joint to split it with co-owners — the return uses this client’s share. Residential finance costs (box 44) are relieved as a 20% reducer, not deducted.</p>

      {coOwners.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--text-primary)]"><Users size={13} className="text-[var(--accent)]" /> Co-owners</p>
          <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">Push each co-owner’s share of the jointly-owned properties to their own return.</p>
          <div className="mt-2 space-y-1.5">
            {coOwners.map(g => (
              <div key={g.clientId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">{g.name}</span>
                <span className="text-[11px] text-[var(--text-muted)]">Share <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(g.shareProfit)}</span> taxable</span>
                <button onClick={() => pushCo(g)} disabled={coBusy === g.clientId} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-0.5 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                  {coBusy === g.clientId ? <><Loader2 size={11} className="animate-spin" /> Pushing…</> : <><ArrowUpRight size={11} /> Push to their return</>}
                </button>
              </div>
            ))}
          </div>
          {coMsg && <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">{coMsg}</p>}
        </div>
      )}
      {coConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => setCoConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-[var(--text-primary)]">Add to {coConfirm.group.name}’s return</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{coConfirm.group.name}’s {ret.taxYear} return already has property. Replace it with their share, or add on top?</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => setCoConfirm(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => doCoPush('add')} className="btn-secondary bg-white">Add to existing</button>
              <button onClick={() => doCoPush('replace')} className="btn-primary">Replace</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PROPERTY_TABS = ['Property income', 'Property expenses', 'Taxable profit or loss'] as const;
function propertySectionCount(p: PropertySource, tab: string): number {
  switch (tab) {
    case 'Property income': return [p.rents, p.propertyIncomeAllowance, p.traditionalAccounting, p.taxTaken, p.premiums, p.reversePremiums].filter(truthy).length;
    case 'Property expenses': return [p.expPremises, p.expRepairs, p.expLoanInterest, p.expProfessional, p.expServices, p.expOther].filter(truthy).length;
    case 'Taxable profit or loss': return [p.privateUse, p.balancingCharges, p.aia, p.sba, p.electricChargepoint, p.freeportSba, p.zeroEmissionCar, p.capitalAllowances, p.domesticItems, p.rentARoomExempt ?? p.rentARoom, p.lossBroughtForward, p.unusedLossCarriedForward, p.lossSetOffTotalIncome, p.residentialFinanceCosts, p.unusedFinanceCostsBfwd].filter(truthy).length;
  }
  return 0;
}

function PropertyCard({ p, idx, taxpayerName, onChange, onRemove }: {
  p: PropertySource; idx: number; taxpayerName: string; onChange: (u: Partial<PropertySource>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<string>('Property income');
  const set = (u: Partial<PropertySource>) => onChange(u);
  const joint = !!p.owners;
  const share = ownerShareFraction(p.owners);
  const shareProp = joint ? share : undefined;
  const activeTab = (PROPERTY_TABS as readonly string[]).includes(tab) ? tab : PROPERTY_TABS[0];
  // Imported rows (from the Landlord or MTD tool) carry a single already-shared
  // "profit" figure with no owners — flag that so the user knows not to re-split
  // it or type over it in the empty boxes.
  const imported = p.id.startsWith('xc-');
  const fromMtd = imported && p.id.includes('mtd');
  const shareMatch = /(\d+)%\s+share\s+of\s+(.+)$/i.exec(p.address || '');
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <input value={p.address} placeholder={`Property ${idx + 1} — address`} onChange={ev => onChange({ address: ev.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
        <ProvenanceBadge id={p.id} />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Taxable <span className="font-bold text-[var(--text-primary)]">{fmtMoney(propertyTaxable(p))}</span>{joint && <span className="ml-1 text-[var(--accent)]">· your {fmtMoney(propertyTaxableShare(p))}</span>}</span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="border-t border-black/5">
          {imported && (
            <div className="border-b border-black/5 bg-sky-50/50 px-3 py-2 text-[11px] text-sky-800">
              <p className="flex items-start gap-1.5">
                <Info size={13} className="mt-0.5 shrink-0 text-sky-500" />
                <span>Imported taxable figure of <b>{fmtMoney(propertyTaxable(p))}</b> — {shareMatch ? <>already {taxpayerName}’s <b>{shareMatch[1]}% share</b> of {shareMatch[2]}, </> : <>already {taxpayerName}’s share, </>}calculated in the {fromMtd ? 'MTD' : 'Landlord'} tool. It’s this client’s own share, so SMITH doesn’t split it again. Leave the boxes below empty — typing into them replaces the imported figure.</span>
              </p>
            </div>
          )}
          <div className="border-b border-black/5 px-3 py-2.5">
            <OwnershipEditor owners={p.owners ?? []} onChange={o => set({ owners: o.length ? o : undefined })} taxpayerName={taxpayerName} />
            {joint && <p className="mt-1 text-[10px] text-[var(--text-muted)]">Enter each box below as the <b>whole property</b> figure — the blue <span className="text-sky-600">your share</span> line under each box is what’s actually filed on {taxpayerName}’s SA105 ({Math.round(share * 100)}%). The £1,000 property allowance and losses are per-person — set each owner’s on their own return.</p>}
          </div>
          <div className="px-3 pt-2.5">
            <SectionTabs tabs={PROPERTY_TABS.map(tt => ({ label: tt, count: propertySectionCount(p, tt) }))} active={activeTab} onSelect={setTab} />
          </div>
          <div className="space-y-3 px-3 py-3">
            {activeTab === 'Property income' && (
              <>
                <BoxSection title={joint ? 'Property income (whole property)' : 'Property income'}>
                  <BoxNum box={20} label="Total rents and other income from property" value={p.rents ?? 0} onChange={v => set({ rents: v })} share={shareProp} />
                  <BoxNum box="20.1" label={joint ? 'Property income allowance (your own, max £1,000)' : 'Property income allowance (max £1,000)'} help={PROP.incomeAllowance} value={p.propertyIncomeAllowance ?? 0} onChange={v => set({ propertyIncomeAllowance: v })} />
                  <BoxCheck box="20.2" label="Traditional accounting" help={PROP.traditionalAccounting} checked={!!p.traditionalAccounting} onChange={v => set({ traditionalAccounting: v })} />
                  <BoxNum box={21} label="Tax taken off any income in box 20" value={p.taxTaken ?? 0} onChange={v => set({ taxTaken: v })} share={shareProp} />
                  <BoxNum box={22} label="Premiums for the grant of a lease" help={PROP.premiums} value={p.premiums ?? 0} onChange={v => set({ premiums: v })} share={shareProp} />
                  <BoxNum box={23} label="Reverse premiums and inducements" help={PROP.reversePremiums} value={p.reversePremiums ?? 0} onChange={v => set({ reversePremiums: v })} share={shareProp} />
                </BoxSection>
                {(p.propertyIncomeAllowance || 0) > 0 && propertyExpensesTotal(p) > 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> You've claimed the £1,000 property income allowance <b>and</b> entered expenses — only the allowance is used in the tax. It's one or the other: clear box 20.1 to deduct actual expenses instead.</p>
                )}
                {joint && <p className="text-[10.5px] text-[var(--text-muted)]">Each box is the <b>whole property</b>; the blue <span className="text-sky-600">your share</span> beneath it is {taxpayerName}’s {Math.round(share * 100)}% that goes on the SA105. The property income allowance is <b>per-person</b> — enter this client’s own (up to £1,000), not the whole.</p>}
              </>
            )}
            {activeTab === 'Property expenses' && (
              (p.propertyIncomeAllowance || 0) > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                  <p className="flex items-start gap-1.5 text-[12px] font-semibold text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> Claiming the £1,000 property income allowance</p>
                  <p className="mt-1 text-[11px] text-amber-700">Actual expenses aren’t used when you claim the allowance — it’s one or the other. To deduct actual expenses instead, clear the property income allowance (box 20.1) on the Property income tab.</p>
                </div>
              ) : (
                <BoxSection title={joint ? 'Property expenses (whole property)' : 'Property expenses'}>
                  <BoxNum box={24} label="Rent, rates, insurance, ground rents etc." value={p.expPremises ?? 0} onChange={v => set({ expPremises: v })} share={shareProp} />
                  <BoxNum box={25} label="Property repairs and maintenance" value={p.expRepairs ?? 0} onChange={v => set({ expRepairs: v })} share={shareProp} />
                  <BoxNum box={26} label="Loan interest and other financial costs" help={PROP.loanInterest} value={p.expLoanInterest ?? 0} onChange={v => set({ expLoanInterest: v })} share={shareProp} />
                  <BoxNum box={27} label="Legal, management and other professional fees" value={p.expProfessional ?? 0} onChange={v => set({ expProfessional: v })} share={shareProp} />
                  <BoxNum box={28} label="Costs of services provided, including wages" value={p.expServices ?? 0} onChange={v => set({ expServices: v })} share={shareProp} />
                  <BoxNum box={29} label="Other allowable property expenses" value={p.expOther ?? 0} onChange={v => set({ expOther: v })} share={shareProp} />
                </BoxSection>
              )
            )}
            {activeTab === 'Taxable profit or loss' && (
              <BoxSection title="Taxable profit or loss">
                <BoxNum box={30} label="Private use adjustment" help={PROP.privateUse} value={p.privateUse ?? 0} onChange={v => set({ privateUse: v })} share={shareProp} />
                <BoxNum box={31} label="Balancing charges" help={PROP.balancingCharges} value={p.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} share={shareProp} />
                <BoxNum box={32} label="Annual Investment Allowance" help={PROP.aia} value={p.aia ?? 0} onChange={v => set({ aia: v })} share={shareProp} />
                <BoxNum box={33} label="Structures and Buildings Allowance" value={p.sba ?? 0} onChange={v => set({ sba: v })} share={shareProp} />
                <BoxNum box="33.1" label="Electric charge-point allowance" value={p.electricChargepoint ?? 0} onChange={v => set({ electricChargepoint: v })} share={shareProp} />
                <BoxNum box="33.2" label="Freeport and Investment Zones Structures and Buildings Allowance" value={p.freeportSba ?? 0} onChange={v => set({ freeportSba: v })} share={shareProp} />
                <BoxNum box="34.1" label="Zero-emission car allowance" value={p.zeroEmissionCar ?? 0} onChange={v => set({ zeroEmissionCar: v })} share={shareProp} />
                <BoxNum box={35} label="All other capital allowances" value={p.capitalAllowances ?? 0} onChange={v => set({ capitalAllowances: v })} share={shareProp} />
                <BoxNum box={36} label="Costs of replacing domestic items" help={PROP.domesticItems} value={p.domesticItems ?? 0} onChange={v => set({ domesticItems: v })} share={shareProp} />
                <BoxNum box={37} label="Rent a Room exempt amount" help={PROP.rentARoomExempt} value={p.rentARoomExempt ?? p.rentARoom ?? 0} onChange={v => set({ rentARoomExempt: v })} share={shareProp} />
                <BoxCalc box={38} label="Adjusted profit for the year" help={PROP.adjustedProfit} value={propertyAdjustedProfit(p)} shareValue={joint ? Math.round(propertyAdjustedProfit(p) * share) : undefined} />
                <BoxNum box={39} label="Loss brought forward used against this year's profits" help={PROP.lossBroughtForward} value={p.lossBroughtForward ?? 0} onChange={v => set({ lossBroughtForward: v })} share={shareProp} />
                <BoxNum label="Unused losses b/fwd to carry forward to next year" value={p.unusedLossCarriedForward ?? 0} onChange={v => set({ unusedLossCarriedForward: v })} share={shareProp} />
                <BoxCalc box={40} label="Taxable profit for the year" help={PROP.taxableProfit} value={propertyTaxable(p)} shareValue={joint ? propertyTaxableShare(p) : undefined} />
                <BoxCalc box={41} label="Adjusted loss for the year" help={PROP.adjustedLoss} value={propertyAdjustedLoss(p)} shareValue={joint ? Math.round(propertyAdjustedLoss(p) * share) : undefined} />
                <BoxNum box={42} label="Loss set off against total income for the year" value={p.lossSetOffTotalIncome ?? 0} onChange={v => set({ lossSetOffTotalIncome: v })} share={shareProp} />
                <BoxCalc box={43} label="Loss to carry forward to following year" help={PROP.lossCarryForward} value={propertyLossCarryForward(p)} shareValue={joint ? Math.round(propertyLossCarryForward(p) * share) : undefined} />
                <BoxNum box={44} label="Residential property finance costs" help={PROP.residentialFinanceCosts} value={p.residentialFinanceCosts ?? 0} onChange={v => set({ residentialFinanceCosts: v })} share={shareProp} />
                <BoxNum box={45} label="Unused residential property finance costs brought forward" value={p.unusedFinanceCostsBfwd ?? 0} onChange={v => set({ unusedFinanceCostsBfwd: v })} share={shareProp} />
              </BoxSection>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const FOREIGN_TABS = ['Unremittable income', 'Overseas Income', 'Income from Land and property', 'Foreign tax paid'] as const;
const FOREIGN_SUBTABS: Record<string, string[]> = {
  'Unremittable income': [],
  'Overseas Income': ['Interest & other income', 'Dividends from foreign companies', 'Remitted income excl. dividends', 'Remitted foreign dividends', 'Pensions income', 'Other income'],
  'Income from Land and property': ['Income & Expenses', 'Calculate Taxable P&L', 'Summary', 'Total P&L'],
  'Foreign tax paid': ['Foreign tax', 'Capital gains', 'Foreign life insurance', 'Non-resident trusts', 'Transfer of Assets & Settlements'],
};
const foreignRid = (n: number) => `fr-${n}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Entry count shown in brackets on a foreign sub-tab heading (0 = no badge).
function foreignSubCount(sa: Sa106, tab: string, sub: string): number {
  const n = (a?: unknown[]) => a?.length ?? 0;
  if (tab === 'Overseas Income') {
    switch (sub) {
      case 'Interest & other income': return n(sa.interest);
      case 'Dividends from foreign companies': return n(sa.dividends);
      case 'Remitted income excl. dividends': return n(sa.remittedExcl);
      case 'Remitted foreign dividends': return n(sa.remittedDividends);
      case 'Pensions income': return n(sa.pensions);
      case 'Other income': return n(sa.otherDividend) + n(sa.otherAll);
    }
  }
  if (tab === 'Income from Land and property') return sub === 'Total P&L' ? 0 : n(sa.properties);
  if (tab === 'Foreign tax paid') {
    if (sub === 'Foreign tax') return n(sa.foreignTaxRows);
    if (sub === 'Non-resident trusts') return n(sa.nrtSavings) + n(sa.nrtDividends);
  }
  return 0;
}

function ForeignPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const sa: Sa106 = income.foreign ?? {};
  const set = (u: Partial<Sa106>) => setIncome(i => ({ ...i, foreign: { ...i.foreign, ...u } }));
  const [tab, setTab] = useState<string>('Overseas Income');
  const [sub, setSub] = useState(0);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (FOREIGN_TABS as readonly string[]).includes(tab) ? tab : FOREIGN_TABS[0];
  const subList = FOREIGN_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  const legacy = !!(sa.sources?.length || sa.income || sa.foreignTaxPaid);
  return (
    <div className="space-y-3">
      {legacy && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Legacy foreign figures are still counted in the tax. Re-enter them in the boxes below to file box-for-box, then clear the old ones.</p>}
      <SectionTabs tabs={FOREIGN_TABS.map(tt => ({ label: tt }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(st => ({ label: st, count: foreignSubCount(sa, activeTab, st) }))} active={sub} onSelect={setSub} />}

      {/* ── Unremittable income ── */}
      {activeTab === 'Unremittable income' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Unremittable income">
            <BoxYesNo box={1} label="Unable to transfer any of your overseas income to the UK?" help={FGN.unremittable} value={!!sa.unremittable} onChange={v => set({ unremittable: v })} />
          </BoxSection>
          <BoxSection title="Foreign Tax Credit Relief">
            <BoxNum box={2} label="Foreign Tax Credit Relief on your income" help={FGN.ftcrOnIncome} value={sa.ftcrOnIncome ?? 0} onChange={v => set({ ftcrOnIncome: v })} />
          </BoxSection>
        </StudioCard>
      )}

      {/* ── Overseas Income ── */}
      {subName === 'Interest & other income' && <ForeignIncomeTable title="Interest and other income" rows={sa.interest ?? []} onChange={r => set({ interest: r })} totalBoxes={{ swt: '3', taxable: '4' }} fig="4.1" figValue={sa.interestFig ?? 0} onFigChange={v => set({ interestFig: v })} maxRows={12} />}
      {subName === 'Dividends from foreign companies' && <ForeignIncomeTable title="Dividends from foreign companies" rows={sa.dividends ?? []} onChange={r => set({ dividends: r })} totalBoxes={{ taxable: '6' }} fig="6.1" figValue={sa.dividendsFig ?? 0} onFigChange={v => set({ dividendsFig: v })} maxRows={18} />}
      {subName === 'Remitted income excl. dividends' && <ForeignIncomeTable title="Remitted foreign income excluding dividends" rows={sa.remittedExcl ?? []} onChange={r => set({ remittedExcl: r })} maxRows={5} />}
      {subName === 'Remitted foreign dividends' && (
        <ForeignIncomeTable title="Remitted foreign dividends income" rows={sa.remittedDividends ?? []} onChange={r => set({ remittedDividends: r })} totalBoxes={{ swt: '7.3', taxable: '7.4' }} maxRows={1}
          extra={<BoxNum box="7.5" label="Amount in box 7.4 subject to dividend tax credit" value={sa.remittedDivSubjectToCredit ?? 0} onChange={v => set({ remittedDivSubjectToCredit: v })} />} />
      )}
      {subName === 'Pensions income' && <ForeignIncomeTable title="Overseas pensions, social security benefits and royalties etc." rows={sa.pensions ?? []} onChange={r => set({ pensions: r })} totalBoxes={{ swt: '8', taxable: '9' }} fig="9.1" figValue={sa.pensionsFig ?? 0} onFigChange={v => set({ pensionsFig: v })} maxRows={4} breakdownCols={FGN_PENSION_COLS} />}
      {subName === 'Other income' && (
        <div className="space-y-3">
          <ForeignIncomeTable title="Dividend income received by a person abroad" rows={sa.otherDividend ?? []} onChange={r => set({ otherDividend: r })} totalBoxes={{ swt: '10', taxable: '11' }} fig="11.1" figValue={sa.otherDividendFig ?? 0} onFigChange={v => set({ otherDividendFig: v })} maxRows={5} />
          <ForeignIncomeTable title="All other income received by a person abroad" rows={sa.otherAll ?? []} onChange={r => set({ otherAll: r })} totalBoxes={{ swt: '12', taxable: '13' }} fig="13.0" figValue={sa.otherAllFig ?? 0} onFigChange={v => set({ otherAllFig: v })} maxRows={5}
            extra={<>
              <BoxNum box="13.1" label="Residential finance cost" help={PROP.residentialFinanceCosts} value={sa.otherResiFinanceCost ?? 0} onChange={v => set({ otherResiFinanceCost: v })} />
              <BoxNum box="13.2" label="Unused residential property finance costs brought forward" value={sa.otherResiFinanceBfwd ?? 0} onChange={v => set({ otherResiFinanceBfwd: v })} />
            </>} />
        </div>
      )}

      {/* ── Income from Land and property ── */}
      {activeTab === 'Income from Land and property' && <ForeignPropertySection sa={sa} set={set} subName={subName} />}

      {/* ── Foreign tax paid ── */}
      {subName === 'Foreign tax' && <ForeignIncomeTable title="Foreign tax" note="Foreign tax on income reported elsewhere on your return." rows={sa.foreignTaxRows ?? []} onChange={r => set({ foreignTaxRows: r })} columns="acef" />}
      {subName === 'Capital gains' && (
        <StudioCard className="p-4"><BoxSection title="Foreign tax paid on capital gains">
          <BoxNum box={33} label="Amount of chargeable gain under UK rules" help={FGN.cgUkGain} value={sa.cgUkGain ?? 0} onChange={v => set({ cgUkGain: v })} />
          <BoxNum box={34} label="Number of days over which UK gain accrued" value={sa.cgUkDays ?? 0} onChange={v => set({ cgUkDays: v })} />
          <BoxNum box={35} label="Amount of chargeable gain under foreign tax rules" help={FGN.cgForeignGain} value={sa.cgForeignGain ?? 0} onChange={v => set({ cgForeignGain: v })} />
          <BoxNum box={36} label="Number of days over which foreign gain accrued" value={sa.cgForeignDays ?? 0} onChange={v => set({ cgForeignDays: v })} />
          <BoxNum box={37} label="Foreign tax paid" value={sa.cgForeignTax ?? 0} onChange={v => set({ cgForeignTax: v })} />
          <BoxYesNo box={38} label="To claim Foreign Tax Credit Relief?" value={!!sa.cgClaimFtcr} onChange={v => set({ cgClaimFtcr: v })} />
          <BoxNum box={39} label="Total Foreign Tax Credit Relief on gains" value={sa.cgFtcr ?? 0} onChange={v => set({ cgFtcr: v })} />
          <BoxNum box={40} label="Special Withholding Tax" value={sa.cgSwt ?? 0} onChange={v => set({ cgSwt: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Foreign life insurance' && (
        <StudioCard className="p-4"><BoxSection title="Gains on foreign life insurance policies etc.">
          <BoxNum box={43} label="Gains on foreign life insurance policies, etc." help={FGN.lifeGains} value={sa.lifeGains ?? 0} onChange={v => set({ lifeGains: v })} />
          <BoxNum box={44} label="Number of years" help={FGN.lifeYears} value={sa.lifeYears ?? 0} onChange={v => set({ lifeYears: v })} />
          <BoxNum box={45} label="Tax treated as paid" value={sa.lifeTaxPaid ?? 0} onChange={v => set({ lifeTaxPaid: v })} />
          <BoxNum box={46} label="Total amount omitted" value={sa.lifeOmitted ?? 0} onChange={v => set({ lifeOmitted: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Non-resident trusts' && (
        <div className="space-y-3">
          <StudioCard className="p-4"><BoxSection title="Non-resident settlor-interested trusts — residential property">
            <BoxNum box="48.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.nrtResiPropertyFig ?? 0} onChange={v => set({ nrtResiPropertyFig: v })} />
            <BoxNum box={49} label="Overseas residential property income / restricted finance costs for NR trust" value={sa.nrtResiProperty ?? 0} onChange={v => set({ nrtResiProperty: v })} />
            <BoxNum box="49.1" label="Unused overseas residential property finance costs b/fwd (re box 48)" value={sa.nrtResiFinanceBfwd ?? 0} onChange={v => set({ nrtResiFinanceBfwd: v })} />
          </BoxSection></StudioCard>
          <ForeignIncomeTable title="Savings income arising in non-resident settlor-interested trusts" rows={sa.nrtSavings ?? []} onChange={r => set({ nrtSavings: r })} totalBoxes={{ swt: '50', taxable: '51' }} fig="51.1" figValue={sa.nrtSavingsFig ?? 0} onFigChange={v => set({ nrtSavingsFig: v })} />
          <ForeignIncomeTable title="Dividend income arising in non-resident settlor-interested trusts" rows={sa.nrtDividends ?? []} onChange={r => set({ nrtDividends: r })} totalBoxes={{ swt: '52', taxable: '53' }} fig="53.1" figValue={sa.nrtDividendsFig ?? 0} onFigChange={v => set({ nrtDividendsFig: v })} />
          <StudioCard className="p-4"><BoxSection title="Other non-resident trust income">
            <BoxNum box={54} label="Discretionary income from non-settlor interested non-resident trusts" value={sa.nrtDiscretionary ?? 0} onChange={v => set({ nrtDiscretionary: v })} />
            <BoxNum box="54.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.nrtDiscretionaryFig ?? 0} onChange={v => set({ nrtDiscretionaryFig: v })} />
            <BoxNum box={55} label="Capital sums paid to settlor by trustees of non-resident trusts" value={sa.nrtCapitalSums ?? 0} onChange={v => set({ nrtCapitalSums: v })} />
            <BoxNum box="55.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.nrtCapitalSumsFig ?? 0} onChange={v => set({ nrtCapitalSumsFig: v })} />
            <BoxNum box={56} label="Gains on disposal of holdings in offshore fund (excl. box 13)" value={sa.offshoreFundGains ?? 0} onChange={v => set({ offshoreFundGains: v })} />
            <BoxNum box="56.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.offshoreFundGainsFig ?? 0} onChange={v => set({ offshoreFundGainsFig: v })} />
            <BoxNum box={57} label="Non-trade income (excl. box 13)" value={sa.nonTradeIncome ?? 0} onChange={v => set({ nonTradeIncome: v })} />
            <BoxNum box="57.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.nonTradeIncomeFig ?? 0} onChange={v => set({ nonTradeIncomeFig: v })} />
          </BoxSection></StudioCard>
        </div>
      )}
      {subName === 'Transfer of Assets & Settlements' && (
        <StudioCard className="p-4"><BoxSection title="Transfer of Assets Abroad & Settlements">
          <BoxNum box={58} label="Transfer of Assets Abroad — Taxable Benefits" value={sa.toaaBenefits ?? 0} onChange={v => set({ toaaBenefits: v })} />
          <BoxNum box="58.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.toaaBenefitsFig ?? 0} onChange={v => set({ toaaBenefitsFig: v })} />
          <BoxNum box={59} label="Transfer of Assets Abroad — Taxable Benefits (TPI / PFSI)" value={sa.toaaTpiPfsi ?? 0} onChange={v => set({ toaaTpiPfsi: v })} />
          <BoxNum box="59.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.toaaTpiPfsiFig ?? 0} onChange={v => set({ toaaTpiPfsiFig: v })} />
          <BoxNum box={60} label="Transfer of Assets Abroad — Close Family Member Benefits" value={sa.toaaCloseFamily ?? 0} onChange={v => set({ toaaCloseFamily: v })} />
          <BoxNum box="60.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.toaaCloseFamilyFig ?? 0} onChange={v => set({ toaaCloseFamilyFig: v })} />
          <BoxNum box={61} label="Transfer of Assets Abroad — Onward Gifts Benefits" value={sa.toaaOnwardGifts ?? 0} onChange={v => set({ toaaOnwardGifts: v })} />
          <BoxNum box="61.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.toaaOnwardGiftsFig ?? 0} onChange={v => set({ toaaOnwardGiftsFig: v })} />
          <BoxNum box={62} label="Settlements — Taxable Benefits (TTI / PFSI)" value={sa.settleTtiPfsi ?? 0} onChange={v => set({ settleTtiPfsi: v })} />
          <BoxNum box="62.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.settleTtiPfsiFig ?? 0} onChange={v => set({ settleTtiPfsiFig: v })} />
          <BoxNum box={63} label="Settlements — Close Family Member Benefits (TTI / PFSI)" value={sa.settleCloseFamily ?? 0} onChange={v => set({ settleCloseFamily: v })} />
          <BoxNum box="63.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.settleCloseFamilyFig ?? 0} onChange={v => set({ settleCloseFamilyFig: v })} />
          <BoxNum box={64} label="Settlements — Onward Gifts Benefits" value={sa.settleOnwardGifts ?? 0} onChange={v => set({ settleOnwardGifts: v })} />
          <BoxNum box="64.1" label="Amount claimed under the FIG regime" help={FGN.fig} value={sa.settleOnwardGiftsFig ?? 0} onChange={v => set({ settleOnwardGiftsFig: v })} />
        </BoxSection></StudioCard>
      )}

      <p className="text-[10.5px] text-[var(--text-muted)]">Interest is taxed at savings rates, dividends at dividend rates, foreign property & the rest as other income. Foreign Tax Credit Relief (per row) is credited, capped at the UK tax on the same income. Capital gains, life insurance, trust and Transfer-of-Assets boxes are captured for the return but not yet in the headline estimate.</p>
    </div>
  );
}

// Country dropdown — stores the 3-letter ISO/HMRC territory code, shows the name.
function CountrySelect({ value, onChange, className = '' }: { value?: string; onChange: (code: string) => void; className?: string }) {
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={`input-base py-1 text-[12px] ${className}`}>
      <option value="">Select country…</option>
      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
    </select>
  );
}

// Resolve a raw token (a code, or a country name from a scan) to an ISO alpha-3
// code, or null if it's not a country we know.
function resolveCountryCode(token: string): string | null {
  const s = token.trim();
  if (!s) return null;
  const hit = COUNTRIES.find(c => c.code === s.toUpperCase() || c.name.toLowerCase() === s.toLowerCase());
  return hit ? hit.code : null;
}

// A pick-as-many-as-you-need country list (SA109 boxes 17/18/19) — reuses
// CountrySelect so each choice stores its 3-letter code. The model field stays a
// simple comma-joined code string, so scans / the AI note keep working; scanned
// country names are resolved to codes on display.
function CountryCodeList({ box, label, value, onChange, note, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; note?: string; help?: string }) {
  const codes = [...new Set((value ? value.split(/[,\n;]/) : []).map(resolveCountryCode).filter((c): c is string => !!c))];
  const write = (next: string[]) => onChange([...new Set(next.filter(Boolean))].join(', '));
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </div>
      <div className="space-y-1.5">
        {codes.map((c, i) => (
          <div key={`${c}-${i}`} className="flex items-center gap-2">
            <CountrySelect value={c} onChange={v => { const n = [...codes]; if (v) n[i] = v; else n.splice(i, 1); write(n); }} className="flex-1" />
            <button onClick={() => { const n = [...codes]; n.splice(i, 1); write(n); }} className="shrink-0 rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-rose-50 hover:text-rose-500" aria-label="Remove country"><Trash2 size={13} /></button>
          </div>
        ))}
        <CountrySelect value="" onChange={v => { if (v) write([...codes, v]); }} className="w-full" />
      </div>
      {note && <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">{note}</p>}
    </div>
  );
}

// Breakdown sub-table columns (the "+" pop-ups).
const FGN_INCOME_COLS: BreakdownColumn<ForeignIncomeItem>[] = [
  { key: 'description', label: 'Description of income', kind: 'text' },
  { key: 'grossIncome', label: 'Gross income arising', kind: 'number', total: true },
  { key: 'foreignTax', label: 'Foreign tax taken off', kind: 'number', total: true },
  { key: 'ukTax', label: 'UK tax taken off', kind: 'number', total: true },
];
// Overseas pensions add a "10% Deduction" checkbox column.
const FGN_PENSION_COLS: BreakdownColumn<ForeignIncomeItem>[] = [...FGN_INCOME_COLS, { key: 'tenPercent', label: '10% Deduction', kind: 'check' }];
const FGN_EXPENSE_COLS: BreakdownColumn<ForeignExpenseItem>[] = [
  { key: 'description', label: 'Description of expense', kind: 'text' },
  { key: 'expense', label: 'Expense', kind: 'number', total: true },
  { key: 'privateUse', label: 'Private use', kind: 'number', total: true },
];

// The recurring SA106 country-income table (columns A–F). `columns="acef"` drops
// the Income-arising (B) and Special-Withholding (D) columns (used by "Foreign tax").
// The green "+" on each row itemises that row's income into a breakdown sub-table.
function ForeignIncomeTable({ title, note, rows, onChange, totalBoxes, extra, columns = 'full', fig, figValue, onFigChange, maxRows, breakdownCols = FGN_INCOME_COLS }: {
  title: string; note?: string; rows: ForeignRow[]; onChange: (r: ForeignRow[]) => void;
  totalBoxes?: { swt?: string; taxable?: string }; extra?: React.ReactNode; columns?: 'full' | 'acef';
  fig?: string; figValue?: number; onFigChange?: (v: number) => void; maxRows?: number; breakdownCols?: BreakdownColumn<ForeignIncomeItem>[];
}) {
  const full = columns === 'full';
  const [itemise, setItemise] = useState<number | null>(null);
  const atMax = maxRows != null && rows.length >= maxRows;
  const add = () => { if (!atMax) onChange([...rows, { id: foreignRid(rows.length) }]); };
  const upd = (i: number, u: Partial<ForeignRow>) => onChange(rows.map((r, j) => j === i ? { ...r, ...u } : r));
  const del = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const t = foreignTableTotals(rows);
  const cols = full ? 'minmax(88px,1.3fr) 1fr 1fr 1fr 40px 1fr 26px' : 'minmax(88px,1.3fr) 1fr 40px 1fr 26px';
  return (
    <StudioCard className="p-4">
      <SectionTitle title={title} />
      {note && <p className="mb-2 flex items-start gap-1 text-[11px] text-amber-700"><Info size={11} className="mt-0.5 shrink-0" /> {note}</p>}
      <div className="mt-2 hidden gap-2 border-b border-black/5 pb-1 text-[9px] font-bold uppercase tracking-wide text-[var(--text-muted)] sm:grid" style={{ gridTemplateColumns: cols }}>
        <span>A Country</span>{full && <span>B Income</span>}<span>C Foreign tax</span>{full && <span>D SWT</span>}<span className="text-center">E FTCR</span><span className="text-right">F Taxable</span><span />
      </div>
      {rows.length === 0 && <p className="py-2 text-[11.5px] text-[var(--text-muted)]">No entries yet — add a country.</p>}
      {rows.map((r, i) => (
        <div key={r.id} className="grid items-center gap-2 border-b border-black/5 py-1.5" style={{ gridTemplateColumns: cols }}>
          <CountrySelect value={r.country} onChange={v => upd(i, { country: v })} />
          {full && (r.breakdown?.length
            ? <div className="input-base flex items-center justify-end bg-sky-50/70 py-1 text-[11.5px] font-semibold text-sky-700" title="From the itemised breakdown">{fmtMoney(foreignRowIncome(r))}</div>
            : <NumIn value={r.incomeArising ?? 0} onChange={v => upd(i, { incomeArising: v })} />)}
          {r.breakdown?.length
            ? <div className="input-base flex items-center justify-end bg-sky-50/70 py-1 text-[11.5px] font-semibold text-sky-700" title="From the itemised breakdown">{fmtMoney(foreignRowForeignTax(r))}</div>
            : <NumIn value={r.foreignTax ?? 0} onChange={v => upd(i, { foreignTax: v })} />}
          {full && (
            <div className="flex items-center gap-1">
              <NumIn value={r.specialWithholding ?? 0} onChange={v => upd(i, { specialWithholding: v })} />
              <Tooltip label={`Itemise this row's income${r.breakdown?.length ? ` (${r.breakdown.length})` : ''}`}>
                <button onClick={() => setItemise(i)} className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-white transition-colors ${r.breakdown?.length ? 'bg-lime-600' : 'bg-lime-500 hover:bg-lime-600'}`} aria-label="Itemise income"><Plus size={13} /></button>
              </Tooltip>
            </div>
          )}
          <input type="checkbox" checked={!!r.creditRelief} onChange={e => upd(i, { creditRelief: e.target.checked })} className="mx-auto h-3.5 w-3.5 accent-[var(--accent)]" aria-label="Claim FTCR" />
          <div className="rounded-md bg-sky-50/70 px-2 py-1 text-right text-[12px] font-semibold text-sky-700">{fmtMoney(foreignRowTaxable(r))}</div>
          <button onClick={() => del(i)} className="text-[var(--text-muted)] transition-colors hover:text-rose-500" aria-label="Remove country"><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={add} disabled={atMax} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:no-underline"><Plus size={13} /> Add country</button>
        {maxRows != null && <span className="text-[10.5px] text-[var(--text-muted)]">{rows.length} / {maxRows}{atMax ? ' — max reached' : ''}</span>}
      </div>
      {(totalBoxes || extra) && (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-black/5 pt-3 sm:grid-cols-3">
          {full && totalBoxes?.swt && <BoxCalc box={totalBoxes.swt} label="Total SWT (column above)" value={t.swt} />}
          {totalBoxes?.taxable && <BoxCalc box={totalBoxes.taxable} label="Total taxable (column above)" value={t.taxable} />}
          {fig && <BoxNum box={fig} label="Total claimed under the FIG regime" help={FGN.fig} value={figValue ?? 0} onChange={v => onFigChange?.(v)} />}
          {extra}
        </div>
      )}
      {itemise != null && rows[itemise] && (
        <BreakdownModal<ForeignIncomeItem>
          title={`${title} — income breakdown`}
          items={rows[itemise].breakdown ?? []}
          columns={breakdownCols}
          blank={() => ({ id: foreignRid((rows[itemise].breakdown ?? []).length) })}
          onChange={items => upd(itemise, { breakdown: items })}
          onClose={() => setItemise(null)}
        />
      )}
    </StudioCard>
  );
}

// Foreign land & property — a foreign SA105. Sub-tabs mirror Capium: Income &
// Expenses (14–18), Calculate Taxable P&L (19–24.2), Summary (per-country A–F),
// Total P&L (26/27/31/32). Multiple properties are summed into the section.
function ForeignPropertySection({ sa, set, subName }: { sa: Sa106; set: (u: Partial<Sa106>) => void; subName: string }) {
  const props = sa.properties ?? [];
  const setProps = (p: ForeignProperty[]) => set({ properties: p });
  const add = () => setProps([...props, { id: `fp-${props.length}-${Date.now()}` }]);
  const upd = (i: number, u: Partial<ForeignProperty>) => setProps(props.map((x, j) => j === i ? { ...x, ...u } : x));
  const del = (i: number) => setProps(props.filter((_, j) => j !== i));
  const totals = foreignPropertyTotals(sa);

  if (subName === 'Total P&L') {
    return (
      <StudioCard className="p-4"><BoxSection title="Total profit or loss">
        <BoxNum box={26} label="Total loss brought forward from earlier years" value={sa.propLossBroughtForward ?? 0} onChange={v => set({ propLossBroughtForward: v })} />
        <BoxCalc box={27} label="Total taxable profits (box 25 − box 26, if positive)" value={totals.taxableProfit} />
        <BoxNum box="30.1" label="Total claimed under the FIG regime" help={FGN.fig} value={sa.propFig ?? 0} onChange={v => set({ propFig: v })} />
        <BoxNum box={31} label="Loss set off against total income" value={sa.propLossSetOff ?? 0} onChange={v => set({ propLossSetOff: v })} />
        <BoxCalc box={32} label="Total loss to carry forward to the following year" value={totals.lossCf} />
      </BoxSection></StudioCard>
    );
  }
  return (
    <div className="space-y-3">
      {props.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--text-muted)]">No foreign properties yet — add one to enter the boxes.</p>}
      {props.map((p, i) => <ForeignPropertyCard key={p.id} p={p} idx={i} subName={subName} onChange={u => upd(i, u)} onRemove={() => del(i)} />)}
      <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add foreign property</button>
      {subName === 'Summary' && (
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-3 sm:grid-cols-4">
          <BoxCalc box={25} label="Total adjusted profit/loss" value={totals.adjusted} />
          <BoxCalc box={30} label="Total taxable amount" value={props.reduce((a, p) => a + Math.max(0, foreignPropertyAdjusted(p)), 0)} />
        </div>
      )}
    </div>
  );
}

// A number box with a green "+" that itemises it into a breakdown sub-table;
// when itemised the value is the breakdown total (read-only).
function ItemiseNumField({ box, label, help, itemised, value, onChange, onItemise, count }: {
  box: number | string; label: string; help?: string; itemised: boolean;
  value: number; onChange: (v: number) => void; onItemise: () => void; count?: number;
}) {
  return (
    <div>
      <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> {label}{count ? <span className="font-bold text-[var(--text-secondary)]"> ({count})</span> : null}{help && <HelpDot help={help} label={label} />}
      </label>
      <div className="flex items-center gap-1">
        {itemised
          ? <div className="input-base flex flex-1 items-center justify-end bg-sky-50/70 py-1 text-[12px] font-semibold text-sky-700" title="From itemised expenses">{fmtMoney(value)}</div>
          : <NumIn value={value} onChange={onChange} />}
        <Tooltip label="Itemise expenses"><button onClick={onItemise} className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-lime-500 text-white transition-colors hover:bg-lime-600" aria-label="Itemise expenses"><Plus size={13} /></button></Tooltip>
      </div>
    </div>
  );
}

function ForeignPropertyCard({ p, idx, subName, onChange, onRemove }: {
  p: ForeignProperty; idx: number; subName: string; onChange: (u: Partial<ForeignProperty>) => void; onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [expOpen, setExpOpen] = useState(false);
  const set = (u: Partial<ForeignProperty>) => onChange(u);
  const expItemised = !!p.expenseItems?.length;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} /></button>
        <CountrySelect value={p.country} onChange={v => set({ country: v })} className="flex-1 font-semibold" />
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]">Adjusted <span className="font-bold text-[var(--text-primary)]">{fmtMoney(foreignPropertyAdjusted(p))}</span></span>
        <RemoveBtn onClick={onRemove} />
      </div>
      {open && (
        <div className="space-y-3 border-t border-black/5 px-3 py-3">
          {subName === 'Income & Expenses' && (
            <BoxSection title="Income & expenses">
              <BoxNum box={14} label="Total rents & receipts" value={p.totalRents ?? 0} onChange={v => set({ totalRents: v })} />
              <BoxNum box="14.1" label="Property income allowance" help={FGN.propAllowance} value={p.propertyIncomeAllowance ?? 0} onChange={v => set({ propertyIncomeAllowance: v })} />
              <BoxCheck box="14.2" label="Traditional accounting" checked={!!p.traditionalAccounting} onChange={v => set({ traditionalAccounting: v })} />
              <BoxNum box={15} label="No. of let properties" value={p.letProperties ?? 0} onChange={v => set({ letProperties: v })} />
              <BoxNum box={16} label="Premiums paid" value={p.premiumsPaid ?? 0} onChange={v => set({ premiumsPaid: v })} />
              <ItemiseNumField box={17} label="Property expenses" itemised={expItemised} count={p.expenseItems?.length} value={foreignPropertyExpenses(p)} onChange={v => set({ expenses: v })} onItemise={() => setExpOpen(true)} />
              <BoxCalc box={18} label="Net profit or loss" value={foreignPropertyNet(p)} />
            </BoxSection>
          )}
          {subName === 'Calculate Taxable P&L' && (
            <BoxSection title="Calculate taxable profit or loss">
              <ItemiseNumField box={19} label="Private use adjustment" help={PROP.privateUse} itemised={expItemised} count={p.expenseItems?.length} value={foreignPropertyPrivateUse(p)} onChange={v => set({ privateUse: v })} onItemise={() => setExpOpen(true)} />
              <BoxNum box={20} label="Balancing charges" help={PROP.balancingCharges} value={p.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} />
              <BoxNum box={21} label="Capital allowances" value={p.capitalAllowances ?? 0} onChange={v => set({ capitalAllowances: v })} />
              <BoxNum box="21.1" label="Zero-emission car allowance" value={p.zeroEmissionCar ?? 0} onChange={v => set({ zeroEmissionCar: v })} />
              <BoxNum box="22.1" label="Structures and Buildings Allowance" value={p.sba ?? 0} onChange={v => set({ sba: v })} />
              <BoxNum box="22.2" label="Electric charge-point allowance" value={p.electricChargepoint ?? 0} onChange={v => set({ electricChargepoint: v })} />
              <BoxNum box={23} label="Costs of replacing domestic items" help={PROP.domesticItems} value={p.domesticItems ?? 0} onChange={v => set({ domesticItems: v })} />
              <BoxCalc box={24} label="Adjusted profit or loss" value={foreignPropertyAdjusted(p)} />
              <BoxNum box="24.1" label="Residential property finance costs" help={PROP.residentialFinanceCosts} value={p.residentialFinanceCosts ?? 0} onChange={v => set({ residentialFinanceCosts: v })} />
              <BoxNum box="24.2" label="Unused residential property finance costs brought forward" value={p.unusedFinanceCostsBfwd ?? 0} onChange={v => set({ unusedFinanceCostsBfwd: v })} />
            </BoxSection>
          )}
          {subName === 'Summary' && (
            <BoxSection title="Summary (per country)">
              <BoxCalc box="B" label="Adjusted profit or loss" value={foreignPropertyAdjusted(p)} />
              <BoxNum box="C" label="Foreign tax taken off or paid" value={p.foreignTax ?? 0} onChange={v => set({ foreignTax: v })} />
              <BoxNum box="D" label="UK tax taken off" value={p.ukTax ?? 0} onChange={v => set({ ukTax: v })} />
              <BoxCheck box="E" label="Claim credit relief" checked={!!p.creditRelief} onChange={v => set({ creditRelief: v })} />
              <BoxCalc box="F" label="Taxable amount" value={Math.max(0, foreignPropertyAdjusted(p))} />
            </BoxSection>
          )}
        </div>
      )}
      {expOpen && (
        <BreakdownModal<ForeignExpenseItem>
          title="Expenses"
          items={p.expenseItems ?? []}
          columns={FGN_EXPENSE_COLS}
          blank={() => ({ id: `fe-${Date.now()}-${Math.floor(Math.random() * 1000)}` })}
          onChange={items => set({ expenseItems: items })}
          onClose={() => setExpOpen(false)}
        />
      )}
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

// ── SA108 Capital gains summary — full box-for-box page (Capium layout) ───────
const SA108_TABS = ['Property and Assets', 'Shares and Securities', 'Losses and adjustments', 'Non-resident Capital Gains Tax', 'Any other information'] as const;
const SA108_SUBTABS: Record<string, string[]> = {
  'Property and Assets': ['Residential property (and carried interest)', 'Cryptoassets', 'Other property, assets and gains'],
  'Shares and Securities': ['Listed shares and securities', 'Unlisted shares and securities'],
  'Losses and adjustments': [],
  'Non-resident Capital Gains Tax': [],
  'Any other information': [],
};
const nz = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : !!v)).length;
function sa108Count(s: Sa108, key: string): number {
  switch (key) {
    case 'Residential property (and carried interest)': return nz([s.resiDisposals, s.resiProceeds, s.resiCosts, s.resiGains, s.resiFig, s.resiLosses, s.resiClaimCode, s.resiPptGains, s.resiPptTaxCharged, s.resiOverallGain, s.resiOverallTaxPaid, s.carriedInterestArising, s.carriedInterestAccruals, s.carriedInterestGains, s.carriedInterestFig]);
    case 'Cryptoassets': return nz([s.cryptoDisposals, s.cryptoProceeds, s.cryptoCosts, s.cryptoGains, s.cryptoLosses, s.cryptoClaimCode, s.cryptoRtt, s.cryptoRttTaxPaid]);
    case 'Other property, assets and gains': return nz([s.otherDisposals, s.otherProceeds, s.otherCosts, s.otherGains, s.otherFig, s.otherNonResiLand, s.otherBadrResiLand, s.otherBadrShares, s.otherBadrOther, s.otherLosses, s.otherClaimCode, s.otherRtt, s.otherRttTaxPaid]);
    case 'Listed shares and securities': return nz([s.listedDisposals, s.listedProceeds, s.listedCosts, s.listedGains, s.listedFig, s.listedLosses, s.listedClaimCode, s.listedRtt, s.listedRttTaxPaid]);
    case 'Unlisted shares and securities': return nz([s.unlistedDisposals, s.unlistedProceeds, s.unlistedCosts, s.unlistedGains, s.unlistedFig, s.unlistedLosses, s.unlistedClaimCode, s.unlistedRtt, s.unlistedRttTaxPaid, s.essExceedingLimit, s.seisReinvestment, s.lossesUsedAgainstIncome1, s.shareLossRelief1, s.lossesUsedAgainstIncome2, s.shareLossRelief2]);
    case 'Losses and adjustments': return nz([s.lossesBfUsed, s.incomeLossesSetAgainst, s.lossesCarriedForward, s.lossesUsedEarlierYear, s.erGainsPre2010, s.badrGains, s.badrLifetimeClaimed, s.cgtAdjustments, s.nonResTrustLiability]);
    case 'Non-resident Capital Gains Tax': return nz([s.nrcgtResiProperty, s.nrcgtNonResiProperty, s.nrcgtIndirect, s.nrcgtTaxCharged, s.nrcgtLosses, s.eisExcludedSecurities, s.eisExcludedFig, s.qahcGains, s.qahcGainsFig, s.qahcLosses]);
    case 'Any other information': return nz([s.estimatesOrValuations, s.otherInformation]);
  }
  return 0;
}

function Sa108Page({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const sa: Sa108 = income.sa108 ?? {};
  const set = (u: Partial<Sa108>) => setIncome(i => ({ ...i, sa108: { ...i.sa108, ...u } }));
  const [tab, setTab] = useState<string>('Property and Assets');
  const [sub, setSub] = useState(0);
  const [calcOpen, setCalcOpen] = useState(false);
  const calcState = income.cgtCalc ?? {};
  const calcCount = (calcState.disposals ?? []).length;
  // Autosave + auto-total: every calculator change writes cgtCalc AND recomputes
  // the SA108 boxes it manages, so the form always mirrors the working.
  const onCalcChange = (s: NonNullable<Sa100Income['cgtCalc']>) => setIncome(i => ({ ...i, cgtCalc: s, sa108: cgtCalcToSa108(s, i.sa108) }));
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (SA108_TABS as readonly string[]).includes(tab) ? tab : SA108_TABS[0];
  const subList = SA108_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  const legacy = (income.capitalGains?.disposals?.length ?? 0) > 0 || nz([income.capitalGains?.residentialGains, income.capitalGains?.otherGains, income.capitalGains?.losses]) > 0;
  return (
    <div className="space-y-3">
      {legacy && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">You have a legacy per-disposal capital-gains working (still used for the tax) below. Re-enter it box-for-box above to file from the SA108 page, then clear the old one.</p>}
      {/* CGT calculator — totals disposals onto the boxes below */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--accent)]/25 bg-[var(--accent)]/[0.03] px-3 py-2">
        <p className="text-[11.5px] text-[var(--text-secondary)]"><span className="font-semibold text-[var(--text-primary)]">Capital gains calculator</span> — record each disposal, suggest reliefs, allocate losses, and auto-total onto the SA108 boxes.{calcCount > 0 && <span className="text-[var(--text-muted)]"> ({calcCount} disposal{calcCount === 1 ? '' : 's'})</span>}</p>
        <button onClick={() => setCalcOpen(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"><Calculator size={14} /> {calcCount > 0 ? 'Open calculator' : 'Open calculator'}</button>
      </div>
      {calcOpen && <CgtCalculator state={calcState} taxYear={ret.taxYear} taxpayerName={ret.clientName ?? 'You'} returnType={ret.returnType} onChange={onCalcChange} onClose={() => setCalcOpen(false)} />}
      <SectionTabs tabs={SA108_TABS.map(tt => ({ label: tt, count: (SA108_SUBTABS[tt] ?? []).length === 0 ? sa108Count(sa, tt) : 0 }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(st => ({ label: st, count: sa108Count(sa, st) }))} active={sub} onSelect={setSub} />}

      {/* ── Property and Assets ── */}
      {subName === 'Residential property (and carried interest)' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Residential property">
            <BoxNum box={3} label="Number of disposals" help={CGT.disposals} value={sa.resiDisposals ?? 0} onChange={v => set({ resiDisposals: v })} />
            <BoxNum box={4} label="Disposal proceeds" help={CGT.proceeds} value={sa.resiProceeds ?? 0} onChange={v => set({ resiProceeds: v })} />
            <BoxNum box={5} label="Allowable costs (including purchase price)" help={CGT.costs} value={sa.resiCosts ?? 0} onChange={v => set({ resiCosts: v })} />
            <BoxNum box={6} label="Gains in the year, before losses (excl. carried interest)" help={CGT.gains} value={sa.resiGains ?? 0} onChange={v => set({ resiGains: v })} />
            <BoxNum box="6.1" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.resiFig ?? 0} onChange={v => set({ resiFig: v })} />
            <BoxNum box={7} label="Losses in the year" help={CGT.losses} value={sa.resiLosses ?? 0} onChange={v => set({ resiLosses: v })} />
            <BoxText box={8} label="Claim or election code" help={CGT.claimCode} value={sa.resiClaimCode ?? ''} onChange={v => set({ resiClaimCode: v })} />
            <BoxNum box={9} label="Total gains/losses on UK residential property reported on CGT UK Property Disposal returns" help={CGT.pptGains} value={sa.resiPptGains ?? 0} onChange={v => set({ resiPptGains: v })} />
            <BoxNum box={10} label="Tax on gains in box 9 already charged" help={CGT.pptTaxCharged} value={sa.resiPptTaxCharged ?? 0} onChange={v => set({ resiPptTaxCharged: v })} />
            <BoxNum box={11} label="Overall gain or loss" value={sa.resiOverallGain ?? 0} onChange={v => set({ resiOverallGain: v })} />
            <BoxNum box={12} label="Tax on gains in box 11 already paid" value={sa.resiOverallTaxPaid ?? 0} onChange={v => set({ resiOverallTaxPaid: v })} />
          </BoxSection>
          <BoxSection title="Carried interest">
            <BoxNum box={13} label="Carried interest (arising basis) — before any claim or election" help={CGT.carriedInterest} value={sa.carriedInterestArising ?? 0} onChange={v => set({ carriedInterestArising: v })} />
            <BoxNum box="13A" label="Carried interest (accruals basis) — before any claim or election" help={CGT.carriedInterest} value={sa.carriedInterestAccruals ?? 0} onChange={v => set({ carriedInterestAccruals: v })} />
            <BoxNum box="13B" label="Gains on carried interest in the year (CGT13 + CGT13A, less claim/election)" value={sa.carriedInterestGains ?? 0} onChange={v => set({ carriedInterestGains: v })} />
            <BoxNum box="13C" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.carriedInterestFig ?? 0} onChange={v => set({ carriedInterestFig: v })} />
          </BoxSection>
        </StudioCard>
      )}
      {subName === 'Cryptoassets' && (
        <StudioCard className="p-4"><BoxSection title="Cryptoassets">
          <BoxNum box="13.1" label="Number of disposals" help={CGT.disposals} value={sa.cryptoDisposals ?? 0} onChange={v => set({ cryptoDisposals: v })} />
          <BoxNum box="13.2" label="Disposal proceeds" help={CGT.proceeds} value={sa.cryptoProceeds ?? 0} onChange={v => set({ cryptoProceeds: v })} />
          <BoxNum box="13.3" label="Allowable costs" help={CGT.costs} value={sa.cryptoCosts ?? 0} onChange={v => set({ cryptoCosts: v })} />
          <BoxNum box="13.4" label="Gains in the year, before losses" help={CGT.gains} value={sa.cryptoGains ?? 0} onChange={v => set({ cryptoGains: v })} />
          <BoxNum box="13.5" label="Losses in the year" help={CGT.losses} value={sa.cryptoLosses ?? 0} onChange={v => set({ cryptoLosses: v })} />
          <BoxText box="13.6" label="Claim or election code" help={CGT.claimCode} value={sa.cryptoClaimCode ?? ''} onChange={v => set({ cryptoClaimCode: v })} />
          <BoxNum box="13.7" label="Total gains/losses on this asset type reported on Real Time Transaction returns" help={CGT.rtt} value={sa.cryptoRtt ?? 0} onChange={v => set({ cryptoRtt: v })} />
          <BoxNum box="13.8" label="Tax on gains in box 13.7 already paid" help={CGT.rttTaxPaid} value={sa.cryptoRttTaxPaid ?? 0} onChange={v => set({ cryptoRttTaxPaid: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Other property, assets and gains' && (
        <StudioCard className="p-4"><BoxSection title="Other property, assets and gains">
          <BoxNum box={14} label="Number of disposals" help={CGT.disposals} value={sa.otherDisposals ?? 0} onChange={v => set({ otherDisposals: v })} />
          <BoxNum box={15} label="Disposal proceeds" help={CGT.proceeds} value={sa.otherProceeds ?? 0} onChange={v => set({ otherProceeds: v })} />
          <BoxNum box={16} label="Allowable costs" help={CGT.costs} value={sa.otherCosts ?? 0} onChange={v => set({ otherCosts: v })} />
          <BoxNum box={17} label="Gains in the year, before losses" help={CGT.gains} value={sa.otherGains ?? 0} onChange={v => set({ otherGains: v })} />
          <BoxNum box="17.0" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.otherFig ?? 0} onChange={v => set({ otherFig: v })} />
          <BoxNum box="17.1" label="Amount in CGT17 re non-residential land and buildings" value={sa.otherNonResiLand ?? 0} onChange={v => set({ otherNonResiLand: v })} />
          <BoxNum box="17.2" label="Amount in box 17 re resi/non-resi land where BADR is claimed" help={CGT.badrSplit} value={sa.otherBadrResiLand ?? 0} onChange={v => set({ otherBadrResiLand: v })} />
          <BoxNum box="17.3" label="Amount in box 17 re listed/unlisted shares where BADR is claimed" help={CGT.badrSplit} value={sa.otherBadrShares ?? 0} onChange={v => set({ otherBadrShares: v })} />
          <BoxNum box="17.4" label="Amount in box 17 re other assets where BADR is claimed" help={CGT.badrSplit} value={sa.otherBadrOther ?? 0} onChange={v => set({ otherBadrOther: v })} />
          <BoxNum box={19} label="Losses in the year" help={CGT.losses} value={sa.otherLosses ?? 0} onChange={v => set({ otherLosses: v })} />
          <BoxText box={20} label="Claim or election code" help={CGT.claimCode} value={sa.otherClaimCode ?? ''} onChange={v => set({ otherClaimCode: v })} />
          <BoxNum box={21} label="Total gains/losses on this asset type reported on Real Time Transaction returns" help={CGT.rtt} value={sa.otherRtt ?? 0} onChange={v => set({ otherRtt: v })} />
          <BoxNum box={22} label="Tax on gains in box 21 already paid" help={CGT.rttTaxPaid} value={sa.otherRttTaxPaid ?? 0} onChange={v => set({ otherRttTaxPaid: v })} />
        </BoxSection></StudioCard>
      )}

      {/* ── Shares and Securities ── */}
      {subName === 'Listed shares and securities' && (
        <StudioCard className="p-4"><BoxSection title="Listed shares and securities">
          <BoxNum box={23} label="Number of disposals" help={CGT.disposals} value={sa.listedDisposals ?? 0} onChange={v => set({ listedDisposals: v })} />
          <BoxNum box={24} label="Disposal proceeds" help={CGT.proceeds} value={sa.listedProceeds ?? 0} onChange={v => set({ listedProceeds: v })} />
          <BoxNum box={25} label="Allowable costs" help={CGT.costs} value={sa.listedCosts ?? 0} onChange={v => set({ listedCosts: v })} />
          <BoxNum box={26} label="Gains in the year, before losses" help={CGT.gains} value={sa.listedGains ?? 0} onChange={v => set({ listedGains: v })} />
          <BoxNum box="26.1" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.listedFig ?? 0} onChange={v => set({ listedFig: v })} />
          <BoxNum box={27} label="Losses in the year" help={CGT.losses} value={sa.listedLosses ?? 0} onChange={v => set({ listedLosses: v })} />
          <BoxText box={28} label="Claim or election code" help={CGT.claimCode} value={sa.listedClaimCode ?? ''} onChange={v => set({ listedClaimCode: v })} />
          <BoxNum box={29} label="Total gains/losses on this asset type reported on Real Time Transaction returns" help={CGT.rtt} value={sa.listedRtt ?? 0} onChange={v => set({ listedRtt: v })} />
          <BoxNum box={30} label="Tax on gains in box 29 already paid" help={CGT.rttTaxPaid} value={sa.listedRttTaxPaid ?? 0} onChange={v => set({ listedRttTaxPaid: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Unlisted shares and securities' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Unlisted shares and securities">
            <BoxNum box={31} label="Number of disposals" help={CGT.disposals} value={sa.unlistedDisposals ?? 0} onChange={v => set({ unlistedDisposals: v })} />
            <BoxNum box={32} label="Disposal proceeds" help={CGT.proceeds} value={sa.unlistedProceeds ?? 0} onChange={v => set({ unlistedProceeds: v })} />
            <BoxNum box={33} label="Allowable costs" help={CGT.costs} value={sa.unlistedCosts ?? 0} onChange={v => set({ unlistedCosts: v })} />
            <BoxNum box={34} label="Gains in the year, before losses" help={CGT.gains} value={sa.unlistedGains ?? 0} onChange={v => set({ unlistedGains: v })} />
            <BoxNum box="34.1" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.unlistedFig ?? 0} onChange={v => set({ unlistedFig: v })} />
            <BoxNum box={35} label="Losses in the year" help={CGT.losses} value={sa.unlistedLosses ?? 0} onChange={v => set({ unlistedLosses: v })} />
            <BoxText box={36} label="Claim or election code" help={CGT.claimCode} value={sa.unlistedClaimCode ?? ''} onChange={v => set({ unlistedClaimCode: v })} />
            <BoxNum box={37} label="Total gains/losses on this asset type reported on Real Time Transaction returns" help={CGT.rtt} value={sa.unlistedRtt ?? 0} onChange={v => set({ unlistedRtt: v })} />
            <BoxNum box={38} label="Tax on gains in box 37 already paid" help={CGT.rttTaxPaid} value={sa.unlistedRttTaxPaid ?? 0} onChange={v => set({ unlistedRttTaxPaid: v })} />
          </BoxSection>
          <BoxSection title="Reliefs & losses against income">
            <BoxNum box={39} label="Gains exceeding the lifetime limit for Employee Shareholder Status shares" help={CGT.essLimit} value={sa.essExceedingLimit ?? 0} onChange={v => set({ essExceedingLimit: v })} />
            <BoxNum box={40} label="Gains invested under SEIS and qualifying for relief" help={CGT.seis} value={sa.seisReinvestment ?? 0} onChange={v => set({ seisReinvestment: v })} />
            <BoxNum box={41} label="Losses used against income" value={sa.lossesUsedAgainstIncome1 ?? 0} onChange={v => set({ lossesUsedAgainstIncome1: v })} />
            <BoxNum box={42} label="Amount in box 41 relating to Share Loss Relief in year" help={CGT.shareLossRelief} value={sa.shareLossRelief1 ?? 0} onChange={v => set({ shareLossRelief1: v })} />
            <BoxNum box={43} label="Losses used against income" value={sa.lossesUsedAgainstIncome2 ?? 0} onChange={v => set({ lossesUsedAgainstIncome2: v })} />
            <BoxNum box={44} label="Amount in box 43 relating to Share Loss Relief in year" help={CGT.shareLossRelief} value={sa.shareLossRelief2 ?? 0} onChange={v => set({ shareLossRelief2: v })} />
          </BoxSection>
        </StudioCard>
      )}

      {/* ── Losses and adjustments ── */}
      {activeTab === 'Losses and adjustments' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Losses set against capital gains">
            <BoxNum box={45} label="Losses brought forward and used in-year" help={CGT.lossesBf} value={sa.lossesBfUsed ?? 0} onChange={v => set({ lossesBfUsed: v })} />
            <BoxNum box={46} label="Income losses in-year set against gains" help={CGT.incomeLosses} value={sa.incomeLossesSetAgainst ?? 0} onChange={v => set({ incomeLossesSetAgainst: v })} />
          </BoxSection>
          <BoxSection title="Capital losses — other information">
            <BoxNum box={47} label="Losses available to be carried forward" help={CGT.lossesCf} value={sa.lossesCarriedForward ?? 0} onChange={v => set({ lossesCarriedForward: v })} />
            <BoxNum box={48} label="Losses used against an earlier year's gain" value={sa.lossesUsedEarlierYear ?? 0} onChange={v => set({ lossesUsedEarlierYear: v })} />
          </BoxSection>
          <BoxSection title="Investors' Relief and Business Asset Disposal Relief (previously 'Entrepreneurs' Relief')">
            <BoxNum box={49} label="Gains qualifying for Investors' Relief" value={sa.erGainsPre2010 ?? 0} onChange={v => set({ erGainsPre2010: v })} />
            <BoxNum box={50} label="Gains qualifying for Business Asset Disposal Relief" help={CGT.badr} value={sa.badrGains ?? 0} onChange={v => set({ badrGains: v })} />
            <BoxNum box="50.1" label="Lifetime allowance of BADR and Entrepreneurs' Relief claimed to date" help={CGT.badrLifetime} value={sa.badrLifetimeClaimed ?? 0} onChange={v => set({ badrLifetimeClaimed: v })} />
          </BoxSection>
          <BoxSection title="Tax adjustments to 2025-26 capital gains">
            <BoxNum box={51} label="Adjustments to Capital Gains Tax" help={CGT.adjustments} value={sa.cgtAdjustments ?? 0} onChange={v => set({ cgtAdjustments: v })} />
            <BoxNum box={52} label="Additional liability for non-resident or dual resident trusts" value={sa.nonResTrustLiability ?? 0} onChange={v => set({ nonResTrustLiability: v })} />
          </BoxSection>
        </StudioCard>
      )}

      {/* ── Non-resident Capital Gains Tax ── */}
      {activeTab === 'Non-resident Capital Gains Tax' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Non-resident Capital Gains Tax (NRCGT) on UK property">
            <BoxNum box="52.1" label="Disposals of UK residential property" help={CGT.nrcgt} value={sa.nrcgtResiProperty ?? 0} onChange={v => set({ nrcgtResiProperty: v })} />
            <BoxNum box="52.2" label="Direct disposals of non-residential UK properties" help={CGT.nrcgt} value={sa.nrcgtNonResiProperty ?? 0} onChange={v => set({ nrcgtNonResiProperty: v })} />
            <BoxCheck box="52.3" label="Any gains from indirect disposals?" help={CGT.nrcgtIndirect} checked={!!sa.nrcgtIndirect} onChange={v => set({ nrcgtIndirect: v })} />
            <BoxNum box="52.4" label="Tax on gains in boxes 52.1 and 52.2 already charged" value={sa.nrcgtTaxCharged ?? 0} onChange={v => set({ nrcgtTaxCharged: v })} />
            <BoxNum box="52.5" label="Total losses available against NRCGT gains for the year" value={sa.nrcgtLosses ?? 0} onChange={v => set({ nrcgtLosses: v })} />
          </BoxSection>
          <BoxSection title="EIS and QAHC">
            <BoxNum box="52EG" label="Total gains from the disposal of excluded indexed securities" help={CGT.eisExcluded} value={sa.eisExcludedSecurities ?? 0} onChange={v => set({ eisExcludedSecurities: v })} />
            <BoxNum box="52EG.1" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.eisExcludedFig ?? 0} onChange={v => set({ eisExcludedFig: v })} />
            <BoxNum box="52QG" label="Total gains from QAHC share repurchases and security redemptions" help={CGT.qahc} value={sa.qahcGains ?? 0} onChange={v => set({ qahcGains: v })} />
            <BoxNum box="52QG.1" label="Amount claimed under the FIG regime" help={CGT.fig} value={sa.qahcGainsFig ?? 0} onChange={v => set({ qahcGainsFig: v })} />
            <BoxNum box="52QL" label="Total losses from QAHC share repurchases and security redemptions" help={CGT.qahc} value={sa.qahcLosses ?? 0} onChange={v => set({ qahcLosses: v })} />
          </BoxSection>
        </StudioCard>
      )}

      {/* ── Any other information ── */}
      {activeTab === 'Any other information' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Any other information">
            <BoxCheck box={53} label="Do the computations include any estimates or valuations?" help={CGT.estimates} checked={!!sa.estimatesOrValuations} onChange={v => set({ estimatesOrValuations: v })} />
          </BoxSection>
          <div>
            <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]"><span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">54</span> Additional text note for Tax Return</label>
            <textarea value={sa.otherInformation ?? ''} onChange={e => set({ otherInformation: e.target.value })} rows={3} className="input-base w-full py-1.5 text-[12.5px]" placeholder="Any other information for the Tax Return" />
          </div>
        </StudioCard>
      )}

      {legacy && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Legacy working (per-disposal)</p>
          <CapitalGainsPage income={income} setIncome={setIncome} />
        </div>
      )}
    </div>
  );
}

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

// ── SA109 Residence, FIG regime & remittance basis — full box-for-box page ────
const SA109_TABS = [
  'Residence status',
  'Personal allowances and domicile',
  'Foreign income and gains (FIG) regime & Remittance Basis',
  'Overseas Workday Relief & Temporary repatriation facility',
  'Any other information',
] as const;
const SA109_SUBTABS: Record<string, string[]> = {
  'Personal allowances and domicile': ['Personal allowances', 'Residence in other countries', 'Foreign income and gains (FIG) regime'],
};
const sa109Cid = () => `s109c-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const SA109_COMPANY_COLS: BreakdownColumn<Sa109Company>[] = [
  { key: 'companyNumber', label: 'Company number', kind: 'text' },
  { key: 'companyName', label: 'Company name', kind: 'text' },
  { key: 'amountInvested', label: 'Amount invested', kind: 'number', total: true },
];

// Count populated boxes — overall (no tab) or for one top tab (drives the (N) badges).
function sa109Count(sa: Sa109, tab?: string): number {
  const f = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!(v && String(v).trim()))).length;
  const status = () => f([sa.notResident, sa.splitYear, sa.splitYearMultiple, sa.residentLastYear, sa.splitYearDate, sa.thirdAutoOverseasTest, sa.gapBetweenEmployments, sa.homeOverseas, sa.daysInUk, sa.daysExceptional, sa.daysTransit, sa.ukTies, sa.workdaysUk, sa.workdaysOverseas]);
  const allowances = () => f([sa.paUnderDta, sa.paOtherBasis, sa.nationalResidentCountries, sa.residentCountryCodes, sa.residentCountryCodesPrior, sa.dtaIncomeReliefAmount, sa.dtaReliefResidence, sa.dtaReliefOther, sa.figArrivalDate, sa.figPriorResidentYear]);
  const figRemit = () => f([sa.figIncomeClaim, sa.figGainsClaim, sa.qahcDeemedForeign, sa.remittedNominated, sa.investmentNoLongerQualifies]) + (sa.figForeignIncomeReliefCompanies?.length ?? 0);
  const owrTrf = () => f([sa.owrElection, sa.owrClaim, sa.owrTransitional, sa.owrQualifyingEmpIncome, sa.owrQualifyingForeignEmpIncome, sa.owrMaxRelief, sa.owrClaimedOnEmpIncome, sa.owrTotalRelief, sa.trfElection, sa.trfPersonalDesignations, sa.trfTrustPayments, sa.trfRemitted]);
  const other = () => f([sa.otherInformation]);
  switch (tab) {
    case 'Residence status': return status();
    case 'Personal allowances and domicile': return allowances();
    case 'Foreign income and gains (FIG) regime & Remittance Basis': return figRemit();
    case 'Overseas Workday Relief & Temporary repatriation facility': return owrTrf();
    case 'Any other information': return other();
    default: return status() + allowances() + figRemit() + owrTrf() + other();
  }
}
// Per-sub-tab count for the SA109 "Personal allowances and domicile" tab.
function sa109SubCount(sa: Sa109, sub: string): number {
  const f = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!(v && String(v).trim()))).length;
  switch (sub) {
    case 'Personal allowances': return f([sa.paUnderDta, sa.paOtherBasis, sa.nationalResidentCountries]);
    case 'Residence in other countries': return f([sa.residentCountryCodes, sa.residentCountryCodesPrior, sa.dtaIncomeReliefAmount, sa.dtaReliefResidence, sa.dtaReliefOther]);
    case 'Foreign income and gains (FIG) regime': return f([sa.figArrivalDate, sa.figPriorResidentYear]);
  }
  return 0;
}

// A free-text box with a box chip (multi-line) — matches BoxText's chrome.
function BoxTextArea({ box, label, value, onChange, rows = 3, placeholder, right }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; right?: ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="input-base w-full py-1 text-[12.5px]" />
    </div>
  );
}

// A day-count box (SA109 boxes 10/11/11.1/13/14) with a "count the days" helper —
// enter one or more date ranges and SMITH totals the (inclusive) days for you.
function DayNum({ box, label, value, onChange, help }: { box?: number | string; label: string; value: number; onChange: (v: number) => void; help?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
        <button onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20"><Calculator size={10} /> Count days</button>
      </div>
      <input type="number" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)} className="input-base py-1 text-right text-[12.5px]" />
      {open && <DaysCalcModal current={value || 0} label={label} onApply={v => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </div>
  );
}

// Inclusive day count between two ISO dates (or 0 if incomplete/invalid).
function inclusiveDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

function DaysCalcModal({ current, label, onApply, onClose }: { current: number; label: string; onApply: (v: number) => void; onClose: () => void }) {
  const [ranges, setRanges] = useState<{ id: string; from: string; to: string }[]>([{ id: 'r0', from: '', to: '' }]);
  const total = ranges.reduce((a, r) => a + inclusiveDays(r.from, r.to), 0);
  const upd = (id: string, u: Partial<{ from: string; to: string }>) => setRanges(rs => rs.map(r => (r.id === id ? { ...r, ...u } : r)));
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="text-[14px] font-bold text-[var(--text-primary)]">Count the days — {label}</p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <div className="px-5 py-4">
          <p className="mb-2 text-[11px] text-[var(--text-muted)]">Add each trip / period as a date range — SMITH counts the days (inclusive of both dates) and totals them.</p>
          <div className="space-y-2">
            {ranges.map(r => (
              <div key={r.id} className="flex items-center gap-2">
                <input type="date" value={r.from} onChange={e => upd(r.id, { from: e.target.value })} className="input-base flex-1 py-1 text-[12px]" aria-label="From" />
                <span className="text-[11px] text-[var(--text-muted)]">to</span>
                <input type="date" value={r.to} onChange={e => upd(r.id, { to: e.target.value })} className="input-base flex-1 py-1 text-[12px]" aria-label="To" />
                <span className="w-14 shrink-0 text-right text-[12px] font-semibold text-[var(--text-primary)]">{inclusiveDays(r.from, r.to)}d</span>
                {ranges.length > 1 && <button onClick={() => setRanges(rs => rs.filter(x => x.id !== r.id))} className="text-[var(--text-muted)] hover:text-rose-500"><Trash2 size={13} /></button>}
              </div>
            ))}
          </div>
          <button onClick={() => setRanges(rs => [...rs, { id: `r${Date.now()}`, from: '', to: '' }])} className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)]"><Plus size={12} /> Add another period</button>
          <div className="mt-3 flex items-center justify-between rounded-lg bg-[var(--accent)]/[0.06] px-3 py-2">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">Total days</span>
            <span className="text-[15px] font-extrabold text-[var(--text-primary)]">{total}</span>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-black/5 px-5 py-3">
          {current > 0 && <button onClick={() => onApply(current + total)} className="btn-secondary">Add to current ({current})</button>}
          <button onClick={() => onApply(total)} disabled={total === 0} className="btn-primary disabled:opacity-40"><Check size={14} /> Use {total} days</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Sa109Page({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const sa: Sa109 = income.residence ?? {};
  const set = (u: Partial<Sa109>) => setIncome(i => ({ ...i, residence: { ...i.residence, ...u } }));
  const [tab, setTab] = useState<string>(SA109_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (SA109_TABS as readonly string[]).includes(tab) ? tab : SA109_TABS[0];
  const subList = SA109_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', residence: sa }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: sa.otherInformation ? `${sa.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={SA109_TABS.map(tt => ({ label: tt, count: sa109Count(sa, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(ss => ({ label: ss, count: sa109SubCount(sa, ss) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Residence status' && (
        <div className="space-y-3">
          <SectionTitle title="Residence status" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={1} label="Not resident in the UK?" checked={!!sa.notResident} onChange={v => set({ notResident: v, status: v ? 'non-resident' : (sa.splitYear ? 'split-year' : 'resident') })} help={RES.notResident} />
            <BoxCheck box={3} label="Requesting split-year treatment?" checked={!!sa.splitYear} onChange={v => set({ splitYear: v, status: v ? 'split-year' : (sa.notResident ? 'non-resident' : 'resident') })} help={RES.splitYear} />
            <BoxCheck box="3.1" label="Does more than one case of split-year treatment apply?" checked={!!sa.splitYearMultiple} onChange={v => set({ splitYearMultiple: v })} help={RES.splitYearMultiple} />
            <BoxCheck box={4} label="Resident in the UK last year?" checked={!!sa.residentLastYear} onChange={v => set({ residentLastYear: v })} help={RES.residentLastYear} />
            <BoxText box={6} label="Date from which the UK part of the split year begins or ends" value={sa.splitYearDate ?? ''} onChange={v => set({ splitYearDate: v })} placeholder="dd-mm-yyyy" help={RES.splitYearDate} />
            <BoxCheck box={7} label="Meets the third automatic overseas test?" checked={!!sa.thirdAutoOverseasTest} onChange={v => set({ thirdAutoOverseasTest: v })} help={RES.thirdAutoOverseasTest} />
            <BoxCheck box={8} label="Had a gap between employments in the year?" checked={!!sa.gapBetweenEmployments} onChange={v => set({ gapBetweenEmployments: v })} help={RES.gapBetweenEmployments} />
            <BoxCheck box={9} label="Has a home overseas?" checked={!!sa.homeOverseas} onChange={v => set({ homeOverseas: v })} help={RES.homeOverseas} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DayNum box={10} label="Days spent in the UK during the year" value={sa.daysInUk ?? 0} onChange={v => set({ daysInUk: v })} help={RES.daysInUk} />
            <DayNum box={11} label="Days attributed to exceptional circumstances" value={sa.daysExceptional ?? 0} onChange={v => set({ daysExceptional: v })} help={RES.daysExceptional} />
            <DayNum box="11.1" label="Days in the UK at midnight but in transit" value={sa.daysTransit ?? 0} onChange={v => set({ daysTransit: v })} help={RES.daysTransit} />
            <LabelledNum box={12} label="Number of ties to the UK" value={sa.ukTies ?? 0} onChange={v => set({ ukTies: v })} help={RES.ukTies} />
            <DayNum box={13} label="Workdays in the UK" value={sa.workdaysUk ?? 0} onChange={v => set({ workdaysUk: v })} help={RES.workdaysUk} />
            <DayNum box={14} label="Workdays overseas" value={sa.workdaysOverseas ?? 0} onChange={v => set({ workdaysOverseas: v })} help={RES.workdaysOverseas} />
          </div>
        </div>
      )}

      {activeTab === 'Personal allowances and domicile' && subName === 'Personal allowances' && (
        <div className="space-y-3">
          <SectionTitle title="Personal allowances for non-residents and dual residents" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={15} label="Claiming personal allowances under the terms of a DTA?" checked={!!sa.paUnderDta} onChange={v => set({ paUnderDta: v })} help={RES.paUnderDta} />
            <BoxCheck box={16} label="Claiming personal allowances on some other basis?" checked={!!sa.paOtherBasis} onChange={v => set({ paOtherBasis: v })} help={RES.paOtherBasis} />
          </div>
          <CountryCodeList box={17} label="Countries of which you are a national and/or resident" value={sa.nationalResidentCountries ?? ''} onChange={v => set({ nationalResidentCountries: v })} help={RES.nationalResidentCountries} note="Pick each country — SMITH stores its 3-letter HMRC code." />
        </div>
      )}
      {activeTab === 'Personal allowances and domicile' && subName === 'Residence in other countries' && (
        <div className="space-y-3">
          <SectionTitle title="Residence in other countries" />
          <CountryCodeList box={18} label="Countries in which you were resident for tax purposes this year (other than the UK)" value={sa.residentCountryCodes ?? ''} onChange={v => set({ residentCountryCodes: v })} help={RES.residentCountryCodes} />
          <CountryCodeList box={19} label="If also resident in either/both of those countries for the prior year, enter them" value={sa.residentCountryCodesPrior ?? ''} onChange={v => set({ residentCountryCodesPrior: v })} help={RES.residentCountryCodesPrior} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LabelledNum box={20} label="Amount of DTA income on which relief is claimed" value={sa.dtaIncomeReliefAmount ?? 0} onChange={v => set({ dtaIncomeReliefAmount: v })} help={RES.dtaIncomeReliefAmount} />
            <LabelledNum box={21} label="Relief claimed under a DTA for residence in another country" value={sa.dtaReliefResidence ?? 0} onChange={v => set({ dtaReliefResidence: v })} help={RES.dtaReliefResidence} />
            <LabelledNum box={22} label="Relief claimed under other provisions of a DTA" value={sa.dtaReliefOther ?? 0} onChange={v => set({ dtaReliefOther: v })} help={RES.dtaReliefOther} />
          </div>
        </div>
      )}
      {activeTab === 'Personal allowances and domicile' && subName === 'Foreign income and gains (FIG) regime' && (
        <div className="space-y-3">
          <SectionTitle title="Foreign income and gains (FIG) regime" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxText box={23} label="Date of arrival in the UK" value={sa.figArrivalDate ?? ''} onChange={v => set({ figArrivalDate: v })} placeholder="dd-mm-yyyy" help={RES.figArrivalDate} />
            <BoxText box={24} label="If UK resident in a tax year before your most recent arrival, enter that year" value={sa.figPriorResidentYear ?? ''} onChange={v => set({ figPriorResidentYear: v })} placeholder="e.g. 2021-22" help={RES.figPriorResidentYear} />
          </div>
        </div>
      )}

      {activeTab === 'Foreign income and gains (FIG) regime & Remittance Basis' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <SectionTitle title="Foreign income and gains (FIG) regime" />
            <div className="grid grid-cols-1 gap-2">
              <BoxCheck box={28} label="Making a claim for relief on foreign income under the FIG regime" checked={!!sa.figIncomeClaim} onChange={v => set({ figIncomeClaim: v })} help={RES.figIncomeClaim} />
              <BoxCheck box={29} label="Making a claim for relief on foreign gains under the FIG regime" checked={!!sa.figGainsClaim} onChange={v => set({ figGainsClaim: v })} help={RES.figGainsClaim} />
              <BoxCheck box={30} label="UK income or gains deemed to be foreign under qualifying asset holding company (QAHC) rules" checked={!!sa.qahcDeemedForeign} onChange={v => set({ qahcDeemedForeign: v })} help={RES.qahcDeemedForeign} />
            </div>
            {(sa.figIncomeClaim || sa.figGainsClaim) && <p className="text-[10.5px] text-amber-700">Claiming FIG relief withdraws the personal allowance and the CGT annual exempt amount — reflected in the tax computation.</p>}
          </div>
          <div className="space-y-2">
            <SectionTitle title="Remittance basis" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <BoxCheck box={37} label="Remitted any nominated income or gains this year?" checked={!!sa.remittedNominated} onChange={v => set({ remittedNominated: v })} help={RES.remittedNominated} />
              <BoxCheck box={39} label="The investment no longer qualifies for relief?" checked={!!sa.investmentNoLongerQualifies} onChange={v => set({ investmentNoLongerQualifies: v })} help={RES.investmentNoLongerQualifies} />
            </div>
            <BreakdownField box={38} label="Claiming relief for foreign income (companies invested in)" title="Claiming relief for foreign income"
              items={sa.figForeignIncomeReliefCompanies ?? []} columns={SA109_COMPANY_COLS}
              blank={() => ({ id: sa109Cid() })} onChange={items => set({ figForeignIncomeReliefCompanies: items })}
              rowTotal={c => c.amountInvested || 0} help={RES.figCompanies} />
          </div>
        </div>
      )}

      {activeTab === 'Overseas Workday Relief & Temporary repatriation facility' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <SectionTitle title="Overseas Workday Relief (OWR)" />
            <div className="grid grid-cols-1 gap-2">
              <BoxCheck box={40} label="Making an election for Overseas Workday Relief" checked={!!sa.owrElection} onChange={v => set({ owrElection: v })} help={RES.owrElection} />
              <BoxCheck box={41} label="Making a claim for Overseas Workday Relief" checked={!!sa.owrClaim} onChange={v => set({ owrClaim: v })} help={RES.owrClaim} />
              <BoxCheck box={43} label="Qualify for the OWR transitional provisions for any year claimed" checked={!!sa.owrTransitional} onChange={v => set({ owrTransitional: v })} help={RES.owrTransitional} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <LabelledNum box={44} label="Qualifying employment income after deductions" value={sa.owrQualifyingEmpIncome ?? 0} onChange={v => set({ owrQualifyingEmpIncome: v })} help={RES.owrQualifyingEmpIncome} />
              <LabelledNum box={46} label="Qualifying foreign employment income after deductions" value={sa.owrQualifyingForeignEmpIncome ?? 0} onChange={v => set({ owrQualifyingForeignEmpIncome: v })} help={RES.owrQualifyingForeignEmpIncome} />
              <LabelledNum box={47} label="Maximum relief available under the financial limit" value={sa.owrMaxRelief ?? 0} onChange={v => set({ owrMaxRelief: v })} help={RES.owrMaxRelief} />
              <LabelledNum box={48} label="OWR claimed on the qualifying employment income" value={sa.owrClaimedOnEmpIncome ?? 0} onChange={v => set({ owrClaimedOnEmpIncome: v })} help={RES.owrClaimedOnEmpIncome} />
              <LabelledNum box={49} label="Total amount of OWR relief claimed for the year" value={sa.owrTotalRelief ?? 0} onChange={v => set({ owrTotalRelief: v })} help={RES.owrTotalRelief} />
            </div>
          </div>
          <div className="space-y-2">
            <SectionTitle title="Temporary repatriation facility (TRF)" />
            <div className="grid grid-cols-1 gap-2"><BoxCheck box={50} label="Making an election under the TRF" checked={!!sa.trfElection} onChange={v => set({ trfElection: v })} help={RES.trfElection} /></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <LabelledNum box={51} label="Amount relating to personal TRF designations" value={sa.trfPersonalDesignations ?? 0} onChange={v => set({ trfPersonalDesignations: v })} help={RES.trfPersonalDesignations} />
              <LabelledNum box={52} label="Amount relating to capital payments / benefits received from trusts" value={sa.trfTrustPayments ?? 0} onChange={v => set({ trfTrustPayments: v })} help={RES.trfTrustPayments} />
              <LabelledNum box={53} label="Amount of TRF designations remitted in this tax year" value={sa.trfRemitted ?? 0} onChange={v => set({ trfRemitted: v })} help={RES.trfRemitted} />
            </div>
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">OWR, TRF and residence-relief amounts are captured for filing; they are not yet applied to the headline tax computation — review before filing.</p>
        </div>
      )}

      {activeTab === 'Any other information' && (
        <div className="space-y-2">
          <BoxTextArea box={54} label="Please give any other information in this space" value={sa.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={8}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the residence details entered — review and edit before filing.</p>
        </div>
      )}
    </div>
  );
}

// ── SA107 Trusts & estates — full box-for-box page (Capium layout) ────────────
const SA107_TABS = ['Income from Trusts', 'Income from the estates'] as const;
const SA107_SUBTABS: Record<string, string[]> = {
  'Income from Trusts': ['Discretionary income', 'Non-discretionary income', 'Income chargeable'],
  'Income from the estates': ['Income from UK estates', 'Income from foreign estates', 'Foreign tax paid on estate income'],
};
const estateRid = () => `ef-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const ESTATE_FGN_COLS: BreakdownColumn<EstateForeignItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'income', label: 'Income', kind: 'number', total: true },
  { key: 'foreignTax', label: 'Foreign tax', kind: 'number', total: true },
  { key: 'ukTaxWithheld', label: 'UK Tax withheld', kind: 'number', total: true },
];

// Entry count shown in brackets on a Trusts sub-tab heading (0 = no badge).
function sa107SubCount(sa: Sa107, sub: string): number {
  const c = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : !!v)).length;
  switch (sub) {
    case 'Discretionary income': return c([sa.discretionaryNet, sa.settlorInterestedPayments]);
    case 'Non-discretionary income': return c([sa.nonDiscNonSavings, sa.nonDiscSavings, sa.nonDiscDividend, sa.trusteesNonResident]);
    case 'Income chargeable': return c([sa.settlorNonSavingsBasic, sa.settlorSavingsBasic, sa.settlorDividend, sa.settlorNonSavingsTrust, sa.settlorSavingsTrust, sa.settlorDividendTrust, sa.settlorNonSavingsGross, sa.settlorSavingsGross, sa.lifeAssuranceTaxPaid]);
    case 'Income from UK estates': return c([sa.estateNonSavings, sa.estateSavings, sa.estateDividend, sa.estateDividend75, sa.estateNonSavingsNonRepayable]);
    case 'Income from foreign estates': return (sa.foreignEstates?.length ?? 0) + c([sa.foreignEstateFig]);
    case 'Foreign tax paid on estate income': return c([sa.estateResiPropertyIncome, sa.estateResiFinanceBfwd, sa.otherInformation]);
  }
  return 0;
}

function Sa107Page({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const sa: Sa107 = income.sa107 ?? {};
  const set = (u: Partial<Sa107>) => setIncome(i => ({ ...i, sa107: { ...i.sa107, ...u } }));
  const [tab, setTab] = useState<string>('Income from Trusts');
  const [sub, setSub] = useState(0);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (SA107_TABS as readonly string[]).includes(tab) ? tab : SA107_TABS[0];
  const subList = SA107_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  const estates = sa.foreignEstates ?? [];
  const legacy = (income.trusts ?? []).length > 0;
  return (
    <div className="space-y-3">
      {legacy && <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">You have legacy trust / estate sources (still counted in the tax) below. Re-enter them box-for-box above to file from the SA107 page, then clear the old ones.</p>}
      <SectionTabs tabs={SA107_TABS.map(tt => ({ label: tt }))} active={activeTab} onSelect={setTop} />
      <SubTabs tabs={subList.map(st => ({ label: st, count: sa107SubCount(sa, st) }))} active={sub} onSelect={setSub} />

      {/* ── Income from Trusts ── */}
      {subName === 'Discretionary income' && (
        <StudioCard className="p-4"><BoxSection title="Discretionary income payment from a UK resident trust">
          <BoxNum box={1} label="Net amount" help={TRUST.discretionary} value={sa.discretionaryNet ?? 0} onChange={v => set({ discretionaryNet: v })} />
          <BoxNum box={2} label="Total payments from settlor-interested trusts" help={TRUST.settlorInterested} value={sa.settlorInterestedPayments ?? 0} onChange={v => set({ settlorInterestedPayments: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Non-discretionary income' && (
        <StudioCard className="p-4"><BoxSection title="Non-discretionary income entitlement from a trust">
          <BoxNum box={3} label="Net amount of non-savings income" help={TRUST.nonDiscNet} value={sa.nonDiscNonSavings ?? 0} onChange={v => set({ nonDiscNonSavings: v })} />
          <BoxNum box={4} label="Net amount of savings income" help={TRUST.nonDiscNet} value={sa.nonDiscSavings ?? 0} onChange={v => set({ nonDiscSavings: v })} />
          <BoxNum box={5} label="Net amount of dividend income" help={TRUST.nonDiscNet} value={sa.nonDiscDividend ?? 0} onChange={v => set({ nonDiscDividend: v })} />
          <BoxCheck box={6} label="Trustees not resident in the UK for tax purposes?" help={TRUST.trusteesNonResident} checked={!!sa.trusteesNonResident} onChange={v => set({ trusteesNonResident: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Income chargeable' && (
        <StudioCard className="p-4"><BoxSection title="Income chargeable on settlors">
          <BoxNum box={7} label="Non-savings income taxed at basic rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorNonSavingsBasic ?? 0} onChange={v => set({ settlorNonSavingsBasic: v })} />
          <BoxNum box={8} label="Savings income taxed at basic rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorSavingsBasic ?? 0} onChange={v => set({ settlorSavingsBasic: v })} />
          <BoxNum box={9} label="Dividends income taxed at dividend rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorDividend ?? 0} onChange={v => set({ settlorDividend: v })} />
          <BoxNum box={10} label="Non-savings income taxed at trust rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorNonSavingsTrust ?? 0} onChange={v => set({ settlorNonSavingsTrust: v })} />
          <BoxNum box={11} label="Savings income taxed at trust rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorSavingsTrust ?? 0} onChange={v => set({ settlorSavingsTrust: v })} />
          <BoxNum box={12} label="Dividend income taxed at trust rate (net amount)" help={TRUST.settlorChargeable} value={sa.settlorDividendTrust ?? 0} onChange={v => set({ settlorDividendTrust: v })} />
          <BoxNum box={13} label="Non-savings income paid gross" help={TRUST.settlorChargeable} value={sa.settlorNonSavingsGross ?? 0} onChange={v => set({ settlorNonSavingsGross: v })} />
          <BoxNum box={14} label="Savings income paid gross" help={TRUST.settlorChargeable} value={sa.settlorSavingsGross ?? 0} onChange={v => set({ settlorSavingsGross: v })} />
          <BoxNum box={15} label="Tax paid on certain UK life assurance policies" help={TRUST.lifeAssurance} value={sa.lifeAssuranceTaxPaid ?? 0} onChange={v => set({ lifeAssuranceTaxPaid: v })} />
        </BoxSection></StudioCard>
      )}

      {/* ── Income from the estates ── */}
      {subName === 'Income from UK estates' && (
        <StudioCard className="p-4"><BoxSection title="Income from United Kingdom (UK) estates">
          <BoxNum box={16} label="Non savings income (after tax)" help={TRUST.estateIncome} value={sa.estateNonSavings ?? 0} onChange={v => set({ estateNonSavings: v })} />
          <BoxNum box={17} label="Savings income (after tax)" help={TRUST.estateIncome} value={sa.estateSavings ?? 0} onChange={v => set({ estateSavings: v })} />
          <BoxNum box={18} label="Dividend income (after tax)" help={TRUST.estateIncome} value={sa.estateDividend ?? 0} onChange={v => set({ estateDividend: v })} />
          <BoxNum box="18.1" label="Dividend income that has been taxed at 7.5%, after tax taken off" help={TRUST.estateDividend75} value={sa.estateDividend75 ?? 0} onChange={v => set({ estateDividend75: v })} />
          <BoxNum box={19} label="Non-savings income taxed at non-repayable basic rate" help={TRUST.estateNonRepayable} value={sa.estateNonSavingsNonRepayable ?? 0} onChange={v => set({ estateNonSavingsNonRepayable: v })} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Income from foreign estates' && (
        <StudioCard className="p-4"><BoxSection title="Income from foreign estates">
          <BreakdownField box={22} label="Foreign estate income" title="Foreign estate" help={TRUST.foreignEstate} items={estates} columns={ESTATE_FGN_COLS} blank={() => ({ id: estateRid() })} onChange={r => set({ foreignEstates: r })} rowTotal={i => i.income || 0} />
          <BoxNum box="22.1" label="Amount claimed under the foreign income and gains (FIG) regime" help={FGN.fig} value={sa.foreignEstateFig ?? 0} onChange={v => set({ foreignEstateFig: v })} />
          <BreakdownField box={23} label="Relief for UK tax already accounted for" title="Foreign estate" items={estates} columns={ESTATE_FGN_COLS} blank={() => ({ id: estateRid() })} onChange={r => set({ foreignEstates: r })} rowTotal={i => i.ukTaxWithheld || 0} />
        </BoxSection></StudioCard>
      )}
      {subName === 'Foreign tax paid on estate income' && (
        <StudioCard className="space-y-3 p-4">
          <BoxSection title="Foreign tax paid on estate income">
            <BreakdownField box={24} label="Foreign Tax Credit Relief has not been claimed" title="Foreign estate" items={estates} columns={ESTATE_FGN_COLS} blank={() => ({ id: estateRid() })} onChange={r => set({ foreignEstates: r })} rowTotal={i => i.foreignTax || 0} />
          </BoxSection>
          <BoxSection title="Residential property income">
            <BoxNum box={25} label="Residential property income" help={TRUST.estateResiProperty} value={sa.estateResiPropertyIncome ?? 0} onChange={v => set({ estateResiPropertyIncome: v })} />
            <BoxNum box="25.1" label="Unused residential finance costs brought forward" value={sa.estateResiFinanceBfwd ?? 0} onChange={v => set({ estateResiFinanceBfwd: v })} />
          </BoxSection>
          <div>
            <label className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]"><span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">26</span> Any other information</label>
            <textarea value={sa.otherInformation ?? ''} onChange={e => set({ otherInformation: e.target.value })} rows={3} className="input-base w-full py-1.5 text-[12.5px]" placeholder="Please give any other information in this space" />
          </div>
        </StudioCard>
      )}

      {legacy && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Legacy sources</p>
          <TrustsPage income={income} setIncome={setIncome} />
        </div>
      )}
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

// ── Shared SA-page navigation (used across SA106/107/108/109/101) ────────────
// Level-2 "section" tabs — an underline tab bar: the primary tabs that open the
// areas within a form page. Reads unmistakably as tabs (accent underline + text
// on a shared divider), distinct from the level-1 form-page pills above it.
function SectionTabs({ tabs, active, onSelect }: { tabs: { label: string; count?: number }[]; active: string; onSelect: (label: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-x-1 border-b border-[var(--border)]">
      {tabs.map(t => {
        const on = t.label === active;
        return (
          <button key={t.label} onClick={() => onSelect(t.label)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-semibold transition-colors ${on ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text-secondary)]'}`}>
            {t.label}{t.count ? <span className={`rounded-full px-1.5 text-[9.5px] font-bold leading-[1.6] ${on ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-slate-100 text-slate-500'}`}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
// Level-3 "sub-section" tabs — a segmented control: a nested toggle within a
// section. Visually secondary (grouped pills with a raised active segment), so it
// never gets confused with the level-2 section tabs above it.
function SubTabs({ tabs, active, onSelect }: { tabs: { label: string; count?: number }[]; active: number; onSelect: (i: number) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-black/[0.04] p-0.5">
      {tabs.map((t, i) => {
        const on = i === active;
        return (
          <button key={t.label} onClick={() => onSelect(i)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${on ? 'bg-white text-[var(--accent)] shadow-sm ring-1 ring-black/[0.04]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
            {t.label}{t.count ? <span className="font-bold">({t.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ── SA102M Ministry of religion — box-for-box page (a "More" page) ───────────
const MINISTER_TABS = ['Income as a minister of religion', 'Business expenses'] as const;
const MINISTER_SUBTABS: Record<string, string[]> = {
  'Income as a minister of religion': ['Income', 'Benefits and expenses'],
  'Business expenses': ['Expenses paid', 'Service benefit', 'Other income'],
};
function minSubCount(m: MinisterOfReligion, sub: string): number {
  switch (sub) {
    case 'Income': return [m.natureOfPost, m.salary, m.payrolledBenefitsStudentLoan, m.taxOffSalary, m.feesOfferings, m.vicarageExpensesPaid, m.personalExpenses, m.excessMileage, m.roundSumExpenses, m.taxOffRoundSum, m.otherIncome, m.taxOffOtherIncome].filter(truthy).length;
    case 'Benefits and expenses': return [m.vicarageServicesBenefit, m.carBenefit, m.carFuelBenefit, m.loansBenefit, m.expensesReceived, m.otherBenefits].filter(truthy).length;
    case 'Expenses paid': return [m.travellingExpenses, m.manseMaintenance, m.rent, m.secretarialAssistance, m.otherExpenses, m.backPayAfterApril, m.earlierYearBackPay, m.pensionPayments].filter(truthy).length;
    case 'Service benefit': return [m.amountPaidTowardBenefit].filter(truthy).length;
    case 'Other income': return [m.chaplaincyIncome, m.taxOffChaplaincy, m.totalTaxTakenOff].filter(truthy).length;
  }
  return 0;
}
function minSectionCount(m: MinisterOfReligion, tab: string): number {
  return (MINISTER_SUBTABS[tab] ?? []).reduce((a, s) => a + minSubCount(m, s), 0);
}

function MinisterPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const m: MinisterOfReligion = income.minister ?? {};
  const set = (u: Partial<MinisterOfReligion>) => setIncome(i => ({ ...i, minister: { ...i.minister, ...u } }));
  const cb = ministerComputed(m);
  const [tab, setTab] = useState<string>(MINISTER_TABS[0]);
  const [sub, setSub] = useState(0);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (MINISTER_TABS as readonly string[]).includes(tab) ? tab : MINISTER_TABS[0];
  const subList = MINISTER_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];
  return (
    <div className="space-y-3">
      <SectionTabs tabs={MINISTER_TABS.map(tt => ({ label: tt, count: minSectionCount(m, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: minSubCount(m, s) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Income as a minister of religion' && subName === 'Income' && (
        <div className="space-y-3">
          <SectionTitle title="Income as a minister of religion" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxText box={1} label="Nature of post or appointment" value={m.natureOfPost ?? ''} onChange={v => set({ natureOfPost: v })} help={MIN.natureOfPost} />
            <LabelledNum box={2} label="Salary or stipend" value={m.salary ?? 0} onChange={v => set({ salary: v })} help={MIN.salary} />
            <LabelledNum box="2.1" label="Payrolled benefits in box 2 affecting student loan" value={m.payrolledBenefitsStudentLoan ?? 0} onChange={v => set({ payrolledBenefitsStudentLoan: v })} help={MIN.payrolledBenefitsStudentLoan} />
            <LabelledNum box={3} label="Tax taken off salary" value={m.taxOffSalary ?? 0} onChange={v => set({ taxOffSalary: v })} help={MIN.taxOffSalary} />
            <LabelledNum box={4} label="Fees and offerings" value={m.feesOfferings ?? 0} onChange={v => set({ feesOfferings: v })} help={MIN.feesOfferings} />
            <LabelledNum box={5} label="Vicarage expenses paid for you" value={m.vicarageExpensesPaid ?? 0} onChange={v => set({ vicarageExpensesPaid: v })} help={MIN.vicarageExpensesPaid} />
            <LabelledNum box={6} label="Personal expenses, living accommodation, vouchers etc" value={m.personalExpenses ?? 0} onChange={v => set({ personalExpenses: v })} help={MIN.personalExpenses} />
            <LabelledNum box={7} label="Excess mileage allowance and passenger payments" value={m.excessMileage ?? 0} onChange={v => set({ excessMileage: v })} help={MIN.excessMileage} />
            <LabelledNum box={8} label="Round-sum expenses and rent allowances" value={m.roundSumExpenses ?? 0} onChange={v => set({ roundSumExpenses: v })} help={MIN.roundSumExpenses} />
            <LabelledNum box={9} label="Tax taken off round-sum expenses" value={m.taxOffRoundSum ?? 0} onChange={v => set({ taxOffRoundSum: v })} help={MIN.taxOffRoundSum} />
            <LabelledNum box={10} label="Other income incl. gifts, grants and balancing charges" value={m.otherIncome ?? 0} onChange={v => set({ otherIncome: v })} help={MIN.otherIncome} />
            <LabelledNum box={11} label="Tax taken off box 10" value={m.taxOffOtherIncome ?? 0} onChange={v => set({ taxOffOtherIncome: v })} help={MIN.taxOffOtherIncome} />
            <BoxCalc box={12} label="Total income as a minister of religion" value={cb.box12} />
          </div>
        </div>
      )}
      {activeTab === 'Income as a minister of religion' && subName === 'Benefits and expenses' && (
        <div className="space-y-3">
          <SectionTitle title="Benefits and expenses payments you receive as a minister of religion" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={13} label="Vicarage or manse services benefits received" value={m.vicarageServicesBenefit ?? 0} onChange={v => set({ vicarageServicesBenefit: v })} help={MIN.vicarageServicesBenefit} />
            <LabelledNum box={14} label="Car benefit" value={m.carBenefit ?? 0} onChange={v => set({ carBenefit: v })} help={MIN.carBenefit} />
            <LabelledNum box={15} label="Car fuel benefit" value={m.carFuelBenefit ?? 0} onChange={v => set({ carFuelBenefit: v })} help={MIN.carFuelBenefit} />
            <LabelledNum box={16} label="Interest-free and low interest loans" value={m.loansBenefit ?? 0} onChange={v => set({ loansBenefit: v })} help={MIN.loansBenefit} />
            <LabelledNum box={17} label="Expenses payments received" value={m.expensesReceived ?? 0} onChange={v => set({ expensesReceived: v })} help={MIN.expensesReceived} />
            <LabelledNum box={18} label="Other benefits" value={m.otherBenefits ?? 0} onChange={v => set({ otherBenefits: v })} help={MIN.otherBenefits} />
            <BoxCalc box={19} label="Total benefits and expenses" value={cb.box19} />
            <BoxCalc box={20} label="Taxable income, benefits and expenses received" value={cb.box20} />
          </div>
        </div>
      )}
      {activeTab === 'Business expenses' && subName === 'Expenses paid' && (
        <div className="space-y-3">
          <SectionTitle title="Expenses paid by you as a minister of religion" />
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700"><Info size={13} className="mt-0.5 shrink-0" /> If your income, benefits and expenses received were more than £8,500 and you made an entry in box 5 or 13, complete boxes 27 to 35.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={21} label="Travelling expenses" value={m.travellingExpenses ?? 0} onChange={v => set({ travellingExpenses: v })} help={MIN.travellingExpenses} />
            <LabelledNum box={22} label="Maintenance, repairs and insurance of manse etc" value={m.manseMaintenance ?? 0} onChange={v => set({ manseMaintenance: v })} help={MIN.manseMaintenance} />
            <LabelledNum box={23} label="Rent" value={m.rent ?? 0} onChange={v => set({ rent: v })} help={MIN.rent} />
            <LabelledNum box={24} label="Secretarial assistance" value={m.secretarialAssistance ?? 0} onChange={v => set({ secretarialAssistance: v })} help={MIN.secretarialAssistance} />
            <LabelledNum box={25} label="Other expenses" value={m.otherExpenses ?? 0} onChange={v => set({ otherExpenses: v })} help={MIN.otherExpenses} />
            <BoxCalc box={26} label="Total expenses paid" value={cb.box26} />
            <BoxCalc box={27} label="Gross income" value={cb.box27} />
            <LabelledNum box={28} label="Back pay received after 5 April" value={m.backPayAfterApril ?? 0} onChange={v => set({ backPayAfterApril: v })} help={MIN.backPayAfterApril} />
            <LabelledNum box={29} label="Earlier year back pay received this year" value={m.earlierYearBackPay ?? 0} onChange={v => set({ earlierYearBackPay: v })} help={MIN.earlierYearBackPay} />
            <LabelledNum box={30} label="Payments to registered pension schemes" value={m.pensionPayments ?? 0} onChange={v => set({ pensionPayments: v })} help={MIN.pensionPayments} />
            <BoxCalc box={31} label="Net income" value={cb.box31} />
          </div>
        </div>
      )}
      {activeTab === 'Business expenses' && subName === 'Service benefit' && (
        <div className="space-y-3">
          <SectionTitle title="Service benefit cap calculation" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxCalc box={32} label="10% of net income" value={cb.box32} />
            <LabelledNum box={33} label="Amount paid toward benefit received" value={m.amountPaidTowardBenefit ?? 0} onChange={v => set({ amountPaidTowardBenefit: v })} help={MIN.amountPaidTowardBenefit} />
            <BoxCalc box={34} label="Payments and service benefits" value={cb.box34} />
            <BoxCalc box={35} label="Service benefit cap" value={cb.box35} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">The service-benefit cap (boxes 34/35) is a working figure — review against the SA102M notes before filing.</p>
        </div>
      )}
      {activeTab === 'Business expenses' && subName === 'Other income' && (
        <div className="space-y-3">
          <SectionTitle title="Other income as a minister of religion" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={36} label="Chaplaincy and other income as a minister" value={m.chaplaincyIncome ?? 0} onChange={v => set({ chaplaincyIncome: v })} help={MIN.chaplaincyIncome} />
            <LabelledNum box={37} label="Tax taken off box 36" value={m.taxOffChaplaincy ?? 0} onChange={v => set({ taxOffChaplaincy: v })} help={MIN.taxOffChaplaincy} />
            <BoxCalc box={38} label="Taxable income minus expenses" value={cb.box38} />
            <LabelledNum box={39} label="Total tax taken off" value={m.totalTaxTakenOff ?? cb.box39} onChange={v => set({ totalTaxTakenOff: v })} help={MIN.totalTaxTakenOff} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">The taxable income (box 38) is added to your income and the total tax taken off (box 39) is credited against the bill.</p>
        </div>
      )}
    </div>
  );
}

// ── SA102 Northern Ireland Legislative Assembly — box-for-box "More" page ─────
const ASSEMBLY_TABS = ['Income/Benefit from your office', 'Office expenses paid out by you'] as const;
const ASSEMBLY_SUBTABS: Record<string, string[]> = {
  'Income/Benefit from your office': ['Income from office', 'Benefit from your office'],
  'Office expenses paid out by you': ['Office expenses', 'Any other information'],
};
function assemblySubCount(a: AssemblyOffice, sub: string): number {
  switch (sub) {
    case 'Income from office': return [a.p60Pay, a.payrolledBenefitsStudentLoan, a.taxTakenOff].filter(truthy).length;
    case 'Benefit from your office': return [a.officeCostExpenditure, a.otherCashReimbursements, a.allOtherBenefits, a.balancingCharges].filter(truthy).length;
    case 'Office expenses': return [a.secretarialAssistance, a.officeExpenses, a.otherExpensesCapitalAllowances].filter(truthy).length;
    case 'Any other information': return a.otherInformation && a.otherInformation.trim() ? 1 : 0;
  }
  return 0;
}
function assemblySectionCount(a: AssemblyOffice, tab: string): number {
  return (ASSEMBLY_SUBTABS[tab] ?? []).reduce((acc, s) => acc + assemblySubCount(a, s), 0);
}

function NiAssemblyPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const a: AssemblyOffice = income.niAssembly ?? {};
  const set = (u: Partial<AssemblyOffice>) => setIncome(i => ({ ...i, niAssembly: { ...i.niAssembly, ...u } }));
  const cb = assemblyComputed(a);
  const [tab, setTab] = useState<string>(ASSEMBLY_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (ASSEMBLY_TABS as readonly string[]).includes(tab) ? tab : ASSEMBLY_TABS[0];
  const subList = ASSEMBLY_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const facts = [
        a.p60Pay ? `Payments from P60 for the Assembly office: £${a.p60Pay}.` : '',
        cb.benefits ? `Office benefits and cash reimbursements total: £${cb.benefits}.` : '',
        cb.expenses ? `Office expenses paid personally total: £${cb.expenses}.` : '',
        a.taxTakenOff ? `Tax taken off the office pay: £${a.taxTakenOff}.` : '',
        `Net taxable office income: £${cb.taxable}.`,
      ].filter(Boolean);
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', context: { form: 'SA102 supplementary page for a member of the Northern Ireland Legislative Assembly', facts } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: a.otherInformation ? `${a.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={ASSEMBLY_TABS.map(tt => ({ label: tt, count: assemblySectionCount(a, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: assemblySubCount(a, s) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Income/Benefit from your office' && subName === 'Income from office' && (
        <div className="space-y-3">
          <SectionTitle title="Income from office" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={1} label="Payments from P60" value={a.p60Pay ?? 0} onChange={v => set({ p60Pay: v })} help={NIA.p60Pay} />
            <LabelledNum box="1.1" label="Payrolled benefits in box 1 affecting student loan repayments" value={a.payrolledBenefitsStudentLoan ?? 0} onChange={v => set({ payrolledBenefitsStudentLoan: v })} help={NIA.payrolledBenefitsStudentLoan} />
            <LabelledNum box={2} label="Tax taken off box 1" value={a.taxTakenOff ?? 0} onChange={v => set({ taxTakenOff: v })} help={NIA.taxTakenOff} />
          </div>
        </div>
      )}
      {activeTab === 'Income/Benefit from your office' && subName === 'Benefit from your office' && (
        <div className="space-y-3">
          <SectionTitle title="Benefit from your office" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={3} label="Office Cost Expenditure" value={a.officeCostExpenditure ?? 0} onChange={v => set({ officeCostExpenditure: v })} help={NIA.officeCostExpenditure} />
            <LabelledNum box={4} label="Other cash reimbursements" value={a.otherCashReimbursements ?? 0} onChange={v => set({ otherCashReimbursements: v })} help={NIA.otherCashReimbursements} />
            <LabelledNum box={5} label="All other benefits" value={a.allOtherBenefits ?? 0} onChange={v => set({ allOtherBenefits: v })} help={NIA.allOtherBenefits} />
            <LabelledNum box={6} label="Balancing charges" value={a.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} help={NIA.balancingCharges} />
          </div>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Office expenses' && (
        <div className="space-y-3">
          <SectionTitle title="Office expenses paid out by you" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={7} label="Secretarial, clerical and research assistance" value={a.secretarialAssistance ?? 0} onChange={v => set({ secretarialAssistance: v })} help={NIA.secretarialAssistance} />
            <LabelledNum box={8} label="Office expenses" value={a.officeExpenses ?? 0} onChange={v => set({ officeExpenses: v })} help={NIA.officeExpenses} />
            <LabelledNum box={9} label="Other expenses and capital allowances" value={a.otherExpensesCapitalAllowances ?? 0} onChange={v => set({ otherExpensesCapitalAllowances: v })} help={NIA.otherExpensesCapitalAllowances} />
            <BoxCalc label="Taxable office income (pay + benefits − expenses)" value={cb.taxable} />
            <BoxCalc label="Tax taken off (credited against the bill)" value={cb.taxDeducted} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH adds the taxable office income to this client’s total income and credits the tax taken off against the bill.</p>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Any other information' && (
        <div className="space-y-2">
          <SectionTitle title="Any other information" />
          <BoxTextArea box={10} label="Please give any other information in this space" value={a.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={8}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the office figures entered — review and edit before filing.</p>
        </div>
      )}
    </div>
  );
}

// ── SA102 Members of Parliament (MPs) — box-for-box "More" page ───────────────
const PARLIAMENT_TABS = ['Income from office', 'Benefit from your office', 'Office expenses paid out by you'] as const;
const PARLIAMENT_SUBTABS: Record<string, string[]> = {
  'Income from office': [],
  'Benefit from your office': [],
  'Office expenses paid out by you': ['Office expenses', 'Any other information'],
};
function parliamentSubCount(m: ParliamentOffice, sub: string): number {
  switch (sub) {
    case 'Income from office': return [m.p60Pay, m.payrolledBenefitsStudentLoan, m.taxTakenOff].filter(truthy).length;
    case 'Benefit from your office': return [m.travelVouchers, m.accommodation, m.officeCostsExpenditure, m.contingencyPayment, m.financialAssistanceFund, m.allOtherBenefits, m.balancingCharges].filter(truthy).length;
    case 'Office expenses': return [m.travelWarrants, m.secretarialAssistance, m.officeExpenses, m.otherExpensesCapitalAllowances].filter(truthy).length;
    case 'Any other information': return m.otherInformation && m.otherInformation.trim() ? 1 : 0;
  }
  return 0;
}
function parliamentSectionCount(m: ParliamentOffice, tab: string): number {
  switch (tab) {
    case 'Income from office': return parliamentSubCount(m, 'Income from office');
    case 'Benefit from your office': return parliamentSubCount(m, 'Benefit from your office');
    case 'Office expenses paid out by you': return parliamentSubCount(m, 'Office expenses') + parliamentSubCount(m, 'Any other information');
  }
  return 0;
}
const countHint = (n: number): string | undefined => (n ? `${n} ${n === 1 ? 'entry' : 'entries'}` : undefined);

function ParliamentPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const m: ParliamentOffice = income.parliament ?? {};
  const set = (u: Partial<ParliamentOffice>) => setIncome(i => ({ ...i, parliament: { ...i.parliament, ...u } }));
  const cb = parliamentComputed(m);
  const [tab, setTab] = useState<string>(PARLIAMENT_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (PARLIAMENT_TABS as readonly string[]).includes(tab) ? tab : PARLIAMENT_TABS[0];
  const subList = PARLIAMENT_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const facts = [
        m.p60Pay ? `Payments from P60 as a Member of Parliament: £${m.p60Pay}.` : '',
        cb.benefits ? `Office benefits and cash reimbursements total: £${cb.benefits}.` : '',
        cb.expenses ? `Office expenses paid personally total: £${cb.expenses}.` : '',
        m.taxTakenOff ? `Tax taken off the office pay: £${m.taxTakenOff}.` : '',
        `Net taxable office income: £${cb.taxable}.`,
      ].filter(Boolean);
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', context: { form: 'SA102 supplementary page for a Member of Parliament', facts } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: m.otherInformation ? `${m.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={PARLIAMENT_TABS.map(tt => ({ label: tt, count: parliamentSectionCount(m, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: parliamentSubCount(m, s) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Income from office' && (
        <div className="space-y-3">
          <SectionTitle title="Income from office" sub={countHint(parliamentSectionCount(m, 'Income from office'))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={1} label="Payments from P60" value={m.p60Pay ?? 0} onChange={v => set({ p60Pay: v })} help={PAR.p60Pay} />
            <LabelledNum box="1.1" label="Payrolled benefits in box 1 affecting student loan repayments" value={m.payrolledBenefitsStudentLoan ?? 0} onChange={v => set({ payrolledBenefitsStudentLoan: v })} help={PAR.payrolledBenefitsStudentLoan} />
            <LabelledNum box={2} label="Tax taken off box 1" value={m.taxTakenOff ?? 0} onChange={v => set({ taxTakenOff: v })} help={PAR.taxTakenOff} />
          </div>
        </div>
      )}
      {activeTab === 'Benefit from your office' && (
        <div className="space-y-3">
          <SectionTitle title="Benefit from your office" sub={countHint(parliamentSectionCount(m, 'Benefit from your office'))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={3} label="Travel, travel warrants and vouchers" value={m.travelVouchers ?? 0} onChange={v => set({ travelVouchers: v })} help={PAR.travelVouchers} />
            <LabelledNum box={4} label="Accommodation, excluding Accommodation Expenses" value={m.accommodation ?? 0} onChange={v => set({ accommodation: v })} help={PAR.accommodation} />
            <LabelledNum box={5} label="Office Costs Expenditure" value={m.officeCostsExpenditure ?? 0} onChange={v => set({ officeCostsExpenditure: v })} help={PAR.officeCostsExpenditure} />
            <LabelledNum box={6} label="Contingency payment" value={m.contingencyPayment ?? 0} onChange={v => set({ contingencyPayment: v })} help={PAR.contingencyPayment} />
            <LabelledNum box={7} label="Financial Assistance Fund and other cash reimbursements" value={m.financialAssistanceFund ?? 0} onChange={v => set({ financialAssistanceFund: v })} help={PAR.financialAssistanceFund} />
            <LabelledNum box={8} label="All other benefits" value={m.allOtherBenefits ?? 0} onChange={v => set({ allOtherBenefits: v })} help={PAR.allOtherBenefits} />
            <LabelledNum box={9} label="Balancing charges" value={m.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} help={PAR.balancingCharges} />
          </div>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Office expenses' && (
        <div className="space-y-3">
          <SectionTitle title="Office expenses paid out by you" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={10} label="Travel warrants" value={m.travelWarrants ?? 0} onChange={v => set({ travelWarrants: v })} help={PAR.travelWarrants} />
            <LabelledNum box={11} label="Secretarial, clerical and research assistance" value={m.secretarialAssistance ?? 0} onChange={v => set({ secretarialAssistance: v })} help={PAR.secretarialAssistance} />
            <LabelledNum box={12} label="Office expenses" value={m.officeExpenses ?? 0} onChange={v => set({ officeExpenses: v })} help={PAR.officeExpenses} />
            <LabelledNum box={13} label="Other expenses and capital allowances" value={m.otherExpensesCapitalAllowances ?? 0} onChange={v => set({ otherExpensesCapitalAllowances: v })} help={PAR.otherExpensesCapitalAllowances} />
            <BoxCalc label="Taxable office income (pay + benefits − expenses)" value={cb.taxable} />
            <BoxCalc label="Tax taken off (credited against the bill)" value={cb.taxDeducted} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH adds the taxable office income to this client’s total income and credits the tax taken off against the bill.</p>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Any other information' && (
        <div className="space-y-2">
          <SectionTitle title="Any other information" />
          <BoxTextArea box={14} label="Please give any other information in this space" value={m.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={8}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the office figures entered — review and edit before filing.</p>
        </div>
      )}
    </div>
  );
}

// ── SA102 Scottish Parliament (MSP) — box-for-box "More" page ─────────────────
const SCOT_TABS = ['Income/Benefit from your office', 'Office expenses paid out by you'] as const;
const SCOT_SUBTABS: Record<string, string[]> = {
  'Income/Benefit from your office': ['Income from office', 'Benefit from your office'],
  'Office expenses paid out by you': ['Office expenses', 'Any other information'],
};
function scotSubCount(m: ScottishParliamentOffice, sub: string): number {
  switch (sub) {
    case 'Income from office': return [m.p60Pay, m.payrolledBenefitsStudentLoan, m.taxTakenOff].filter(truthy).length;
    case 'Benefit from your office': return [m.accommodation, m.officeCostProvision, m.otherCashReimbursements, m.allOtherBenefits, m.balancingCharges].filter(truthy).length;
    case 'Office expenses': return [m.officeCosts, m.otherExpensesCapitalAllowances].filter(truthy).length;
    case 'Any other information': return m.otherInformation && m.otherInformation.trim() ? 1 : 0;
  }
  return 0;
}
function scotSectionCount(m: ScottishParliamentOffice, tab: string): number {
  return (SCOT_SUBTABS[tab] ?? []).reduce((acc, s) => acc + scotSubCount(m, s), 0);
}

function ScottishParliamentPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const m: ScottishParliamentOffice = income.scottishParliament ?? {};
  const set = (u: Partial<ScottishParliamentOffice>) => setIncome(i => ({ ...i, scottishParliament: { ...i.scottishParliament, ...u } }));
  const cb = scottishParliamentComputed(m);
  const [tab, setTab] = useState<string>(SCOT_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (SCOT_TABS as readonly string[]).includes(tab) ? tab : SCOT_TABS[0];
  const subList = SCOT_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const facts = [
        m.p60Pay ? `Payments from P60 as a Member of the Scottish Parliament: £${m.p60Pay}.` : '',
        cb.benefits ? `Office benefits and cash reimbursements total: £${cb.benefits}.` : '',
        cb.expenses ? `Office expenses paid personally total: £${cb.expenses}.` : '',
        m.taxTakenOff ? `Tax taken off the office pay: £${m.taxTakenOff}.` : '',
        `Net taxable office income: £${cb.taxable}.`,
      ].filter(Boolean);
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', context: { form: 'SA102 supplementary page for a Member of the Scottish Parliament', facts } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: m.otherInformation ? `${m.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={SCOT_TABS.map(tt => ({ label: tt, count: scotSectionCount(m, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: scotSubCount(m, s) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Income/Benefit from your office' && subName === 'Income from office' && (
        <div className="space-y-3">
          <SectionTitle title="Income from office" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={1} label="Payments from P60" value={m.p60Pay ?? 0} onChange={v => set({ p60Pay: v })} help={SCP.p60Pay} />
            <LabelledNum box="1.1" label="Payrolled benefits in box 1 affecting student loan repayments" value={m.payrolledBenefitsStudentLoan ?? 0} onChange={v => set({ payrolledBenefitsStudentLoan: v })} help={SCP.payrolledBenefitsStudentLoan} />
            <LabelledNum box={2} label="Tax taken off box 1" value={m.taxTakenOff ?? 0} onChange={v => set({ taxTakenOff: v })} help={SCP.taxTakenOff} />
          </div>
        </div>
      )}
      {activeTab === 'Income/Benefit from your office' && subName === 'Benefit from your office' && (
        <div className="space-y-3">
          <SectionTitle title="Benefit from your office" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={3} label="Accommodation" value={m.accommodation ?? 0} onChange={v => set({ accommodation: v })} help={SCP.accommodation} />
            <LabelledNum box={4} label="Office Cost Provision — non-capital items" value={m.officeCostProvision ?? 0} onChange={v => set({ officeCostProvision: v })} help={SCP.officeCostProvision} />
            <LabelledNum box={5} label="Other cash reimbursements" value={m.otherCashReimbursements ?? 0} onChange={v => set({ otherCashReimbursements: v })} help={SCP.otherCashReimbursements} />
            <LabelledNum box={6} label="All other benefits" value={m.allOtherBenefits ?? 0} onChange={v => set({ allOtherBenefits: v })} help={SCP.allOtherBenefits} />
            <LabelledNum box={7} label="Balancing charges" value={m.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} help={SCP.balancingCharges} />
          </div>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Office expenses' && (
        <div className="space-y-3">
          <SectionTitle title="Office expenses paid out by you" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={8} label="Office costs" value={m.officeCosts ?? 0} onChange={v => set({ officeCosts: v })} help={SCP.officeCosts} />
            <LabelledNum box={9} label="Other expenses and capital allowances" value={m.otherExpensesCapitalAllowances ?? 0} onChange={v => set({ otherExpensesCapitalAllowances: v })} help={SCP.otherExpensesCapitalAllowances} />
            <BoxCalc label="Taxable office income (pay + benefits − expenses)" value={cb.taxable} />
            <BoxCalc label="Tax taken off (credited against the bill)" value={cb.taxDeducted} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH adds the taxable office income to this client’s total income and credits the tax taken off against the bill.</p>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Any other information' && (
        <div className="space-y-2">
          <SectionTitle title="Any other information" />
          <BoxTextArea box={10} label="Please give any other information in this space" value={m.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={8}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the office figures entered — review and edit before filing.</p>
        </div>
      )}
    </div>
  );
}

// ── SA102 National Assembly for Wales (Senedd) — box-for-box "More" page ──────
const WELSH_TABS = ['Income from office', 'Benefit from your office', 'Office expenses paid out by you'] as const;
const WELSH_SUBTABS: Record<string, string[]> = {
  'Income from office': [],
  'Benefit from your office': [],
  'Office expenses paid out by you': ['Office expenses', 'Any other information'],
};
function welshSubCount(m: WelshAssemblyOffice, sub: string): number {
  switch (sub) {
    case 'Income from office': return [m.p60Pay, m.payrolledBenefitsStudentLoan, m.taxTakenOff].filter(truthy).length;
    case 'Benefit from your office': return [m.familyTravelCosts, m.accommodation, m.officeCostAllowance, m.groupSupportAllowance, m.otherCashReimbursements, m.allOtherBenefits, m.balancingCharges].filter(truthy).length;
    case 'Office expenses': return [m.familyTravelExpenses, m.secretarialClerical, m.officeExpenses, m.otherExpenses].filter(truthy).length;
    case 'Any other information': return m.otherInformation && m.otherInformation.trim() ? 1 : 0;
  }
  return 0;
}
function welshSectionCount(m: WelshAssemblyOffice, tab: string): number {
  switch (tab) {
    case 'Income from office': return welshSubCount(m, 'Income from office');
    case 'Benefit from your office': return welshSubCount(m, 'Benefit from your office');
    case 'Office expenses paid out by you': return welshSubCount(m, 'Office expenses') + welshSubCount(m, 'Any other information');
  }
  return 0;
}

function WelshAssemblyPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const m: WelshAssemblyOffice = income.welshAssembly ?? {};
  const set = (u: Partial<WelshAssemblyOffice>) => setIncome(i => ({ ...i, welshAssembly: { ...i.welshAssembly, ...u } }));
  const cb = welshAssemblyComputed(m);
  const [tab, setTab] = useState<string>(WELSH_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (WELSH_TABS as readonly string[]).includes(tab) ? tab : WELSH_TABS[0];
  const subList = WELSH_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const facts = [
        m.p60Pay ? `Payments from P60 as a Member of the Senedd: £${m.p60Pay}.` : '',
        cb.benefits ? `Office benefits and cash reimbursements total: £${cb.benefits}.` : '',
        cb.expenses ? `Office expenses paid personally total: £${cb.expenses}.` : '',
        m.taxTakenOff ? `Tax taken off the office pay: £${m.taxTakenOff}.` : '',
        `Net taxable office income: £${cb.taxable}.`,
      ].filter(Boolean);
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', context: { form: 'SA102 supplementary page for a Member of the Senedd (National Assembly for Wales)', facts } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: m.otherInformation ? `${m.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={WELSH_TABS.map(tt => ({ label: tt, count: welshSectionCount(m, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: welshSubCount(m, s) }))} active={sub} onSelect={setSub} />}

      {activeTab === 'Income from office' && (
        <div className="space-y-3">
          <SectionTitle title="Income from office" sub={countHint(welshSectionCount(m, 'Income from office'))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={1} label="Payments from P60" value={m.p60Pay ?? 0} onChange={v => set({ p60Pay: v })} help={WAL.p60Pay} />
            <LabelledNum box="1.1" label="Payrolled benefits in box 1 affecting student loan repayments" value={m.payrolledBenefitsStudentLoan ?? 0} onChange={v => set({ payrolledBenefitsStudentLoan: v })} help={WAL.payrolledBenefitsStudentLoan} />
            <LabelledNum box={2} label="Tax taken off box 1" value={m.taxTakenOff ?? 0} onChange={v => set({ taxTakenOff: v })} help={WAL.taxTakenOff} />
          </div>
        </div>
      )}
      {activeTab === 'Benefit from your office' && (
        <div className="space-y-3">
          <SectionTitle title="Benefit from your office" sub={countHint(welshSectionCount(m, 'Benefit from your office'))} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={3} label="Family travel costs" value={m.familyTravelCosts ?? 0} onChange={v => set({ familyTravelCosts: v })} help={WAL.familyTravelCosts} />
            <LabelledNum box={4} label="Accommodation" value={m.accommodation ?? 0} onChange={v => set({ accommodation: v })} help={WAL.accommodation} />
            <LabelledNum box={5} label="Office Cost Allowance" value={m.officeCostAllowance ?? 0} onChange={v => set({ officeCostAllowance: v })} help={WAL.officeCostAllowance} />
            <LabelledNum box={6} label="Group Support Allowance" value={m.groupSupportAllowance ?? 0} onChange={v => set({ groupSupportAllowance: v })} help={WAL.groupSupportAllowance} />
            <LabelledNum box={7} label="Other cash reimbursements" value={m.otherCashReimbursements ?? 0} onChange={v => set({ otherCashReimbursements: v })} help={WAL.otherCashReimbursements} />
            <LabelledNum box={8} label="All other benefits" value={m.allOtherBenefits ?? 0} onChange={v => set({ allOtherBenefits: v })} help={WAL.allOtherBenefits} />
            <LabelledNum box={9} label="Balancing charges" value={m.balancingCharges ?? 0} onChange={v => set({ balancingCharges: v })} help={WAL.balancingCharges} />
          </div>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Office expenses' && (
        <div className="space-y-3">
          <SectionTitle title="Office expenses paid out by you" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={10} label="Family travel costs" value={m.familyTravelExpenses ?? 0} onChange={v => set({ familyTravelExpenses: v })} help={WAL.familyTravelExpenses} />
            <LabelledNum box={11} label="Secretarial and clerical" value={m.secretarialClerical ?? 0} onChange={v => set({ secretarialClerical: v })} help={WAL.secretarialClerical} />
            <LabelledNum box={12} label="Office expenses" value={m.officeExpenses ?? 0} onChange={v => set({ officeExpenses: v })} help={WAL.officeExpenses} />
            <LabelledNum box={13} label="Other expenses" value={m.otherExpenses ?? 0} onChange={v => set({ otherExpenses: v })} help={WAL.otherExpenses} />
            <BoxCalc label="Taxable office income (pay + benefits − expenses)" value={cb.taxable} />
            <BoxCalc label="Tax taken off (credited against the bill)" value={cb.taxDeducted} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH adds the taxable office income to this client’s total income and credits the tax taken off against the bill.</p>
        </div>
      )}
      {activeTab === 'Office expenses paid out by you' && subName === 'Any other information' && (
        <div className="space-y-2">
          <SectionTitle title="Any other information" />
          <BoxTextArea box={14} label="Please give any other information in this space" value={m.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={8}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the office figures entered — review and edit before filing.</p>
        </div>
      )}
    </div>
  );
}

// ── SA103L Lloyd's Underwriters — box-for-box "More" page ─────────────────────
const LLOYDS_TABS = ['Income from personal funds', 'Foreign sources income', "Lloyd's losses and expenses", "Lloyd's taxable profits or losses"] as const;
const LLOYDS_SUBTABS: Record<string, string[]> = {
  'Income from personal funds': ['UK interest', 'UK dividends'],
  'Foreign sources income': ['Non-UK interest', 'Non-UK dividends', "Other Lloyd's receipts"],
  "Lloyd's losses and expenses": ["Lloyd's losses and expenses", "Lloyd's foreign tax"],
  "Lloyd's taxable profits or losses": ['Taxable profits & losses', 'Taxable profits & losses (cont.)', "Lloyd's losses reconciliation", 'NICs & Other Info'],
};
function lloydsSubCount(l: LloydsUnderwriter, sub: string): number {
  const num = (...xs: (number | undefined)[]) => xs.filter(truthy).length;
  switch (sub) {
    case 'UK interest': return num(l.ukUntaxedInterest, l.accruedIncomeProfits, l.ukTaxedInterest, l.ukInterestTaxTakenOff);
    case 'UK dividends': return num(l.stockDividends, l.nonQualifyingDistributions, l.otherUkDividends);
    case 'Non-UK interest': return num(l.nonUkInterestNet, l.nonUkInterestForeignTax, l.nonUkInterestUkTax);
    case 'Non-UK dividends': return num(l.nonUkDividendsGross, l.nonUkDividendsForeignTax, l.nonUkDividendsUkTax);
    case "Other Lloyd's receipts": return num(l.aggregateSyndicateProfits, l.specialReserveWithdrawal, l.stopLossRecoveries, l.compensationReceipts, l.foreignTaxRepayments, l.otherNonSyndicateIncome, l.ftcrGiven);
    case "Lloyd's losses and expenses": return num(l.aggregateSyndicateLosses, l.specialReserveTransfer, l.stopLossPremiums, l.quotaSharePremiums, l.estateProtectionPremiums, l.underwritingLoanInterest, l.membersAssocExpenses, l.agentCommissionSalaries, l.bankGuaranteeFees, l.accountancyFees, l.otherExpenses);
    case "Lloyd's foreign tax": return num(l.usIncomeTax, l.canadianTax, l.syndicateForeignTax, l.additionalForeignTax);
    case 'Taxable profits & losses': return num(l.foreignTaxDeductionProfit, l.lossesBroughtForwardProfit);
    case 'Taxable profits & losses (cont.)': return num(l.foreignTaxDeductionLoss, l.lossSetOffOtherIncome, l.lossCarriedBack);
    case "Lloyd's losses reconciliation": return num(l.lossesBroughtForward);
    case 'NICs & Other Info': return (l.class2Voluntary ? 1 : 0) + (l.class4Exempt ? 1 : 0) + num(l.class4Adjustment) + (l.class2FullYear ? 1 : 0) + (l.otherInformation && l.otherInformation.trim() ? 1 : 0);
  }
  return 0;
}
function lloydsSectionCount(l: LloydsUnderwriter, tab: string): number {
  return (LLOYDS_SUBTABS[tab] ?? []).reduce((acc, s) => acc + lloydsSubCount(l, s), 0);
}

function LloydsPage({ ret, income, setIncome }: { ret: TaxReturn; income: Sa100Income; setIncome: SetIncome }) {
  const l: LloydsUnderwriter = income.lloyds ?? {};
  const set = (u: Partial<LloydsUnderwriter>) => setIncome(i => ({ ...i, lloyds: { ...i.lloyds, ...u } }));
  const cb = lloydsComputed(l);
  const [tab, setTab] = useState<string>(LLOYDS_TABS[0]);
  const [sub, setSub] = useState(0);
  const [noteBusy, setNoteBusy] = useState(false);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (LLOYDS_TABS as readonly string[]).includes(tab) ? tab : LLOYDS_TABS[0];
  const subList = LLOYDS_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  async function suggestNote() {
    setNoteBusy(true);
    try {
      const facts = [
        cb.box27 ? `Total Lloyd's income: £${cb.box27}.` : '',
        cb.box40 ? `Total Lloyd's losses and expenses: £${cb.box40}.` : '',
        cb.box41 ? `Profit for the year: £${cb.box41}.` : cb.box42 ? `Loss for the year: £${cb.box42}.` : '',
        cb.box48 ? `Total foreign tax: £${cb.box48}.` : '',
        cb.taxable ? `Total taxable profits from Lloyd's: £${cb.taxable}.` : '',
      ].filter(Boolean);
      const r = await fetch('/api/tax-studio/suggest-note', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear: ret.taxYear, clientName: ret.clientName ?? '', context: { form: "SA103L supplementary page for a member of Lloyd's (an underwriter)", facts } }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.note) set({ otherInformation: l.otherInformation ? `${l.otherInformation}\n\n${d.note}` : d.note });
    } finally { setNoteBusy(false); }
  }

  return (
    <div className="space-y-3">
      <SectionTabs tabs={LLOYDS_TABS.map(tt => ({ label: tt, count: lloydsSectionCount(l, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(s => ({ label: s, count: lloydsSubCount(l, s) }))} active={sub} onSelect={setSub} />}

      {/* ── Income from personal funds ── */}
      {activeTab === 'Income from personal funds' && subName === 'UK interest' && (
        <div className="space-y-3">
          <SectionTitle title="Income from personal funds at Lloyd's — UK interest" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={1} label="Untaxed UK interest (banks, unit trusts, gilts) — amount received" value={l.ukUntaxedInterest ?? 0} onChange={v => set({ ukUntaxedInterest: v })} help={LLU.ukUntaxedInterest} />
            <LabelledNum box={2} label="Profits from Accrued Income Scheme and deeply discounted securities" value={l.accruedIncomeProfits ?? 0} onChange={v => set({ accruedIncomeProfits: v })} help={LLU.accruedIncomeProfits} />
            <LabelledNum box={3} label="Taxed interest from other UK savings and investments — after tax taken off" value={l.ukTaxedInterest ?? 0} onChange={v => set({ ukTaxedInterest: v })} help={LLU.ukTaxedInterest} />
            <LabelledNum box={4} label="Tax taken off" value={l.ukInterestTaxTakenOff ?? 0} onChange={v => set({ ukInterestTaxTakenOff: v })} help={LLU.ukInterestTaxTakenOff} />
            <BoxCalc box={5} label="Total UK interest" value={cb.box5} />
          </div>
        </div>
      )}
      {activeTab === 'Income from personal funds' && subName === 'UK dividends' && (
        <div className="space-y-3">
          <SectionTitle title="Income from personal funds at Lloyd's — UK dividends" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={6} label="Stock dividends from UK companies — amount received" value={l.stockDividends ?? 0} onChange={v => set({ stockDividends: v })} help={LLU.stockDividends} />
            <LabelledNum box={8} label="Non-qualifying distributions — amount received" value={l.nonQualifyingDistributions ?? 0} onChange={v => set({ nonQualifyingDistributions: v })} help={LLU.nonQualifyingDistributions} />
            <LabelledNum box={9} label="Other UK dividends and qualifying distributions" value={l.otherUkDividends ?? 0} onChange={v => set({ otherUkDividends: v })} help={LLU.otherUkDividends} />
            <BoxCalc box={11} label="Total UK dividends" value={cb.box11} />
          </div>
        </div>
      )}

      {/* ── Foreign sources income ── */}
      {activeTab === 'Foreign sources income' && subName === 'Non-UK interest' && (
        <div className="space-y-3">
          <SectionTitle title="Non-UK interest and other foreign sources income" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={12} label="Net amount received" value={l.nonUkInterestNet ?? 0} onChange={v => set({ nonUkInterestNet: v })} help={LLU.nonUkInterestNet} />
            <LabelledNum box={13} label="Foreign tax taken off" value={l.nonUkInterestForeignTax ?? 0} onChange={v => set({ nonUkInterestForeignTax: v })} help={LLU.nonUkInterestForeignTax} />
            <LabelledNum box={14} label="UK tax taken off" value={l.nonUkInterestUkTax ?? 0} onChange={v => set({ nonUkInterestUkTax: v })} help={LLU.nonUkInterestUkTax} />
          </div>
        </div>
      )}
      {activeTab === 'Foreign sources income' && subName === 'Non-UK dividends' && (
        <div className="space-y-3">
          <SectionTitle title="Non-UK dividends" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={15} label="Amount received including dividend tax credit" value={l.nonUkDividendsGross ?? 0} onChange={v => set({ nonUkDividendsGross: v })} help={LLU.nonUkDividendsGross} />
            <LabelledNum box={16} label="Amount of foreign tax taken off" value={l.nonUkDividendsForeignTax ?? 0} onChange={v => set({ nonUkDividendsForeignTax: v })} help={LLU.nonUkDividendsForeignTax} />
            <LabelledNum box={17} label="Amount of UK tax taken off" value={l.nonUkDividendsUkTax ?? 0} onChange={v => set({ nonUkDividendsUkTax: v })} help={LLU.nonUkDividendsUkTax} />
            <BoxCalc box={18} label="Total non-UK income" value={cb.box18} />
          </div>
        </div>
      )}
      {activeTab === 'Foreign sources income' && subName === "Other Lloyd's receipts" && (
        <div className="space-y-3">
          <SectionTitle title="Other Lloyd's receipts" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={20} label="Aggregate syndicate profits" value={l.aggregateSyndicateProfits ?? 0} onChange={v => set({ aggregateSyndicateProfits: v })} help={LLU.aggregateSyndicateProfits} />
            <LabelledNum box={21} label="Net withdrawal / release from Special Reserve Fund" value={l.specialReserveWithdrawal ?? 0} onChange={v => set({ specialReserveWithdrawal: v })} help={LLU.specialReserveWithdrawal} />
            <LabelledNum box={22} label="Stop loss recoveries" value={l.stopLossRecoveries ?? 0} onChange={v => set({ stopLossRecoveries: v })} help={LLU.stopLossRecoveries} />
            <LabelledNum box={23} label="Compensation receipts" value={l.compensationReceipts ?? 0} onChange={v => set({ compensationReceipts: v })} help={LLU.compensationReceipts} />
            <LabelledNum box={24} label="Repayments of foreign tax previously allowed by deduction" value={l.foreignTaxRepayments ?? 0} onChange={v => set({ foreignTaxRepayments: v })} help={LLU.foreignTaxRepayments} />
            <LabelledNum box={25} label="Other Lloyd's non-syndicate income" value={l.otherNonSyndicateIncome ?? 0} onChange={v => set({ otherNonSyndicateIncome: v })} help={LLU.otherNonSyndicateIncome} />
            <BoxCalc box={26} label="Total other Lloyd's receipts" value={cb.box26} />
            <BoxCalc box={27} label="Total Lloyd's income" value={cb.box27} />
            <LabelledNum box={28} label="Foreign Tax Credit Relief was given" value={l.ftcrGiven ?? 0} onChange={v => set({ ftcrGiven: v })} help={LLU.ftcrGiven} />
          </div>
        </div>
      )}

      {/* ── Losses and expenses ── */}
      {activeTab === "Lloyd's losses and expenses" && subName === "Lloyd's losses and expenses" && (
        <div className="space-y-3">
          <SectionTitle title="Lloyd's losses and expenses" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={29} label="Aggregate syndicate losses" value={l.aggregateSyndicateLosses ?? 0} onChange={v => set({ aggregateSyndicateLosses: v })} help={LLU.aggregateSyndicateLosses} />
            <LabelledNum box={30} label="Net transfer to Special Reserve Fund" value={l.specialReserveTransfer ?? 0} onChange={v => set({ specialReserveTransfer: v })} help={LLU.specialReserveTransfer} />
            <LabelledNum box={31} label="Stop loss premiums paid" value={l.stopLossPremiums ?? 0} onChange={v => set({ stopLossPremiums: v })} help={LLU.stopLossPremiums} />
            <LabelledNum box={32} label="Personal Quota Share and Exeat premiums paid" value={l.quotaSharePremiums ?? 0} onChange={v => set({ quotaSharePremiums: v })} help={LLU.quotaSharePremiums} />
            <LabelledNum box={33} label="Estate protection plan premiums paid" value={l.estateProtectionPremiums ?? 0} onChange={v => set({ estateProtectionPremiums: v })} help={LLU.estateProtectionPremiums} />
            <LabelledNum box={34} label="Interest paid on loans to fund underwriting" value={l.underwritingLoanInterest ?? 0} onChange={v => set({ underwritingLoanInterest: v })} help={LLU.underwritingLoanInterest} />
            <LabelledNum box={35} label="Lloyd's Members' associations expenses paid" value={l.membersAssocExpenses ?? 0} onChange={v => set({ membersAssocExpenses: v })} help={LLU.membersAssocExpenses} />
            <LabelledNum box={36} label="Members' Agent profit commission and salaries" value={l.agentCommissionSalaries ?? 0} onChange={v => set({ agentCommissionSalaries: v })} help={LLU.agentCommissionSalaries} />
            <LabelledNum box={37} label="Fees for bank guarantees / letters of credit" value={l.bankGuaranteeFees ?? 0} onChange={v => set({ bankGuaranteeFees: v })} help={LLU.bankGuaranteeFees} />
            <LabelledNum box={38} label="Accountancy fees" value={l.accountancyFees ?? 0} onChange={v => set({ accountancyFees: v })} help={LLU.accountancyFees} />
            <LabelledNum box={39} label="Other Lloyd's expenses" value={l.otherExpenses ?? 0} onChange={v => set({ otherExpenses: v })} help={LLU.otherExpenses} />
            <BoxCalc box={40} label="Total losses and expenses" value={cb.box40} />
          </div>
        </div>
      )}
      {activeTab === "Lloyd's losses and expenses" && subName === "Lloyd's foreign tax" && (
        <div className="space-y-3">
          <SectionTitle title="Total incomings and outgoings" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxCalc box={41} label="Amount of profit" value={cb.box41} />
            <BoxCalc box={42} label="Amount of loss" value={cb.box42} />
          </div>
          <SectionTitle title="Lloyd's foreign tax" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxCalc box={43} label="Foreign tax on personal fund income" value={cb.box43} />
            <LabelledNum box={44} label="US income tax paid" value={l.usIncomeTax ?? 0} onChange={v => set({ usIncomeTax: v })} help={LLU.usIncomeTax} />
            <LabelledNum box={45} label="Canadian tax paid" value={l.canadianTax ?? 0} onChange={v => set({ canadianTax: v })} help={LLU.canadianTax} />
            <LabelledNum box={46} label="Syndicate foreign tax" value={l.syndicateForeignTax ?? 0} onChange={v => set({ syndicateForeignTax: v })} help={LLU.syndicateForeignTax} />
            <LabelledNum box={47} label="Additional payments of foreign tax" value={l.additionalForeignTax ?? 0} onChange={v => set({ additionalForeignTax: v })} help={LLU.additionalForeignTax} />
            <BoxCalc box={48} label="Total foreign tax" value={cb.box48} />
          </div>
        </div>
      )}

      {/* ── Taxable profits or losses ── */}
      {activeTab === "Lloyd's taxable profits or losses" && subName === 'Taxable profits & losses' && (
        <div className="space-y-3">
          <SectionTitle title="Calculating Lloyd's taxable profits or allowable losses" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxCalc box={49} label="Profit from box 41" value={cb.box49} />
            <LabelledNum box={50} label="Foreign tax claimed as a deduction" value={l.foreignTaxDeductionProfit ?? 0} onChange={v => set({ foreignTaxDeductionProfit: v })} help={LLU.foreignTaxDeductionProfit} />
            <LabelledNum box={51} label="Lloyd's losses brought forward" value={l.lossesBroughtForwardProfit ?? 0} onChange={v => set({ lossesBroughtForwardProfit: v })} help={LLU.lossesBroughtForwardProfit} />
            <BoxCalc box={52} label="Total taxable profits from Lloyd's" value={cb.box52} />
            <BoxCalc box={53} label="Loss from box 42" value={cb.box53} />
          </div>
        </div>
      )}
      {activeTab === "Lloyd's taxable profits or losses" && subName === 'Taxable profits & losses (cont.)' && (
        <div className="space-y-3">
          <SectionTitle title="Lloyd's losses reconciliation" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={54} label="Foreign tax claimed as a deduction — from box 48" value={l.foreignTaxDeductionLoss ?? 0} onChange={v => set({ foreignTaxDeductionLoss: v })} help={LLU.foreignTaxDeductionLoss} />
            <BoxCalc box={55} label="Loss for the year 2025–26 (box 53 + box 54)" value={cb.box55} />
            <LabelledNum box={56} label="Loss set off against other income" value={l.lossSetOffOtherIncome ?? 0} onChange={v => set({ lossSetOffOtherIncome: v })} help={LLU.lossSetOffOtherIncome} />
            <LabelledNum box={57} label="Loss carried back to set against earlier years" value={l.lossCarriedBack ?? 0} onChange={v => set({ lossCarriedBack: v })} help={LLU.lossCarriedBack} />
            <BoxCalc box={58} label="Unused loss available to carry forward" value={cb.box58} />
          </div>
        </div>
      )}
      {activeTab === "Lloyd's taxable profits or losses" && subName === "Lloyd's losses reconciliation" && (
        <div className="space-y-3">
          <SectionTitle title="Lloyd's losses reconciliation" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={59} label="Losses brought forward from earlier years" value={l.lossesBroughtForward ?? 0} onChange={v => set({ lossesBroughtForward: v })} help={LLU.lossesBroughtForward} />
            <BoxCalc box={60} label="Losses brought forward used against this year's profits" value={cb.box60} />
            <BoxCalc box={61} label="Unused loss" value={cb.box61} />
            <BoxCalc box={62} label="Total loss available to carry forward" value={cb.box62} />
          </div>
        </div>
      )}
      {activeTab === "Lloyd's taxable profits or losses" && subName === 'NICs & Other Info' && (
        <div className="space-y-3">
          <SectionTitle title="NICs & other information" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={63} label="You choose to pay Class 2 NICs voluntarily?" checked={!!l.class2Voluntary} onChange={v => set({ class2Voluntary: v })} help={LLU.class2Voluntary} />
            <BoxCheck box={64} label="Exempt from paying Class 4 NICs?" checked={!!l.class4Exempt} onChange={v => set({ class4Exempt: v })} help={LLU.class4Exempt} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <LabelledNum box={65} label="Adjustment to profits chargeable to Class 4 NICs" value={l.class4Adjustment ?? 0} onChange={v => set({ class4Adjustment: v })} help={LLU.class4Adjustment} />
            <BoxYesNo label="Member for the full tax year and willing to pay Class 2 NIC for the full year?" value={!!l.class2FullYear} onChange={v => set({ class2FullYear: v })} help={LLU.class2FullYear} />
          </div>
          <SectionTitle title="Any other information" />
          <BoxTextArea box={66} label="Please give any other information in this space" value={l.otherInformation ?? ''} onChange={v => set({ otherInformation: v })} rows={7}
            right={<button onClick={suggestNote} disabled={noteBusy} className="inline-flex items-center gap-1 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20 disabled:opacity-50">{noteBusy ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} SMITH, help me write this</button>} />
          <p className="text-[10.5px] text-[var(--text-muted)]">SMITH drafts a starting note from the Lloyd's figures entered — review and edit before filing.</p>
        </div>
      )}
      <p className="text-[10.5px] text-[var(--text-muted)]">The Lloyd's result is taxed as trading income; the taxable profit (box 52) is added to this client's income and the UK tax taken off is credited. Computed boxes are working figures — review against the SA103L notes before filing.</p>
    </div>
  );
}

// ── SA101 Additional information — full box-for-box page (Capium layout) ──────
const SA101_TABS = [
  'Other UK Income',
  'Share schemes and other tax reliefs',
  "Married couple's allowance & Other info",
  'Pension & Tax avoidance schemes',
] as const;
const SA101_SUBTABS: Record<string, string[]> = {
  'Other UK Income': ['Other UK Income', 'Life insurance gains', 'Stock dividends & Bonus issues', 'Business receipts taxed as income'],
  'Share schemes and other tax reliefs': ['Share schemes', 'Other tax reliefs'],
  "Married couple's allowance & Other info": ["Married Couple's Allowance", 'Other information'],
  'Pension & Tax avoidance schemes': ['Pension savings tax charges', 'Tax avoidance schemes'],
};
const s101id = () => `s101-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
const GILT_COLS: BreakdownColumn<Sa101GiltItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'gross', label: 'Gross amount', kind: 'number', total: true },
  { key: 'tax', label: 'Tax taken off', kind: 'number', total: true },
];
const LIFE_COLS: BreakdownColumn<Sa101LifeGainItem>[] = [
  { key: 'description', label: 'Policy and event details', kind: 'text' },
  { key: 'years', label: 'No. of years', kind: 'number' },
  { key: 'gain', label: 'Amount of gain', kind: 'number', total: true },
  { key: 'taxPaid', label: 'Tax treated as paid', kind: 'number', total: true },
];
const VOIDED_COLS: BreakdownColumn<Sa101VoidedIsaItem>[] = [
  { key: 'description', label: 'Policy details', kind: 'text' },
  { key: 'gain', label: 'Amount of gain', kind: 'number', total: true },
  { key: 'taxPaid', label: 'Tax treated as paid', kind: 'number', total: true },
];
const AA_COLS: BreakdownColumn<Sa101AnnualAllowanceItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'amount', label: 'Amount', kind: 'number', total: true },
  { key: 'taxPaid', label: 'Tax paid', kind: 'number', total: true },
];
const UNAUTH_COLS: BreakdownColumn<Sa101UnauthPaymentItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'notSurcharge', label: 'Not subject to surcharge', kind: 'number', total: true },
  { key: 'surcharge', label: 'Subject to surcharge', kind: 'number', total: true },
  { key: 'foreignTax', label: 'Foreign tax paid', kind: 'number', total: true },
];
const FLUMP_COLS: BreakdownColumn<Sa101ForeignLumpItem>[] = [
  { key: 'description', label: 'Description', kind: 'text' },
  { key: 'shortServiceRefund', label: 'Short service refund', kind: 'number', total: true },
  { key: 'taxableLumpSum', label: 'Taxable lump sum', kind: 'number', total: true },
  { key: 'foreignTax', label: 'Foreign tax paid', kind: 'number', total: true },
];
const sumK = <T,>(items: T[] | undefined, k: keyof T): number => (items ?? []).reduce((a, x) => a + (Number(x[k]) || 0), 0);

// A box entered as a fixed number of stacked single-line inputs (SA101 boxes 19 &
// 20 — the scheme reference numbers and their tax years). Stored newline-joined.
function StackedInputs({ box, label, value, onChange, rows = 3, placeholder, help }: { box?: number | string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; help?: string }) {
  const lines = value ? value.split('\n') : [];
  const cells = Array.from({ length: Math.max(rows, lines.length) }, (_, i) => lines[i] ?? '');
  const setAt = (i: number, v: string) => {
    const n = [...cells]; n[i] = v;
    onChange(n.join('\n').replace(/\n+$/, ''));
  };
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        {box != null ? <span className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span> : null} {label}{help && <HelpDot help={help} label={label} />}
      </div>
      <div className="space-y-1">
        {cells.map((c, i) => (
          <input key={i} value={c} placeholder={i === 0 ? placeholder : undefined} onChange={e => setAt(i, e.target.value)} className="input-base w-full py-1 text-[12.5px]" />
        ))}
      </div>
    </div>
  );
}

// Count populated boxes — overall (no tab) or per top tab (drives the (N) badges).
function sa101Count(sa: Sa101, tab?: string): number {
  const f = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!(v && String(v).trim()))).length;
  const otherUk = () => f([sa.giltInterestNet, sa.giltTaxTaken, sa.giltGross, sa.chargeableEventGains, sa.lifeGainNoTaxPaid, sa.voidedIsaGain, sa.voidedIsaTax, sa.deficiencyRelief, sa.stockDividends, sa.bonusIssues, sa.closeCompanyLoansWrittenOff, sa.businessReceipts, sa.businessReceiptsYear]);
  const shares = () => f([sa.shareSchemesTaxable, sa.taxableLumpSums, sa.efrbsBenefits, sa.redundancyReceipts, sa.taxOffLumpSums, sa.taxOnEmploymentPages, sa.exemptForeignService, sa.lumpSumExemption30k, sa.disabilityPortion, sa.seafarersDeduction, sa.foreignEarningsNotTaxable, sa.foreignTaxNoTcr, sa.exemptOverseasPensionContrib, sa.patentRoyaltyPayments, sa.vctSubscriptions, sa.eisSubscriptions, sa.citrInvestment, sa.annualPayments, sa.qualifyingLoanInterest, sa.postCessationExpenses, sa.preIncorporationLosses, sa.maintenancePayments, sa.tradeUnionDeathBenefits, sa.reliefRedemptionBonusShares, sa.seisSubscriptions, sa.nonDeductiblePropertyPartnershipInterest]);
  const mca = () => f([sa.mcaSpouseName, sa.mcaSpouseDob, sa.mcaTransferHalf, sa.mcaTransferAll, sa.mcaPrevSpouseDob, sa.mcaReceiveHalf, sa.mcaReceiveAll, sa.mcaSpousePartnerFullName, sa.mcaMarriageDate, sa.mcaHaveSurplus, sa.mcaGiveSurplus, sa.earlierYearsLosses, sa.unusedLossesCarriedForward, sa.laterYearReliefClaimed, sa.laterYearReliefNotLimited, sa.laterYearLossTaxYear, sa.payrollGiving]);
  const pension = () => f([sa.annualAllowanceExcess, sa.annualAllowanceTaxPaid, sa.pensionOverseasTransfer, sa.overseasTransferChargeTax, sa.pensionSchemeRef, sa.unauthNotSurcharge, sa.unauthSurcharge, sa.unauthForeignTax, sa.foreignLumpShortServiceRefund, sa.foreignLumpTaxable, sa.foreignLumpForeignTax, sa.avoidanceSchemeRefs, sa.avoidanceTaxYears]);
  switch (tab) {
    case 'Other UK Income': return otherUk();
    case 'Share schemes and other tax reliefs': return shares();
    case "Married couple's allowance & Other info": return mca();
    case 'Pension & Tax avoidance schemes': return pension();
    default: return otherUk() + shares() + mca() + pension();
  }
}
// Per-sub-tab count (drives the (N) badge on the SA101 level-3 sub-tabs).
function sa101SubCount(sa: Sa101, sub: string): number {
  const f = (vals: (number | boolean | string | undefined)[]) => vals.filter(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!(v && String(v).trim()))).length;
  switch (sub) {
    case 'Other UK Income': return f([sa.giltInterestNet, sa.giltTaxTaken, sa.giltGross]);
    case 'Life insurance gains': return f([sa.chargeableEventGains, sa.lifeGainTaxPaidYears, sa.lifeGainNoTaxPaid, sa.lifeGainNoTaxYears, sa.voidedIsaGain, sa.voidedIsaYears, sa.voidedIsaTax, sa.deficiencyRelief]);
    case 'Stock dividends & Bonus issues': return f([sa.stockDividends, sa.bonusIssues, sa.closeCompanyLoansWrittenOff]);
    case 'Business receipts taxed as income': return f([sa.businessReceipts, sa.businessReceiptsYear]);
    case 'Share schemes': return f([sa.shareSchemesTaxable, sa.taxableLumpSums, sa.efrbsBenefits, sa.redundancyReceipts, sa.taxOffLumpSums, sa.taxOnEmploymentPages, sa.exemptForeignService, sa.lumpSumExemption30k, sa.disabilityPortion, sa.seafarersDeduction, sa.foreignEarningsNotTaxable, sa.foreignTaxNoTcr, sa.exemptOverseasPensionContrib, sa.patentRoyaltyPayments]);
    case 'Other tax reliefs': return f([sa.vctSubscriptions, sa.eisSubscriptions, sa.citrInvestment, sa.annualPayments, sa.qualifyingLoanInterest, sa.postCessationExpenses, sa.preIncorporationLosses, sa.maintenancePayments, sa.tradeUnionDeathBenefits, sa.reliefRedemptionBonusShares, sa.seisSubscriptions, sa.nonDeductiblePropertyPartnershipInterest]);
    case "Married Couple's Allowance": return f([sa.mcaSpouseName, sa.mcaSpouseDob, sa.mcaTransferHalf, sa.mcaTransferAll, sa.mcaPrevSpouseDob, sa.mcaReceiveHalf, sa.mcaReceiveAll, sa.mcaSpousePartnerFullName, sa.mcaMarriageDate, sa.mcaHaveSurplus, sa.mcaGiveSurplus]);
    case 'Other information': return f([sa.earlierYearsLosses, sa.unusedLossesCarriedForward, sa.laterYearReliefClaimed, sa.laterYearReliefNotLimited, sa.laterYearLossTaxYear, sa.payrollGiving]);
    case 'Pension savings tax charges': return f([sa.annualAllowanceExcess, sa.annualAllowanceTaxPaid, sa.pensionOverseasTransfer, sa.overseasTransferChargeTax, sa.pensionSchemeRef, sa.unauthNotSurcharge, sa.unauthSurcharge, sa.unauthForeignTax, sa.foreignLumpShortServiceRefund, sa.foreignLumpTaxable, sa.foreignLumpForeignTax]);
    case 'Tax avoidance schemes': return f([sa.avoidanceSchemeRefs, sa.avoidanceTaxYears]);
  }
  return 0;
}

function AdditionalPage({ income, setIncome }: { income: Sa100Income; setIncome: SetIncome }) {
  const sa: Sa101 = income.additional ?? {};
  const set = (u: Partial<Sa101>) => setIncome(i => ({ ...i, additional: { ...i.additional, ...u } }));
  const [tab, setTab] = useState<string>(SA101_TABS[0]);
  const [sub, setSub] = useState(0);
  const setTop = (tt: string) => { setTab(tt); setSub(0); };
  const activeTab = (SA101_TABS as readonly string[]).includes(tab) ? tab : SA101_TABS[0];
  const subList = SA101_SUBTABS[activeTab] ?? [];
  const subName = subList[sub] ?? subList[0];

  return (
    <div className="space-y-3">
      <SectionTabs tabs={SA101_TABS.map(tt => ({ label: tt, count: sa101Count(sa, tt) }))} active={activeTab} onSelect={setTop} />
      {subList.length > 0 && <SubTabs tabs={subList.map(ss => ({ label: ss, count: sa101SubCount(sa, ss) }))} active={sub} onSelect={setSub} />}

      {/* ══ Tab 1 · Other UK Income ══ */}
      {activeTab === 'Other UK Income' && subName === 'Other UK Income' && (
        <div className="space-y-3">
          <SectionTitle title="Interest from gilts, deeply-discounted securities and accrued income profits" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <BreakdownField box={1} label="Gilt etc interest after tax taken off" title="Gilts etc" items={sa.giltItems ?? []} columns={GILT_COLS}
              blank={() => ({ id: s101id() })} rowTotal={g => (g.gross || 0) - (g.tax || 0)} fallbackTotal={sa.giltInterestNet ?? 0} help={ADD.giltInterestNet}
              onChange={items => set({ giltItems: items, giltInterestNet: sumK(items, 'gross') - sumK(items, 'tax'), giltGross: sumK(items, 'gross'), giltTaxTaken: sumK(items, 'tax') })} />
            <LabelledNum box={2} label="Tax taken off" value={sa.giltTaxTaken ?? 0} onChange={v => set({ giltTaxTaken: v })} help={ADD.giltTaxTaken} />
            <LabelledNum box={3} label="Gross amount before tax" value={sa.giltGross ?? 0} onChange={v => set({ giltGross: v })} help={ADD.giltGross} />
          </div>
        </div>
      )}
      {activeTab === 'Other UK Income' && subName === 'Life insurance gains' && (
        <div className="space-y-3">
          <SectionTitle title="Life insurance gains" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BreakdownField box={4} label="UK policy gains where tax was treated as paid — amount of gain" title="Life assurance gains" items={sa.lifeGainItems ?? []} columns={LIFE_COLS}
              blank={() => ({ id: s101id() })} rowTotal={g => g.gain || 0} fallbackTotal={sa.chargeableEventGains ?? 0} help={ADD.chargeableEventGains}
              onChange={items => set({ lifeGainItems: items, chargeableEventGains: sumK(items, 'gain'), chargeableEventUkPolicy: true })} />
            <LabelledNum box={5} label="Number of years the policy has been held" value={sa.lifeGainTaxPaidYears ?? 0} onChange={v => set({ lifeGainTaxPaidYears: v })} help={ADD.years} />
            <LabelledNum box={6} label="UK policy gains where no tax was treated as paid — amount of gain" value={sa.lifeGainNoTaxPaid ?? 0} onChange={v => set({ lifeGainNoTaxPaid: v })} help={ADD.lifeGainNoTaxPaid} />
            <LabelledNum box={7} label="Number of years the policy has been held" value={sa.lifeGainNoTaxYears ?? 0} onChange={v => set({ lifeGainNoTaxYears: v })} help={ADD.years} />
            <BreakdownField box={8} label="UK policy gains from voided ISAs" title="Gains from voided ISAs" items={sa.voidedIsaItems ?? []} columns={VOIDED_COLS}
              blank={() => ({ id: s101id() })} rowTotal={g => g.gain || 0} fallbackTotal={sa.voidedIsaGain ?? 0} help={ADD.voidedIsaGain}
              onChange={items => set({ voidedIsaItems: items, voidedIsaGain: sumK(items, 'gain'), voidedIsaTax: sumK(items, 'taxPaid') })} />
            <LabelledNum box={9} label="Number of years the policy has been held" value={sa.voidedIsaYears ?? 0} onChange={v => set({ voidedIsaYears: v })} help={ADD.years} />
            <LabelledNum box={10} label="Tax taken off box 8" value={sa.voidedIsaTax ?? 0} onChange={v => set({ voidedIsaTax: v })} help={ADD.voidedIsaTax} />
            <BreakdownField box={11} label="Deficiency relief" title="Deficiency relief" items={sa.deficiencyItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.deficiencyRelief ?? 0} help={ADD.deficiencyRelief}
              onChange={items => set({ deficiencyItems: items, deficiencyRelief: sumK(items, 'amount') })} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">Gains are added to income; box-4 gains carry a 20% credit (UK policy). Top-slicing relief and deficiency relief are captured but not applied to the headline tax — review before filing.</p>
        </div>
      )}
      {activeTab === 'Other UK Income' && subName === 'Stock dividends & Bonus issues' && (
        <div className="space-y-3">
          <SectionTitle title="Stock dividends, bonus issues of securities and redeemable shares" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <BreakdownField box={12} label="Stock dividends" title="Stock dividends" items={sa.stockDividendItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.stockDividends ?? 0} help={ADD.stockDividends}
              onChange={items => set({ stockDividendItems: items, stockDividends: sumK(items, 'amount') })} />
            <BreakdownField box={13} label="Bonus issues of securities and redeemable shares" title="Non-qualifying distributions" items={sa.bonusIssueItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.bonusIssues ?? 0} help={ADD.bonusIssues}
              onChange={items => set({ bonusIssueItems: items, bonusIssues: sumK(items, 'amount') })} />
            <LabelledNum box="13.1" label="Close company loans written off or released" value={sa.closeCompanyLoansWrittenOff ?? 0} onChange={v => set({ closeCompanyLoansWrittenOff: v })} help={ADD.closeCompanyLoansWrittenOff} />
          </div>
        </div>
      )}
      {activeTab === 'Other UK Income' && subName === 'Business receipts taxed as income' && (
        <div className="space-y-3">
          <SectionTitle title="Business receipts taxed as income of an earlier year" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BreakdownField box={14} label="Post-cessation or other business receipts" title="Post-cessation and other business receipts taxed as income of earlier years" items={sa.businessReceiptItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.businessReceipts ?? 0} help={ADD.businessReceipts}
              onChange={items => set({ businessReceiptItems: items, businessReceipts: sumK(items, 'amount') })} />
            <BoxText box={15} label="Tax year the income is to be taxed as" value={sa.businessReceiptsYear ?? ''} onChange={v => set({ businessReceiptsYear: v })} placeholder="YYYY-YY" help={ADD.businessReceiptsYear} />
          </div>
        </div>
      )}

      {/* ══ Tab 2 · Share schemes and other tax reliefs ══ */}
      {activeTab === 'Share schemes and other tax reliefs' && subName === 'Share schemes' && (
        <div className="space-y-3">
          <SectionTitle title="Share schemes, employment lump sums, compensation, deductions and patent royalties" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BreakdownField box={1} label="Share schemes — the taxable amount" title="Share schemes — the taxable amount" items={sa.shareSchemeItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.shareSchemesTaxable ?? 0} help={ADD.shareSchemesTaxable}
              onChange={items => set({ shareSchemeItems: items, shareSchemesTaxable: sumK(items, 'amount') })} />
            <LabelledNum box={3} label="Taxable lump sums" value={sa.taxableLumpSums ?? 0} onChange={v => set({ taxableLumpSums: v })} help={ADD.taxableLumpSums} />
            <LabelledNum box={4} label="Relevant benefits provided under an EFRBS" value={sa.efrbsBenefits ?? 0} onChange={v => set({ efrbsBenefits: v })} help={ADD.efrbsBenefits} />
            <LabelledNum box={5} label="Total redundancy and other receipts" value={sa.redundancyReceipts ?? 0} onChange={v => set({ redundancyReceipts: v })} help={ADD.redundancyReceipts} />
            <LabelledNum box={6} label="Tax taken off boxes 3 to 5" value={sa.taxOffLumpSums ?? 0} onChange={v => set({ taxOffLumpSums: v })} help={ADD.taxOffLumpSums} />
            <BoxCheck box={7} label="Has all tax taken off been included on the employment pages?" checked={!!sa.taxOnEmploymentPages} onChange={v => set({ taxOnEmploymentPages: v })} help={ADD.taxOnEmploymentPages} />
            <LabelledNum box={8} label="Exempt amount for foreign service" value={sa.exemptForeignService ?? 0} onChange={v => set({ exemptForeignService: v })} help={ADD.exemptForeignService} />
            <LabelledNum box={9} label="£30,000 lump sum exemption applicable" value={sa.lumpSumExemption30k ?? 0} onChange={v => set({ lumpSumExemption30k: v })} help={ADD.lumpSumExemption30k} />
            <LabelledNum box={10} label="Portion of the above paid for disability" value={sa.disabilityPortion ?? 0} onChange={v => set({ disabilityPortion: v })} help={ADD.disabilityPortion} />
            <LabelledNum box={11} label="Seafarers' Earnings Deduction" value={sa.seafarersDeduction ?? 0} onChange={v => set({ seafarersDeduction: v })} help={ADD.seafarersDeduction} />
            <LabelledNum box={12} label="Foreign earnings not taxable in the UK" value={sa.foreignEarningsNotTaxable ?? 0} onChange={v => set({ foreignEarningsNotTaxable: v })} help={ADD.foreignEarningsNotTaxable} />
            <LabelledNum box={13} label="Foreign tax for which tax credit relief not claimed" value={sa.foreignTaxNoTcr ?? 0} onChange={v => set({ foreignTaxNoTcr: v })} help={ADD.foreignTaxNoTcr} />
            <LabelledNum box={14} label="Exempt employers' contributions to an overseas pension scheme" value={sa.exemptOverseasPensionContrib ?? 0} onChange={v => set({ exemptOverseasPensionContrib: v })} help={ADD.exemptOverseasPensionContrib} />
            <BreakdownField box={15} label="UK patent royalty payments made" title="UK patent royalty payments made" items={sa.patentRoyaltyItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.patentRoyaltyPayments ?? 0} help={ADD.patentRoyaltyPayments}
              onChange={items => set({ patentRoyaltyItems: items, patentRoyaltyPayments: sumK(items, 'amount') })} />
          </div>
        </div>
      )}
      {activeTab === 'Share schemes and other tax reliefs' && subName === 'Other tax reliefs' && (
        <div className="space-y-3">
          <SectionTitle title="Other tax reliefs" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BreakdownField box={1} label="Subscriptions for Venture Capital Trust shares" title="Subscriptions for Venture Capital Trust shares" items={sa.vctItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.vctSubscriptions ?? 0} help={ADD.vctSubscriptions}
              onChange={items => set({ vctItems: items, vctSubscriptions: sumK(items, 'amount') })} />
            <BreakdownField box={2} label="Subscriptions for Enterprise Investment Scheme shares" title="Subscriptions for shares under the Enterprise Investment Scheme" items={sa.eisItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.eisSubscriptions ?? 0} help={ADD.eisSubscriptions}
              onChange={items => set({ eisItems: items, eisSubscriptions: sumK(items, 'amount') })} />
            <BreakdownField box={3} label="Community Investment Tax Relief" title="Community investment tax relief" items={sa.citrItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.citrInvestment ?? 0} help={ADD.citrInvestment}
              onChange={items => set({ citrItems: items, citrInvestment: sumK(items, 'amount') })} />
            <BreakdownField box={4} label="Annual payments made" title="Annual payments made" items={sa.annualPaymentItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.annualPayments ?? 0} help={ADD.annualPayments}
              onChange={items => set({ annualPaymentItems: items, annualPayments: sumK(items, 'amount') })} />
            <BreakdownField box={5} label="Qualifying loan interest" title="Qualifying loan interest" items={sa.qualifyingLoanItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.qualifyingLoanInterest ?? 0} help={ADD.qualifyingLoanInterest}
              onChange={items => set({ qualifyingLoanItems: items, qualifyingLoanInterest: sumK(items, 'amount') })} />
            <BreakdownField box={6} label="Post-cessation expenses and certain other losses" title="Post-cessation expenses and certain other losses" items={sa.postCessationItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.postCessationExpenses ?? 0} help={ADD.postCessationExpenses}
              onChange={items => set({ postCessationItems: items, postCessationExpenses: sumK(items, 'amount') })} />
            <LabelledNum box="6.1" label="Pre-incorporation losses" value={sa.preIncorporationLosses ?? 0} onChange={v => set({ preIncorporationLosses: v })} help={ADD.preIncorporationLosses} />
            <LabelledNum box={7} label="Maintenance payments (maximum £4,360)" value={sa.maintenancePayments ?? 0} onChange={v => set({ maintenancePayments: v })} help={ADD.maintenancePayments} />
            <LabelledNum box={8} label="Payments to a trade union etc. for death benefits" value={sa.tradeUnionDeathBenefits ?? 0} onChange={v => set({ tradeUnionDeathBenefits: v })} help={ADD.tradeUnionDeathBenefits} />
            <BreakdownField box={9} label="Relief claimed on redemption of bonus shares" title="Relief claimed on redemption of bonus shares" items={sa.redemptionBonusItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.reliefRedemptionBonusShares ?? 0} help={ADD.reliefRedemptionBonusShares}
              onChange={items => set({ redemptionBonusItems: items, reliefRedemptionBonusShares: sumK(items, 'amount') })} />
            <BreakdownField box={10} label="Subscriptions for Seed Enterprise Investment Scheme shares" title="Subscriptions for shares under the Seed Enterprise Investment Scheme" items={sa.seisItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.seisSubscriptions ?? 0} help={ADD.seisSubscriptions}
              onChange={items => set({ seisItems: items, seisSubscriptions: sumK(items, 'amount') })} />
            <LabelledNum box={12} label="Non-deductible loan interest from property-letting partnerships" value={sa.nonDeductiblePropertyPartnershipInterest ?? 0} onChange={v => set({ nonDeductiblePropertyPartnershipInterest: v })} help={ADD.nonDeductiblePropertyPartnershipInterest} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">EIS/VCT give a 30% reducer, SEIS 50%, CITR 5%, maintenance 10% (capped). Annual payments, qualifying loan interest and post-cessation losses are captured but not yet applied to the headline tax — review before filing.</p>
        </div>
      )}

      {/* ══ Tab 3 · Married couple's allowance & Other info ══ */}
      {activeTab === "Married couple's allowance & Other info" && subName === "Married Couple's Allowance" && (
        <div className="space-y-3">
          <SectionTitle title="Married Couple's Allowance" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxText box={1} label="Name of spouse or civil partner" value={sa.mcaSpouseName ?? ''} onChange={v => set({ mcaSpouseName: v })} help={ADD.mcaSpouseName} />
            <BoxText box={2} label="Spouse's date of birth" value={sa.mcaSpouseDob ?? ''} onChange={v => set({ mcaSpouseDob: v })} placeholder="dd-mm-yyyy" help={ADD.mcaSpouseDob} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={3} label="Transfer HALF of the minimum allowance to the lower-income spouse?" checked={!!sa.mcaTransferHalf} onChange={v => set({ mcaTransferHalf: v })} help={ADD.mcaTransferHalf} />
            <BoxCheck box={4} label="Transfer ALL of the minimum allowance to the lower-income spouse?" checked={!!sa.mcaTransferAll} onChange={v => set({ mcaTransferAll: v })} help={ADD.mcaTransferAll} />
          </div>
          <BoxText box={5} label="Date of birth of previous spouse or civil partner" value={sa.mcaPrevSpouseDob ?? ''} onChange={v => set({ mcaPrevSpouseDob: v })} placeholder="dd-mm-yyyy" help={ADD.mcaPrevSpouseDob} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={6} label="Receive HALF of the minimum allowance from your spouse?" checked={!!sa.mcaReceiveHalf} onChange={v => set({ mcaReceiveHalf: v })} help={ADD.mcaReceiveHalf} />
            <BoxCheck box={7} label="Receive ALL of the minimum allowance from your spouse?" checked={!!sa.mcaReceiveAll} onChange={v => set({ mcaReceiveAll: v })} help={ADD.mcaReceiveAll} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BoxText box={8} label="Your spouse's or civil partner's full name" value={sa.mcaSpousePartnerFullName ?? ''} onChange={v => set({ mcaSpousePartnerFullName: v })} help={ADD.mcaSpousePartnerFullName} />
            <BoxText box={9} label="Date of marriage or civil partnership" value={sa.mcaMarriageDate ?? ''} onChange={v => set({ mcaMarriageDate: v })} placeholder="dd-mm-yyyy" help={ADD.mcaMarriageDate} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <BoxCheck box={10} label="To have your spouse's or civil partner's surplus allowance?" checked={!!sa.mcaHaveSurplus} onChange={v => set({ mcaHaveSurplus: v })} help={ADD.mcaHaveSurplus} />
            <BoxCheck box={11} label="Give your spouse or civil partner your surplus allowance?" checked={!!sa.mcaGiveSurplus} onChange={v => set({ mcaGiveSurplus: v })} help={ADD.mcaGiveSurplus} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">Married Couple's Allowance (for couples where one was born before 6 April 1935) is captured for filing but not applied to the headline tax — review before filing.</p>
        </div>
      )}
      {activeTab === "Married couple's allowance & Other info" && subName === 'Other information' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <SectionTitle title="Other income losses" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <LabelledNum box={1} label="Earlier years' losses" value={sa.earlierYearsLosses ?? 0} onChange={v => set({ earlierYearsLosses: v })} help={ADD.earlierYearsLosses} />
              <LabelledNum box={2} label="Total unused losses carried forward" value={sa.unusedLossesCarriedForward ?? 0} onChange={v => set({ unusedLossesCarriedForward: v })} help={ADD.unusedLossesCarriedForward} />
            </div>
          </div>
          <div className="space-y-2">
            <SectionTitle title="Trade losses from a later year" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LabelledNum box={3} label="Relief claimed" value={sa.laterYearReliefClaimed ?? 0} onChange={v => set({ laterYearReliefClaimed: v })} help={ADD.laterYearReliefClaimed} />
              <LabelledNum box={4} label="Amount of relief not subject to the limit on Income Tax reliefs" value={sa.laterYearReliefNotLimited ?? 0} onChange={v => set({ laterYearReliefNotLimited: v })} help={ADD.laterYearReliefNotLimited} />
              <BoxText box={5} label="Tax year for which you are claiming" value={sa.laterYearLossTaxYear ?? ''} onChange={v => set({ laterYearLossTaxYear: v })} placeholder="YYYY-YY" help={ADD.laterYearLossTaxYear} />
            </div>
          </div>
          <div className="space-y-2">
            <SectionTitle title="Limit on Income Tax relief" />
            <BreakdownField box={6} label="Payments made through the Payroll Giving scheme" title="Payments made through the Payroll Giving scheme" items={sa.payrollGivingItems ?? []} columns={LINE_COLS}
              blank={() => ({ id: s101id(), amount: 0 })} rowTotal={x => x.amount || 0} fallbackTotal={sa.payrollGiving ?? 0} help={ADD.payrollGiving}
              onChange={items => set({ payrollGivingItems: items, payrollGiving: sumK(items, 'amount') })} />
          </div>
        </div>
      )}

      {/* ══ Tab 4 · Pension & Tax avoidance schemes ══ */}
      {activeTab === 'Pension & Tax avoidance schemes' && subName === 'Pension savings tax charges' && (
        <div className="space-y-3">
          <SectionTitle title="Pension Savings Tax Charges" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BreakdownField box={10} label="Amount saved in excess of the Annual Allowance" title="Amounts saved in excess of the Annual Allowance" items={sa.annualAllowanceItems ?? []} columns={AA_COLS}
              blank={() => ({ id: s101id() })} rowTotal={x => x.amount || 0} fallbackTotal={sa.annualAllowanceExcess ?? 0} help={ADD.annualAllowanceExcess}
              onChange={items => set({ annualAllowanceItems: items, annualAllowanceExcess: sumK(items, 'amount'), annualAllowanceTaxPaid: sumK(items, 'taxPaid') })} />
            <LabelledNum box={11} label="Annual Allowance tax paid by the scheme" value={sa.annualAllowanceTaxPaid ?? 0} onChange={v => set({ annualAllowanceTaxPaid: v })} help={ADD.annualAllowanceTaxPaid} />
            <LabelledNum box="11.1" label="Pension benefits transferred to an overseas scheme" value={sa.pensionOverseasTransfer ?? 0} onChange={v => set({ pensionOverseasTransfer: v })} help={ADD.pensionOverseasTransfer} />
            <LabelledNum box="11.2" label="Tax paid on your overseas transfer charge" value={sa.overseasTransferChargeTax ?? 0} onChange={v => set({ overseasTransferChargeTax: v })} help={ADD.overseasTransferChargeTax} />
            <BoxText box={12} label="Scheme reference" value={sa.pensionSchemeRef ?? ''} onChange={v => set({ pensionSchemeRef: v })} help={ADD.pensionSchemeRef} />
            <BreakdownField box={13} label="Unauthorised payment — amount not subject to surcharge" title="Unauthorised payments from a pension scheme" items={sa.unauthorisedItems ?? []} columns={UNAUTH_COLS}
              blank={() => ({ id: s101id() })} rowTotal={x => x.notSurcharge || 0} fallbackTotal={sa.unauthNotSurcharge ?? 0} help={ADD.unauthNotSurcharge}
              onChange={items => set({ unauthorisedItems: items, unauthNotSurcharge: sumK(items, 'notSurcharge'), unauthSurcharge: sumK(items, 'surcharge'), unauthForeignTax: sumK(items, 'foreignTax') })} />
            <LabelledNum box={14} label="Unauthorised payment — amount subject to surcharge" value={sa.unauthSurcharge ?? 0} onChange={v => set({ unauthSurcharge: v })} help={ADD.unauthSurcharge} />
            <LabelledNum box={15} label="Unauthorised payment — foreign tax paid" value={sa.unauthForeignTax ?? 0} onChange={v => set({ unauthForeignTax: v })} help={ADD.unauthForeignTax} />
            <BreakdownField box={16} label="Foreign lump sums — short service refund" title="Foreign lump sums" items={sa.foreignLumpItems ?? []} columns={FLUMP_COLS}
              blank={() => ({ id: s101id() })} rowTotal={x => x.shortServiceRefund || 0} fallbackTotal={sa.foreignLumpShortServiceRefund ?? 0} help={ADD.foreignLumpShortServiceRefund}
              onChange={items => set({ foreignLumpItems: items, foreignLumpShortServiceRefund: sumK(items, 'shortServiceRefund'), foreignLumpTaxable: sumK(items, 'taxableLumpSum'), foreignLumpForeignTax: sumK(items, 'foreignTax') })} />
            <LabelledNum box={17} label="Foreign lump sums — taxable lump sum" value={sa.foreignLumpTaxable ?? 0} onChange={v => set({ foreignLumpTaxable: v })} help={ADD.foreignLumpTaxable} />
            <LabelledNum box={18} label="Foreign lump sums — foreign tax paid" value={sa.foreignLumpForeignTax ?? 0} onChange={v => set({ foreignLumpForeignTax: v })} help={ADD.foreignLumpForeignTax} />
          </div>
          <p className="text-[10.5px] text-[var(--text-muted)]">Pension savings tax charges are captured for filing but not yet applied to the headline tax computation — review before filing.</p>
        </div>
      )}
      {activeTab === 'Pension & Tax avoidance schemes' && subName === 'Tax avoidance schemes' && (
        <div className="space-y-3">
          <SectionTitle title="Tax avoidance schemes" />
          <StackedInputs box={19} label="The scheme reference number(s)" value={sa.avoidanceSchemeRefs ?? ''} onChange={v => set({ avoidanceSchemeRefs: v })} rows={3} placeholder="Scheme reference number" help={ADD.avoidanceSchemeRefs} />
          <StackedInputs box={20} label="Tax year(s) in which the expected advantage arises" value={sa.avoidanceTaxYears ?? ''} onChange={v => set({ avoidanceTaxYears: v })} rows={3} placeholder="YYYY-YY" help={ADD.avoidanceTaxYears} />
        </div>
      )}
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
      {(() => {
        const parts = [
          { label: 'Employment', amount: c.employmentIncome },
          { label: 'Self-employment', amount: c.tradeProfit },
          { label: 'Partnership', amount: c.partnershipProfit },
          { label: 'Property', amount: c.propertyProfit },
          { label: 'Savings & interest', amount: c.savingsIncome },
          { label: 'Dividends', amount: c.dividendIncome },
          // 'Other income' is itemised into its own sub-components (pensions, minister, etc.)
          ...(c.otherIncomeParts.length ? c.otherIncomeParts : (c.otherIncome > 0 ? [{ label: 'Other income', amount: c.otherIncome }] : [])),
        ].filter(p => p.amount > 0);
        return parts.length > 1 ? (
          <div className="mb-1 ml-2 space-y-0.5 border-l-2 border-black/5 pl-2.5">
            {parts.map(p => (
              <div key={p.label} className="flex items-center justify-between text-[10.5px] text-[var(--text-muted)]">
                <span>{p.label}</span><span className="tabular-nums">{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        ) : null;
      })()}
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
