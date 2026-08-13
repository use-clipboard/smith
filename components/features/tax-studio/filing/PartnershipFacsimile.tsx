// Facsimile of HMRC's SA104F Partnership (full) — 5 pages (FP1–5), teal theme,
// bound to PartnershipSource + the partnership calc helpers (see types.ts / calc.ts).

import type React from 'react';
import type { TaxReturn, PartnershipSource } from '../types';
import {
  FormThemeContext, RecordContext, TEAL_THEME, TEAL, CELL, Page, SuppHead, Note, Panel, Money, Cells, Line, Tick, YesNo, Label, toDDMMYYYY,
} from './formPrimitives';
import {
  partnershipAdjustedProfit, partnershipTaxableTradeProfit, partnershipTotalTaxableProfit, partnershipAdjustedLoss,
  partnershipLossCarryForward, partnershipAdjustedUkSavings, partnershipAdjustedForeignSavings, partnershipTotalUntaxedSavings,
  partnershipPropertyTaxable, partnershipOtherUkTaxable, partnershipOtherUkLossCarryForward, partnershipOffshoreTaxable,
  partnershipForeignTaxable, partnershipForeignLossCarryForward, partnershipUntaxedOther, partnershipTaxTakenTotal,
} from '../calc';

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;
const TealHead = ({ children }: { children: React.ReactNode }) => <p className="mb-2 text-[13px] font-bold" style={{ color: TEAL }}>{children}</p>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
const date = (d?: string) => toDDMMYYYY(d);
const n = (v?: number) => v || 0;

