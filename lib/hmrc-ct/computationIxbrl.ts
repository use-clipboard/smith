// CT600 tax-computation iXBRL (Phase B — docs/ct-filing.md).
//
// HMRC's Corporation Tax Online service requires the tax computation to be filed
// as an INLINE XBRL (iXBRL) document — an XHTML page that reads as a normal
// computation, with the key figures tagged against HMRC's CT COMPUTATIONAL
// TAXONOMY. This is the counterpart to the statutory-accounts iXBRL
// (lib/accounts-studio/ixbrl.ts); the two are attached together to the CT600
// submission (Phases C/D).
//
// The iXBRL MECHANICS here — the ix: header, contexts, unit, nonFraction facts,
// number/sign/format handling — mirror lib/accounts-studio/ixbrl.ts, which is
// Arelle-validated. What is NOT yet validated is the CT-computational TAXONOMY
// itself:
//
//   ⚠⚠ CONCEPT QNAMES, THE NAMESPACE AND THE SCHEMA-REF ENTRY POINT ARE
//   PROVISIONAL. They follow the shape of HMRC's CT computational taxonomy but
//   have NOT been validated against the actual taxonomy. Before the first test
//   submission (Phase F): pin the exact taxonomy version, resolve every QName in
//   COMP_CONCEPTS against it with Arelle, and fix the namespace + entry point.
//   Every concept lives in COMP_CONCEPTS so corrections land in one place.

import type { TaxReturn } from '@/components/features/tax-studio/types';
import { computeCt600 } from '@/components/features/tax-studio/calc';

// ── Namespaces ───────────────────────────────────────────────────────────────
// ⚠ The `ct-comp` namespace + version segment are PROVISIONAL — confirm against
// the CT computational taxonomy pack in use before validating.
const NS = {
  xhtml:   'http://www.w3.org/1999/xhtml',
  ix:      'http://www.xbrl.org/2013/inlineXBRL',
  link:    'http://www.xbrl.org/2003/linkbase',
  xlink:   'http://www.w3.org/1999/xlink',
  xbrli:   'http://www.xbrl.org/2003/instance',
  xsi:     'http://www.w3.org/2001/XMLSchema-instance',
  iso4217: 'http://www.xbrl.org/2003/iso4217',
  ixt:     'http://www.xbrl.org/inlineXBRL/transformation/2015-02-26',
  'ct-comp': 'http://www.hmrc.gov.uk/schemas/ct/comp/2023-01-01',
} as const;

/** schemaRef entry point for the CT computational taxonomy. ⚠ PROVISIONAL. */
const COMP_SCHEMA_REF = 'http://www.hmrc.gov.uk/schemas/ct/comp/2023-01-01/CT-Comp-2023.xsd';

/** HMRC's Unique Taxpayer Reference identifier scheme (entity identifier). */
const UTR_SCHEME = 'http://www.hmrc.gov.uk/id/utr';

// ── Concept map (the ONLY place to correct taxonomy QNames) ⚠ PROVISIONAL ─────
const COMP_CONCEPTS = {
  companyName:        'ct-comp:CompanyName',
  utr:                'ct-comp:TaxReference',
  registrationNumber: 'ct-comp:CompanyRegistrationNumber',
  periodStart:        'ct-comp:StartOfPeriodCoveredByReturn',
  periodEnd:          'ct-comp:EndOfPeriodCoveredByReturn',
  turnover:           'ct-comp:Turnover',
  tradingProfit:      'ct-comp:NetTradingProfits',
  capitalAllowances:  'ct-comp:CapitalAllowances',
  loanRelationships:  'ct-comp:NonTradingLoanRelationshipProfits',
  propertyIncome:     'ct-comp:UKPropertyBusinessIncome',
  nonTradingIntangibles: 'ct-comp:NonTradingGainsIntangibles',
  otherIncome:        'ct-comp:OtherIncome',
  chargeableGains:    'ct-comp:NetChargeableGains',
  profitsBeforeDeductions: 'ct-comp:ProfitsBeforeOtherDeductions',
  deductionsAndReliefs: 'ct-comp:DeductionsAndReliefs',
  pctct:              'ct-comp:ProfitsChargeableToCorporationTax',
  corporationTaxChargeable: 'ct-comp:CorporationTaxChargeable',
  marginalRelief:     'ct-comp:MarginalReliefForCorporationTax',
  netCorporationTax:  'ct-comp:NetCorporationTaxChargeable',
  taxOutstanding:     'ct-comp:TaxPayable',
  rdExpenditureCredit: 'ct-comp:ResearchAndDevelopmentExpenditureCredit',
} as const;

