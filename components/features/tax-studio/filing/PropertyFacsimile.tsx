// Facsimile of HMRC's SA105 UK property — 2 pages (UKP1–2), peach theme.
// One SA105 aggregates every UK property on the return. Boxes hold the
// taxpayer's SHARE of each property (whole figures × the ownership fraction —
// exactly what the editor shows on its blue "your share" line and what the
// SA100 total income uses), except the per-person property income allowance
// (box 20.1), which is not scaled.

import type React from 'react';
import { useContext } from 'react';
import type { TaxReturn, PropertySource } from '../types';
import {
  FormThemeContext, PEACH_THEME, TEAL, CELL, CELL_SHADOW, Page, SuppHead, Note, Panel, Money, Tick, BoxNum,
} from './formPrimitives';
import {
  ownerShareFraction, propertyAdjustedProfit, propertyAdjustedLoss, propertyTaxable, propertyTaxableShare, propertyLossCarryForward, propertyFinanceShare,
} from '../calc';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;

// A single blank/filled character box (day/count cells).
const Cell = ({ ch }: { ch?: string }) => (
  <span className="flex h-[18px] w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', boxShadow: CELL_SHADOW }}>{ch || ''}</span>
);

// A row whose label sits left and its control (tick / count) sits at the right —
// the SA105 "details" layout (boxes 1–4, 20.2). The box-number chip hangs on the
// panel's left edge like every other box.
const HdrRow = ({ n, control, children }: { n: React.ReactNode; control: React.ReactNode; children: React.ReactNode }) => (
  <div data-sa-fieldroot className="mb-3 flex items-start text-[10.5px] font-bold leading-tight text-black">
    <span className="-ml-3 mr-1 mt-[1px] shrink-0"><BoxNum n={n} /></span>
    <span className="min-w-0 flex-1">{children}</span>
    <span className="ml-2 shrink-0">{control}</span>
  </div>
);

// The retired-boxes banner (5–19) — full-width peach panel, centred teal text.
function RetiredBanner() {
  const t = useContext(FormThemeContext);
  return (
    <div className="mb-3 px-3 py-2 text-center text-[11px] font-bold" style={{ color: TEAL, background: t.panelBg, border: `1px solid ${t.panelBorder}` }}>
      Boxes 5 to 19 are no longer in use – income and expenses shoud be included in boxes 20 to 45 below - read the notes
    </div>
  );
}

