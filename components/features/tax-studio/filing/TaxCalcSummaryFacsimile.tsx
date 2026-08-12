// Facsimile of HMRC's SA110 Tax calculation summary — 2 pages (TC1–2), teal
// theme. Boxes 1–6 and 11 are mapped from the SMITH tax computation; the
// PAYE-coding, surplus-allowance and adjustment boxes (7–10, 12–17) are user
// inputs SMITH does not model and are shown blank, as on a return not using them.

import type React from 'react';
import type { TaxReturn } from '../types';
import { FormThemeContext, TEAL_THEME, CELL, Page, SuppHead, Note, Panel, Money, Tick, Label } from './formPrimitives';
import { computeSa100Full } from '../calc';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;

export default function TaxCalcSummaryFacsimile({ ret }: { ret: TaxReturn }) {
  const c = computeSa100Full(ret.income, ret.taxYear);
  const incomeSide = Math.round(c.totalDue) - c.capitalGainsTax; // income tax + Class 4 NIC + student loan + HICBC
  const box1 = Math.max(0, incomeSide - c.taxDeductedAtSource);
  const box2 = Math.max(0, c.taxDeductedAtSource - incomeSide);
  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── TC 1 ── */}
      <Page tag="TC 1" code="SA110">
        <SuppHead title="Tax calculation summary" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Head>Self Assessment</Head>
        <Note>You can use the working sheet in the ‘Tax calculation summary notes’ to work out the total tax, Student Loan repayment, Postgraduate Loan repayment, Class 2 NICs and Class 4 NICs due or overpaid for 2025–26. If the result is a positive amount, enter it in box 1, if it’s negative, enter it in box 2. For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Total tax (this may include Student Loan or Postgraduate Loan repayments), Class 2 NICs and Class 4 NICs due before any payments on account" value={box1} />
              <Money n={2} label="Total tax (this may include Student Loan or Postgraduate Loan repayments), Class 2 NICs and Class 4 NICs overpaid" value={box2} />
              <Money n={3} label="Student Loan repayment due" value={c.studentLoan} />
              <Money n="3.1" label="Postgraduate Loan repayment due" value={0} />
            </div>
            <div>
              <Money n={4} label="Class 4 NICs due" value={c.class4Nic} />
              <Money n="4.1" label="Class 2 NICs due" value={0} />
              <Money n={5} label="Capital Gains Tax due" value={c.capitalGainsTax} />
              <Money n={6} label="Pension charges due" value={0} />
            </div>
          </div>
        </Panel>
        <Head>Underpaid tax and other debts</Head>
        <Note>If you pay tax under PAYE, look at your P2, ‘PAYE Coding Notice’ and the notes in sections 10 and 11 of the ‘Tax calculation summary notes’, then fill in boxes 7, 8 and 9 as appropriate.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={7} label="Underpaid tax for earlier years included in your tax code for 2025–26 – enter the amount shown as ‘amount of underpaid tax for earlier years’ from your P2, ‘PAYE Coding Notice’" value={0} />
            </div>
            <div>
              <Money n={8} label="Underpaid tax for 2025–26 included in your tax code for 2026–27 – enter the amount shown as ‘estimated underpayment for 2025–26’ from your P2, ‘PAYE Coding Notice’" value={0} />
              <Money n={9} label="Outstanding debt included in your tax code for 2025–26 – enter the amount from your P2, ‘PAYE Coding Notice’" value={0} />
            </div>
          </div>
        </Panel>
        <Head>Payments on account</Head>
        <Note>Please read the notes in section 12 of the ‘Tax calculation summary notes’ to see if you need to make any payments on account for 2026–27.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><div className="mb-3"><Label n={10}>If you’re claiming to reduce your 2026–27 payments on account, put ‘X’ in the box – enter the reduced amount of your first payment in box 11 and say why you’re making the claim in box 17 on page TC 2 of this form</Label><Tick /></div></div>
            <div><Money n={11} label="Your first payment on account for 2026–27 – enter the amount (including pence)" value={c.poaApplies ? c.paymentOnAccount : 0} /></div>
          </div>
        </Panel>
      </Page>

      {/* ── TC 2 ── */}
      <Page tag="TC 2" code="SA110">
        <Head>Blind person’s surplus allowance and married couple’s surplus allowance</Head>
        <Note>Enter the amount of any surplus allowance transferred from your spouse or civil partner.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={12} label="Blind person’s surplus allowance you can have" value={0} /></div>
            <div><Money n={13} label="If you or your spouse or civil partner were born before 6 April 1935, the amount of married couple’s surplus allowance you can have" value={0} /></div>
          </div>
        </Panel>
        <Head>Adjustments to tax due</Head>
        <Note>You may need to make an adjustment to increase or decrease your tax for 2025–26, calculated by reference to an earlier year, because you’re claiming averaging for farmers and creators of literary or artistic work or making certain adjustments to earlier years.</Note>
        <Note>If you’re carrying back certain losses from 2026–27 to 2025–26, any repayment will be in the form of a credit on your Self Assessment statement of account and set against other amounts to be paid and will not affect the figures in boxes 1 to 6 on page TC 1. If you need help in filling in these boxes, ask us or your tax adviser.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={14} label="Increase in tax due because of adjustments to an earlier year" value={0} /></div>
            <div>
              <Money n={15} label="Decrease in tax due because of adjustments to an earlier year" value={0} />
              <Money n={16} label="Any 2026–27 repayment you’re claiming now" value={0} />
            </div>
          </div>
        </Panel>
        <Head>Any other information</Head>
        <Panel className="flex flex-1 flex-col">
          <Label n={17}>Please give any other information in this space</Label>
          <div className="min-h-[160px] flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }} />
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
