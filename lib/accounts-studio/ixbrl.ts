// Accounts Studio — iXBRL generation.
//
// Produces an Inline XBRL (iXBRL) document — a single XHTML file that is both
// human-readable and machine-tagged — from an engagement's structured
// FinancialStatements, for online filing to Companies House.
//
// ── STATUS ───────────────────────────────────────────────────────────────────
// Both FRS 102 Section 1A and FRS 105 output VALIDATE CLEAN against the FRC 2023
// taxonomy under Arelle 2.42.1 — no errors, warnings or inconsistencies, WITH
// XBRL Dimensions + calculation validation. (Micro-entity FRS 105 has no separate
// taxonomy; it tags against the same FRS-102 entry point — see ENTRY_POINTS.)
// That covers: well-formed iXBRL, valid XBRL 2.1, the creditor-maturity dimension
// (carried on <scenario>), every concept QName in the CONCEPTS table below
// resolving against the taxonomy, and articulated figures. (Validated 2026-07-21;
// see docs/ch-filing.md.)
//
// ⚠ STILL EXTERNAL to this technical pass: Companies House business rules — CH's
// own validation layer requires mandatory content beyond taxonomy-validity (e.g.
// the balance-sheet statements, director-approval name, accountant's report, and
// for micro-entities the s.442/micro-entity provisions statements). Test via the
// CH iXBRL validation service / a test submission; extend the tagged facts as
// needed. (The micro-entity concept SET differs from small-company, but that's a
// content question on top of the taxonomy-validity confirmed here.)
//
// FRC 2023 suite: v1.0.1 (hotfix 17 Feb 2023), usable from 5 Apr 2023. CH also
// accepts the 2024/2025/2026 suites — bump the dated URLs/namespaces together.

import type { FinancialStatements } from './statements';

// ── Namespaces ───────────────────────────────────────────────────────────────
const NS = {
  xhtml:   'http://www.w3.org/1999/xhtml',
  ix:      'http://www.xbrl.org/2013/inlineXBRL',
  ixt:     'http://www.xbrl.org/inlineXBRL/transformation/2020-02-12', // ixt v4
  xbrli:   'http://www.xbrl.org/2003/instance',
  link:    'http://www.xbrl.org/2003/linkbase',
  xlink:   'http://www.w3.org/1999/xlink',
  xbrldi:  'http://xbrl.org/2006/xbrldi',
  iso4217: 'http://www.xbrl.org/2003/iso4217',
  // FRC 2023 taxonomy namespaces (dated 2023-01-01). core + bus confirmed via
  // Arelle validation (the FRS-102 entry point imports frc-core + bus at these
  // exact URIs). `countries` is declared for foreign-property use but unused here.
  core:      'http://xbrl.frc.org.uk/fr/2023-01-01/core',
  bus:       'http://xbrl.frc.org.uk/cd/2023-01-01/business',
  countries: 'http://xbrl.frc.org.uk/cd/2023-01-01/countries',
};

/** Companies House uses this scheme for the entity identifier (company number). */
const CH_ENTITY_SCHEME = 'http://www.companieshouse.gov.uk/';

/** Taxonomy entry point (schemaRef target) per framework.
 *
 * There is NO separate FRS-105 taxonomy: micro-entity (FRS 105) accounts tag
 * against the FRS-102 "UK GAAP" entry point, which carries both the small-company
 * and micro-entity concepts. (A `/FRS-105/…` URL does not exist — it 403s.) So
 * both frameworks resolve to the same entry point; the keys are kept distinct in
 * case the FRC ever splits out a micro entry point. Both Arelle-validated. */
const FRS_102_ENTRY = 'https://xbrl.frc.org.uk/FRS-102/2023-01-01/FRS-102-2023-01-01.xsd';
const ENTRY_POINTS: Record<IxbrlFramework, string> = {
  'frs105':    FRS_102_ENTRY,
  'frs102-1a': FRS_102_ENTRY,
};

export type IxbrlFramework = 'frs105' | 'frs102-1a';

export interface IxbrlInput {
  companyName: string;
  companyNumber: string;
  /** yyyy-mm-dd */
  periodStartIso: string;
  periodEndIso: string;
  priorStartIso?: string | null;
  priorEndIso?: string | null;
  framework: IxbrlFramework;
  statements: FinancialStatements;
}

// ── Concept map ──────────────────────────────────────────────────────────────
// Maps the figures we hold to FRC 2023 concept QNames. Every QName below was
// confirmed to resolve against the taxonomy by Arelle (no missingReferences).
// `maturity` marks the creditor facts that carry the maturity dimension — CH
// requires creditors to be split within/after one year, via the dimensioned
// contexts (IC-W / IC-A etc.).
type PLKey = 'turnoverTotal' | 'grossProfit' | 'operatingProfit' | 'taxation' | 'netProfit';
type BSKey =
  | 'fixedAssetsTotal' | 'currentAssetsTotal' | 'creditorsWithinTotal' | 'netCurrentAssets'
  | 'totalAssetsLessCurrent' | 'creditorsAfterTotal' | 'provisionsTotal' | 'netAssets' | 'totalEquity';