// ── iXBRL fact helpers (mirror lib/accounts-studio/ixbrl.ts) ──────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const round0 = (n: number) => Math.round(n);

/** A signed £ numeric fact (whole pounds; CT figures are to the nearest £1). */
function num(concept: string, contextRef: string, value: number): string {
  const v = round0(value);
  const sign = v < 0 ? ' sign="-"' : '';
  return `<ix:nonFraction name="${concept}" contextRef="${contextRef}" unitRef="GBP" decimals="0" format="ixt:num-dot-decimal" scale="0"${sign}>${Math.abs(v)}</ix:nonFraction>`;
}
/** A non-numeric text fact. */
function text(concept: string, contextRef: string, value: string): string {
  return `<ix:nonNumeric name="${concept}" contextRef="${contextRef}">${esc(value)}</ix:nonNumeric>`;
}
/** yyyy-mm-dd → dd/mm/yyyy for display. */
function ukSlash(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
/** An inline date fact (shown dd/mm/yyyy, transformed to ISO). */
function dateFact(concept: string, contextRef: string, iso: string): string {
  return `<ix:nonNumeric name="${concept}" contextRef="${contextRef}" format="ixt:date-day-month-year">${ukSlash(iso)}</ix:nonNumeric>`;
}
/** A £ money row for the readable body: label + tagged figure (facts only when non-zero). */
function moneyRow(label: string, concept: string, contextRef: string, value: number, opts?: { strong?: boolean }): string {
  const cls = opts?.strong ? ' class="strong"' : '';
  const cell = value === 0 ? '£0' : `£${num(concept, contextRef, value)}`;
  return `<tr${cls}><td class="lbl">${esc(label)}</td><td class="num">${cell}</td></tr>`;
}

const isoOk = (d?: string): string | null => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export interface Ct600CompIxbrlResult {
  /** The complete iXBRL (XHTML) document. */
  document: string;
  utr: string | null;
}

export function buildCt600ComputationIxbrl(ret: TaxReturn): Ct600CompIxbrlResult {
  const periodStart = isoOk(ret.periodStart) ?? '';
  const periodEnd = isoOk(ret.periodEnd) ?? '';
  const utr = (ret.utr ?? '').replace(/[^0-9]/g, '').slice(0, 10) || null;
  const crn = (ret.companyRegNumber ?? '').trim();
  const companyName = ret.clientName || '';
  const c = computeCt600(ret.ct600, ret.taxYear, { periodStart: ret.periodStart, periodEnd: ret.periodEnd });
  const t = ret.ct600?.trading ?? {};

  // Single duration context for the whole accounting period, identified by UTR.
  const CTX = 'PERIOD';
  const identifier = `<xbrli:identifier scheme="${UTR_SCHEME}">${esc(utr || '0000000000')}</xbrli:identifier>`;
  const context = `<xbrli:context id="${CTX}">`
    + `<xbrli:entity>${identifier}</xbrli:entity>`
    + `<xbrli:period><xbrli:startDate>${periodStart}</xbrli:startDate><xbrli:endDate>${periodEnd}</xbrli:endDate></xbrli:period>`
    + `</xbrli:context>`;

  const rdCredits = (t.rdec || 0) + (t.avec || 0) + (t.vgec || 0);
  const taxOutstanding = Math.max(0, c.corporationTax - rdCredits);

  const K = COMP_CONCEPTS;
  const incomeRows = [
    moneyRow('Net trading profits', K.tradingProfit, CTX, Math.max(0, c.taxableTradingProfit)),
    c.nonTradingLoanProfit ? moneyRow('Non-trading loan relationship profits', K.loanRelationships, CTX, c.nonTradingLoanProfit) : '',
    c.propertyProfit ? moneyRow('UK property business income', K.propertyIncome, CTX, c.propertyProfit) : '',
    c.intangiblesProfit ? moneyRow('Non-trading gains on intangibles', K.nonTradingIntangibles, CTX, c.intangiblesProfit) : '',
    c.otherIncome ? moneyRow('Other income', K.otherIncome, CTX, c.otherIncome) : '',
    c.chargeableGains ? moneyRow('Net chargeable gains', K.chargeableGains, CTX, c.chargeableGains) : '',
  ].filter(Boolean).join('\n        ');

  const taxRows = [
    moneyRow('Profits chargeable to Corporation Tax', K.pctct, CTX, c.pctct, { strong: true }),
    moneyRow('Corporation Tax chargeable', K.corporationTaxChargeable, CTX, c.taxBeforeMarginalRelief),
    c.marginalRelief ? moneyRow('Less: marginal relief', K.marginalRelief, CTX, -c.marginalRelief) : '',
    moneyRow('Net Corporation Tax chargeable', K.netCorporationTax, CTX, c.corporationTax, { strong: true }),
    rdCredits ? moneyRow('Less: R&D / creative expenditure credits', K.rdExpenditureCredit, CTX, -rdCredits) : '',
  ].filter(Boolean).join('\n        ');

  const nsAttrs = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join('\n      ');

  const document = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="${NS.xhtml}"
      ${nsAttrs}
      xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
    <title>${esc(companyName)} — Corporation Tax computation</title>
    <style type="text/css">
      body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px;}
      h1{font-size:20px;margin:0 0 4px;} .sub{color:#555;font-size:12px;margin:0 0 24px;}
      h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:4px;margin:28px 0 8px;}
      table{width:100%;border-collapse:collapse;font-size:13px;} td{padding:4px 0;} td.num{text-align:right;font-variant-numeric:tabular-nums;}
      td.lbl{color:#222;} tr.strong td{font-weight:bold;border-top:1px solid #ccc;}
    </style>
  </head>
  <body>
    <div style="display:none">
      <ix:header>
        <ix:references>
          <link:schemaRef xlink:type="simple" xlink:href="${COMP_SCHEMA_REF}"/>
        </ix:references>
        <ix:resources>
          <xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit>
          ${context}
        </ix:resources>
      </ix:header>
    </div>

    <h1>${text(K.companyName, CTX, companyName)}</h1>
    <p class="sub">Tax reference (UTR) ${utr ? text(K.utr, CTX, utr) : '—'}${crn ? `<br/>Company registration number ${text(K.registrationNumber, CTX, crn)}` : ''}<br/>
      Corporation Tax computation for the period ${periodStart ? dateFact(K.periodStart, CTX, periodStart) : '—'} to ${periodEnd ? dateFact(K.periodEnd, CTX, periodEnd) : '—'}</p>

    <h2>Income and profits</h2>
    <table>
      <tbody>
        ${moneyRow('Turnover', K.turnover, CTX, c.turnover)}
        ${incomeRows}
        ${moneyRow('Profits before other deductions and reliefs', K.profitsBeforeDeductions, CTX, c.netProfits, { strong: true })}
        ${c.lossesReliefs ? moneyRow('Deductions and reliefs', K.deductionsAndReliefs, CTX, -c.lossesReliefs) : ''}
      </tbody>
    </table>

    <h2>Corporation Tax</h2>
    <table>
      <tbody>
        ${taxRows}
        ${moneyRow('Tax outstanding', K.taxOutstanding, CTX, taxOutstanding, { strong: true })}
      </tbody>
    </table>

    <p class="sub" style="margin-top:32px">Generated by SMITH Tax Studio — CT computation iXBRL. ⚠ Draft: taxonomy concepts are provisional; validate before filing.</p>
  </body>
</html>`;

  return { document, utr };
}
