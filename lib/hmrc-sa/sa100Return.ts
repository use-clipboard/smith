// Assemble the legacy SA100 return into an <IRenvelope> body.
//
// Pipeline:  TaxReturn ──build──▶ <IRenvelope> (IRmark empty)
//                        Phase 2 ──▶ compute + inject IRmark  (./irmark.ts)
//                        Phase 2 ──▶ wrap in <GovTalkMessage>  (./gateway.ts)
//                        Phase 3 ──▶ submit → poll → delete    (submit route)
//
// The IRmark is computed OVER this IRenvelope (with the <IRmark> element empty),
// so we emit it empty here and fill it downstream. Element names/structure are
// PROVISIONAL pending the 2025/26 SA100 XSD (Phase 0) — this file + ./pages/*
// are the single place first-round TPVS corrections land, mirroring how
// lib/companiesHouse/gateway.ts was built and then schema-validated.

import type { TaxReturn } from '@/components/features/tax-studio/types';
import { computeSa100Full } from '@/components/features/tax-studio/calc';
import { buildSa100Core } from './pages/sa100Core';
import { buildSa102 } from './pages/sa102Employment';
import { buildSa103 } from './pages/sa103SelfEmployment';
import { buildSa104 } from './pages/sa104Partnership';
import { buildSa105 } from './pages/sa105Property';
import { buildSa106 } from './pages/sa106Foreign';
import { buildSa107 } from './pages/sa107Trusts';
import { buildSa108 } from './pages/sa108CapitalGains';
import { buildSa109 } from './pages/sa109Residence';
import { buildSa110 } from './pages/sa110TaxCalc';
import { buildSa101 } from './pages/sa101Additional';
import { el, group } from './xml';

// ⚠ Confirm against the XSD: the SA schema namespace + version for 2025/26.
const SA_NS = 'http://www.govtalk.gov.uk/taxation/SA/SA100/24-25'; // placeholder — update to the 25-26 URI

/** '2025/26' → the 5 April period-end date HMRC keys the return on. */
export function periodEndFor(taxYear: string): string {
  const yy = parseInt(taxYear.slice(-2), 10);
  const endYear = Number.isNaN(yy) ? new Date().getUTCFullYear() : 2000 + yy;
  return `${endYear}-04-05`;
}

export interface Sa100BuildResult {
  /** The <IRenvelope> XML with an EMPTY <IRmark> — Phase 2 computes and injects it. */
  irEnvelope: string;
  periodEnd: string;
  utr: string | null;
}

/** Build every supplementary page in schedule order. SA102 is wired; the rest
 *  are TODO (Phase 1 continuation) — each follows sa102Employment.ts's shape. */
function buildSupplementaryPages(ret: TaxReturn): string {
  const inc = ret.income;
  // SA110 boxes 1–5 come from SMITH's own computation (HMRC expects the
  // software's calc on the tax-calculation summary). box1 = the income-tax side
  // (total due less CGT) net of tax deducted at source; box2 = the overpayment.
  const c = computeSa100Full(inc, ret.taxYear);
  const incomeSide = Math.round(c.totalDue) - c.capitalGainsTax;
  const sa110Computed = {
    box1: Math.max(0, incomeSide - c.taxDeductedAtSource),
    box2: Math.max(0, c.taxDeductedAtSource - incomeSide),
    studentLoan: c.studentLoan,
    class4Nic: c.class4Nic,
    capitalGainsTax: c.capitalGainsTax,
  };
  return [
    buildSa102(inc.employment),          // Employment
    buildSa103(inc.selfEmployment),      // Self-employment (full/short)
    buildSa104(inc.partnerships),        // Partnership
    buildSa105(inc.property, inc),       // UK property (+ return-level boxes 1–4)
    buildSa108(inc.sa108),               // Capital gains
    buildSa106(inc.foreign),             // Foreign (summary-level; per-country detail TODO)
    buildSa107(inc.sa107),               // Trusts & estates
    buildSa109(inc.residence),           // Residence / remittance
    buildSa101(inc.additional),          // Additional information
    buildSa110(inc.sa110, sa110Computed),// Tax calculation summary (computed boxes 1–5 + user boxes 7–17)
    // "More" schedules (rare, TODO): SA102M / SA102 devolved-legislature / SA103L
  ].join('');
}

export function buildSa100Return(ret: TaxReturn): Sa100BuildResult {
  const periodEnd = periodEndFor(ret.taxYear);
  const utr = ret.utr ?? null;

  // IRheader — keys the return to the taxpayer + carries the (empty) IRmark.
  // ⚠ Confirm the exact IRheader shape (Keys/PeriodEnd/Principal/Sender/IRmark
  //    ordering + the return wrapper) against the XSD.
  const irHeader = group('IRheader', [
    group('Keys', [el('Key', utr ?? undefined, { Type: 'UTR' })]),
    el('PeriodEnd', periodEnd),
    el('DefaultCurrency', 'GBP'),
    '<IRmark Type="generic"></IRmark>',
    el('Sender', 'Agent'),
  ]);

  const returnBody = group('MTR', [
    buildSa100Core(ret),
    buildSupplementaryPages(ret),
  ]);

  const irEnvelope = `<IRenvelope xmlns="${SA_NS}">${irHeader}${returnBody}</IRenvelope>`;
  return { irEnvelope, periodEnd, utr };
}
