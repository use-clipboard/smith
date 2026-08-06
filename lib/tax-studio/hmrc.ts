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

/** Best-effort extraction of headline figures from a retrieved calculation. The
 *  Individual Calculations response is deeply nested and version-dependent, so
 *  we probe the common locations and surface whatever is present. */
export function summariseCalculation(json: unknown): CalcSummary {
  const j = (json ?? {}) as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});
  // The taxCalculation block sits under `calculation`, `outputs`, or top-level
  // depending on the API version — probe all so the summary is version-tolerant.
  const calc = obj(j.calculation);
  const outputs = obj(j.outputs);
  const taxCalc = obj(calc.taxCalculation ?? outputs.taxCalculation ?? j.taxCalculation);
  const incomeTax = obj(taxCalc.incomeTax);
  const class4 = obj(obj(taxCalc.nics).class4Nics);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    calculationId: (j.calculationId as string) ?? (obj(j.metadata).calculationId as string) ?? null,
    totalIncomeTaxAndNicsDue: num(taxCalc.totalIncomeTaxAndNicsDue) ?? num(taxCalc.totalIncomeTaxAndNicsAndCgtDue) ?? num(taxCalc.totalIncomeTaxNicsCharged),
    incomeTaxDue: num(incomeTax.totalIncomeTaxDueAfterTaxReductions) ?? num(incomeTax.incomeTaxDueAfterReliefs) ?? num(incomeTax.incomeTaxCharged),
    class4NicDue: num(class4.class4NicsAmount) ?? num(class4.totalClass4Charge) ?? num(class4.totalIncomeTaxAndNicsDue),
    totalTaxable: num(taxCalc.totalTaxableIncome),
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
