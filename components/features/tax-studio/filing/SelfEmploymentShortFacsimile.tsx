// Facsimile of HMRC's SA103S Self-employment (short) — 2 pages (SES1–2), one set
// per short-form trade, in the cream theme, bound to TradeSource + the shared
// trade calc helpers. Box numbering differs from the full SA103F page.

import type { TaxReturn, TradeSource } from '../types';
import {
  FormThemeContext, CREAM_THEME, Page, SuppHead, Note, SubHead, Panel, Money, Line, Cells, Tick, YesNo, Label, toDDMMYYYY,
} from './formPrimitives';
import {
  tradeExpensesTotal, tradeNetProfit, tradeProfitForTax, tradeTaxableProfit, tradeAdjustedLoss, tradeLossCarriedForward,
} from '../calc';

const date = (d?: string) => toDDMMYYYY(d);

export default function SelfEmploymentShortFacsimile({ ret, trade }: { ret: TaxReturn; trade: TradeSource }) {
  const t = trade;
  const net = tradeNetProfit(t);

  return (
    <FormThemeContext.Provider value={CREAM_THEME}>
      {/* ── SES 1 ── */}
      <Page tag="SES 1" code="SA103S">
        <SuppHead
          title="Self-employment (short)"
          name={ret.clientName}
          utr={ret.utr ?? undefined}
          note={<Note>Please read the ‘Self-employment (short) notes’ to check if you should use this page or the ‘Self-employment (full)’ page. For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>}
        />
        <SubHead>Business details</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Description of business" value={t.description} lines={2} />
              <Cells n={2} label="Postcode of your business address" groups={[8]} value={t.postcode} />
              <div className="mb-3"><Label n={3}>If your business name, description, address or postcode have changed in the last 12 months, put ‘X’ in the box and give details in the ‘Any other information’ box of your tax return</Label><Tick on={!!t.detailsChanged} /></div>
              <div className="mb-3"><Label n={4}>If you are a foster carer or shared lives carer, put ‘X’ in the box</Label><Tick on={!!t.fosterCarer} /></div>
              <div><Label n="5Q">Did this business start after 5 April 2025? – you must put ‘X’ in one box</Label><YesNo yes={t.startedInYear ?? false} /></div>
            </div>
            <div>
              <Cells n={5} label="If you answered ‘Yes’ in box 5Q, enter the date the business started  DD MM YYYY" groups={[2, 2, 4]} value={date(t.dateStarted)} />
              <div className="mb-3"><Label n="6Q">Did this business cease before 6 April 2026? – you must put ‘X’ in one box</Label><YesNo yes={t.ceasedInYear ?? false} /></div>
              <Cells n={6} label="If you answered ‘Yes’ in box 6Q, enter the final date of trading  DD MM YYYY" groups={[2, 2, 4]} value={date(t.dateCeased)} />
              <Cells n={7} label="Date your books or accounts are made up to – between 31 March and 5 April 2026, or the final date of trading – read the notes  DD MM YYYY" groups={[2, 2, 4]} value={date(t.periodEnd)} />
              <div><Label n={8}>If you’ve used traditional accounting rather than cash basis to calculate your income and expenses, put ‘X’ in the box</Label><Tick on={!!t.traditionalAccounting} /></div>
            </div>
          </div>
        </Panel>
        <SubHead>Business income – if your annual business turnover was below £90,000</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={9} label="Your turnover – the takings, fees, sales or money earned by your business" value={t.turnover} /></div>
            <div>
              <Money n={10} label="Any other business income not included in box 9" value={t.otherBusinessIncome} />
              <Money n="10.1" label="Trading income allowance – read the notes" value={t.tradingIncomeAllowance} cells={4} />
            </div>
          </div>
        </Panel>
        <SubHead>Allowable business expenses</SubHead>
        <Note>If your annual turnover was below £90,000 you may just put your total expenses in box 20, rather than filling in the whole section.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={11} label="Costs of goods bought for resale or goods used" value={t.expCostOfGoods} />
              <Money n={12} label="Car, van and travel expenses – after private use proportion" value={t.expCarVanTravel} />
              <Money n={13} label="Wages, salaries and other staff costs" value={t.expWages} />
              <Money n={14} label="Rent, rates, power and insurance costs" value={t.expPremises} />
              <Money n={15} label="Repairs and maintenance of property and equipment" value={t.expRepairs} />
            </div>
            <div>
              <Money n={16} label="Accountancy, legal and other professional fees" value={t.expProfessional} />
              <Money n={17} label="Interest and bank and credit card financial charges" value={t.expInterest} />
              <Money n={18} label="Phone, fax, stationery and other office costs" value={t.expOffice} />
              <Money n={19} label="Other allowable business expenses – client entertaining costs are not an allowable expense" value={t.expOtherCosts} />
              <Money n={20} label="Total allowable expenses – total of boxes 11 to 19" value={tradeExpensesTotal(t)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SES 2 ── */}
      <Page tag="SES 2" code="SA103S">
        <SubHead>Net profit or loss</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={21} label="Net profit – if your business income is more than your expenses (if box 9 + box 10 minus box 20 is positive)" value={Math.max(0, net)} /></div>
            <div><Money n={22} label="Or, net loss – if your expenses exceed your business income (if box 20 minus (box 9 + box 10) is positive)" value={Math.max(0, -net)} /></div>
          </div>
        </Panel>
        <SubHead>Tax allowances for certain buildings, vehicles and equipment (capital allowances)</SubHead>
        <Note>Do not include the cost of these in your business expenses.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={23} label="Annual Investment Allowance" value={t.aia} />
              <Money n={24} label="Allowance for small balance of unrelieved expenditure" value={t.ca18} />
              <Money n="24.1" label="Zero-emission car allowance" value={t.zeroEmissionCar} />
              <Money n={25} label="Other capital allowances" value={t.ca6} />
            </div>
            <div>
              <Money n="25.1" label="The Structures and Buildings Allowance" value={t.sba} />
              <Money n="25.2" label="Freeport and Investment Zones Structures and Buildings Allowance" value={t.sbaFreeport} />
              <Money n={26} label="Total balancing charges – for example, where you have disposed of items for more than their tax value" value={t.balancingCharges} />
            </div>
          </div>
        </Panel>
        <SubHead>Calculating your taxable profits</SubHead>
        <Note>Your taxable profit may not be the same as your net profit. Please read the ‘Self-employment (short) notes’ to see if you need to make any adjustments and fill in the boxes which apply to arrive at your taxable profit for the year.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={27} label="Goods and/or services for your own use" value={t.goodsOwnUse} />
              <Money n={28} label="Net business profit for tax purposes (if box 21 + box 26 + box 27 minus (boxes 22 to 25.2) is positive). Or if you’ve completed box 10.1 (box 21 + box 26 + box 27 minus box 10.1)" value={Math.max(0, tradeProfitForTax(t))} />
            </div>
            <div>
              <Money n={29} label="Loss brought forward from earlier years set off against this year’s profits – up to the amount in box 28" value={t.lossBroughtForward} />
              <Money n={30} label="Any other business income not included in box 9 or box 10" value={t.otherBusinessIncome75} />
            </div>
          </div>
        </Panel>
        <SubHead>Total taxable profits or net business loss</SubHead>
        <Note>If your total profits from all Self-employments and Partnerships for 2025–26 are less than £6,845, you do not have to pay Class 2 National Insurance contributions, but you may want to pay voluntarily (box 36) to protect your rights to certain benefits.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={31} label="Total taxable profits from this business (if box 28 + box 30 minus box 29 is positive)" value={tradeTaxableProfit(t)} /></div>
            <div><Money n={32} label="Net business loss for tax purposes (if boxes 22 to 25.2 minus (box 21 + box 26 + box 27) is positive)" value={tradeAdjustedLoss(t)} /></div>
          </div>
        </Panel>
        <SubHead>Losses, Class 2 and Class 4 National Insurance contributions (NICs) and CIS deductions</SubHead>
        <Note>If you’ve made a loss for tax purposes (box 32), read the ‘Self-employment (short) notes’ and fill in boxes 33 to 35 as appropriate.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={33} label="Loss from this tax year set off against other income for 2025–26" value={t.lossSetOffOtherIncome} />
              <Money n={34} label="Loss to be carried back to previous years and set off against income (or capital gains)" value={t.lossCarriedBack} />
              <Money n={35} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={tradeLossCarriedForward(t)} />
            </div>
            <div>
              <div className="mb-3"><Label n={36}>If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put ‘X’ in the box</Label><Tick on={!!t.class2Voluntary} /></div>
              <div className="mb-3"><Label n={37}>If you’re exempt from paying Class 4 NICs, put ‘X’ in the box</Label><Tick on={!!t.class4Exempt} /></div>
              <Money n={38} label="Total Construction Industry Scheme (CIS) deductions taken from your payments by contractors – CIS subcontractors only" value={t.cisDeductions} />
            </div>
          </div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
