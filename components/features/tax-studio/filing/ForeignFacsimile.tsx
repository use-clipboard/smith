'use client';

// Facsimile of HMRC's SA106 Foreign — 8 pages (F1–F8), cream theme. The foreign
// pages use full-width alternating colour bands (cream / mint) that bleed to one
// page edge (facing-page spreads: even F-pages bleed right, odd bleed left), and
// split each income table's A–F columns across two facing pages. Whole-pound
// money boxes. Bound to the Sa106 model (see types.ts).

import type React from 'react';
import { createContext, useContext } from 'react';
import type { TaxReturn, Sa106, ForeignRow, ForeignProperty } from '../types';
import { FormThemeContext, CREAM_THEME, TEAL, CELL, MONEY_TINT, CELL_SHADOW, Page, SuppHead, Note, Panel, Cells, Tick, Label } from './formPrimitives';

const CREAM = '#faf6ea';
const MINT = '#e9f3f2';
const BORDER = '#d8d2be';
const ABC = 'grid-cols-[120px_1fr_1fr]';
const DEF = 'grid-cols-[1fr_84px_1fr]';
const ACEF = 'grid-cols-[84px_1fr_66px_1fr]';

// Horizontal padding for band content, set by the Table's bleed direction so the
// colour fills to the page edge while the content stays within the 13mm margin.
const BleedPad = createContext('px-[13mm]');

function Table({ bleed = 'both', children }: { bleed?: 'left' | 'right' | 'none' | 'both'; children: React.ReactNode }) {
  const cfg = {
    right: { m: '-mr-[13mm]', pad: 'pl-3 pr-[13mm]' },
    left: { m: '-ml-[13mm]', pad: 'pl-[13mm] pr-3' },
    none: { m: '', pad: 'px-3' },
    both: { m: '-mx-[13mm]', pad: 'px-[13mm]' },
  }[bleed];
  return (
    <div className={`mb-3 overflow-hidden ${cfg.m}`} style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
      <BleedPad.Provider value={cfg.pad}>{children}</BleedPad.Provider>
    </div>
  );
}
function Band({ bg, children }: { bg: string; children: React.ReactNode }) {
  const pad = useContext(BleedPad);
  return <div className={`${pad} py-3`} style={{ background: bg }}>{children}</div>;
}
// Column-header row (sits inside the first band, so it's on the coloured panel).
function ColHead({ cols, children }: { cols: string; children: React.ReactNode }) {
  return <div className={`grid ${cols} gap-x-6 pb-2 text-[10.5px] font-bold text-black`}>{children}</div>;
}
function SecHead({ children, cont, note }: { children: React.ReactNode; cont?: boolean; note?: React.ReactNode }) {
  return <p className="mb-2 text-[11.5px] font-bold text-black">{children}{cont && <span className="font-normal"> continued</span>}{note && <span className="font-normal"> {note}</span>}</p>;
}
function Ctry({ value }: { value?: string }) {
  const chars = (value || '').toUpperCase().replace(/\s/g, '').split('');
  return (
    <div className="flex items-center gap-[3px]">
      {Array.from({ length: 3 }).map((_, k) => (
        <span key={k} className="flex h-[18px] w-[16px] items-center justify-center bg-white text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}` }}>{chars[k] || ''}</span>
      ))}
    </div>
  );
}
// Bare money box. Whole pounds by default (£ … single 0); `pence` adds · 0 0.
function Amt({ value, minus, pence, cells = 7 }: { value?: number | null; minus?: boolean; pence?: boolean; cells?: number }) {
  const neg = (value || 0) < 0;
  const digits = value ? Math.round(Math.abs(value)).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < digits.length && k < cells; k++) arr[cells - 1 - k] = digits[digits.length - 1 - k];
  const base: React.CSSProperties = { border: `1px solid ${CELL}`, boxShadow: CELL_SHADOW };
  return (
    <div className="flex items-stretch gap-[3px]" style={{ height: 20 }}>
      <span className="flex w-[15px] items-center justify-center text-[12px] text-slate-500" style={{ ...base, background: MONEY_TINT }}>£</span>
      {minus && <span className="flex w-[14px] items-center justify-center" style={{ ...base, background: MONEY_TINT }}>{neg ? <span className="text-[12px] font-bold text-black">−</span> : <span className="block" style={{ width: 9, height: 3, background: '#fff' }} />}</span>}
      {arr.map((d, i) => <span key={i} className="flex w-[15px] items-center justify-center bg-white text-[11.5px] font-medium text-black" style={base}>{d}</span>)}
      {pence ? (
        <>
          <span className="flex w-[6px] items-end justify-center pb-[2px] text-[13px] font-bold text-black">·</span>
          <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={{ ...base, background: MONEY_TINT }}>0</span>
          <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={{ ...base, background: MONEY_TINT }}>0</span>
        </>
      ) : (
        <span className="ml-[2px] flex w-[15px] items-center justify-center text-[11px] text-slate-400" style={{ ...base, background: MONEY_TINT }}>0</span>
      )}
    </div>
  );
}
// Labelled money box (Label above the money row), whole pounds by default.
function FMoney({ n, label, value, minus, pence, cells = 8 }: { n?: React.ReactNode; label?: React.ReactNode; value?: number | null; minus?: boolean; pence?: boolean; cells?: number }) {
  return (
    <div className="mb-4">
      {(n != null || label != null) && <Label n={n}>{label}</Label>}
      <Amt value={value} minus={minus} pence={pence} cells={cells} />
    </div>
  );
}
function Tag({ n }: { n: React.ReactNode }) {
  return <span className="flex h-[15px] min-w-[19px] shrink-0 items-center justify-center whitespace-nowrap px-[2px] text-[9.5px] font-bold text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{n}</span>;
}
// Total row: [tag] label, then the money box under it.
function TotalRow({ n, label, value, minus }: { n?: React.ReactNode; label?: React.ReactNode; value?: number | null; minus?: boolean }) {
  return (
    <div className="mb-2">
      {(n != null || label) && <div className="mb-1 flex items-start gap-1 text-[10.5px] font-bold text-black">{n != null && <Tag n={n} />}{label && <span>{label}</span>}</div>}
      <Amt value={value} minus={minus} />
    </div>
  );
}
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
const H4 = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 text-[15px] font-normal text-black">{children}</h4>;

