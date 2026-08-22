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

// SA100 return namespace for 2025/26 — matches the targetNamespace of the 2026
// MTR schema (MTR-v1-2.xsd). The trailing "/1" is the schema major version.
const SA_NS = 'http://www.govtalk.gov.uk/taxation/SA/SA100/25-26/1';

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

/** Build every supplementary page in the schema's MTR sequence order:
 *  SA101, SA102, SA103F, SA104F, SA105, SA106, SA107, SA108, SA109, SA110.
 *  (Order is significant — the MTR type is an xsd:sequence.) All pages are
 *  validated against MTR-v1-2.xsd. */
function buildSupplementaryPages(ret: TaxReturn): string {
  const inc = ret.income;
  // The SA110 tax-calculation summary carries SMITH's own computation (HMRC
  // expects the software's calc). box1 = the income-tax side (total due less
  // CGT) net of tax deducted at source; box2 = the overpayment.
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
    buildSa101(inc.additional),          // Additional information
    buildSa102(inc.employment),          // Employment (repeatable)
    buildSa103(inc.selfEmployment),      // Self-employment (SA103F, repeatable)
    buildSa104(inc.partnerships),        // Partnership (SA104F, repeatable)
    buildSa105(inc.property, inc),       // UK property (+ return-level boxes 1–4)
    buildSa106(inc.foreign),             // Foreign (per-country rows)
    buildSa107(inc.sa107),               // Trusts & estates
    buildSa108(inc.sa108),               // Capital gains
    buildSa109(inc.residence),           // Residence / remittance
    buildSa110(inc.sa110, sa110Computed),// Tax calculation summary (required)
    // "More"/rare schedules not yet built: SA102M, SA103S, SA103L, SA104S.
  ].join('');
}

export function buildSa100Return(ret: TaxReturn): Sa100BuildResult {
  const periodEnd = periodEndFor(ret.taxYear);
  const utr = ret.utr ?? null;

  // IRheader — keys the return to the taxpayer + carries the (empty) IRmark.
  // Element order matches the MTR-v1-2.xsd IRheader sequence (Keys, PeriodEnd,
  // [Principal, Agent,] DefaultCurrency, [Manifest,] IRmark, Sender). The IRmark
  // is emitted empty here and filled downstream (irmark.ts).
  const irHeader = group('IRheader', [
    group('Keys', [el('Key', utr ?? undefined, { Type: 'UTR' })]),
    el('PeriodEnd', periodEnd),
    el('DefaultCurrency', 'GBP'),
    '<IRmark Type="generic"></IRmark>',
    el('Sender', 'Agent'),
  ]);

  // The MTR-level Declaration is a REQUIRED child of <MTR> after all SA pages.
  // It is an xsd:choice: agent filings use <AgentDeclaration>. (TODO: expose an
  // individual-vs-agent switch once non-agent filing is supported.)
  const mtrDeclaration = '<Declaration><AgentDeclaration>yes</AgentDeclaration></Declaration>';

  const returnBody = group('MTR', [
    buildSa100Core(ret),
    buildSupplementaryPages(ret),
    mtrDeclaration,
  ]);

  const irEnvelope = `<IRenvelope xmlns="${SA_NS}">${irHeader}${returnBody}</IRenvelope>`;
  return { irEnvelope, periodEnd, utr };
}