const PL_CONCEPTS: Record<PLKey, string> = {
  turnoverTotal:   'core:TurnoverRevenue',
  grossProfit:     'core:GrossProfitLoss',
  operatingProfit: 'core:OperatingProfitLoss',
  taxation:        'core:TaxTaxCreditOnProfitOrLossOnOrdinaryActivities',
  netProfit:       'core:ProfitLoss',
};

const BS_CONCEPTS: Record<BSKey, { qname: string; maturity?: 'within' | 'after' }> = {
  fixedAssetsTotal:       { qname: 'core:FixedAssets' },
  currentAssetsTotal:     { qname: 'core:CurrentAssets' },
  creditorsWithinTotal:   { qname: 'core:Creditors', maturity: 'within' },
  netCurrentAssets:       { qname: 'core:NetCurrentAssetsLiabilities' },
  totalAssetsLessCurrent: { qname: 'core:TotalAssetsLessCurrentLiabilities' },
  creditorsAfterTotal:    { qname: 'core:Creditors', maturity: 'after' },
  provisionsTotal:        { qname: 'core:ProvisionsForLiabilitiesBalanceSheetSubtotal' },
  netAssets:              { qname: 'core:NetAssetsLiabilities' },
  totalEquity:            { qname: 'core:Equity' },
};

