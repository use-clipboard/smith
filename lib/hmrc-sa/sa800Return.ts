// Assemble the SA800 Partnership Tax Return into an <IRenvelope> body.
//
// Pipeline mirrors sa100Return.ts: TaxReturn → <IRenvelope> (IRmark empty) →
// markIrEnvelope (compute + inject IRmark) → buildSubmissionEnvelope (GovTalk,
// Class HMRC-SA-SA800) → submit/poll/delete. Same Transaction Engine, IRmark and
// vendor id (9626 covers SA100/SA800/SA900) as SA100 — only the Class and the
// return schema differ.
//
// ⚠⚠ ELEMENT NAMES AND STRUCTURE ARE PROVISIONAL — the SA800 (Partnership Tax
// Return) XSD was flagged to HMRC SDST as "to follow" and is not yet in hand.
// They follow the shape of the SA100 MTR schema. Validate against the official
// SA800 XSD before the first TPVS submission; every wire-format correction lands
// in THIS file, exactly as SA100 was built and then schema-validated.

import type { TaxReturn, Sa800Data } from '@/components/features/tax-studio/types';
import { computeSa800 } from '@/components/features/tax-studio/calc';
import { periodEndFor } from './sa100Return';
import { el, group, isoDate, moneyDown, digitsOnly, clip } from './xml';

// SA800 return namespace for 2025/26. ⚠ Confirm against the SA800 XSD.
const SA800_NS = 'http://www.govtalk.gov.uk/taxation/SA/SA800/25-26/1';

export interface Sa800BuildResult {
  /** The <IRenvelope> XML with an EMPTY <IRmark> — markIrEnvelope fills it in. */
  irEnvelope: string;
  periodEnd: string;
  utr: string | null;
}

export function buildSa800Return(ret: TaxReturn): Sa800BuildResult {
  const periodEnd = periodEndFor(ret.taxYear); // HMRC keys the PTR on 5 April
  const utr = digitsOnly(ret.utr ?? undefined, 10);
  const sa: Sa800Data = ret.sa800 ?? { trading: {}, statement: { partners: [] } };
  const t = sa.trading;
  const c = computeSa800(sa, ret.taxYear, { periodStart: sa.periodStart, periodEnd: sa.periodEnd });

  // IRheader — keys the return to the partnership UTR + carries the empty IRmark.
  const irHeader = group('IRheader', [
    group('Keys', [el('Key', utr ?? undefined, { Type: 'UTR' })]),
    el('PeriodEnd', periodEnd),
    el('DefaultCurrency', 'GBP'),
    '<IRmark Type="generic"></IRmark>',
    el('Sender', 'Agent'),
  ]);

  const details = group('PartnershipDetails', [
    el('BusinessName', clip(sa.businessName || ret.clientName, 100) ?? undefined),
    el('BusinessDescription', clip(sa.tradeDescription, 100) ?? undefined),
    group('AccountingPeriod', [
      el('Start', isoDate(sa.periodStart) ?? undefined),
      el('End', isoDate(sa.periodEnd) ?? undefined),
    ]),
  ]);

  // Trading & professional income (boxes 3.x). Element names provisional.
  const trade = group('TradingIncome', [
    el('Turnover', moneyDown(t.accountsMode === '3line' ? (t.turnover3line ?? 0) : (t.sales ?? 0))),  // 3.24 / 3.29
    el('NetProfitPerAccounts', moneyDown(c.netProfitPerAccounts)),   // 3.26 / 3.65
    el('DisallowableExpenses', moneyDown(c.disallowable)),           // 3.66
    el('BalancingCharges', moneyDown(c.balancingCharges)),           // 3.23
    el('CapitalAllowances', moneyDown(c.capitalAllowances)),         // 3.22
    el('NetProfitForTax', moneyDown(c.netProfitForTax)),             // 3.73
    el('TaxableProfit', moneyDown(c.profit)),                        // 3.83
    el('AllowableLoss', moneyDown(c.loss)),                          // 3.84
    el('CisDeductions', moneyDown(t.cisDeductions)),                 // 3.97
    el('TaxTakenOff', moneyDown(t.taxTakenOff)),                     // 3.98
    el('PartnershipCharges', moneyDown(t.netPartnershipCharges)),    // 3.117
    el('UntaxedInterest', moneyDown(sa.untaxedInterest)),            // 7.9A
  ]);

  // Partnership Statement — one <Partner> per member with their allocation.
  const statement = group('PartnershipStatement',
    [el('Full', sa.statement.full ? 'yes' : undefined)].concat(
      sa.statement.partners.map(p => {
        const s = c.partnerShares.find(x => x.id === p.id);
        return group('Partner', [
          el('Name', clip(p.name, 100) ?? undefined),
          el('UTR', digitsOnly(p.utr, 10) ?? undefined),
          el('NINO', clip(p.nino, 9) ?? undefined),
          el('DateAppointed', isoDate(p.dateAppointed) ?? undefined),
          el('DateCeased', isoDate(p.dateCeased) ?? undefined),
          el('ProfitShare', moneyDown(s?.profitShare)),      // box 11
          el('LossShare', moneyDown(s?.loss)),               // box 12
          el('BasisAdjustment', moneyDown(s?.basisAdj)),     // box 11A
          el('UntaxedSavings', moneyDown(s?.untaxedSavings)),// box 24
          el('CisDeductions', moneyDown(s?.cis)),            // box 24A
          el('PartnershipCharges', moneyDown(s?.charges)),   // box 29
        ]);
      }),
    ),
  );

  // Agent filing declaration (nominated partner declaration is captured on-screen).
  const declaration = '<Declaration><AgentDeclaration>yes</AgentDeclaration></Declaration>';

  const returnBody = group('PartnershipTaxReturn', [details, trade, statement, declaration]);
  const irEnvelope = `<IRenvelope xmlns="${SA800_NS}">${irHeader}${returnBody}</IRenvelope>`;
  return { irEnvelope, periodEnd, utr };
}
