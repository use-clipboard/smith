// Facsimile of HMRC's SA104S Partnership (short) — 2 pages (SP1–2), teal theme,
// bound to PartnershipSource + the partnership calc helpers (see types.ts).

import type React from 'react';
import type { TaxReturn, PartnershipSource } from '../types';
import {
  FormThemeContext, RecordContext, TEAL_THEME, TEAL, CELL, Page, SuppHead, Note, Panel, Money, Cells, Line, Tick, YesNo, Label, toDDMMYYYY,
} from './formPrimitives';
import {
  partnershipAdjustedProfit, partnershipTaxableTradeProfit, partnershipTotalTaxableProfit,
  partnershipAdjustedLoss, partnershipLossCarryForward,
} from '../calc';

const H = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
const date = (d?: string) => toDDMMYYYY(d);

export default function PartnershipShortFacsimile({ ret, partner }: { ret: TaxReturn; partner: PartnershipSource }) {
  const p = partner;
  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      <RecordContext.Provider value={p.id}>
      {/* ── SP 1 ── */}
      <Page tag="SP 1" code="SA104S">
        <SuppHead title="Partnership (short)" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>Complete a ‘Partnership’ page for each partnership of which you were a member and for each partnership business.<br />For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
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
              <div className="mb-3"><Label n="4Q">Did you leave this partnership after 5 April 2025 but before 6 April 2026? You must put ‘X’ in one box</Label><YesNo yes={p.ceasedPartner ?? false} /></div>
              <Cells n={4} label="If you answered ‘Yes’ in box 4Q enter the date you left this partnership  DD MM YYYY" groups={[2, 2, 4]} value={date(p.dateLeft)} />
              <NotInUse>Box 5 is not in use</NotInUse>
            </div>
          </div>
        </Panel>
        <H>Your share of the partnership’s trading or professional profits</H>
        <Note>Please refer to the Partnership Statement to complete these pages and if you need any help, read the ‘Partnership (short) notes’. If your partnership’s accounting date is not between 31 March and 5 April you will need to apportion your share of the partnership’s profits from each accounting period to the tax year – use box 9 to adjust your share of the profit or loss (box 8). If the partnership carries on certain trades or professions, or in certain situations, you may need to make further tax adjustments in boxes 10 to 12. If you have untaxed transition profit from 2023–24 you will need to complete the ‘Partnership (full)’ page. If you want to enter a loss, or an adjustment needs to be taken off, put a minus (–) in the box next to the £ sign.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 6 and 7 are not in use</NotInUse>
              <Money n={8} label="Your share of the partnership’s profit or loss – from box 11 or box 12 on the Partnership Statement" value={p.profit} minus />
              <Money n={9} label="Adjustment where the partnership’s accounting period ended before 31 March 2026 or where the partnership’s accounting period was not 12 months long" value={p.adjustmentPeriod} minus />
              <Money n={10} label="Adjustment for change of accounting practice – from box 11A on the Partnership Statement" value={p.accountingAdjustment} />
              <Money n={11} label="Averaging adjustment – only for farmers, market gardeners and creators of literary or artistic works" value={p.averagingAdjustment} minus />
              <Money n={12} label="Foreign tax claimed as a deduction – only if Foreign Tax Credit Relief is not being claimed on the ‘Foreign’ pages" value={p.foreignTaxDeduction} />
            </div>
            <div>
              <NotInUse>Boxes 13, 14 and 15 are not in use</NotInUse>
              <Money n={16} label="Adjusted profit for 2025–26 – see the working sheet in the notes" value={partnershipAdjustedProfit(p)} />
              <Money n={17} label="Losses brought forward from earlier years set off against this year’s profit (up to the amount in box 16)" value={p.lossBroughtForward} />
              <Money n={18} label="Taxable profits after losses brought forward (box 16 minus box 17)" value={partnershipTaxableTradeProfit(p)} />
              <Money n={19} label="Any other business income not included in the partnership accounts" value={p.otherBusinessIncome} />
              <Money n={20} label="Your share of total taxable profits from the partnership’s business for 2025–26 (box 18 + box 19)" value={partnershipTotalTaxableProfit(p)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SP 2 ── */}
      <Page tag="SP 2" code="SA104S">
        <div className="flex h-full flex-col">
          <H>Your share of the partnership’s trading or professional losses</H>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <Money n={21} label="Adjusted loss for 2025–26 – see the working sheet in the notes" value={partnershipAdjustedLoss(p)} />
                <Money n={22} label="Loss from this tax year set off against other income for 2025–26" value={p.lossAgainstOtherIncome} />
              </div>
              <div>
                <Money n={23} label="Loss to be carried back to previous years and set off against income (or capital gains)" value={p.lossCarriedBack} />
                <Money n={24} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={partnershipLossCarryForward(p)} />
              </div>
            </div>
          </Panel>
          <H>Class 2 and Class 4 National Insurance contributions (NICs)</H>
          <Note>If your total profits from all self-employments and partnerships for 2025–26 are less than £6,845 you do not have to pay Class 2 NICs, but you may want to pay voluntarily (box 25) to protect your rights to certain benefits. Read the ‘Partnership (short) notes’.</Note>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div><Label n={25}>If your total profits for 2025–26 are less than £6,845, and you choose to pay Class 2 NICs voluntarily, put ‘X’ in the box</Label><Tick on={!!p.class2Voluntary} /></div>
              <div>
                <div className="mb-3"><Label n={26}>If you’re exempt from paying Class 4 NICs, put ‘X’ in the box</Label><Tick on={!!p.class4Exempt} /></div>
                <Money n={27} label="Adjustment to profits chargeable to Class 4 NICs" value={p.class4Adjustment} />
              </div>
            </div>
          </Panel>
          <H>Your share of the partnership’s untaxed interest</H>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div><Money n={28} label="Your share of untaxed interest – from box 13 on the Partnership Statement" value={p.ukSavings} /></div>
              <div><NotInUse>Box 29 is not in use</NotInUse></div>
            </div>
          </Panel>
          <H>Your share of the partnership’s tax paid and deductions</H>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div><Money n={30} label="Your share of Construction Industry Scheme deductions made by contractors – from box 24 on the Partnership Statement" value={p.cisDeductions} /></div>
              <div><Money n={31} label="Your share of any tax taken off trading income (not contractor deductions) – from box 24A on the Partnership Statement" value={p.taxTakenTradingIncome} /></div>
            </div>
          </Panel>
          <H>Any other information</H>
          <Panel className="flex flex-1 flex-col">
            <Label n={32}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{p.otherInformation}</div>
          </Panel>
        </div>
      </Page>
      </RecordContext.Provider>
    </FormThemeContext.Provider>
  );
}
