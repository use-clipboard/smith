// Facsimile of HMRC's SA102 Employment page (E1), one per employment.

import type { TaxReturn, EmploymentSource } from '../types';
import { FormThemeContext, PINK_THEME, Page, SuppHead, Note, Teal, SubHead, Panel, Money, Line, Cells, Tick, YesNo, Label } from './formPrimitives';

export default function EmploymentFacsimile({ ret, emp }: { ret: TaxReturn; emp: EmploymentSource }) {
  const e = emp;
  return (
    <FormThemeContext.Provider value={{ ...PINK_THEME, dense: true }}>
      <Page tag="E 1" code="SA102">
        <SuppHead title="Employment" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Teal>Complete an ‘Employment’ page for each employment or directorship</Teal>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Pay from this employment – the total from your P45 or P60 – before tax was taken off" value={e.pay} />
              <Money n="1.1" label="Payrolled benefits included in box 1 which affect your student loan repayments – read the notes" value={e.payrolledBenefitsStudentLoan} />
              <Money n={2} label="UK tax taken off pay in box 1" value={e.taxDeducted} minus />
              <Money n={3} label="Tips and other payments not on your P60" value={e.tips} />
              <Cells n={4} label="PAYE tax reference of your employer (on your P45/P60)" groups={[3, 11]} value={(e.payeRef || '').replace(/\//g, '')} sep="/" />
              <Line n={5} label="Your employer’s name" value={e.employer} />
              <div>
                <Label n={6}>Were you a director of this company – you must put ‘X’ in one of these boxes</Label>
                <YesNo yes={e.isDirector === undefined ? null : e.isDirector} />
              </div>
            </div>
            <div>
              <Cells n="6.1" label="If you ceased being a director before 6 April 2026, put the date the directorship ceased in the box  DD MM YYYY" groups={[2, 2, 4]} value={e.directorCeasedDate ? e.directorCeasedDate.split('-').reverse().join('') : ''} />
              <div className="mb-3">
                <Label n={7}>Was this company a close company – you must put ‘X’ in one of these boxes</Label>
                <div className="flex items-center gap-3"><YesNo yes={e.isCloseCompany === undefined ? null : e.isCloseCompany} /><span className="text-[10px] text-black">If No, go to question 8</span></div>
              </div>
              <Line n="7.1" label="Name of this close company" value={e.closeCompanyName} />
              <Cells n="7.2" label="Registration number of this close company" groups={[10]} value={e.closeCompanyReg} />
              <Money n="7.3" label="Dividends you received from this close company" value={e.closeCompanyDividends} />
              <Cells n="7.4" label="Percentage shareholding in this close company" groups={[3]} value={e.closeCompanyShareholding ? String(e.closeCompanyShareholding) : ''} />
              <div>
                <Label n={8}>If this employment income is from inside off-payroll working engagements, put ‘X’ in the box – read the notes</Label>
                <Tick on={!!e.teachersLoanOffPayroll} />
              </div>
            </div>
          </div>
        </Panel>
        <SubHead>Benefits from your employment – use your form P11D (or equivalent information)</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={9} label="Company cars and vans" value={e.benCar} />
              <Money n={10} label="Fuel for company cars and vans" value={e.benFuel} />
              <Money n={11} label="Private medical and dental insurance" value={e.benMedical} />
              <Money n={12} label="Vouchers, credit cards and excess mileage allowance" value={e.benVouchers} />
            </div>
            <div>
              <Money n={13} label="Goods and other assets provided by your employer" value={e.benAssets} />
              <Money n={14} label="Accommodation provided by your employer" value={e.benAccommodation} />
              <Money n={15} label="Other benefits (including interest-free and low interest loans)" value={e.benOther} />
              <Money n={16} label="Expenses payments received and balancing charges" value={e.benExpPayments} />
            </div>
          </div>
        </Panel>
        <SubHead>Employment expenses</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={17} label="Business travel and subsistence expenses" value={e.expTravel} />
              <Money n={18} label="Fixed deductions for expenses" value={e.expFixed} />
            </div>
            <div>
              <Money n={19} label="Professional fees and subscriptions" value={e.expProfessional} />
              <Money n={20} label="Other expenses and capital allowances" value={e.expOther} />
            </div>
          </div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
