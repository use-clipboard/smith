// Assemble a CT600 Company Tax Return into an <IRenvelope> body.
//
// Pipeline:  TaxReturn ──build──▶ <IRenvelope> (IRmark empty)
//                        Phase D ──▶ compute + inject IRmark   (./irmark.ts)
//                        Phase D ──▶ wrap in <GovTalkMessage>   (./gateway.ts)
//                        Phase E ──▶ submit → poll → delete     (ct-submit route)
//
// The IRmark is computed OVER this IRenvelope (with <IRmark> empty), so we emit it
// empty here and fill it downstream — same as lib/hmrc-sa/sa100Return.ts.
//
// ⚠⚠ ELEMENT NAMES AND STRUCTURE ARE PROVISIONAL. They follow the shape of HMRC's
// CT GovTalk schema (CompanyTaxReturn) from documentation, but have NOT yet been
// validated against the official CT600 schema pack. Validate against the current
// CT schema XSD before the first test submission (Phase A/F, docs/ct-filing.md).
// Every wire-format correction lands in THIS file — the calc and UI never change.
//
// NOT YET EMITTED (later phases):
//   • <AttachedFiles> — the accounts + computation iXBRL (Phases C/D).
//   • Financial-year apportionment for periods straddling 1 April (single FY here).
//   • Group relief, instalments, ring-fence — not modelled by computeCt600.

import type { TaxReturn } from '@/components/features/tax-studio/types';
import { computeCt600 } from '@/components/features/tax-studio/calc';
import { el, group, isoDate, moneyDown, digitsOnly, clip } from './xml';

// CT600 return namespace. ⚠ Confirm the exact version segment against the schema
// pack in use at build time before validating.
const CT_NS = 'http://www.govtalk.gov.uk/taxation/CT/5';

/** HMRC financial year (1 Apr–31 Mar) that an ISO date falls in, named by its
 *  starting calendar year. 2025-06-30 → 2025; 2026-02-01 → 2025. */
function financialYearOf(iso?: string): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m] = iso.split('-').map(Number);
  return m >= 4 ? y : y - 1;
}

export interface Ct600BuildResult {
  /** The <IRenvelope> XML with an EMPTY <IRmark> — Phase D computes and injects it. */
  irEnvelope: string;
  periodStart: string | null;
  periodEnd: string | null;
  utr: string | null;
}

