// Tax Studio — HMRC ITSA year-end (final declaration / crystallisation) helpers.
//
// Reuses the shared HMRC infrastructure (token resolution + refresh in
// lib/hmrc/api, fraud headers, base URL / sandbox flag). Implements the three
// Individual Calculations API calls the SA100 year-end needs, which do NOT
// exist elsewhere in the codebase:
//   1. trigger a final-declaration tax calculation
//   2. retrieve that calculation
//   3. submit the final declaration (crystallise)
//
// Endpoints match Individual Calculations (MTD) API v8.0 (developer.service.hmrc.gov.uk):
//   trigger:           POST .../self-assessment/{taxYear}/trigger/{calculationType}
//                      (calculationType 'intent-to-finalise' for the final-declaration journey)
//   retrieve:          GET  .../self-assessment/{taxYear}/{calculationId}
//   final declaration: POST .../self-assessment/{taxYear}/{calculationId}/final-declaration
// HMRC pins the version in the Accept header. Override with HMRC_ITSA_CALC_VERSION
// if HMRC ships a newer version. The retrieve response shape should still be
// confirmed against the sandbox (see docs/tax-studio-hmrc-sandbox.md).

import { hmrcRequest, hmrcErrorMessage, type HmrcConnection } from '@/lib/hmrc/api';

export const ITSA_CALC_VERSION = process.env.HMRC_ITSA_CALC_VERSION || '8.0';

// The final-declaration journey triggers an 'intent-to-finalise' calculation,
// which the customer reviews, then confirms via the final-declaration endpoint.
const TRIGGER_CALC_TYPE = 'intent-to-finalise';

/** '2025/26' → '2025-26' (the ITSA API tax-year format). */
export function itsaTaxYear(label: string): string {
  const s = parseInt(label.slice(0, 4), 10);
  if (Number.isNaN(s)) return label;
  return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
}

type Common = {
  conn: HmrcConnection;
  nino: string;
  taxYear: string;            // ITSA format '2025-26'
  fraudHeaders: Record<string, string>;
  testScenario?: string;
};

export interface CalcSummary {
  calculationId: string | null;
  totalIncomeTaxAndNicsDue: number | null;
  incomeTaxDue: number | null;
  class4NicDue: number | null;
  totalTaxable: number | null;
}

// The Individual Calculations retrieve response is large and deeply nested
// (calculation.taxCalculation.{incomeTax,nics,...}), and the nesting shifts a
// little between API versions. Rather than pin one fragile path, we deep-search
// the response tree for HMRC's canonical, distinctive field names. These names
// are unique in the schema (per-source objects use `taxableIncome`, only the
// summary uses `totalTaxableIncome`, etc.), so the first depth-first hit is the
// summary figure — resilient to nesting/version changes.

/** First numeric value found for `key` anywhere in the object tree. */
function deepNumber(node: unknown, key: string): number | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj[key] === 'number') return obj[key] as number;
  for (const v of Object.values(obj)) {
    const found = deepNumber(v, key);
    if (found != null) return found;
  }
  return null;
}
function deepString(node: unknown, key: string): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj[key] === 'string') return obj[key] as string;
  for (const v of Object.values(obj)) {
    const found = deepString(v, key);
    if (found != null) return found;
  }
  return null;
}
/** First candidate key (in priority order) that resolves to a number. */
function firstNumber(root: unknown, keys: string[]): number | null {
  for (const k of keys) { const n = deepNumber(root, k); if (n != null) return n; }
  return null;
}

export function summariseCalculation(json: unknown): CalcSummary {
  const root = json ?? {};
  return {
    calculationId: deepString(root, 'calculationId'),
    totalIncomeTaxAndNicsDue: firstNumber(root, ['totalIncomeTaxAndNicsDue', 'totalIncomeTaxAndNicsAndCgtDue', 'totalIncomeTaxNicsCharged']),
    incomeTaxDue: firstNumber(root, ['incomeTaxDueAfterTaxReductions', 'totalIncomeTaxDueAfterTaxReductions', 'incomeTaxDueAfterReliefs', 'incomeTaxCharged']),
    class4NicDue: firstNumber(root, ['totalClass4Charge', 'class4NicsAmount']),
    totalTaxable: firstNumber(root, ['totalTaxableIncome']),
  };
}

export async function triggerFinalCalculation(c: Common): Promise<{ ok: boolean; status: number; calculationId: string | null; error?: string }> {
  const r = await hmrcRequest(c.conn, `/individuals/calculations/${c.nino}/self-assessment/${c.taxYear}/trigger/${TRIGGER_CALC_TYPE}`, {
    method: 'POST', version: ITSA_CALC_VERSION, fraudHeaders: c.fraudHeaders, testScenario: c.testScenario,
  });
  if (r.status >= 200 && r.status < 300) {
    const calcId = (r.json as { calculationId?: string } | null)?.calculationId ?? null;
    return { ok: true, status: r.status, calculationId: calcId };
  }
  return { ok: false, status: r.status, calculationId: null, error: hmrcErrorMessage(r.json) };
}

export async function retrieveCalculation(c: Common & { calculationId: string }): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const r = await hmrcRequest(c.conn, `/individuals/calculations/${c.nino}/self-assessment/${c.taxYear}/${c.calculationId}`, {
    version: ITSA_CALC_VERSION, fraudHeaders: c.fraudHeaders, testScenario: c.testScenario,
  });
  const ok = r.status >= 200 && r.status < 300;
  return { ok, status: r.status, json: r.json, error: ok ? undefined : hmrcErrorMessage(r.json) };
}

export async function submitFinalDeclaration(c: Common & { calculationId: string }): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> {
  const r = await hmrcRequest(c.conn, `/individuals/calculations/${c.nino}/self-assessment/${c.taxYear}/${c.calculationId}/final-declaration`, {
    method: 'POST', version: ITSA_CALC_VERSION, fraudHeaders: c.fraudHeaders, testScenario: c.testScenario,
  });
  const ok = r.status >= 200 && r.status < 300;
  return { ok, status: r.status, json: r.json, error: ok ? undefined : hmrcErrorMessage(r.json) };
}
