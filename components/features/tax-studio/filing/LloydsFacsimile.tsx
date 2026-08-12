// Facsimile of HMRC's SA103L Lloyd's underwriters — 4 pages (LU1–4), cream theme
// with teal sub-headers, bound to the LloydsUnderwriter model + lloydsComputed.

import type React from 'react';
import type { TaxReturn, LloydsUnderwriter } from '../types';
import {
  FormThemeContext, CREAM_THEME, TEAL, CELL, Page, SuppHead, Note, Panel, Money, Label, Tick,
} from './formPrimitives';
import { lloydsComputed } from '../calc';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;
const TealSub = ({ children }: { children: React.ReactNode }) => <p className="mb-2 text-[13px] font-bold leading-tight" style={{ color: TEAL }}>{children}</p>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;

export default function LloydsFacsimile({ ret }: { ret: TaxReturn }) {
  const l: LloydsUnderwriter = ret.income.lloyds ?? {};
  const c = lloydsComputed(l);
  const intro = (
    <>
      <Note>If your final syndicate results were declared and your Lloyd’s deposit was released before 1 January 2025, do not complete these pages. Please read the ‘Lloyd’s underwriters notes’ for more information.</Note>
      <Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
    </>
  );
  return (
    <FormThemeContext.Provider value={CREAM_THEME}>
      {/* ── LU 1 ── */}
      <Page tag="LU 1" code="SA103L">
        <SuppHead title="Lloyd’s underwriters" name={ret.clientName} utr={ret.utr ?? undefined} note={intro} />
        <Head>Income from personal funds at Lloyd’s – UK interest (year ended 31 December 2025)</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TealSub>UK interest which has not been taxed</TealSub>
              <Money n={1} label="Untaxed interest from UK banks or building societies, UK unit trusts etc and gilts – the amount received" value={l.ukUntaxedInterest} />
              <TealSub>Accrued Income Scheme and deeply discounted securities</TealSub>
              <Money n={2} label="Profits from Accrued Income Scheme and deeply discounted securities" value={l.accruedIncomeProfits} />
            </div>
            <div>
              <TealSub>UK interest which has been taxed already</TealSub>
              <Money n={3} label="Taxed interest from any other UK savings and investments – after tax taken off" value={l.ukTaxedInterest} />
              <Money n={4} label="Tax taken off" value={l.ukInterestTaxTakenOff} />
              <Money n={5} label="Total UK interest and tax taken off (total of boxes 1 to 4)" value={c.box5} />
            </div>
          </div>
        </Panel>
        <Head>Income from personal funds at Lloyd’s – UK dividends (year ended 31 December 2025)</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={6} label="Stock dividends from UK companies – the amount of dividend received" value={l.stockDividends} />
              <NotInUse>Box 7 is not in use</NotInUse>
              <Money n={8} label="Bonus issues of securities and redeemable shares" value={l.nonQualifyingDistributions} />
            </div>
            <div>
              <Money n={9} label="Other dividends and distributions from UK companies – the amount received (Property Income Distributions (PIDs) go in box 3 above)" value={l.otherUkDividends} />
              <NotInUse>Box 10 is not in use</NotInUse>
              <Money n={11} label="Total UK company dividends and distributions (boxes 6 + box 8 + box 9)" value={c.box11} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── LU 2 ── */}
      <Page tag="LU 2" code="SA103L">
        <Head>Foreign sources income from assets in personal funds at Lloyd’s (year ended 31 December 2025)</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TealSub>Non-UK interest and other foreign sources income</TealSub>
              <Money n={12} label="Net amount received" value={l.nonUkInterestNet} />
              <Money n={13} label="Amount of foreign tax taken off" value={l.nonUkInterestForeignTax} />
              <Money n={14} label="Amount of UK tax taken off" value={l.nonUkInterestUkTax} />
            </div>
            <div>
              <TealSub>Non-UK dividends</TealSub>
              <Money n={15} label="Amount received" value={l.nonUkDividendsGross} />
              <Money n={16} label="Amount of foreign tax taken off" value={l.nonUkDividendsForeignTax} />
              <Money n={17} label="Amount of Special Withholding Tax or UK tax taken off" value={l.nonUkDividendsUkTax} />
              <Money n={18} label="Total non-UK income (total of boxes 12 to 17)" value={c.box18} />
              <NotInUse>Box 19 is not in use</NotInUse>
            </div>
          </div>
        </Panel>
        <Head>Other Lloyd’s receipts</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={20} label="Aggregate syndicate profits" value={l.aggregateSyndicateProfits} />
              <Money n={21} label="Net withdrawal/release from Special Reserve Fund" value={l.specialReserveWithdrawal} />
              <Money n={22} label="Stop loss recoveries" value={l.stopLossRecoveries} />
              <Money n={23} label="Compensation receipts" value={l.compensationReceipts} />
            </div>
            <div>
              <Money n={24} label="Repayments of foreign tax previously allowed by deduction" value={l.foreignTaxRepayments} />
              <Money n={25} label="Other Lloyd’s non-syndicate income" value={l.otherNonSyndicateIncome} />
              <Money n={26} label="Total of other Lloyd’s receipts (total of boxes 20 to 25)" value={c.box26} />
            </div>
          </div>
        </Panel>
        <Head>Total Lloyd’s income</Head>
        <Panel>
          <Money n={27} label="Total Lloyd’s income (box 5 + box 11 + box 18 + box 26)" value={c.box27} />
        </Panel>
      </Page>

      {/* ── LU 3 ── */}
      <Page tag="LU 3" code="SA103L">
        <Head>Foreign tax repayments</Head>
        <Panel>
          <Money n={28} label="If you’ve received a repayment of foreign tax on which Foreign Tax Credit Relief was given – enter the amount below and, if you are calculating your tax, copy this figure to box 14 on the ‘Tax calculation summary’ page" value={l.ftcrGiven} />
        </Panel>
        <Head>Lloyd’s losses and expenses</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={29} label="Aggregate syndicate losses" value={l.aggregateSyndicateLosses} />
              <Money n={30} label="Net transfer to Special Reserve Fund" value={l.specialReserveTransfer} />
              <Money n={31} label="Stop loss premiums paid" value={l.stopLossPremiums} />
              <Money n={32} label="Personal Quota Share and Exeat premiums paid" value={l.quotaSharePremiums} />
              <Money n={33} label="Estate Protection Plan premiums paid" value={l.estateProtectionPremiums} />
              <Money n={34} label="Interest paid on loans to fund underwriting" value={l.underwritingLoanInterest} />
            </div>
            <div>
              <Money n={35} label="Lloyd’s Members’ associations expenses paid" value={l.membersAssocExpenses} />
              <Money n={36} label="Members’ Agent profit commission and salaries" value={l.agentCommissionSalaries} />
              <Money n={37} label="Fees for bank guarantees/letters of credit" value={l.bankGuaranteeFees} />
              <Money n={38} label="Accountancy fees" value={l.accountancyFees} />
              <Money n={39} label="Other Lloyd’s expenses" value={l.otherExpenses} />
              <Money n={40} label="Total losses and expenses (total of boxes 29 to 39)" value={c.box40} />
            </div>
          </div>
        </Panel>
        <Head>Total incomings and outgoings</Head>
        <Note>Compare your total Lloyd’s income in box 27 with your total losses and expenses in box 40. If the amount in box 40 is less than the amount in box 27, you’ve made a profit. If the amount in box 40 is more than the amount in box 27, you’ve made a loss. Enter the amount of the profit in box 41, or the amount of the loss in box 42.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={41} label="Amount of profit (if box 27 minus box 40 is a positive amount)" value={c.box41} /></div>
            <div><Money n={42} label="Amount of loss (if box 27 minus box 40 is a negative amount)" value={c.box42} /></div>
          </div>
        </Panel>
        <Head>Lloyd’s foreign tax</Head>
        <Note>Please read the ‘Lloyd’s underwriters notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={43} label="Foreign tax on personal fund income (box 13 + box 16)" value={c.box43} />
              <Money n={44} label="US income tax paid" value={l.usIncomeTax} />
              <Money n={45} label="Canadian tax paid" value={l.canadianTax} />
            </div>
            <div>
              <Money n={46} label="Syndicate foreign tax" value={l.syndicateForeignTax} />
              <Money n={47} label="Additional payments of foreign tax" value={l.additionalForeignTax} />
              <Money n={48} label="Total foreign tax (total of boxes 43 to 47)" value={c.box48} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── LU 4 ── */}
      <Page tag="LU 4" code="SA103L">
        <Head>Calculating Lloyd’s taxable profits or allowable losses</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TealSub>If you made a profit fill in boxes 49 to 52</TealSub>
              <Money n={49} label="Profit from box 41" value={c.box49} />
              <Money n={50} label="Foreign tax claimed as a deduction – only if Foreign Tax Credit Relief has not been claimed on the ‘Foreign’ pages" value={l.foreignTaxDeductionProfit} />
              <Money n={51} label="Lloyd’s losses brought forward from earlier years used against this year’s profits – copy this amount to box 60 below" value={l.lossesBroughtForwardProfit} />
              <Money n={52} label="Total taxable profits from Lloyd’s (box 49 minus (box 50 + box 51))" value={c.box52} />
            </div>
            <div>
              <TealSub>If you made a loss fill in boxes 53 to 58</TealSub>
              <Money n={53} label="Loss from box 42" value={c.box53} />
              <Money n={54} label="Foreign tax claimed as a deduction – from box 48" value={c.box54} />
              <Money n={55} label="Loss for the year 2025–26 (box 53 + box 54)" value={c.box55} />
              <Money n={56} label="Loss set off against other income for 2025–26" value={l.lossSetOffOtherIncome} />
              <Money n={57} label="Loss carried back to set against earlier years" value={l.lossCarriedBack} />
              <Money n={58} label="Unused loss available to carry forward after all other set-offs" value={c.box58} />
            </div>
          </div>
        </Panel>
        <Head>Lloyd’s losses reconciliation</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={59} label="Losses brought forward from earlier years" value={l.lossesBroughtForward} />
              <Money n={60} label="Losses brought forward used against this year’s profits – the amount from box 51" value={c.box60} />
            </div>
            <div>
              <Money n={61} label="Unused loss from 2025–26 – from box 58" value={c.box61} />
              <Money n={62} label="Total loss available to carry forward (box 59 minus box 60) or (box 59 + box 61)" value={c.box62} />
            </div>
          </div>
        </Panel>
        <Head>Class 2 and Class 4 National Insurance contributions (NICs)</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={63}>If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put ‘X’ in the box</Label><Tick on={!!l.class2Voluntary} /></div>
            <div>
              <div className="mb-3"><Label n={64}>If you are exempt from paying Class 4 NICs, put ‘X’ in the box</Label><Tick on={!!l.class4Exempt} /></div>
              <Money n={65} label="Adjustment to profits chargeable to Class 4 NICs" value={l.class4Adjustment} />
            </div>
          </div>
        </Panel>
        <Head>Any other information</Head>
        <Panel className="flex flex-1 flex-col">
          <Label n={66}>Please give any other information in this space</Label>
          <div className="min-h-[120px] flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{l.otherInformation}</div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