export default function PartnershipFacsimile({ ret, partner }: { ret: TaxReturn; partner: PartnershipSource }) {
  const p = partner;
  const box70 = n(p.taxedIncome10) - n(p.taxedIncome10ForeignTax);
  const box73 = n(p.taxedIncome20) - n(p.taxedIncome20ForeignTax);
  const box76 = partnershipTotalTaxableProfit(p) + partnershipUntaxedOther(p) + n(p.otherTaxedIncome) - n(p.otherTaxedIncomeForeignTax);

  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      <RecordContext.Provider value={p.id}>
      {/* ── FP 1 ── */}
      <Page tag="FP 1" code="SA104F">
        <SuppHead title="Partnership (full)" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>Complete a ‘Partnership’ page for each partnership of which you were a member and for each partnership business.<br />For help filling in this form go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <H>Partnership details</H>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Cells n={1} label="Partnership reference number" groups={[5, 5]} value={p.utr} />
              <Line label="Description of partnership trade or profession" n={2} value={p.description} lines={2} />
              <div><Label n="3Q">Did you become a partner in this partnership after 5 April 2025? You must put ‘X’ in one box</Label><YesNo yes={p.becamePartner ?? false} /></div>
            </div>
            <div>
              <Cells n={3} label="If you answered ‘Yes’ in box 3Q, enter the date you became a partner  DD MM YYYY" groups={[2, 2, 4]} value={date(p.dateJoined)} />
              <div className="mb-3"><Label n="4Q">Did you cease being a partner in this partnership after 5 April 2025 but before 6 April 2026? You must put ‘X’ in one box</Label><YesNo yes={p.ceasedPartner ?? false} /></div>
              <Cells n={4} label="If you answered ‘Yes’ in box 4Q enter the date you left this partnership  DD MM YYYY" groups={[2, 2, 4]} value={date(p.dateLeft)} />
              <NotInUse>Box 5 is not in use</NotInUse>
            </div>
          </div>
        </Panel>
        <H>Your share of the partnership’s trading or professional profits</H>
        <Note>Please refer to the Partnership Statement to complete these pages and if you need any help, read the ‘Partnership (full) notes’. If your partnership’s accounting date is not between 31 March and 5 April you will need to apportion your share of the partnership’s profits from each accounting period to the tax year – use box 9 to adjust your share of the profit or loss (box 8). If the partnership carries on certain trades or professions, or in certain situations, you may need to make further tax adjustments in boxes 10 to 12. If you have untaxed transition profit from 2023–24 enter the amount treated as arising this year in box 16.3 – if you ceased to be partner in the year enter all your untaxed transition profit. If you want to enter a loss, or an adjustment needs to be taken off, put a minus (–) in the box next to the £ sign.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 6 and 7 are not in use</NotInUse>
              <Money n={8} label="Your share of the partnership’s profit or loss – from box 11 or box 12 on the Partnership Statement" value={p.profit} minus />
              <Money n={9} label="Adjustment where the partnership’s accounting period ended before 31 March 2026 or where the partnership’s accounting period was not 12 months long" value={p.adjustmentPeriod} minus />
              <Money n={10} label="Adjustment for change of accounting practice – from box 11A on the Partnership Statement" value={p.accountingAdjustment} />
            </div>
            <div>
              <Money n={11} label="Averaging adjustment – only for farmers, market gardeners and creators of literary or artistic works" value={p.averagingAdjustment} minus />
              <Money n={12} label="Foreign tax claimed as a deduction – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.foreignTaxDeduction} />
              <NotInUse>Boxes 13, 14 and 15 are not in use</NotInUse>
              <Money n={16} label="Adjusted profit for 2025–26 – see the working sheet in the notes" value={partnershipAdjustedProfit(p)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── FP 2 ── */}
      <Page tag="FP 2" code="SA104F">
        <p className="mb-1 text-[15px] font-normal text-black">Your share of the partnership’s trading or professional profits <span className="text-[11px]">continued</span></p>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 16.1 and 16.2 are not in use</NotInUse>
              <Money n="16.3" label="Spread of the transition profit treated as arising in this tax year – read the notes" value={p.transitionProfit} />
              <Money n="16.4" label="Loss brought forward from earlier years set off against this year’s spread of the transition profit (up to the amount in box 16.3)" value={p.transitionLossBfwd} />
              <Money n={17} label="Losses brought forward from earlier years set off against this year’s adjusted profit" value={p.lossBroughtForward} />
            </div>
            <div>
              <Money n={18} label="Taxable profits after losses brought forward – do not include the amount in box 16.3" value={partnershipTaxableTradeProfit(p)} />
              <Money n={19} label="Any other business income not included in the partnership accounts" value={p.otherBusinessIncome} />
              <Money n={20} label="Your share of the total taxable profits from the partnership’s business for 2025–26" value={partnershipTotalTaxableProfit(p)} />
              <Money n="20.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.figClaim} />
            </div>
          </div>
        </Panel>
        <H>Your share of the partnership’s trading or professional losses</H>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={21} label="Adjusted loss for 2025–26 – see the working sheet in the notes" value={partnershipAdjustedLoss(p)} />
              <Money n="21.1" label="Adjustment to losses as a result of a claim under the foreign income and gains (FIG) regime" value={p.lossFigAdjustment} />
            </div>
            <div>
              <Money n={22} label="Loss from this tax year set off against other income for 2025–26" value={p.lossAgainstOtherIncome} />
              <Money n={23} label="Loss to be carried back to previous years and set off against income (or capital gains)" value={p.lossCarriedBack} />
              <Money n={24} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={partnershipLossCarryForward(p)} />
            </div>
          </div>
        </Panel>
        <H>Class 2 and Class 4 National Insurance contributions (NICs)</H>
        <Note>If your total profits from all self-employments and partnerships for 2025–26 are less than £6,845, you do not have to pay Class 2 NICs, but you may want to pay voluntarily (box 25) to protect your rights to certain benefits.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={25}>If your total profits for 2025–26 are less than £6,845, and you choose to pay Class 2 NICs voluntarily, put ‘X’ in the box</Label><Tick on={!!p.class2Voluntary} /></div>
            <div>
              <div className="mb-3"><Label n={26}>If you are exempt from paying Class 4 NICs, put ‘X’ in the box</Label><Tick on={!!p.class4Exempt} /></div>
              <Money n={27} label="Adjustment to profits chargeable to Class 4 NICs" value={p.class4Adjustment} cells={6} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── FP 3 ── */}
      <Page tag="FP 3" code="SA104F">
        <H>Your share of the partnership’s untaxed income</H>
        <Note>If your partnership has a trade whose accounting date is not between 31 March and 5 April, you will need to make adjustments to arrive at your share of the partnership’s source of untaxed income, profit or loss for the tax year. Please read the ‘Partnership (full) notes’ for more information.</Note>
        <Panel divided>
          <TealHead>Untaxed savings income</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={28} label="Share of UK untaxed savings income – from box 13 on the Partnership Statement" value={p.ukSavings} />
              <Money n={29} label="Adjustment to untaxed savings income including adjustment for the tax year" value={p.ukSavingsAdjustment} minus />
              <Money n={30} label="Adjusted UK savings income (box 28 + box 29)" value={partnershipAdjustedUkSavings(p)} />
              <Money n={31} label="Share of foreign untaxed savings income – from box 14 on the Partnership Statement" value={p.foreignSavings} />
            </div>
            <div>
              <Money n={32} label="Adjustment to foreign savings income in box 31 including adjustment for the tax year" value={p.foreignSavingsAdjustment} minus />
              <Money n={33} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.foreignSavingsTax} />
              <Money n={34} label="Adjusted foreign savings income (box 31 + box 32 minus box 33)" value={partnershipAdjustedForeignSavings(p)} />
              <Money n={35} label="Total untaxed savings income taxable at 20% (box 30 + box 34)" value={partnershipTotalUntaxedSavings(p)} />
              <Money n="35.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.savingsFigClaim} />
            </div>
          </div>
        </Panel>
        <Panel divided>
          <TealHead>Income from UK property</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={36} label="Share of profit or loss for 2025–26 from UK property – from box 19 on the Partnership Statement" value={p.propertyProfit} minus />
              <Money n={37} label="Adjustment to profit or loss from UK property in box 36 including adjustment for the tax year" value={p.propertyAdjustment} minus />
              <Money n={38} label="Losses brought forward from earlier years set off against profits (up to the amount in box 36 + box 37)" value={p.propertyLossBfwd} />
              <Money n={39} label="Loss set off against 2025–26 total income – this will be unusual" value={p.propertyLossAgainstOther} />
            </div>
            <div>
              <Money n={40} label="Loss to be carried forward after any set-offs – including unused losses brought forward" value={p.propertyLossCarryForward} />
              <Money n={41} label="Taxable profit after adjustments and losses (if box 36 + box 37 minus box 38 is positive or zero)" value={partnershipPropertyTaxable(p)} />
              <Money n="41.1" label="Residential property finance costs – from box 26 on the Partnership Statement" value={p.propertyFinanceCosts} />
              <Money n="41.2" label="Unused residential property finance costs brought forward" value={p.propertyFinanceCostsBfwd} />
              <NotInUse>Boxes 42, 43 and 44 are not in use</NotInUse>
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── FP 4 ── */}
      <Page tag="FP 4" code="SA104F">
        <Panel divided>
          <TealHead>Other untaxed UK income</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={45} label="Share of other untaxed UK income – from box 15 on the Partnership Statement" value={p.otherUkIncome} />
              <Money n={46} label="Adjustment to other untaxed UK income in box 45 including adjustment for the tax year" value={p.otherUkIncomeAdjustment} minus />
              <Money n={47} label="Losses brought forward from earlier years set off against income (up to the amount in box 45 + box 46)" value={p.otherUkLossBfwd} />
            </div>
            <div>
              <Money n={48} label="Taxable profit (box 45 + box 46 minus box 47)" value={partnershipOtherUkTaxable(p)} />
              <Money n={49} label="Share of loss for 2025–26 from other untaxed UK income – from box 16 on the Partnership Statement" value={p.otherUkIncomeB} />
              <Money n={50} label="Adjustment to loss from other untaxed UK income in box 49" value={p.otherUkLossAdjustment} minus />
              <Money n={51} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={partnershipOtherUkLossCarryForward(p)} />
            </div>
          </div>
        </Panel>
        <Panel divided>
          <TealHead>Income from offshore funds</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={52} label="Share of income from offshore funds – from box 18 on the Partnership Statement" value={p.offshoreIncome} />
              <Money n={53} label="Adjustment to income from offshore funds in box 52 including adjustment for the tax year" value={p.offshoreAdjustment} minus />
              <Money n={54} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.offshoreTax} />
            </div>
            <div>
              <Money n={55} label="Taxable income after adjustments and foreign tax (box 52 + box 53 minus box 54)" value={partnershipOffshoreTaxable(p)} />
              <Money n="55.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.offshoreFigClaim} />
            </div>
          </div>
        </Panel>
        <Panel divided>
          <TealHead>Other untaxed foreign income</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={56} label="Share of other untaxed foreign income – from box 17 on the Partnership Statement" value={p.foreignIncome} />
              <Money n={57} label="Adjustment to other untaxed foreign income in box 56 including adjustment for the tax year" value={p.foreignIncomeAdjustment} minus />
              <Money n={58} label="Losses brought forward from earlier years set off against income (up to the amount in box 56 + box 57)" value={p.foreignLossBfwd} />
              <Money n={59} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.foreignTax} />
              <Money n={60} label="Taxable profit (box 56 + box 57 minus (box 58 + box 59))" value={partnershipForeignTaxable(p)} />
              <Money n="60.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.foreignFigClaim} />
            </div>
            <div>
              <Money n={61} label="Share of loss for 2025–26 from other untaxed foreign income – from box 21 on the Partnership Statement" value={p.foreignIncomeB} />
              <Money n={62} label="Adjustment to loss from other untaxed foreign income in box 61" value={p.foreignLossAdjustment} minus />
              <Money n={63} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={partnershipForeignLossCarryForward(p)} />
              <Money n="63.1" label="Residential property finance costs – from box 27 on the Partnership Statement" value={p.foreignFinanceCosts} />
              <Money n="63.2" label="Unused residential property finance costs brought forward" value={p.foreignFinanceCostsBfwd} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── FP 5 ── */}
      <Page tag="FP 5" code="SA104F">
        <Panel divided>
          <TealHead>Total untaxed income</TealHead>
          <div className="grid grid-cols-2 gap-x-10">
            <div><NotInUse>Boxes 64, 65 and 66 are not in use</NotInUse></div>
            <div><Money n={67} label="Share of total untaxed income – other than savings income (box 41 + box 48 + box 55 + box 60)" value={partnershipUntaxedOther(p)} /></div>
          </div>
        </Panel>
        <H>Your share of the partnership’s taxed income and dividend income</H>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={68} label="Dividend income – from boxes 14A and 22A on the Partnership Statement" value={p.taxedIncome10} />
              <Money n={69} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.taxedIncome10ForeignTax} />
              <Money n={70} label="Total dividend income (box 68 minus box 69)" value={box70} />
              <Money n="70.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.taxedIncome10Fig} />
              <Money n={71} label="Share of taxed income taxable at 20% – from box 22 on the Partnership Statement" value={p.taxedIncome20} />
            </div>
            <div>
              <Money n={72} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.taxedIncome20ForeignTax} />
              <Money n={73} label="Taxed income taxable at 20% (box 71 minus box 72)" value={box73} />
              <Money n={74} label="Share of other taxed income – from box 23 on the Partnership Statement" value={p.otherTaxedIncome} />
              <Money n={75} label="Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.otherTaxedIncomeForeignTax} />
              <Money n="75.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={p.otherTaxedFig} />
            </div>
          </div>
        </Panel>
        <H>Your share of the partnership’s total taxed and untaxed income</H>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={76} label="Share of total taxed and untaxed income other than that taxable at 10% and 20% (box 20 + box 67 + box 74 minus box 75)" value={box76} /></div>
            <div><Money n="76.1" label="Amount claimed under the foreign income and gains (FIG) regime in respect of share of total taxed and untaxed income other than that taxable at 10% and 20% (box 20.1 + box 55.1 + box 60.1 + box 75.1)" value={p.totalFig} /></div>
          </div>
        </Panel>
        <H>Your share of the partnership’s tax paid and deductions</H>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={77} label="Share of Income Tax taken off partnership income – from box 25 on the Partnership Statement" value={p.incomeTaxTaken} />
              <Money n={78} label="Share of Construction Industry Scheme (CIS) deductions made by contractors – from box 24 on the Partnership Statement" value={p.cisDeductions} />
            </div>
            <div>
              <Money n={79} label="Share of any tax taken off trading income (not contractor deductions) – from box 24A on the Partnership Statement" value={p.taxTakenTradingIncome} />
              <Money n={80} label="Share of total tax taken off (boxes 77 to 79)" value={partnershipTaxTakenTotal(p)} />
            </div>
          </div>
        </Panel>
      </Page>
      </RecordContext.Provider>
    </FormThemeContext.Provider>
  );
}
