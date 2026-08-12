// Facsimile of HMRC's SA101 Additional information — 4 pages (Ai1–4), teal theme.
// Box numbers restart per section (HMRC's section-relative numbering), bound to
// the Sa101 model (income.additional). Scalar box fields carry the breakdown
// totals, so the facsimile reads them directly.

import type React from 'react';
import type { TaxReturn, Sa101 } from '../types';
import {
  FormThemeContext, TEAL_THEME, TEAL, CELL, CELL_SHADOW, Page, SuppHead, Note, Panel, Money, Cells, Line, Tick, Label, toDDMMYYYY,
} from './formPrimitives';

// Major teal section header with a full-width teal rule above it.
const TealSection = ({ children }: { children: React.ReactNode }) => <h3 className="mb-2 mt-3 border-t-2 pt-2 text-[16px] font-bold leading-tight" style={{ color: TEAL, borderColor: TEAL }}>{children}</h3>;
// Black sub-heading.
const BlackHead = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-2 text-[15px] font-normal leading-tight text-black">{children}</h4>;
// Small teal in-panel sub-header.
const TealSub = ({ children }: { children: React.ReactNode }) => <p className="mb-2 mt-1 text-[13px] font-bold leading-tight" style={{ color: TEAL }}>{children}</p>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;

const Cell = ({ ch }: { ch?: string }) => (
  <span className="flex h-[18px] w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', boxShadow: CELL_SHADOW }}>{ch || ''}</span>
);
// N blank/filled cells (e.g. number of years the policy was held).
const NumCells = ({ n, label, cells, value }: { n: React.ReactNode; label: React.ReactNode; cells: number; value?: number }) => {
  const s = value ? Math.round(value).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < s.length && k < cells; k++) arr[cells - 1 - k] = s[s.length - 1 - k];
  return <div className="mb-3"><Label n={n}>{label}</Label><div className="flex gap-[3px]">{arr.map((d, i) => <Cell key={i} ch={d} />)}</div></div>;
};
// Up to `rows` stacked rows of `cells` boxes, from a newline-joined string.
const StackRows = ({ n, label, value, rows, cells, year }: { n: React.ReactNode; label: React.ReactNode; value?: string; rows: number; cells: number; year?: boolean }) => {
  const lines = (value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const list = Array.from({ length: rows }).map((_, i) => lines[i] || '');
  return (
    <div className="mb-3">
      <Label n={n}>{label}</Label>
      <div className="space-y-[6px]">
        {list.map((ln, ri) => {
          const digits = ln.toUpperCase().replace(/[^0-9A-Z]/g, '');
          if (year) {
            return <div key={ri} className="flex items-center gap-[3px]">{Array.from({ length: 4 }).map((_, k) => <Cell key={k} ch={digits[k]} />)}<span className="mx-[2px] text-[12px] font-bold text-black">–</span>{Array.from({ length: 2 }).map((_, k) => <Cell key={k} ch={digits[4 + k]} />)}</div>;
          }
          return <div key={ri} className="flex gap-[3px]">{Array.from({ length: cells }).map((_, k) => <Cell key={k} ch={digits[k]} />)}</div>;
        })}
      </div>
    </div>
  );
};

export default function AdditionalFacsimile({ ret }: { ret: TaxReturn }) {
  const a: Sa101 = ret.income.additional ?? {};
  const yr = (s?: string) => (s || '').replace(/\D/g, '');
  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── Ai 1 — Other UK income ── */}
      <Page tag="Ai 1" code="SA101">
        <SuppHead title="Additional information" name={ret.clientName} utr={ret.utr ?? undefined}
          note={<Note>Complete these pages for less common types of income, deductions and tax reliefs, and for any other information.<br />For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>} />
        <TealSection>Other UK income</TealSection>
        <BlackHead>Interest from gilt-edged and other UK securities, deeply discounted securities and accrued income profits</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Gilt etc interest after tax taken off" value={a.giltInterestNet} />
              <Money n={2} label="Tax taken off" value={a.giltTaxTaken} />
            </div>
            <div>
              <Money n={3} label="Gross amount before tax" value={a.giltGross} />
            </div>
          </div>
        </Panel>
        <BlackHead>Gains from life insurance policies, capital redemption policies and life annuity contracts</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={4} label="UK policy or contract gains on which tax was treated as paid – the amount of the gain" value={a.chargeableEventGains} />
              <NumCells n={5} label="Number of years the policy has been held or since the last gain" cells={2} value={a.lifeGainTaxPaidYears} />
              <Money n={6} label="UK policy or contract gains where no tax was treated as paid – the amount of the gain" value={a.lifeGainNoTaxPaid} />
              <NumCells n={7} label="Number of years the policy has been held or since the last gain" cells={2} value={a.lifeGainNoTaxYears} />
            </div>
            <div>
              <Money n={8} label="UK policy or contract gains from voided ISAs" value={a.voidedIsaGain} />
              <NumCells n={9} label="Number of years the policy was held" cells={2} value={a.voidedIsaYears} />
              <Money n={10} label="Tax taken off gain shown in box 8" value={a.voidedIsaTax} />
              <Money n={11} label="Deficiency relief" value={a.deficiencyRelief} />
            </div>
          </div>
        </Panel>
        <BlackHead>Stock dividends, bonus issues of securities and redeemable shares</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={12} label="Stock dividends – the amount received" value={a.stockDividends} />
              <Money n={13} label="Bonus issues of securities and redeemable shares" value={a.bonusIssues} />
            </div>
            <div>
              <Money n="13.1" label="Close company loans written off or released" value={a.closeCompanyLoansWrittenOff} />
            </div>
          </div>
        </Panel>
        <BlackHead>Business receipts taxed as income of an earlier year</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={14} label="The amount of post-cessation or other business receipts" value={a.businessReceipts} /></div>
            <div><Cells n={15} label="Tax year income to be taxed, for example, 2024–25  YYYY YY" groups={[4, 2]} sep="–" value={yr(a.businessReceiptsYear)} /></div>
          </div>
        </Panel>
      </Page>

      {/* ── Ai 2 — Share schemes / Other tax reliefs ── */}
      <Page tag="Ai 2" code="SA101">
        <TealSection>Share schemes and employment lump sums, compensation and deductions, certain post-employment income and patent royalty payments</TealSection>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Share schemes – the taxable amount – excluding amounts included on your P60 or P45" value={a.shareSchemesTaxable} />
              <NotInUse>Box 2 is not in use</NotInUse>
              <Money n={3} label="Taxable lump sums and certain income after the end of your job – excluding redundancy and compensation for loss of your job" value={a.taxableLumpSums} />
              <Money n={4} label="Lump sums or benefits received from an Employer Financed Retirement Benefits Scheme excluding pensions" value={a.efrbsBenefits} />
              <Money n={5} label="Redundancy, other lump sums and compensation payments – the amount above the £30,000 exemption" value={a.redundancyReceipts} />
              <Money n={6} label="Tax taken off boxes 3 to 5" value={a.taxOffLumpSums} />
              <div className="mb-3"><Label n={7}>If you’ve left box 6 blank because the tax is included in box 2 on the ‘Employment’ page, put ‘X’ in the box</Label><Tick on={!!a.taxOnEmploymentPages} /></div>
            </div>
            <div>
              <Money n={8} label="Exemptions for amounts entered in box 4" value={a.exemptForeignService} />
              <Money n={9} label="Compensation and lump sums up to £30,000 exemption" value={a.lumpSumExemption30k} />
              <Money n={10} label="Disability and foreign service deduction" value={a.disabilityPortion} />
              <Money n={11} label="Seafarers’ Earnings Deduction – enter pay on your ‘Employment’ page – read Helpsheet 205" value={a.seafarersDeduction} />
              <Money n={12} label="Foreign earnings not taxable in the UK" value={a.foreignEarningsNotTaxable} />
              <Money n={13} label="Foreign tax for which tax credit relief not claimed" value={a.foreignTaxNoTcr} />
              <Money n={14} label="Exempt employers’ contributions to an overseas pension scheme – read the notes" value={a.exemptOverseasPensionContrib} />
              <Money n={15} label="UK patent royalty payments made" value={a.patentRoyaltyPayments} />
            </div>
          </div>
        </Panel>
        <TealSection>Other tax reliefs – read the notes</TealSection>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Subscriptions for Venture Capital Trust shares – the amount on which relief is claimed" value={a.vctSubscriptions} />
              <Money n={2} label="Subscriptions for Enterprise Investment Scheme shares – the amount on which relief is claimed" value={a.eisSubscriptions} />
              <Money n={3} label="Community Investment Tax Relief – the amount on which relief is claimed" value={a.citrInvestment} />
              <Money n={4} label="Annual payments made" value={a.annualPayments} />
              <Money n={5} label="Qualifying loan interest payable in the year" value={a.qualifyingLoanInterest} />
              <Money n={6} label="Post-cessation trade relief and certain other losses" value={a.postCessationExpenses} />
              <Money n="6.1" label="Pre-incorporation losses" value={a.preIncorporationLosses} />
            </div>
            <div>
              <Money n={7} label="Maintenance payments (up to £4,360) – if you or your former spouse or civil partner were born before 6 April 1935" value={a.maintenancePayments} cells={5} />
              <Money n={8} label="Payments to a trade union for death benefits – half the amount paid (maximum £100)" value={a.tradeUnionDeathBenefits} cells={4} />
              <Money n={9} label="Relief claimed on a qualifying distribution on the redemption of bonus shares or securities" value={a.reliefRedemptionBonusShares} />
              <Money n={10} label="Subscriptions for shares under the Seed Enterprise Investment Scheme" value={a.seisSubscriptions} />
              <NotInUse>Box 11 is not in use</NotInUse>
              <Money n={12} label="Non-deductible loan interest from investments into property letting partnerships" value={a.nonDeductiblePropertyPartnershipInterest} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── Ai 3 — Married Couple's Allowance / Other information ── */}
      <Page tag="Ai 3" code="SA101">
        <TealSection>Married Couple’s Allowance (only complete if either you, your spouse or civil partner were born before 6 April 1935)</TealSection>
        <Note>If you were both born on or after 6 April 1935 and you want to claim Marriage Allowance, complete the Marriage Allowance section on page TR 5 of SA100. Please read the notes and then complete the relevant boxes.</Note>
        <Note>If you’re the husband (marriages up to 5 December 2005), or the spouse or civil partner with the higher income (marriages and civil partnerships on or after 5 December 2005), you should complete box 1 and, where appropriate, boxes 2 to 5 and box 9.</Note>
        <Note>If you’re the wife (marriages up to 5 December 2005), or the spouse or civil partner with the lower income (marriages and civil partnerships on or after 5 December 2005), please read the notes to help you fill in boxes 6 to 11.</Note>
        <Note>If you cannot use all of your Married Couple’s Allowance or you want your spouse or civil partner to have your surplus allowance, please read the notes and then put ‘X’ in box 10 or box 11.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Your spouse’s or civil partner’s full name" value={a.mcaSpouseName} lines={2} />
              <Cells n={2} label="Their date of birth if older than you (and at least one of you was born before 6 April 1935)  DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(a.mcaSpouseDob)} />
              <div className="mb-3"><Label n={3}>If you’ve already agreed that half the minimum allowance is to go to your spouse or civil partner, put ‘X’ in the box</Label><Tick on={!!a.mcaTransferHalf} /></div>
              <div className="mb-3"><Label n={4}>If you’ve already agreed that all of the minimum allowance is to go to your spouse or civil partner, put ‘X’ in the box</Label><Tick on={!!a.mcaTransferAll} /></div>
              <Cells n={5} label="If, in the year to 5 April 2026, you lived with any previous spouse or civil partner, enter their date of birth  DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(a.mcaPrevSpouseDob)} />
            </div>
            <div>
              <div className="mb-3"><Label n={6}>If you’ve already agreed that half of the minimum allowance is to be given to you, put ‘X’ in the box</Label><Tick on={!!a.mcaReceiveHalf} /></div>
              <div className="mb-3"><Label n={7}>If you’ve already agreed that all of the minimum allowance is to be given to you, put ‘X’ in the box</Label><Tick on={!!a.mcaReceiveAll} /></div>
              <Line n={8} label="Your spouse’s or civil partner’s full name" value={a.mcaSpousePartnerFullName} lines={2} />
              <Cells n={9} label="If you were married or formed a civil partnership after 5 April 2025, enter the date of marriage or civil partnership  DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(a.mcaMarriageDate)} />
              <div className="mb-3"><Label n={10}>If you want to have your spouse’s or civil partner’s surplus allowance, put ‘X’ in the box</Label><Tick on={!!a.mcaHaveSurplus} /></div>
              <div className="mb-3"><Label n={11}>If you want your spouse or civil partner to have your surplus allowance, put ‘X’ in the box</Label><Tick on={!!a.mcaGiveSurplus} /></div>
            </div>
          </div>
        </Panel>
        <TealSection>Other information</TealSection>
        <BlackHead>Income Tax losses and limit on Income Tax relief</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TealSub>Other income losses</TealSub>
              <Money n={1} label="Earlier years’ losses – which can be set against certain other income in 2025–26" value={a.earlierYearsLosses} />
              <Money n={2} label="Total unused losses carried forward" value={a.unusedLossesCarriedForward} />
              <TealSub>Trade losses from a later year</TealSub>
              <Money n={3} label="Relief now for 2026–27 trade losses or certain capital losses – read the notes" value={a.laterYearReliefClaimed} />
            </div>
            <div>
              <Money n={4} label="Enter the amount of relief shown in box 3 which is not subject to the limit on Income Tax reliefs" value={a.laterYearReliefNotLimited} />
              <Cells n={5} label="Tax year for which you’re claiming relief in box 3, for example, 2024–25  YYYY YY" groups={[4, 2]} sep="–" value={yr(a.laterYearLossTaxYear)} />
              <TealSub>Limit on Income Tax relief</TealSub>
              <Money n={6} label="Amount of payroll giving" value={a.payrollGiving} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── Ai 4 — Pension savings / Tax avoidance ── */}
      <Page tag="Ai 4" code="SA101">
        <BlackHead>Pension Savings Tax Charges</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 7, 8 and 9 are not in use</NotInUse>
              <Money n={10} label="Amount saved towards your pension, in the period covered by this tax return, in excess of the Annual Allowance" value={a.annualAllowanceExcess} />
              <Money n={11} label="Annual Allowance tax paid or payable by your pension scheme" value={a.annualAllowanceTaxPaid} />
              <Money n="11.1" label="Value of pension benefits transferred subject to the overseas transfer charge" value={a.pensionOverseasTransfer} />
              <Money n="11.2" label="Tax paid by your pension scheme on your overseas transfer charge" value={a.overseasTransferChargeTax} />
              <div className="mb-3">
                <Label n={12}>Pension scheme tax reference number</Label>
                <div className="flex items-center gap-[3px]">
                  <span className="flex h-[18px] items-center justify-center px-1 text-[10px] font-bold text-slate-500" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>PSTR</span>
                  {Array.from({ length: 10 }).map((_, k) => <Cell key={k} ch={(a.pensionSchemeRef || '').toUpperCase().replace(/\s/g, '')[k]} />)}
                </div>
              </div>
            </div>
            <div>
              <Money n={13} label="Amount of unauthorised payment from a pension scheme, not subject to surcharge" value={a.unauthNotSurcharge} />
              <Money n={14} label="Amount of unauthorised payment from a pension scheme, subject to surcharge" value={a.unauthSurcharge} />
              <Money n={15} label="Foreign tax paid on an unauthorised payment (in £ sterling)" value={a.unauthForeignTax} />
              <Money n={16} label="Taxable short service refund of contributions (overseas pension schemes only)" value={a.foreignLumpShortServiceRefund} />
              <NotInUse>Box 17 is not in use</NotInUse>
              <Money n={18} label="Foreign tax paid (in £ sterling) on box 16" value={a.foreignLumpForeignTax} />
            </div>
          </div>
        </Panel>
        <BlackHead>Tax avoidance schemes</BlackHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><StackRows n={19} label="The scheme reference number or promoter reference number" value={a.avoidanceSchemeRefs} rows={3} cells={11} /></div>
            <div><StackRows n={20} label="The tax year in which the expected advantage arises, for example, 2024–25  YYYY YY" value={a.avoidanceTaxYears} rows={3} cells={6} year /></div>
          </div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