export function buildCt600Return(ret: TaxReturn): Ct600BuildResult {
  const periodStart = isoDate(ret.periodStart);
  const periodEnd = isoDate(ret.periodEnd);
  const utr = digitsOnly(ret.utr ?? undefined, 10);
  const crn = clip(ret.companyRegNumber ?? undefined, 8);
  const c = computeCt600(ret.ct600, ret.taxYear, { periodStart: ret.periodStart, periodEnd: ret.periodEnd });
  const t = ret.ct600?.trading ?? {};

  // ── IRheader — keys the return to the company UTR + carries the empty IRmark ──
  const irHeader = group('IRheader', [
    group('Keys', [el('Key', utr ?? undefined, { Type: 'UTR' })]),
    el('PeriodEnd', periodEnd ?? undefined),
    el('DefaultCurrency', 'GBP'),
    '<IRmark Type="generic"></IRmark>',
    el('Sender', 'Agent'),
  ]);

  // ── Company information ──
  const companyInformation = group('CompanyInformation', [
    el('CompanyName', clip(ret.clientName, 56) ?? undefined),
    el('RegistrationNumber', crn ?? undefined),
    el('Reference', utr ?? undefined),
    group('PeriodCovered', [
      el('From', periodStart ?? undefined),
      el('To', periodEnd ?? undefined),
    ]),
  ]);

  // ── Turnover (box 145) ──
  const turnover = group('Turnover', [el('Total', moneyDown(c.turnover))]);

  // ── Income / profits chain ──
  // Box 165 net trading profits (155 less 160); 170 loan relationships; 190
  // property; 205 other income; 220 net chargeable gains; 235 profits before
  // other deductions; 295 deductions & reliefs; 315 chargeable profits (PCTCT).
  const box165 = Math.max(0, c.taxableTradingProfit - (ret.ct600?.losses?.trading.bfSetTradingProfits || 0)); // net trading profits (155 less 160)
  const income = group('Income', [
    group('Trading', [el('Profits', moneyDown(box165))]),
    el('NonTradingLoanProfitsAndGains', moneyDown(c.nonTradingLoanProfit)),
    el('IncomeFromUKProperty', moneyDown(c.propertyProfit)),
    el('NonTradingGainsIntangibles', moneyDown(c.intangiblesProfit)),
    el('OtherIncome', moneyDown(c.otherIncome)),
  ]);
  const chargeableGains = group('ChargeableGains', [el('NetChargeableGains', moneyDown(c.chargeableGains))]);

  const profitsBeforeDeductions = el('ProfitsBeforeOtherDeductions', moneyDown(c.netProfits));         // box 235
  const deductionsAndReliefs = el('DeductionsAndReliefs', moneyDown(c.lossesReliefs));                 // box 295
  const chargeableProfits = el('ChargeableProfits', moneyDown(c.pctct));                               // box 315

  // ── Corporation Tax chargeable (single financial year for now) ──
  const fy = financialYearOf(periodStart ?? periodEnd ?? undefined);
  const statutoryRate = c.pctct > 0 ? (c.taxBeforeMarginalRelief / c.pctct) * 100 : c.ctRatePct;
  const corporationTaxChargeable = group('CorporationTaxChargeable', [
    group('FinancialYearOne', [
      el('Year', fy ?? undefined),
      group('Details', [
        el('Profit', moneyDown(c.pctct)),
        el('TaxRate', statutoryRate > 0 ? statutoryRate.toFixed(2) : undefined),
        el('Tax', moneyDown(c.taxBeforeMarginalRelief)),
      ]),
    ]),
  ]);

  // ── Reliefs / net tax (marginal relief box 435; net CT box 440/475) ──
  const marginalReliefBlock = group('MarginalReliefForFinancialYear', [
    el('MarginalReliefAmount', moneyDown(c.marginalRelief)),
  ]);
  const netCorporationTax = el('CorporationTaxChargeableAfterReliefs', moneyDown(c.corporationTax));   // box 440/475

  const companyTaxCalculation = group('CompanyTaxCalculation', [
    income,
    chargeableGains,
    profitsBeforeDeductions,
    deductionsAndReliefs,
    chargeableProfits,
    corporationTaxChargeable,
    marginalReliefBlock,
    netCorporationTax,
  ]);

  // ── Tax outstanding (box 600 = 525 less R&D/creative credits 545) ──
  const box545 = (t.rdec || 0) + (t.avec || 0) + (t.vgec || 0);
  const taxOutstanding = group('CalculationOfTaxOutstandingOrOverpaid', [
    el('NetCorporationTaxLiability', moneyDown(c.corporationTax)),
    el('TaxChargeable', moneyDown(c.corporationTax)),
    el('TaxOutstanding', moneyDown(Math.max(0, c.corporationTax - box545))),
  ]);

  // ── Declaration ──
  // Agent filing. TODO(Phase E): capture the signatory name/status in Approval and
  // switch AcceptDeclaration accordingly; enforce it in the pre-submission gate.
  const declaration = group('Declaration', [
    el('AcceptDeclaration', 'yes'),
    el('Name', clip(ret.preparedBy, 56) ?? undefined),
    el('Status', 'Agent'),
  ]);

  const companyTaxReturn = group('CompanyTaxReturn', [
    companyInformation,
    turnover,
    companyTaxCalculation,
    taxOutstanding,
    declaration,
    // TODO(Phase C/D): <AttachedFiles> — accounts iXBRL + computation iXBRL.
  ], { ReturnType: 'new' });

  const irEnvelope = `<IRenvelope xmlns="${CT_NS}">${irHeader}${companyTaxReturn}</IRenvelope>`;
  return { irEnvelope, periodStart, periodEnd, utr };
}
