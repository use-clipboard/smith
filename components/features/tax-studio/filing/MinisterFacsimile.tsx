// Facsimile of HMRC's SA102M Ministers of religion — 2 pages (MoR1–2), pink
// theme, bound to the MinisterOfReligion model + ministerComputed.

import type React from 'react';
import type { TaxReturn, MinisterOfReligion } from '../types';
import { FormThemeContext, PINK_THEME, CELL, Page, SuppHead, Note, Panel, Money, Line, Label, InfoDot } from './formPrimitives';
import { ministerComputed } from '../calc';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;

export default function MinisterFacsimile({ ret }: { ret: TaxReturn }) {
  const m: MinisterOfReligion = ret.income.minister ?? {};
  const c = ministerComputed(m);
  return (
    <FormThemeContext.Provider value={PINK_THEME}>
      {/* ── MoR 1 ── */}
      <Page tag="MoR 1" code="SA102M">
        <SuppHead title="Ministers of religion" name={ret.clientName} utr={ret.utr ?? undefined}
          note={<Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>} />
        <Head>Income as a minister of religion</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Nature of your post or appointment" value={m.natureOfPost} />
              <Money n={2} label="Salary or stipend – before tax was taken off" value={m.salary} />
              <Money n="2.1" label="Payrolled benefits included in box 2 which affect your student loan repayments – read the notes" value={m.payrolledBenefitsStudentLoan} />
              <Money n={3} label="Tax taken off box 2" value={m.taxOffSalary} minus />
              <Money n={4} label="Fees and offerings" value={m.feesOfferings} />
              <Money n={5} label="Vicarage expenses paid for you" value={m.vicarageExpensesPaid} />
            </div>
            <div>
              <Money n={6} label="Personal expenses paid for you, living accommodation, vouchers and credit cards" value={m.personalExpenses} />
              <Money n={7} label="Excess mileage allowance and passenger payments" value={m.excessMileage} />
              <Money n={8} label="Round-sum expenses and rent allowances" value={m.roundSumExpenses} />
              <Money n={9} label="Tax taken off box 8" value={m.taxOffRoundSum} />
              <Money n={10} label="Other income from your post or appointment including gifts, grants and balancing charges" value={m.otherIncome} />
              <Money n={11} label="Tax taken off box 10" value={m.taxOffOtherIncome} />
              <Money n={12} label="Total income as a minister of religion (box 2 + boxes 4 to 8 + box 10)" value={c.box12} />
            </div>
          </div>
        </Panel>
        <Head>Benefits and expenses payments you receive as a minister of religion</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={13} label="Vicarage services benefits received" value={m.vicarageServicesBenefit} />
              <Money n={14} label="Car provided for you" value={m.carBenefit} />
              <Money n={15} label="Fuel for car provided for you" value={m.carFuelBenefit} />
            </div>
            <div>
              <Money n={16} label="Interest-free and low interest loans" value={m.loansBenefit} />
              <Money n={17} label="Expenses payments made to you" value={m.expensesReceived} />
              <Money n={18} label="Other benefits" value={m.otherBenefits} />
              <Money n={19} label="Total benefits and expenses (total of boxes 13 to 18)" value={c.box19} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── MoR 2 ── */}
      <Page tag="MoR 2" code="SA102M">
        <Head>Taxable income etc before expenses paid</Head>
        <Panel>
          <Money n={20} label="Taxable income, benefits and expenses received – read the ‘Ministers of religion notes’" value={c.box20} />
        </Panel>
        <Head>Expenses paid by you as a minister of religion</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={21} label="Travelling expenses and capital allowances" value={m.travellingExpenses} />
              <Money n={22} label="Maintenance, repairs and insurance of vicarage etc" value={m.manseMaintenance} />
              <Money n={23} label="Rent" value={m.rent} />
            </div>
            <div>
              <Money n={24} label="Secretarial assistance" value={m.secretarialAssistance} />
              <Money n={25} label="Other expenses" value={m.otherExpenses} />
              <Money n={26} label="Total expenses paid (total of boxes 21 to 25)" value={c.box26} />
            </div>
          </div>
        </Panel>
        <Head>Service benefit cap calculation</Head>
        <Note>If your income, benefits and expenses payments received were at a rate of more than £8,500 for the year and you’ve made an entry in box 5 or 13, complete this section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={27} label="Gross income (box 20 minus (box 5 + box 13))" value={c.box27} />
              <Money n={28} label="2025–26 back pay, received after 5 April 2026" value={m.backPayAfterApril} />
              <Money n={29} label="Earlier years’ back pay, received during 2025–26" value={m.earlierYearBackPay} />
              <Money n={30} label="Payments (excluding those deducted directly from pay before tax) to registered pension schemes or qualifying overseas pension schemes" value={m.pensionPayments} />
              <Money n={31} label="Net income (box 27 + box 28 minus (box 26 + box 29 + box 30))" value={c.box31} minus />
            </div>
            <div>
              <Money n={32} label="10% of net income in box 31" value={c.box32} />
              <Money n={33} label="Amount you paid toward service benefit received – read the ‘Ministers of religion notes’" value={m.amountPaidTowardBenefit} />
              <Money n={34} label="Payments made for you and service benefit received for your vicarage (box 5 + box 13)" value={c.box34} />
              <Money n={35} label="Service benefit cap (box 33 + box 34 minus box 32) – if this is a positive figure enter the amount, if a negative figure enter ‘0’" value={c.box35} />
            </div>
          </div>
        </Panel>
        <Head>Other income as a minister of religion</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={36} label="Chaplaincy and other income as a minister" value={m.chaplaincyIncome} /></div>
            <div><Money n={37} label="Tax taken off box 36" value={m.taxOffChaplaincy} /></div>
          </div>
        </Panel>
        <Head>Taxable income etc</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={38} label="Taxable income minus expenses (box 20 + box 36 minus (box 26 + box 35))" value={c.box38} /></div>
            <div><Money n={39} label="Total tax taken off (box 3 + box 9 + box 11 + box 37)" value={c.box39} minus /></div>
          </div>
        </Panel>
        <p className="mt-1 flex items-start text-[10.5px] text-black"><InfoDot /> Employment lump sums, compensation and deductions are on the ‘Additional information’ pages.</p>
      </Page>
    </FormThemeContext.Provider>
  );
}
