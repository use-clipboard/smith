// Tax Studio — Planning Sandbox helpers.

import {
  PiggyBank, Coins, Scale, Wrench, Home, SlidersHorizontal, type LucideIcon,
} from 'lucide-react';
import { computeSa100Full, estimateNic } from '../calc';
import { fmtMoney } from '../data';
import type { Sa100Income, Scenario, TaxReturn } from '../types';

export interface ScenarioResult {
  totalIncome: number;
  taxableIncome: number;
  incomeTax: number;
  nic: number;                // Class 4 + employee Class 1 (whole-position view)
  totalTaxAndNic: number;
  netPosition: number;
}

export function scenarioResult(income: Sa100Income, taxYear: string): ScenarioResult {
  const c = computeSa100Full(income, taxYear);
  const nic = estimateNic(income, true);
  const totalTaxAndNic = c.incomeTax + nic;
  return {
    totalIncome: c.totalIncome,
    taxableIncome: c.taxableIncome,
    incomeTax: c.incomeTax,
    nic,
    totalTaxAndNic,
    netPosition: c.totalIncome - totalTaxAndNic,
  };
}

/** The live return as a read-only "Current Plan" scenario. */
export function currentPlanScenario(ret: TaxReturn): Scenario {
  return { id: 'current', name: 'Current Plan', base: true, income: ret.income };
}

let idCounter = 0;
export function newScenarioId(): string {
  idCounter += 1;
  return `sc-${idCounter}-${Date.now().toString(36)}`;
}

// ── Quick-action modellers ───────────────────────────────────────────────────
export type QuickKind = 'pension' | 'dividends' | 'salary-dividends' | 'capex' | 'property' | 'other';

export const QUICK_ACTIONS: { kind: QuickKind; icon: LucideIcon; title: string; sub: string }[] = [
  { kind: 'pension',          icon: PiggyBank,        title: 'Increase pension',   sub: 'See the impact of additional pension contributions.' },
  { kind: 'dividends',        icon: Coins,            title: 'Take dividends',     sub: 'Model different dividend amounts.' },
  { kind: 'salary-dividends', icon: Scale,            title: 'Salary vs dividends',sub: 'Optimise your remuneration.' },
  { kind: 'capex',            icon: Wrench,           title: 'Capital expenditure',sub: 'Test timing of capital purchases.' },
  { kind: 'property',         icon: Home,             title: 'Property scenarios', sub: 'Review property sale or transfer.' },
  { kind: 'other',            icon: SlidersHorizontal,title: 'Other adjustments',  sub: 'Explore other tax adjustments.' },
];

function clone(i: Sa100Income): Sa100Income {
  return {
    ...i,
    employment: i.employment.map(e => ({ ...e })),
    selfEmployment: i.selfEmployment.map(s => ({ ...s })),
    property: i.property.map(p => ({ ...p })),
  };
}

/** Build a new scenario income from the current plan for a quick action. */
export function buildQuickScenario(kind: QuickKind, base: Sa100Income): { name: string; income: Sa100Income } {
  const income = clone(base);
  switch (kind) {
    case 'pension':
      income.pensionContributions = (income.pensionContributions || 0) + 5000;
      return { name: 'Increase Pension', income };
    case 'dividends':
      income.dividends = (income.dividends || 0) + 10000;
      return { name: 'Take Dividends', income };
    case 'salary-dividends':
      if (income.employment[0]) income.employment[0].pay = Math.max(0, income.employment[0].pay - 10000);
      income.dividends = (income.dividends || 0) + 10000;
      return { name: 'Salary vs Dividends', income };
    case 'capex':
      if (income.selfEmployment[0]) income.selfEmployment[0].profit = Math.max(0, income.selfEmployment[0].profit - 10000);
      else income.otherIncome = Math.max(0, income.otherIncome - 10000);
      return { name: 'Capital Expenditure', income };
    case 'property':
      if (income.property[0]) income.property[0].profit = Math.max(0, income.property[0].profit - 5000);
      return { name: 'Property', income };
    case 'other':
      income.giftAid = (income.giftAid || 0) + 1000;
      return { name: 'Other Adjustments', income };
  }
}

// ── Key assumptions (shown in the sandbox side panel) ─────────────────────────
export function keyAssumptions(income: Sa100Income): { label: string; value: string }[] {
  return [
    { label: 'Personal allowance', value: fmtMoney(12570) },
    { label: 'Basic rate band', value: fmtMoney(37700) },
    { label: 'Higher rate band', value: fmtMoney(125140) },
    { label: 'Additional rate', value: '45%' },
    { label: 'Pension contributions', value: fmtMoney(income.pensionContributions || 0) },
    { label: 'Gift Aid donations', value: fmtMoney(income.giftAid || 0) },
  ];
}

// ── Planning insights ────────────────────────────────────────────────────────
export function planningInsights(ret: TaxReturn): string[] {
  const out: string[] = [];
  const base = scenarioResult(ret.income, ret.taxYear);
  // Best saving across stored scenarios.
  let best: { name: string; saving: number } | null = null;
  for (const s of ret.scenarios) {
    const r = scenarioResult(s.income, ret.taxYear);
    const saving = base.totalTaxAndNic - r.totalTaxAndNic;
    if (saving > 0 && (!best || saving > best.saving)) best = { name: s.name, saving };
  }
  // Illustrative pension headroom: +£10k contribution at the marginal rate.
  const bumped = { ...ret.income, pensionContributions: (ret.income.pensionContributions || 0) + 10000 };
  const bumpSaving = base.totalTaxAndNic - scenarioResult(bumped, ret.taxYear).totalTaxAndNic;
  if (bumpSaving > 0) out.push(`A further ${fmtMoney(10000)} pension contribution could save up to ${fmtMoney(bumpSaving)} in tax this year.`);
  if (best) out.push(`Scenario “${best.name}” shows the highest potential saving of ${fmtMoney(best.saving)}.`);
  if (out.length === 0) out.push('Create a scenario to see planning insights based on the client’s figures.');
  return out;
}