export default function ForeignFacsimile({ ret }: { ret: TaxReturn }) {
  const f: Sa106 = ret.income.foreign ?? {};
  const prop = f.properties?.[0];
  const rows = (arr?: ForeignRow[], n = 3) => Array.from({ length: n }, (_, i) => arr?.[i]);

  return (
    <FormThemeContext.Provider value={CREAM_THEME}>
      {/* ── F 1 ── */}
      <Page tag="F 1" code="SA106">
        <SuppHead title="Foreign" name={ret.clientName} utr={ret.utr ?? undefined} />
        <div className="mb-2 border-t-2" style={{ borderColor: TEAL }} />
        <h3 className="mb-1.5 text-[15px] font-bold" style={{ color: TEAL }}>Filling in the ‘Foreign’ pages</h3>
        <Note>The ‘Foreign notes’ explain how to give details of your foreign income and gains on these pages. You can use these pages to make a claim under the foreign income and gains (FIG) regime. To get notes and helpsheets that will help you fill in this form, go to www.gov.uk/taxreturnforms</Note>
        <div className="mb-3 grid grid-cols-2 gap-x-8 text-[10px] leading-snug text-black">
          <div className="space-y-1.5">
            <p className="pl-3 -indent-2">• Page F 1 covers unremittable income and the claim to Foreign Tax Credit Relief.</p>
            <p className="pl-3 -indent-2">• Pages F 2 and F 3 are for foreign income such as interest, dividends, pensions and social security benefits and income received by a person abroad. If you fill in any of columns A, B or C on page F 2, make sure you also consider columns D, E or F on page F 3.</p>
            <p className="pl-3 -indent-2">• Pages F 4 and F 5 are for foreign property income.</p>
          </div>
          <div className="space-y-1.5">
            <p className="pl-3 -indent-2">• Pages F 6 and F 7 are for claiming Foreign Tax Credit Relief on income and capital gains included elsewhere on your tax return, and for entering other overseas income, gains from offshore funds and gains on foreign life insurance policies.</p>
            <p className="pl-3 -indent-2">• Page F 8 is a continuation for other overseas income and gains, and for claiming Foreign Tax Credit Relief on employment, self-employment and other income included elsewhere on your tax return.</p>
          </div>
        </div>
        <H4>Unremittable income</H4>
        <Panel>
          <div className="max-w-[62%]"><Label n={1}>If you were unable to transfer any of your overseas income to the UK, put ‘X’ in the box – and give details in the ‘Any other information’ box on your tax return or on a separate sheet</Label><Tick on={!!f.unremittable} /></div>
        </Panel>
        <H4>Foreign Tax Credit Relief</H4>
        <Note>If foreign tax was taken off your foreign income you may be able to claim Foreign Tax Credit Relief. Please read the ‘Foreign notes’ to see if you can claim the relief and how you should make the claim.</Note>
        <Note>If you’re calculating your tax bill you may also want to calculate your Foreign Tax Credit Relief. If you do, use the Working Sheet provided with Helpsheet 263, ‘Relief for Foreign Tax paid’ and fill in box 2.</Note>
        <Panel>
          <div className="max-w-[55%]"><FMoney n={2} label="If you’re calculating your tax, enter the total Foreign Tax Credit Relief on your income" value={f.ftcrOnIncome} /></div>
        </Panel>
      </Page>

      {/* ── F 2 — overseas income A / B / C (bleed right) ── */}
      <Page tag="F 2" code="SA106">
        <H4>Income from overseas sources</H4>
        <Note>If you have income from overseas savings, foreign dividends, remitted foreign income, overseas pensions or benefits, or income, dividends received by an overseas trust, company or other person abroad, fill in the columns on these 2 pages. Use a separate row for each source of income or country and check the relevant Double Taxation Treaty for any limits to the relief you can claim. Please refer to the ‘Foreign notes’ to find the country or territory codes that you require. If there are not enough rows, attach a separate sheet giving the same information as below. All entries should be in UK pounds.</Note>
        <Table bleed="right">
          <Band bg={CREAM}>
            <ColHead cols={ABC}><span>A Country or territory code</span><span>B Amount of income arising or received before any tax taken off</span><span>C Foreign tax taken off or paid</span></ColHead>
            <SecHead>Interest and other income from overseas savings</SecHead>
            {rows(f.interest).map((r, i) => <div key={i} className={`mb-1.5 grid ${ABC} items-center gap-x-6`}><Ctry value={r?.country} /><Amt value={r?.incomeArising} /><Amt value={r?.foreignTax} /></div>)}
          </Band>
          <Band bg={MINT}>
            <SecHead>Dividends from foreign companies</SecHead>
            {rows(f.dividends).map((r, i) => <div key={i} className={`mb-1.5 grid ${ABC} items-center gap-x-6`}><Ctry value={r?.country} /><Amt value={r?.incomeArising} /><Amt value={r?.foreignTax} /></div>)}
          </Band>
          <Band bg={CREAM}>
            <SecHead>Remitted foreign income excluding dividends</SecHead>
            <div className={`mb-2 grid ${ABC} items-center gap-x-6`}><Ctry value={f.remittedExcl?.[0]?.country} /><Amt value={f.remittedExcl?.[0]?.incomeArising} /><Amt value={f.remittedExcl?.[0]?.foreignTax} /></div>
            <SecHead>Remitted foreign dividend income</SecHead>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.remittedDividends?.[0]?.country} /><Amt value={f.remittedDividends?.[0]?.incomeArising} /><Amt value={f.remittedDividends?.[0]?.foreignTax} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead>Overseas pensions, social security benefits and royalties</SecHead>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.pensions?.[0]?.country} /><Amt value={f.pensions?.[0]?.incomeArising} /><Amt value={f.pensions?.[0]?.foreignTax} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead note="– read Helpsheet 262.">Dividend income received by a person abroad</SecHead>
            <p className="mb-1.5 text-[9.5px] text-black">If you’re omitting income from this section because you’re claiming an exemption, see box 46.</p>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.otherDividend?.[0]?.country} /><Amt value={f.otherDividend?.[0]?.incomeArising} /><Amt value={f.otherDividend?.[0]?.foreignTax} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead>All other income received by a person abroad and any remitted ‘ring fenced’ foreign income</SecHead>
            <p className="mb-1.5 text-[9.5px] text-black">– read Helpsheet 262. If you’re omitting from this section because you’re claiming an exemption, see box 46.</p>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.otherAll?.[0]?.country} /><Amt value={f.otherAll?.[0]?.incomeArising} /><Amt value={f.otherAll?.[0]?.foreignTax} /></div>
          </Band>
        </Table>
      </Page>

      {/* ── F 3 — continuation D / E / F + totals (bleed left) ── */}
      <Page tag="F 3" code="SA106">
        <Note>received by an overseas trust, company or other person abroad, fill in the columns on these 2 pages. Use a separate row for each source of income or country. Refer to the ‘Foreign notes’ to find the country or territory codes that you require. If there are not enough rows, attach a separate sheet.</Note>
        <Table bleed="left">
          <Band bg={CREAM}>
            <ColHead cols={DEF}><span>D Special Withholding Tax and any UK tax taken off</span><span>E To claim Foreign Tax Credit Relief – put ‘X’ in the box</span><span>F Taxable amount – if you’re claiming Foreign Tax Credit Relief, copy column B here. If not, enter column B minus column C</span></ColHead>
            <SecHead cont>Interest and other income from overseas savings</SecHead>
            {rows(f.interest).map((r, i) => <div key={i} className={`mb-1.5 grid ${DEF} items-center gap-x-6`}><Amt value={r?.specialWithholding} /><div className="flex justify-center"><Tick on={!!r?.creditRelief} /></div><Amt value={r?.incomeArising} /></div>)}
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={3} label="Total of column above" value={sumCol(f.interest, 'specialWithholding')} /><TotalRow n={4} label="Total of column above" value={sumCol(f.interest, 'incomeArising')} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="4.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead cont>Dividends from foreign companies</SecHead>
            {rows(f.dividends).map((r, i) => <div key={i} className={`mb-1.5 grid ${DEF} items-center gap-x-6`}><Amt value={r?.specialWithholding} /><div className="flex justify-center"><Tick on={!!r?.creditRelief} /></div><Amt value={r?.incomeArising} /></div>)}
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={5} label="Total of column above" value={sumCol(f.dividends, 'specialWithholding')} /><TotalRow n={6} label="Total of column above" value={sumCol(f.dividends, 'incomeArising')} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="6.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead cont>Remitted foreign income excluding dividends</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n="7.1" value={f.remittedExcl?.[0]?.specialWithholding} /><TotalRow n="7.2" value={f.remittedExcl?.[0]?.incomeArising} /></div>
            <SecHead cont>Remitted foreign dividend</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n="7.3" value={f.remittedDividends?.[0]?.specialWithholding} /><TotalRow n="7.4" value={f.remittedDividends?.[0]?.incomeArising} /></div>
            <div className="mt-1 grid grid-cols-2 gap-x-6"><div className="text-[10.5px] font-bold text-black">Amount in box 7.4 subject to dividend tax credit</div><TotalRow n="7.5" value={f.remittedDivSubjectToCredit} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead cont>Overseas pensions, social security benefits and royalties</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={8} value={f.pensions?.[0]?.specialWithholding} /><TotalRow n={9} value={f.pensions?.[0]?.incomeArising} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="9.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead cont>Dividend income received by a person abroad</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={10} value={f.otherDividend?.[0]?.specialWithholding} /><TotalRow n={11} value={f.otherDividend?.[0]?.incomeArising} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="11.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead cont>All other income received by a person abroad and any remitted ‘ring fenced’ foreign income</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={12} value={f.otherAll?.[0]?.specialWithholding} /><TotalRow n={13} value={f.otherAll?.[0]?.incomeArising} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div className="text-[10px] leading-snug text-black">Amount of residential property income or restricted finance costs associated with income in box 13 for calculating relief for residential finance costs – use the Working Sheet in the notes</div><TotalRow n="13.0" label="Total claimed under the FIG regime" value={undefined} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="13.1" value={f.otherResiFinanceCost} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div className="text-[10.5px] font-bold text-black">Unused residential property finance costs brought forward</div><TotalRow n="13.2" value={f.otherResiFinanceBfwd} /></div>
          </Band>
        </Table>
      </Page>

      {/* ── F 4 — land & property; summary A/B/C (bleed right) ── */}
      <Page tag="F 4" code="SA106">
        <H4>Income from land and property abroad</H4>
        <Note>If you only have one overseas let property, or you have more than one but they’re all in the same country, you can just complete these pages. If you have overseas let properties in more than one country and if any foreign tax has been taken off one or more of those properties, take a copy of these pages and fill in boxes 14 to 24.2 for each property. Fill in a single summary section for all the properties.</Note>
        <h4 className="mb-1 text-[14px] font-normal text-black">Income and expenses</h4>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <FMoney n={14} label="Total rents and other receipts (excluding taxable premiums for the grant of a lease)" value={prop?.totalRents} />
              <FMoney n="14.1" label="Property income allowance – read the notes" value={prop?.propertyIncomeAllowance} cells={5} />
              <div className="mb-3"><Label n="14.2">If you’ve used traditional accounting rather than cash basis to calculate your income and expenses, put ‘X’ in the box</Label><Tick on={!!prop?.traditionalAccounting} /></div>
              <Cells n={15} label="Number of overseas let properties" groups={[5]} value={prop?.letProperties ? String(prop.letProperties) : ''} />
            </div>
            <div>
              <FMoney n={16} label="Premiums paid for the grant of a lease" value={prop?.premiumsPaid} />
              <FMoney n={17} label="Allowable property expenses (rent, repairs, legal fees, cost of services provided) – enter the total amount" value={prop?.expenses} />
              <FMoney n={18} label="Net profit or loss (box 14 + box 16 minus box 17) – if this is a negative figure (a loss) put a minus sign in the box" value={foreignPropNet(prop)} minus pence />
              <FMoney n={19} label="Private use adjustment" value={prop?.privateUse} />
              <FMoney n={20} label="Balancing charges" value={prop?.balancingCharges} />
            </div>
          </div>
        </Panel>
        <H4>Summary of income from land and property abroad</H4>
        <Note>If you’ve filled in any of boxes 14 to 24.2, enter the details below. Please note that boxes 21 to 24.2 are on page F 5.</Note>
        <Table bleed="right">
          <Band bg={CREAM}>
            <ColHead cols={ABC}><span>A Country or territory code</span><span>B Adjusted profit or loss (from box 24)</span><span>C Foreign tax taken off or paid</span></ColHead>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className={`mb-1.5 grid ${ABC} items-center gap-x-6`}><Ctry value={f.properties?.[i]?.country} /><Amt value={i === 0 ? foreignPropAdjusted(prop) : undefined} minus /><Amt value={undefined} /></div>)}
            <div className={`grid ${ABC} gap-x-6`}><div /><TotalRow n={25} label="Total of column above" value={foreignPropAdjusted(prop)} minus /><div /></div>
            <div className={`grid ${ABC} gap-x-6`}><div /><TotalRow n={26} label="Total loss brought forward from earlier years" value={f.propLossBroughtForward} /><div /></div>
            <div className={`grid ${ABC} gap-x-6`}><div /><TotalRow n={27} label="Total taxable profits (if box 25 minus box 26 is a positive amount)" value={undefined} /><TotalRow n={28} label="Total foreign tax" value={undefined} /></div>
            <SecHead>Losses</SecHead>
            <div className={`grid ${ABC} gap-x-6`}><div /><TotalRow n={31} label="Loss set off against total income" value={f.propLossSetOff} /><div /></div>
            <div className={`grid ${ABC} gap-x-6`}><div /><TotalRow n={32} label="Total loss to carry forward to the following year" value={undefined} /><div /></div>
          </Band>
        </Table>
      </Page>

      {/* ── F 5 — calculating P&L; D/E/F (bleed left) ── */}
      <Page tag="F 5" code="SA106">
        <Note>Fill in a single summary section for all the properties. If you have overseas let properties in more than one country and any foreign tax has been taken off, take a copy of these pages and fill in boxes 14 to 24.2 for each property. Fill in a single summary section for all the properties.</Note>
        <H4>Calculating profits and losses for tax purposes</H4>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <FMoney n={21} label="Capital allowances for equipment and vehicles (but not for furnished residential lettings)" value={prop?.capitalAllowances} />
              <FMoney n="21.1" label="Zero-emission car allowance" value={prop?.zeroEmissionCar} />
              <NotInUse>Box 22 is not in use</NotInUse>
              <FMoney n="22.1" label="The Structures and Buildings Allowance" value={prop?.sba} />
              <FMoney n="22.2" label="Electric charge-point allowance" value={prop?.electricChargepoint} />
            </div>
            <div>
              <FMoney n={23} label="Costs of replacing domestic items (for residential lettings only)" value={prop?.domesticItems} />
              <FMoney n={24} label="Adjusted profit or loss for the year (boxes 18 to 20) minus (boxes 21 to 23) – if you’re claiming property income allowance (box 14 + box 16 + box 20 minus box 14.1)" value={foreignPropAdjusted(prop)} minus pence />
              <FMoney n="24.1" label="Residential property finance costs" value={prop?.residentialFinanceCosts} />
              <FMoney n="24.2" label="Unused residential property finance costs brought forward" value={prop?.unusedFinanceCostsBfwd} />
            </div>
          </div>
        </Panel>
        <Table bleed="left">
          <Band bg={CREAM}>
            <ColHead cols={DEF}><span>D UK tax taken off</span><span>E To claim Foreign Tax Credit Relief put ‘X’ in the box</span><span>F Taxable amount</span></ColHead>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className={`mb-1.5 grid ${DEF} items-center gap-x-6`}><Amt value={undefined} /><div className="flex justify-center"><Tick on={false} /></div><Amt value={i === 0 ? foreignPropAdjusted(prop) : undefined} /></div>)}
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={29} label="Total of column above" value={undefined} /><TotalRow n={30} label="Total taxable amount" value={foreignPropAdjusted(prop)} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="30.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
        </Table>
      </Page>

      {/* ── F 6 — CG FTCR; other overseas income A/B/C (bleed right) ── */}
      <Page tag="F 6" code="SA106">
        <H4>Capital gains – Foreign Tax Credit Relief and Special Withholding Tax</H4>
        <Note>If you’ve filled in the ‘Capital gains summary’ pages and you’ve paid foreign tax on those gains, and you want to claim Foreign Tax Credit Relief for the foreign tax, fill in box 33 and boxes 37 to 40. Do not include these amounts in box 2 on page F 1.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <FMoney n={33} label="Amount of chargeable gain under UK rules" value={f.cgUkGain} />
              <Cells n={34} label="Number of days over which UK gain accrued" groups={[5]} value={f.cgUkDays ? String(f.cgUkDays) : ''} />
              <FMoney n={35} label="Amount of chargeable gain under foreign tax rules" value={f.cgForeignGain} />
              <Cells n={36} label="Number of days over which foreign gain accrued" groups={[5]} value={f.cgForeignDays ? String(f.cgForeignDays) : ''} />
            </div>
            <div>
              <FMoney n={37} label="Foreign tax paid" value={f.cgForeignTax} />
              <div className="mb-3"><Label n={38}>To claim Foreign Tax Credit Relief put ‘X’ in the box</Label><Tick on={!!f.cgClaimFtcr} /></div>
              <FMoney n={39} label="Total Foreign Tax Credit Relief on gains" value={f.cgFtcr} />
              <FMoney n={40} label="Special Withholding Tax" value={f.cgSwt} />
            </div>
          </div>
        </Panel>
        <H4>Other overseas income and gains <span className="text-[11px]">continued</span></H4>
        <Table bleed="right">
          <Band bg={CREAM}>
            <ColHead cols={ABC}><span>A Country or territory code</span><span>B Amount of income arising or received before any tax taken off</span><span>C Foreign tax taken off or paid</span></ColHead>
            <SecHead note={<>– include non-UK property income but consider box 49 and 49.1</>}>Non-savings income arising in non-resident settlor interested trusts</SecHead>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry /><Amt value={f.nrtResiProperty} /><Amt value={undefined} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead>Savings income arising in non-resident settlor interested trusts</SecHead>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.nrtSavings?.[0]?.country} /><Amt value={f.nrtSavings?.[0]?.incomeArising} /><Amt value={f.nrtSavings?.[0]?.foreignTax} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead>Dividend income arising in non-resident settlor interested trusts</SecHead>
            <div className={`grid ${ABC} items-center gap-x-6`}><Ctry value={f.nrtDividends?.[0]?.country} /><Amt value={f.nrtDividends?.[0]?.incomeArising} /><Amt value={f.nrtDividends?.[0]?.foreignTax} /></div>
          </Band>
          {/* Continue the alternating band pattern to the foot of the page. */}
          <Band bg={MINT}><div className="h-[54px]" /></Band>
          <Band bg={CREAM}><div className="h-[54px]" /></Band>
          <Band bg={MINT}><div className="h-[54px]" /></Band>
        </Table>
      </Page>

      {/* ── F 7 — life insurance; other overseas D/E/F (bleed left) ── */}
      <Page tag="F 7" code="SA106">
        <H4>Other overseas income and gains</H4>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <NotInUse>Boxes 41 and 42 are not in use</NotInUse>
              <FMoney n={43} label="Gains from foreign life insurance policies, capital redemption policies and life annuity contracts (excluding the amounts entered in box 13) – enter the amount of the gain" value={f.lifeGains} />
              <Cells n={44} label="Number of years" groups={[2]} value={f.lifeYears ? String(f.lifeYears) : ''} />
            </div>
            <div>
              <FMoney n={45} label="Tax treated as paid" value={f.lifeTaxPaid} />
              <FMoney n={46} label="If you’ve omitted income from boxes 11, 13 or 58 to 61 because you’re claiming an exemption in relation to a transfer of assets, enter the total amount omitted (and give full details in the ‘Any other information’ box on your tax return)" value={f.lifeOmitted} />
            </div>
          </div>
        </Panel>
        <Table bleed="left">
          <Band bg={CREAM}>
            <ColHead cols={DEF}><span>D Special Withholding Tax and any UK tax taken off</span><span>E To claim Foreign Tax Credit Relief – put ‘X’ in the box</span><span>F Taxable amount</span></ColHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={47} value={f.nrtResiProperty} /><TotalRow n={48} value={undefined} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div className="text-[10px] leading-snug text-black">Amount of overseas residential property income or restricted finance costs for non-resident trust for residential finance costs</div><TotalRow n="48.1" label="Total claimed under the FIG regime" value={undefined} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div className="text-[10px] leading-snug text-black">Unused overseas residential property finance costs brought forward in relation to box 48</div><TotalRow n={49} value={f.nrtResiProperty} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="49.1" value={f.nrtResiFinanceBfwd} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead cont>Savings income arising in non-resident settlor interested trusts</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={50} value={f.nrtSavings?.[0]?.specialWithholding} /><TotalRow n={51} value={f.nrtSavings?.[0]?.incomeArising} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="51.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead cont>Dividend income arising in non-resident settlor interested trusts</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={52} value={f.nrtDividends?.[0]?.specialWithholding} /><TotalRow n={53} value={f.nrtDividends?.[0]?.incomeArising} /></div>
            <div className="grid grid-cols-2 gap-x-6"><div /><TotalRow n="53.1" label="Total claimed under the FIG regime" value={undefined} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead>Discretionary income from non-settlor interested non-resident trusts</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={54} value={f.nrtDiscretionary} /><TotalRow n="54.1" label="Total claimed under the FIG regime" value={f.nrtDiscretionaryFig} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead>Capital sums paid to settlor by trustees of non-resident trusts</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={55} value={f.nrtCapitalSums} /><TotalRow n="55.1" label="Total claimed under the FIG regime" value={f.nrtCapitalSumsFig} /></div>
          </Band>
          <Band bg={MINT}>
            <SecHead note="– excluding amounts in box 13">Gains on disposal of holdings in offshore fund</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={56} value={f.offshoreFundGains} /><TotalRow n="56.1" label="Total claimed under the FIG regime" value={f.offshoreFundGainsFig} /></div>
          </Band>
          <Band bg={CREAM}>
            <SecHead note="– excluding the amounts in box 13">Non-trade income</SecHead>
            <div className="grid grid-cols-2 gap-x-6"><TotalRow n={57} value={f.nonTradeIncome} /><TotalRow n="57.1" label="Total claimed under the FIG regime" value={f.nonTradeIncomeFig} /></div>
          </Band>
        </Table>
      </Page>

      {/* ── F 8 — ToAA/settlements; foreign tax paid table (no bleed) ── */}
      <Page tag="F 8" code="SA106">
        <H4>Other overseas income and gains <span className="text-[11px]">continued</span></H4>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <FMoney n={58} label="Benefits received by non-transferors from a person abroad in the year taxable under the Transfer of Assets Abroad (ToAA) legislation – if you’re omitting income from this section because you’re claiming an exemption, see box 46" value={f.toaaBenefits} />
              <FMoney n="58.1" label="Amount claimed under the FIG regime" value={f.toaaBenefitsFig} />
              <FMoney n={59} label="Benefits received by transferor in the year from a person abroad matched to Transitionally Protected Income (TPI) or Protected Foreign Source Income (PFSI) taxable under ToAA – if you’re omitting income from this section because you’re claiming an exemption, see box 46" value={f.toaaTpiPfsi} />
              <FMoney n="59.1" label="Amount claimed under the FIG regime" value={f.toaaTpiPfsiFig} />
              <FMoney n={60} label="Benefits chargeable on you under the Close Family Member rules taxable under ToAA – if you’re omitting income from this section because you’re claiming an exemption, see box 46" value={f.toaaCloseFamily} />
              <FMoney n="60.1" label="Amount claimed under the FIG regime" value={f.toaaCloseFamilyFig} />
            </div>
            <div>
              <FMoney n={61} label="Benefits chargeable on you under the Onward Gifts rules taxable under ToAA – if you’re omitting income from this section because you’re claiming an exemption, see box 46" value={f.toaaOnwardGifts} />
              <FMoney n="61.1" label="Amount claimed under the FIG regime" value={f.toaaOnwardGiftsFig} />
              <FMoney n={62} label="Benefits received by settlor in the year from a settlement matched to Transitional Trust Income (TTI) or Protected Foreign Source Income (PFSI) taxable under settlements" value={f.settleTtiPfsi} />
              <FMoney n="62.1" label="Amount claimed under the FIG regime" value={f.settleTtiPfsiFig} />
              <FMoney n={63} label="Benefits received by close family member of the settlor in the year from a settlement matched to Transitional Trust Income (TTI) or Protected Foreign Source Income (PFSI) taxable under settlements" value={f.settleCloseFamily} />
              <FMoney n="63.1" label="Amount claimed under the FIG regime" value={f.settleCloseFamilyFig} />
              <FMoney n={64} label="Benefits chargeable on you under the Onward Gifts rules taxable under settlements" value={f.settleOnwardGifts} />
              <FMoney n="64.1" label="Amount claimed under the FIG regime" value={f.settleOnwardGiftsFig} />
            </div>
          </div>
        </Panel>
        <H4>Foreign tax paid on employment, self-employment and other income</H4>
        <Note>If you’re claiming Foreign Tax Credit Relief on income included elsewhere in your tax return, fill in the columns below and say in the ‘Any other information’ box (on page TR 7) where on your tax return this income is included. The country or territory codes are shown in the ‘Foreign notes’. Make sure that the foreign tax being claimed is the ‘minimum’ due under the laws of the foreign country after all deductions, exemptions, reliefs and allowances have been claimed.</Note>
        <Table bleed="none">
          <Band bg={CREAM}>
            <ColHead cols={ACEF}><span>A Country or territory code</span><span>C Foreign tax paid</span><span>E To claim Foreign Tax Credit Relief put ‘X’ in the box</span><span>F Taxable amount</span></ColHead>
            {rows(f.foreignTaxRows, 4).map((r, i) => <div key={i} className={`mb-1.5 grid ${ACEF} items-center gap-x-4`}><Ctry value={r?.country} /><Amt value={r?.foreignTax} /><div className="flex justify-center"><Tick on={!!r?.creditRelief} /></div><Amt value={r?.incomeArising} /></div>)}
          </Band>
        </Table>
      </Page>
    </FormThemeContext.Provider>
  );
}

// ── local calc helpers ───────────────────────────────────────────────────────
function sumCol(rows: ForeignRow[] | undefined, key: 'specialWithholding' | 'incomeArising' | 'foreignTax'): number {
  return (rows ?? []).reduce((t, r) => t + (r[key] || 0), 0);
}
function foreignPropNet(p?: ForeignProperty): number {
  if (!p) return 0;
  return (p.totalRents || 0) + (p.premiumsPaid || 0) - (p.expenses || 0);
}
function foreignPropAdjusted(p?: ForeignProperty): number {
  if (!p) return 0;
  const net = (p.totalRents || 0) + (p.premiumsPaid || 0) - (p.expenses || 0);
  return net + (p.privateUse || 0) + (p.balancingCharges || 0) - (p.capitalAllowances || 0) - (p.zeroEmissionCar || 0) - (p.sba || 0) - (p.electricChargepoint || 0) - (p.domesticItems || 0);
}
