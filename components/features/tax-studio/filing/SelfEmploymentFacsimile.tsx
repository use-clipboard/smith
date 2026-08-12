// Facsimile of HMRC's SA103F Self-employment (full) — 6 pages (SEF1–6), one set
// per trade, in the cream theme, bound to TradeSource + the trade calc helpers.

import type { TaxReturn, TradeSource } from '../types';
import {
  FormThemeContext, CREAM_THEME, TEAL, CELL, Page, SuppHead, Note, Teal, SubHead, Panel, Money, Line, Cells, Tick, YesNo, Label, toDDMMYYYY,
} from './formPrimitives';
import {
  tradeExpensesTotal, tradeDisallowableTotal, tradeCapitalAllowancesTotal, tradeNetProfit, tradeAdditions, tradeDeductions,
  tradeProfitForTax, tradeAdjustedProfit, tradeTaxableProfit, tradeAdjustedLoss, tradeLossCarriedForward,
  tradeTotalAssets, tradeNetBusinessAssets, tradeCapitalAccountEnd,
} from '../calc';

function NotInUse({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
}
function ColHead({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[13px] font-bold" style={{ color: TEAL }}>{children}</p>;
}
const date = (d?: string) => toDDMMYYYY(d);

// SA103F business expenses — each row is one category shared across the two
// columns: the allowable box (17–30) with its label, and the disallowable box
// (32–45) which HMRC prints with only a box number. Rendering both from one list
// (with the disallowable label ghosted) keeps every box level with its twin.
const EXP_ROWS: { n: number; dn: number; label: string; a: (t: TradeSource) => number | undefined; d: (t: TradeSource) => number | undefined }[] = [
  { n: 17, dn: 32, label: 'Cost of goods bought for resale or goods used', a: t => t.expCostOfGoods, d: t => t.disCostOfGoods },
  { n: 18, dn: 33, label: 'Construction industry – payments to subcontractors', a: t => t.expSubcontractors, d: t => t.disSubcontractors },
  { n: 19, dn: 34, label: 'Wages, salaries and other staff costs', a: t => t.expWages, d: t => t.disWages },
  { n: 20, dn: 35, label: 'Car, van and travel expenses', a: t => t.expCarVanTravel, d: t => t.disCarVanTravel },
  { n: 21, dn: 36, label: 'Rent, rates, power and insurance costs', a: t => t.expPremises, d: t => t.disPremises },
  { n: 22, dn: 37, label: 'Repairs and maintenance of property and equipment', a: t => t.expRepairs, d: t => t.disRepairs },
  { n: 23, dn: 38, label: 'Phone, fax, stationery and other office costs', a: t => t.expOffice, d: t => t.disOffice },
  { n: 24, dn: 39, label: 'Advertising and business entertainment costs', a: t => t.expAdvertising, d: t => t.disAdvertising },
  { n: 25, dn: 40, label: 'Interest on bank and other loans', a: t => t.expInterest, d: t => t.disInterest },
  { n: 26, dn: 41, label: 'Bank, credit card and other financial charges', a: t => t.expBankCharges, d: t => t.disBankCharges },
  { n: 27, dn: 42, label: 'Irrecoverable debts written off', a: t => t.expBadDebts, d: t => t.disBadDebts },
  { n: 28, dn: 43, label: 'Accountancy, legal and other professional fees', a: t => t.expProfessional, d: t => t.disProfessional },
  { n: 29, dn: 44, label: 'Depreciation and loss or profit on sale of assets', a: t => t.expDepreciation, d: t => t.disDepreciation },
  { n: 30, dn: 45, label: 'Other business expenses', a: t => t.expOtherCosts, d: t => t.disOtherCosts },
];

export default function SelfEmploymentFacsimile({ ret, trade }: { ret: TaxReturn; trade: TradeSource }) {
  const t = trade;
  const net = tradeNetProfit(t);
  const pft = tradeProfitForTax(t);
  const head = <SuppHead title="Self-employment (full)" name={ret.clientName} utr={ret.utr ?? undefined} note={<Note>Please read the ‘Self-employment (full) notes’ to check if you should use this page or the ‘Self-employment (short)’ page. For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>} />;

  return (
    <FormThemeContext.Provider value={CREAM_THEME}>
      {/* ── SEF 1 ── */}
      <Page tag="SEF 1" code="SA103F">
        {head}
        <SubHead>Business details</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Business name – unless it’s in your own name" value={t.name} lines={2} />
              <Line n={2} label="Description of business" value={t.description} lines={2} />
              <Line n={3} label="First line of your business address – unless you work from home" value={t.addressLine} lines={2} />
              <Cells n={4} label="Postcode of your business address" groups={[8]} value={t.postcode} />
              <div className="mb-3"><Label n={5}>If the details in boxes 1, 2, 3 or 4 have changed in the last 12 months, put ‘X’ in the box and give details in the ‘Any other information’ box</Label><Tick on={!!t.detailsChanged} /></div>
              <div><Label n="6Q">Did this business start after 5 April 2025? You must put ‘X’ in one box</Label><YesNo yes={t.startedInYear ?? false} /></div>
            </div>
            <div>
              <Cells n={6} label="If you answered ‘Yes’ in box 6Q, enter the date the business started  DD MM YYYY" groups={[2, 2, 4]} value={date(t.dateStarted)} />
              <div className="mb-3"><Label n="7Q">Did this business cease after 5 April 2025 but before 6 April 2026? You must put ‘X’ in one box</Label><YesNo yes={t.ceasedInYear ?? false} /></div>
              <Cells n={7} label="If you answered ‘Yes’ in box 7Q, enter the final date of trading  DD MM YYYY" groups={[2, 2, 4]} value={date(t.dateCeased)} />
              <Cells n={8} label="Date your books or accounts start – the beginning of your accounting period  DD MM YYYY" groups={[2, 2, 4]} value={date(t.periodStart)} />
              <Cells n={9} label="Date your books or accounts are made up to or the end of your accounting period  DD MM YYYY" groups={[2, 2, 4]} value={date(t.periodEnd)} />
              <div><Label n={10}>If you used traditional accounting rather than cash basis to calculate your income and expenses, put ‘X’ in the box</Label><Tick on={!!t.traditionalAccounting} /></div>
            </div>
          </div>
        </Panel>
        <SubHead>Other information</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 11 and 12 are not in use</NotInUse>
              <div><Label n={13}>If special arrangements apply, put ‘X’ in the box</Label><Tick on={!!t.specialArrangements} /></div>
            </div>
            <div><Label n={14}>If you provided the information about your 2025–26 profit on last year’s tax return, put ‘X’ in the box</Label><Tick on={!!t.priorYearProfitDetails} /></div>
          </div>
        </Panel>
        <SubHead>Business income</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={15} label="Your turnover – the takings, fees, sales or money earned by your business" value={t.turnover} /></div>
            <div>
              <Money n={16} label="Any other business income not included in box 15" value={t.otherBusinessIncome} />
              <Money n="16.1" label="Trading income allowance – read the notes" value={t.tradingIncomeAllowance} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SEF 2 — business expenses ── */}
      <Page tag="SEF 2" code="SA103F">
        <SubHead>Business expenses</SubHead>
        <Note>Please read the ‘Self-employment (full) notes’ before filling in this section.</Note>
        <Panel divided>
          <div className="mb-2 grid grid-cols-2 gap-x-10">
            <div>
              <ColHead>Total expenses</ColHead>
              <p className="text-[9.5px] text-black">If your annual turnover was below £90,000, you may just put your total expenses in box 31</p>
            </div>
            <div>
              <ColHead>Disallowable expenses</ColHead>
              <p className="text-[9.5px] text-black">Use this column if the figures in boxes 17 to 30 include disallowable amounts</p>
            </div>
          </div>
          {EXP_ROWS.map(r => (
            <div key={r.n} className="grid grid-cols-2 gap-x-10">
              <Money n={r.n} label={r.label} value={r.a(t)} />
              <Money n={r.dn} label={r.label} ghost value={r.d(t)} />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-x-10">
            <Money n={31} label="Total expenses (total of boxes 17 to 30)" value={tradeExpensesTotal(t)} />
            <Money n={46} label="Total disallowable expenses (total of boxes 32 to 45)" value={tradeDisallowableTotal(t)} />
          </div>
        </Panel>
      </Page>

      {/* ── SEF 3 — net profit + capital allowances + taxable profit ── */}
      <Page tag="SEF 3" code="SA103F">
        <SubHead>Net profit or loss</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={47} label="Net profit – if your business income is more than your expenses (if box 15 + box 16 minus box 31 is positive)" value={Math.max(0, net)} /></div>
            <div><Money n={48} label="Or, net loss – if your expenses are more than your business income (if box 31 minus (box 15 + box 16) is positive)" value={Math.max(0, -net)} /></div>
          </div>
        </Panel>
        <SubHead>Tax allowances for vehicles and equipment (capital allowances)</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={49} label="Annual Investment Allowance" value={t.aia} />
              <Money n={50} label="Capital allowances at 18% on equipment, including cars with lower CO2 emissions" value={t.ca18} />
              <Money n={51} label="Capital allowances at 6% on equipment, including cars with higher CO2 emissions" value={t.ca6} />
              <Money n={52} label="Zero-emission goods vehicle allowance" value={t.zeroEmissionGoods} />
              <Money n="52.1" label="Zero-emission car allowance" value={t.zeroEmissionCar} />
              <Money n={53} label="The Structures and Buildings Allowance" value={t.sba} />
              <Money n="53.1" label="Freeport and Investment Zones Structures and Buildings Allowance" value={t.sbaFreeport} />
            </div>
            <div>
              <Money n={54} label="Electric charge-point allowance" value={t.electricChargepoint} />
              <Money n={55} label="100% and other enhanced capital allowances" value={t.enhancedCapitalAllowances} />
              <Money n={56} label="Allowances on sale or cessation of business use (where you’ve disposed of assets for less than their tax value)" value={t.allowancesOnSale} />
              <Money n={57} label="Total capital allowances (total of boxes 49 to 56)" value={tradeCapitalAllowancesTotal(t)} />
              <NotInUse>Box 58 is not in use</NotInUse>
              <Money n={59} label="Balancing charge on sales of assets or on the cessation of business use (including where Business Premises Renovation Allowance has been claimed)" value={t.balancingCharges} />
            </div>
          </div>
        </Panel>
        <SubHead>Calculating your taxable profit or loss</SubHead>
        <Note>You may have to adjust your net profit or loss for disallowable expenses or capital allowances to arrive at your taxable profit or your loss for tax purposes.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={60} label="Goods and services for your own use" value={t.goodsOwnUse} />
              <Money n={61} label="Total additions to net profit or deductions from net loss (box 46 + box 59 + box 60)" value={tradeAdditions(t)} />
              <Money n={62} label="Income, receipts and other profits included in business income or expenses but not taxable as business profits" value={t.incomeReceiptsElsewhere} />
            </div>
            <div>
              <Money n={63} label="Total deductions from net profit or additions to net loss (box 57 + box 62)" value={tradeDeductions(t)} />
              <Money n={64} label="Net business profit for tax purposes (if box 47 + box 61 minus (box 48 + box 63) is positive)" value={Math.max(0, pft)} />
              <Money n={65} label="Net business loss for tax purposes (if box 48 + box 63 minus (box 47 + box 61) is positive)" value={Math.max(0, -pft)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SEF 4 — taxable profit continued + losses ── */}
      <Page tag="SEF 4" code="SA103F">
        <p className="mb-1 text-[14px] text-black">Calculating your taxable profit or loss <span className="text-[11px]">continued</span></p>
        <Note>In all cases complete boxes 73 and 76. If your accounting date is not between 31 March and 5 April you will need to apportion profits from each accounting period to the tax year – use box 68 to adjust your tax profit (box 64) or loss (box 65) accordingly.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 66 and 67 are not in use</NotInUse>
              <Money n={68} label="Adjustment where your accounting period ended before 31 March 2026 or where your accounting period was not 12 months long – if the adjustment needs to be taken off the profit figure, put a minus sign (-) in the box" value={t.basisAdjustment} minus />
              <NotInUse>Boxes 69 and 70 are not in use</NotInUse>
              <Money n={71} label="Adjustment for change of accounting practice" value={t.changeOfPracticeAdjustment} />
              <Money n={72} label="Averaging adjustment (only for farmers, market gardeners and creators of literary or artistic works) – if the adjustment needs to be taken off the profit figure, put a minus sign (–) in the box" value={t.averagingAdjustment} minus />
              <Money n={73} label="Adjusted profit for 2025–26 – see the working sheet in the notes" value={tradeAdjustedProfit(t)} />
            </div>
            <div>
              <NotInUse>Boxes 73.1 and 73.2 are not in use</NotInUse>
              <Money n="73.3" label="Spread of the transition profit treated as arising in this tax year – read the notes" value={t.transitionProfitSpread} />
              <Money n="73.4" label="Loss brought forward from earlier years set off against this year’s spread of the transition profit (up to the amount in box 73.3)" value={t.transitionLossBfwd} />
              <Money n={74} label="Loss brought forward from earlier years set off against this year’s adjusted profit" value={t.lossBroughtForward} />
              <Money n={75} label="Any other business income not included in boxes 15, 16 or 60" value={t.otherBusinessIncome75} />
              <Money n={76} label="Total taxable profits from this business – see the working sheet in the notes, do not include the amount in box 73.3" value={tradeTaxableProfit(t)} />
              <Money n="76.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={t.figClaim} />
            </div>
          </div>
        </Panel>
        <SubHead>Losses</SubHead>
        <Note>If you’ve made a net loss for the tax year (in box 65, or because of box 68), or if you’ve losses from previous years, read the ‘Self-employment (full) notes’ and fill in boxes 77 to 80, as appropriate.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={77} label="Adjusted loss for 2025–26 – see the working sheet in the notes" value={tradeAdjustedLoss(t)} />
              <Money n="77.1" label="Adjustment to losses as a result of a claim under the foreign income and gains (FIG) regime" value={t.adjustmentLossFig} />
              <Money n={78} label="Loss from this tax year set off against other income for 2025–26" value={t.lossSetOffOtherIncome} />
            </div>
            <div>
              <Money n={79} label="Loss to be carried back to previous years and set off against income (or capital gains)" value={t.lossCarriedBack} />
              <Money n={80} label="Total loss to carry forward after all other set-offs – including unused losses brought forward" value={tradeLossCarriedForward(t)} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SEF 5 — CIS + balance sheet ── */}
      <Page tag="SEF 5" code="SA103F">
        <SubHead>CIS deductions and tax taken off</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={81} label="Total Construction Industry Scheme (CIS) deductions taken from your payments by contractors – CIS subcontractors only" value={t.cisDeductions} /></div>
            <div><Money n={82} label="Other tax taken off trading income" value={t.otherTaxTaken} /></div>
          </div>
        </Panel>
        <SubHead>Balance sheet</SubHead>
        <Note>If your business accounts include a balance sheet showing the assets, liabilities and capital of the business, fill in the relevant boxes below. If you do not have a balance sheet, go to box 100.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <ColHead>Assets</ColHead>
              <Money n={83} label="Equipment, machinery and vehicles" value={t.bsEquipment} />
              <Money n={84} label="Other fixed assets" value={t.bsOtherFixedAssets} />
              <Money n={85} label="Stock and work in progress" value={t.bsStock} />
              <Money n={86} label="Trade debtors" value={t.bsDebtors} />
              <Money n={87} label="Bank or building society balances" value={t.bsBank} />
              <Money n={88} label="Cash in hand" value={t.bsCash} />
              <Money n={89} label="Other current assets and prepayments" value={t.bsOtherCurrentAssets} />
              <Money n={90} label="Total assets (total of boxes 83 to 89)" value={tradeTotalAssets(t)} />
            </div>
            <div>
              <ColHead>Liabilities</ColHead>
              <Money n={91} label="Trade creditors" value={t.bsCreditors} />
              <Money n={92} label="Loans and overdrawn bank account balances" value={t.bsLoans} />
              <Money n={93} label="Other liabilities and accruals" value={t.bsOtherLiabilities} />
              <ColHead>Net business assets</ColHead>
              <Money n={94} label="Net business assets (box 90 minus (boxes 91 to 93))" value={tradeNetBusinessAssets(t)} minus />
              <ColHead>Capital account</ColHead>
              <Money n={95} label="Balance at start of period" value={t.caBalanceStart} minus />
              <Money n={96} label="Net profit or loss (box 47 or box 48)" value={net} minus />
              <Money n={97} label="Capital introduced" value={t.caCapitalIntroduced} />
              <Money n={98} label="Drawings" value={t.caDrawings} />
              <Money n={99} label="Balance at end of period" value={tradeCapitalAccountEnd(t)} minus />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── SEF 6 — NICs + any other information ── */}
      <Page tag="SEF 6" code="SA103F">
        <div className="flex h-full flex-col">
          <SubHead>Class 2 and Class 4 National Insurance contributions (NICs)</SubHead>
          <Note>If your total profits from all self-employment and partnerships for 2025–26 are less than £6,845 you do not have to pay Class 2 National Insurance contributions, but you may want to pay voluntary (box 100) to protect your rights to certain benefits.</Note>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <div className="mb-3"><Label n={100}>If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put ‘X’ in the box</Label><Tick on={!!t.class2Voluntary} /></div>
                <div><Label n={101}>If you’re exempt from paying Class 4 NICs, put ‘X’ in the box</Label><Tick on={!!t.class4Exempt} /></div>
              </div>
              <div><Money n={102} label="Adjustment to profits chargeable to Class 4 NICs" value={t.class4Adjustment} cells={6} /></div>
            </div>
          </Panel>
          <SubHead>Any other information</SubHead>
          <Panel className="flex flex-1 flex-col">
            <Label n={103}>Please give any other information in this space</Label>
            <div className="flex-1" style={{ border: `1px solid ${CELL}`, background: '#fff' }} />
          </Panel>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