export default function PropertyFacsimile({ ret }: { ret: TaxReturn }) {
  const props = ret.income.property ?? [];
  // Aggregate the taxpayer's filed share of each box across all properties.
  const shSum = (f: (p: PropertySource) => number) => props.reduce((a, p) => a + Math.round(f(p) * ownerShareFraction(p.owners)), 0);
  const rawSum = (f: (p: PropertySource) => number) => props.reduce((a, p) => a + (f(p) || 0), 0);
  const box = {
    b20: shSum(p => p.rents || 0),
    b201: rawSum(p => p.propertyIncomeAllowance || 0),        // per-person — not shared
    b21: shSum(p => p.taxTaken || 0),
    b22: shSum(p => p.premiums || 0),
    b23: shSum(p => p.reversePremiums || 0),
    b24: shSum(p => p.expPremises || 0),
    b25: shSum(p => p.expRepairs || 0),
    b26: shSum(p => p.expLoanInterest || 0),
    b27: shSum(p => p.expProfessional || 0),
    b28: shSum(p => p.expServices || 0),
    b29: shSum(p => p.expOther || 0),
    b30: shSum(p => p.privateUse || 0),
    b31: shSum(p => p.balancingCharges || 0),
    b32: shSum(p => p.aia || 0),
    b33: shSum(p => p.sba || 0),
    b331: shSum(p => p.electricChargepoint || 0),
    b332: shSum(p => p.freeportSba || 0),
    b341: shSum(p => p.zeroEmissionCar || 0),
    b35: shSum(p => p.capitalAllowances || 0),
    b36: shSum(p => p.domesticItems || 0),
    b37: shSum(p => p.rentARoomExempt ?? p.rentARoom ?? 0),
    b38: shSum(propertyAdjustedProfit),
    b39: shSum(p => p.lossBroughtForward || 0),
    b40: props.reduce((a, p) => a + propertyTaxableShare(p), 0),
    b41: shSum(propertyAdjustedLoss),
    b42: shSum(p => p.lossSetOffTotalIncome || 0),
    b43: shSum(propertyLossCarryForward),
    b44: Math.round(props.reduce((a, p) => a + propertyFinanceShare(p), 0)),
    b45: shSum(p => p.unusedFinanceCostsBfwd || 0),
  };
  const count = props.length;
  const anyJoint = props.some(p => !!p.owners);
  const anyTraditional = props.some(p => !!p.traditionalAccounting);
  const cnt = count ? count.toString() : '';

  return (
    <FormThemeContext.Provider value={PEACH_THEME}>
      {/* ── UKP 1 ── */}
      <Page tag="UKP 1" code="SA105">
        <SuppHead title="UK property" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>For help filling in this form go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Head>UK property details</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <HdrRow n={1} control={<div className="flex gap-[3px]"><Cell ch={cnt.length > 1 ? cnt[0] : ''} /><Cell ch={cnt[cnt.length - 1]} /></div>}>Number of properties rented out</HdrRow>
              <HdrRow n={2} control={<Tick />}>If all property income ceased in 2025–26 and you do not expect to receive such income in 2026–27, put ‘X’ in the box and consider if you need to fill in the ‘Capital Gains Tax summary’ page</HdrRow>
            </div>
            <div>
              <HdrRow n={3} control={<Tick on={anyJoint} />}>If you have any income from property let jointly, put ‘X’ in the box</HdrRow>
              <HdrRow n={4} control={<Tick />}>If you’re claiming Rent a Room relief and your rents are £7,500 or less (or £3,750 if let jointly), put ‘X’ in the box</HdrRow>
            </div>
          </div>
        </Panel>
        <RetiredBanner />
        <Head>Property income</Head>
        <Note>Do not include Real Estate Investment Trust or Property Authorised Investment Funds dividends/distributions here.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={20} label="Total rents and other income from property" value={box.b20} />
              <Money n="20.1" label="Property income allowance – read the notes" value={box.b201} cells={4} />
              <HdrRow n="20.2" control={<Tick on={anyTraditional} />}>If you’ve used traditional accounting rather than cash basis to calculate your income and expenses, put ‘X’ in the box</HdrRow>
            </div>
            <div>
              <Money n={21} label="Tax taken off any income in box 20" value={box.b21} />
              <Money n={22} label="Premiums for the grant of a lease – from box E on the working sheet" value={box.b22} />
              <Money n={23} label="Reverse premiums and inducements" value={box.b23} />
            </div>
          </div>
        </Panel>
        <Head>Property expenses</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={24} label="Rent, rates, insurance and ground rents" value={box.b24} />
              <Money n={25} label="Property repairs and maintenance" value={box.b25} />
              <Money n={26} label="Non-residential property finance costs" value={box.b26} />
            </div>
            <div>
              <Money n={27} label="Legal, management and other professional fees" value={box.b27} />
              <Money n={28} label="Costs of services provided, including wages" value={box.b28} />
              <Money n={29} label="Other allowable property expenses" value={box.b29} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── UKP 2 ── */}
      <Page tag="UKP 2" code="SA105">
        <Head>Calculating your taxable profit or loss</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={30} label="Private use adjustment" value={box.b30} />
              <Money n={31} label="Balancing charges" value={box.b31} />
              <Money n={32} label="Annual Investment Allowance" value={box.b32} />
              <Money n={33} label="The Structures and Buildings Allowance" value={box.b33} />
              <Money n="33.1" label="Electric charge-point allowance" value={box.b331} />
              <Money n="33.2" label="Freeport and Investment Zones Structures and Buildings Allowance" value={box.b332} />
              <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>Box 34 is not in use</div>
              <Money n="34.1" label="Zero-emission car allowance" value={box.b341} />
              <Money n={35} label="All other capital allowances" value={box.b35} />
              <Money n={36} label="Costs of replacing domestic items – for residential lettings only" value={box.b36} />
            </div>
            <div>
              <Money n={37} label="Rent a Room exempt amount" value={box.b37} cells={5} />
              <Money n={38} label="Adjusted profit for the year – use the working sheet in the notes" value={box.b38} />
              <Money n={39} label="Loss brought forward used against this year’s profits" value={box.b39} />
              <Money n={40} label="Taxable profit for the year (box 38 minus box 39)" value={box.b40} />
              <Money n={41} label="Adjusted loss for the year – use the working sheet in the notes" value={box.b41} />
              <Money n={42} label="Loss set off against 2025–26 total income – this will be unusual" value={box.b42} />
              <Money n={43} label="Loss to carry forward to following year, including unused losses brought forward" value={box.b43} />
              <Money n={44} label="Residential property finance costs" value={box.b44} />
              <Money n={45} label="Unused residential property finance costs brought forward" value={box.b45} />
            </div>
          </div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
