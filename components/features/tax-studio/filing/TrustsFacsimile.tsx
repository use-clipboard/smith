// Facsimile of HMRC's SA107 Trusts etc — 2 pages (T1–2), peach theme with teal
// sub-headers, bound to the Sa107 model (income.trustsSa107 / income.sa107).

import type React from 'react';
import type { TaxReturn, Sa107 } from '../types';
import { FormThemeContext, PEACH_THEME, TEAL, CELL, Page, SuppHead, Note, Panel, Money, Tick, Label, InfoDot } from './formPrimitives';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;
const TealSub = ({ children }: { children: React.ReactNode }) => <p className="mb-2 text-[14px] font-bold leading-tight" style={{ color: TEAL }}>{children}</p>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;
// A money label with a small non-bold explanatory line beneath it.
const Sub = ({ children }: { children: React.ReactNode }) => <span className="block text-[9.5px] font-normal leading-snug">{children}</span>;

export default function TrustsFacsimile({ ret }: { ret: TaxReturn }) {
  const t: Sa107 = ret.income.sa107 ?? {};
  const estates = t.foreignEstates ?? [];
  const box22 = estates.reduce((s, e) => s + (e.income || 0), 0);
  const box23 = estates.reduce((s, e) => s + (e.ukTaxWithheld || 0), 0);
  const box24 = estates.reduce((s, e) => s + (e.foreignTax || 0), 0);
  return (
    <FormThemeContext.Provider value={PEACH_THEME}>
      {/* ── T 1 ── */}
      <Page tag="T 1" code="SA107">
        <SuppHead title="Trusts etc" name={ret.clientName} utr={ret.utr ?? undefined}
          note={<Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>} />
        <Head>Income from trusts and settlements</Head>
        <Panel>
          <TealSub>Discretionary income payment from a UK resident trust</TealSub>
          <div className="grid grid-cols-2 gap-x-10">
            <Money n={1} label="Net amount – after tax taken off" value={t.discretionaryNet} />
            <Money n={2} label="Total payments from settlor-interested trusts" value={t.settlorInterestedPayments} />
          </div>
        </Panel>
        <Panel>
          <TealSub>Non-discretionary income entitlement from a trust</TealSub>
          <Note>If you’ve received income from residential property, consider completing box 25.</Note>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={3} label="Net amount of non-savings income – after tax taken off" value={t.nonDiscNonSavings} />
              <Money n={4} label="Net amount of savings income – after tax taken off" value={t.nonDiscSavings} />
            </div>
            <div>
              <Money n={5} label="Net amount of dividend income – after tax taken off" value={t.nonDiscDividend} />
              <div className="mb-3"><Label n={6}>If you’ve included in your tax return income from trusts or settlements whose trustees are not resident in the UK for tax purposes, put ‘X’ in the box</Label><Tick on={!!t.trusteesNonResident} /></div>
            </div>
          </div>
        </Panel>
        <Head>Income chargeable on settlors</Head>
        <Note>If you’ve received income from residential property, consider completing box 25.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={7} label="Net amount of non-savings income taxed at basic rate – after tax taken off" value={t.settlorNonSavingsBasic} />
              <Money n={8} label="Net amount of savings income taxed at basic rate – after tax taken off" value={t.settlorSavingsBasic} />
              <Money n={9} label="Net amount of dividend income taxed at dividend rate – after tax taken off" value={t.settlorDividend} />
              <Money n={10} label="Net amount of non-savings income taxed at trust rate – after tax taken off" value={t.settlorNonSavingsTrust} />
            </div>
            <div>
              <Money n={11} label="Net amount of savings income taxed at trust rate – after tax taken off" value={t.settlorSavingsTrust} />
              <Money n={12} label="Net amount of dividend income taxed at dividend trust rate – after tax taken off" value={t.settlorDividendTrust} />
              <Money n={13} label="Non-savings income paid gross" value={t.settlorNonSavingsGross} />
              <Money n={14} label="Savings income paid gross" value={t.settlorSavingsGross} />
              <Money n={15} label="Additional tax paid by the trustees on certain UK life insurance policy gains" value={t.lifeAssuranceTaxPaid} />
            </div>
          </div>
        </Panel>
        <p className="mt-1 flex items-start text-[10.5px] text-black"><InfoDot /> Turn over for income from the estates of deceased persons</p>
      </Page>

      {/* ── T 2 ── */}
      <Page tag="T 2" code="SA107">
        <Head>Income from the estates of deceased persons</Head>
        <Panel>
          <TealSub>Income from United Kingdom (UK) estates</TealSub>
          <Note>If you’ve received income from a UK estate only, enter the net income after tax paid or tax credit in boxes 16 to 19.<br />If you’ve received income from residential property, consider completing box 25.</Note>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={16} label={<>Non-savings income – after tax taken off<Sub>This includes rental income and profits from a trade.</Sub></>} value={t.estateNonSavings} />
              <Money n={17} label={<>Savings income – after tax taken off<Sub>This includes bank or building society interest.</Sub></>} value={t.estateSavings} />
              <Money n={18} label={<>Dividend income – after tax taken off<Sub>This includes dividends from UK and foreign companies. Do not include dividend income that has been taxed at 7.5%, this goes in box 18.1.</Sub></>} value={t.estateDividend} />
            </div>
            <div>
              <Money n="18.1" label={<>Dividend income that has been taxed at 7.5% – after tax taken off<Sub>This includes dividends from UK and foreign companies.</Sub></>} value={t.estateDividend75} />
              <Money n={19} label={<>Non-savings income taxed at non-repayable basic rate – after tax taken off<Sub>This includes gains realised on certain life insurance policies.</Sub></>} value={t.estateNonSavingsNonRepayable} />
              <NotInUse>Boxes 20 and 21 are not in use</NotInUse>
            </div>
          </div>
        </Panel>
        <Panel>
          <TealSub>Income from foreign estates</TealSub>
          <Note>If you’ve received income from a foreign estate do not fill in boxes 16 to 19. Instead, enter the income in box 22 and any relief for UK tax already accounted for in box 23.</Note>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={22} label="Foreign estate income" value={box22} />
              <Money n="22.1" label="Amount claimed under the foreign income and gains (FIG) regime" value={t.foreignEstateFig} />
            </div>
            <div>
              <Money n={23} label="Relief for UK tax already accounted for" value={box23} />
            </div>
          </div>
        </Panel>
        <Panel>
          <TealSub>Foreign tax paid on estate income</TealSub>
          <Note>Fill in box 24 if any Foreign Tax Credit Relief is claimable but has not been claimed on foreign income arising to a UK estate or a foreign estate.</Note>
          <Money n={24} label="Foreign tax for which Foreign Tax Credit Relief has not been claimed" value={box24} />
        </Panel>
        <Head>Residential property income</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Money n={25} label="Amount of residential property income or restricted finance costs from trusts and estates for calculating relief for residential finance costs – use the working sheet in the notes" value={t.estateResiPropertyIncome} /></div>
            <div><Money n="25.1" label="Unused residential property finance costs brought forward" value={t.estateResiFinanceBfwd} /></div>
          </div>
        </Panel>
        <Head>Any other information</Head>
        <Panel className="flex flex-1 flex-col">
          <Label n={26}>Please give any other information in this space</Label>
          <div className="min-h-[110px] flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{t.otherInformation}</div>
        </Panel>
      </Page>
    </FormThemeContext.Provider>
  );
}
