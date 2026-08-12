// Facsimile of HMRC's SA102MLA Northern Ireland Legislative Assembly — 2 pages
// (MLA1–2), pink theme, bound to AssemblyOffice (see types.ts).

import type React from 'react';
import type { TaxReturn, AssemblyOffice } from '../types';
import { FormThemeContext, PINK_THEME, CELL, Page, SuppHead, Note, Panel, Money, Label, InfoDot } from './formPrimitives';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;

export default function NIAssemblyFacsimile({ ret, office }: { ret: TaxReturn; office: AssemblyOffice }) {
  const a = office;
  return (
    <FormThemeContext.Provider value={PINK_THEME}>
      {/* ── MLA 1 ── */}
      <Page tag="MLA 1" code="SA102MLA">
        <SuppHead title="Northern Ireland Legislative Assembly" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Head>Income from office</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Payments from P60 (or P45 or payslips) – before tax was taken off" value={a.p60Pay} />
              <Money n="1.1" label="Payrolled benefits included in box 1 which affect your student loan repayments – read the notes" value={a.payrolledBenefitsStudentLoan} />
            </div>
            <div>
              <Money n={2} label="Tax taken off box 1" value={a.taxTakenOff} />
            </div>
          </div>
        </Panel>
        <Head>Benefits from your office</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={3} label="Office cost expenditure – non-capital items (for capital items see the notes)" value={a.officeCostExpenditure} />
              <Money n={4} label="Other cash reimbursements" value={a.otherCashReimbursements} />
            </div>
            <div>
              <Money n={5} label="All other benefits" value={a.allOtherBenefits} />
              <Money n={6} label="Balancing charges" value={a.balancingCharges} />
            </div>
          </div>
        </Panel>
        <Head>Office expenses paid out by you</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={7} label="Secretarial, clerical and research assistance" value={a.secretarialAssistance} />
              <Money n={8} label="Office expenses" value={a.officeExpenses} />
            </div>
            <div>
              <Money n={9} label="Other expenses and capital allowances" value={a.otherExpensesCapitalAllowances} />
            </div>
          </div>
        </Panel>
        <p className="mt-1 flex items-start text-[10.5px] text-black"><InfoDot /> Employment lump sums, compensation and deductions are on the ‘Additional information’ pages.</p>
      </Page>

      {/* ── MLA 2 ── */}
      <Page tag="MLA 2" code="SA102MLA">
        <div className="flex h-full flex-col">
          <Head>Any other information</Head>
          <Panel className="flex flex-1 flex-col">
            <Label n={10}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{a.otherInformation}</div>
          </Panel>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
