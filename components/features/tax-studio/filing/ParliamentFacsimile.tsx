// Facsimile of HMRC's SA102MP Parliament (MPs) — 2 pages (MP1–2), pink theme,
// bound to ParliamentOffice (see types.ts).

import type React from 'react';
import type { TaxReturn, ParliamentOffice } from '../types';
import { FormThemeContext, PINK_THEME, CELL, Page, SuppHead, Note, Panel, Money, Label, InfoDot } from './formPrimitives';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;

export default function ParliamentFacsimile({ ret, office }: { ret: TaxReturn; office: ParliamentOffice }) {
  const m = office;
  return (
    <FormThemeContext.Provider value={PINK_THEME}>
      {/* ── MP 1 ── */}
      <Page tag="MP 1" code="SA102MP">
        <SuppHead title="Parliament" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Head>Income from office</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Payments from P60 (or P45 or payslips) – before tax was taken off" value={m.p60Pay} />
              <Money n="1.1" label="Payrolled benefits included in box 1 which affect your student loan repayments – read the notes" value={m.payrolledBenefitsStudentLoan} />
            </div>
            <div>
              <Money n={2} label="Tax taken off box 1" value={m.taxTakenOff} />
            </div>
          </div>
        </Panel>
        <Head>Benefits from your office</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={3} label="Travel, travel warrants and vouchers" value={m.travelVouchers} />
              <Money n={4} label="Accommodation, excluding accommodation expenses" value={m.accommodation} />
              <Money n={5} label="Office costs expenditure – non-capital items (for capital items read the notes)" value={m.officeCostsExpenditure} />
            </div>
            <div>
              <Money n={6} label="Contingency payment" value={m.contingencyPayment} />
              <Money n={7} label="Financial Assistance Fund and other cash reimbursements" value={m.financialAssistanceFund} />
              <Money n={8} label="All other benefits" value={m.allOtherBenefits} />
              <Money n={9} label="Balancing charges" value={m.balancingCharges} />
            </div>
          </div>
        </Panel>
        <Head>Office expenses paid out by you</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={10} label="Travel warrants" value={m.travelWarrants} />
              <Money n={11} label="Secretarial, clerical and research assistance" value={m.secretarialAssistance} />
            </div>
            <div>
              <Money n={12} label="Office expenses" value={m.officeExpenses} />
              <Money n={13} label="Other expenses and capital allowances" value={m.otherExpensesCapitalAllowances} />
            </div>
          </div>
        </Panel>
        <p className="mt-1 flex items-start text-[10.5px] text-black"><InfoDot /> Employment lump sums, compensation and deductions are on the ‘Additional information’ pages.</p>
      </Page>

      {/* ── MP 2 ── */}
      <Page tag="MP 2" code="SA102MP">
        <div className="flex h-full flex-col">
          <Head>Any other information</Head>
          <Panel className="flex flex-1 flex-col">
            <Label n={14}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{m.otherInformation}</div>
          </Panel>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