// Creditor-maturity dimension + members (explicit dimension). Confirmed by
// Arelle: the dimension + members resolve and pass XBRL Dimensions validation.
const MATURITY_DIM = 'core:MaturitiesOrExpirationPeriodsDimension';
const MATURITY_MEMBER: Record<'within' | 'after', string> = {
  within: 'core:WithinOneYear',
  after:  'core:AfterOneYear',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pounds = (n: number) => Math.round(n); // micro/small accounts are to the nearest £1

/** An inline numeric fact. Value is signed; negatives use sign="-" + abs display. */
function num(concept: string, contextRef: string, value: number): string {
  const v = pounds(value);
  const sign = v < 0 ? ' sign="-"' : '';
  return `<ix:nonFraction name="${concept}" contextRef="${contextRef}" unitRef="GBP" decimals="0" format="ixt:num-dot-decimal" scale="0"${sign}>${Math.abs(v)}</ix:nonFraction>`;
}
/** An inline text (non-numeric) fact. */
function text(concept: string, contextRef: string, value: string): string {
  return `<ix:nonNumeric name="${concept}" contextRef="${contextRef}">${esc(value)}</ix:nonNumeric>`;
}

/** A £ money row for the readable body: label + tagged figure (or plain if untagged). */
function row(label: string, fact: string): string {
  return `<tr><td class="lbl">${esc(label)}</td><td class="num">£${fact}</td></tr>`;
}

// ── Contexts ─────────────────────────────────────────────────────────────────
// Context ids: D=duration (P&L), I=instant (balance sheet); C=current, P=prior;
// W/A = creditor-maturity dimensioned instants.
function contexts(input: IxbrlInput): string {
  const id = `<xbrli:identifier scheme="${CH_ENTITY_SCHEME}">${esc(input.companyNumber || '00000000')}</xbrli:identifier>`;
  const entity = `<xbrli:entity>${id}</xbrli:entity>`;
  const dur = (start: string, end: string) => `<xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>`;
  const inst = (d: string) => `<xbrli:period><xbrli:instant>${d}</xbrli:instant></xbrli:period>`;
  // The creditor-maturity dimension is carried on the context's <scenario> — a
  // direct child of <context> AFTER <period> (XBRL 2.1: <entity> may only hold
  // an <identifier> + optional <segment>, never <scenario>).
  const scenario = (member: string) =>
    `<xbrli:scenario><xbrldi:explicitMember dimension="${MATURITY_DIM}">${member}</xbrldi:explicitMember></xbrli:scenario>`;

  const list: string[] = [];
  const ctx = (cid: string, period: string, scen = '') =>
    list.push(`<xbrli:context id="${cid}">${entity}${period}${scen}</xbrli:context>`);

  ctx('DC', dur(input.periodStartIso, input.periodEndIso));
  ctx('IC', inst(input.periodEndIso));
  ctx('IC-W', inst(input.periodEndIso), scenario(MATURITY_MEMBER.within));
  ctx('IC-A', inst(input.periodEndIso), scenario(MATURITY_MEMBER.after));

  if (input.statements.hasPrior && input.priorStartIso && input.priorEndIso) {
    ctx('DP', dur(input.priorStartIso, input.priorEndIso));
    ctx('IP', inst(input.priorEndIso));
    ctx('IP-W', inst(input.priorEndIso), scenario(MATURITY_MEMBER.within));
    ctx('IP-A', inst(input.priorEndIso), scenario(MATURITY_MEMBER.after));
  }
  return list.join('\n      ');
}

// Context ref for a balance-sheet fact given period + optional maturity.
function bsCtx(period: 'cur' | 'prior', maturity?: 'within' | 'after'): string {
  const base = period === 'cur' ? 'IC' : 'IP';
  if (!maturity) return base;
  return `${base}-${maturity === 'within' ? 'W' : 'A'}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
export function buildIxbrl(input: IxbrlInput): string {
  const { statements: fs } = input;
  const pl = fs.profitLoss;
  const bs = fs.balanceSheet;
  const taxTotal = pl.taxation.reduce((s, g) => s + g.total, 0);

  // P&L rows (current context DC).
  const plRows = [
    row('Turnover', num(PL_CONCEPTS.turnoverTotal, 'DC', pl.turnoverTotal)),
    row('Gross profit', num(PL_CONCEPTS.grossProfit, 'DC', pl.grossProfit)),
    row('Operating profit', num(PL_CONCEPTS.operatingProfit, 'DC', pl.operatingProfit)),
    row('Tax on profit', num(PL_CONCEPTS.taxation, 'DC', taxTotal)),
    row('Profit for the financial year', num(PL_CONCEPTS.netProfit, 'DC', pl.netProfit)),
  ].join('\n        ');

  // Balance-sheet rows (instant contexts; creditors carry the maturity dimension).
  const bsRow = (label: string, key: BSKey, value: number) => {
    const c = BS_CONCEPTS[key];
    return row(label, num(c.qname, bsCtx('cur', c.maturity), value));
  };
  const bsRows = [
    bsRow('Fixed assets', 'fixedAssetsTotal', bs.fixedAssetsTotal),
    bsRow('Current assets', 'currentAssetsTotal', bs.currentAssetsTotal),
    bsRow('Creditors: amounts falling due within one year', 'creditorsWithinTotal', bs.creditorsWithinTotal),
    bsRow('Net current assets', 'netCurrentAssets', bs.netCurrentAssets),
    bsRow('Total assets less current liabilities', 'totalAssetsLessCurrent', bs.totalAssetsLessCurrent),
    bsRow('Creditors: amounts falling due after more than one year', 'creditorsAfterTotal', bs.creditorsAfterTotal),
    bsRow('Provisions for liabilities', 'provisionsTotal', bs.provisionsTotal),
    bsRow('Net assets', 'netAssets', bs.netAssets),
    bsRow('Total equity', 'totalEquity', bs.totalEquity),
  ].join('\n        ');

  const nsAttrs = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join('\n      ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="${NS.xhtml}"
      ${nsAttrs}
      xml:lang="en">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
    <title>${esc(input.companyName)} — Statutory accounts</title>
    <style type="text/css">
      body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px;}
      h1{font-size:20px;margin:0 0 4px;} .sub{color:#555;font-size:12px;margin:0 0 24px;}
      h2{font-size:15px;border-bottom:1px solid #ccc;padding-bottom:4px;margin:28px 0 8px;}
      table{width:100%;border-collapse:collapse;font-size:13px;} td{padding:4px 0;} td.num{text-align:right;font-variant-numeric:tabular-nums;}
      td.lbl{color:#222;}
    </style>
  </head>
  <body>
    <div style="display:none">
      <ix:header>
        <ix:references>
          <link:schemaRef xlink:type="simple" xlink:href="${ENTRY_POINTS[input.framework]}"/>
        </ix:references>
        <ix:resources>
          <xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit>
          ${contexts(input)}
        </ix:resources>
      </ix:header>
    </div>

    <h1>${text('bus:EntityCurrentLegalOrRegisteredName', 'DC', input.companyName)}</h1>
    <p class="sub">Company registration number ${text('bus:UKCompaniesHouseRegisteredNumber', 'DC', input.companyNumber)}<br/>
      Financial statements for the year ended ${esc(input.periodEndIso)}</p>

    <h2>Statement of comprehensive income</h2>
    <table>
      <tbody>
        ${plRows}
      </tbody>
    </table>

    <h2>Statement of financial position</h2>
    <table>
      <tbody>
        ${bsRows}
      </tbody>
    </table>

    <p class="sub" style="margin-top:32px">Generated by SMITH Accounts Studio — iXBRL (${input.framework === 'frs105' ? 'FRS 105' : 'FRS 102 Section 1A'}, FRC 2023 taxonomy). Draft: validate before filing.</p>
  </body>
</html>`;
}

/** Convert a dd-mm-yyyy string to yyyy-mm-dd (XBRL date form). */
export function ddmmyyyyToIso(dmy: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : dmy;
}
