// Facsimile of HMRC's SA109 Residence and foreign income and gains (FIG) regime
// etc — 4 pages (RR1–4), teal theme, bound to the Sa109 model (income.residence).

import type React from 'react';
import type { TaxReturn, Sa109 } from '../types';
import {
  FormThemeContext, TEAL_THEME, TEAL, CELL, CELL_SHADOW, Page, SuppHead, Note, Panel, Money, Cells, Label, Tick, toDDMMYYYY,
} from './formPrimitives';

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mb-1 mt-1 text-[15px] font-normal text-black">{children}</h4>;
const NotInUse = ({ children }: { children: React.ReactNode }) => <div className="mb-3 inline-flex px-3 py-1 text-[11px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>{children}</div>;

// A single blank/filled character box, matching Cells' cell dimensions.
const Cell = ({ ch }: { ch?: string }) => (
  <span className="flex h-[18px] w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', boxShadow: CELL_SHADOW }}>{ch || ''}</span>
);

// A label followed by an 'X' tick box on its own line (SA109 puts the box below).
const TickRow = ({ n, on, children }: { n: React.ReactNode; on?: boolean; children: React.ReactNode }) => (
  <div className="mb-3"><Label n={n}>{children}</Label><Tick on={on} /></div>
);

// Right-aligned numeric boxes (day counts / tie counts) — units in the last box.
function NumCells({ n, label, cells, value }: { n: React.ReactNode; label: React.ReactNode; cells: number; value?: number }) {
  const digits = value ? Math.round(value).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < digits.length && k < cells; k++) arr[cells - 1 - k] = digits[digits.length - 1 - k];
  return (
    <div className="mb-3">
      <Label n={n}>{label}</Label>
      <div className="flex items-center gap-[3px]">{arr.map((d, i) => <Cell key={i} ch={d} />)}</div>
    </div>
  );
}

// Country codes: one ISO alpha-3 code per 3-cell row; `value` is comma-joined.
function CodeRows({ n, label, value, rows }: { n: React.ReactNode; label: React.ReactNode; value?: string; rows: number }) {
  const codes = (value || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const list = Array.from({ length: rows }).map((_, i) => codes[i] || '');
  return (
    <div className="mb-3">
      <Label n={n}>{label}</Label>
      <div className="space-y-[6px]">
        {list.map((c, ri) => <div key={ri} className="flex items-center gap-[3px]">{Array.from({ length: 3 }).map((_, k) => <Cell key={k} ch={c[k]} />)}</div>)}
      </div>
    </div>
  );
}

export default function ResidenceFacsimile({ ret }: { ret: TaxReturn }) {
  const sa: Sa109 = ret.income.residence ?? {};
  const companies = sa.figForeignIncomeReliefCompanies ?? [];
  const box38 = companies.reduce((s, c) => s + (c.amountInvested || 0), 0);
  const yr = (sa.figPriorResidentYear || '').replace(/\D/g, '');
  return (
    <FormThemeContext.Provider value={TEAL_THEME}>
      {/* ── RR 1 — Residence status ── */}
      <Page tag="RR 1" code="SA109">
        <SuppHead title="Residence and foreign income and gains (FIG) regime etc" name={ret.clientName} utr={ret.utr ?? undefined} />
        <Note>For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</Note>
        <Head>Residence status</Head>
        <Note>Please read the ‘Residence and foreign income and gains (FIG) regime etc notes’ before you fill in boxes 1 to 14.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={1} on={sa.notResident}>If you were not resident in the UK for 2025–26, put ‘X’ in the box</TickRow>
              <NotInUse>Box 2 is not in use</NotInUse>
              <TickRow n={3} on={sa.splitYear}>If your circumstances meet the criteria for split year treatment for 2025–26, put ‘X’ in the box</TickRow>
              <TickRow n="3.1" on={sa.splitYearMultiple}>If more than one case of split year treatment applies, put ‘X’ in the box</TickRow>
              <TickRow n={4} on={sa.residentLastYear}>If you were resident in the UK for 2024–25, put ‘X’ in the box</TickRow>
              <NotInUse>Box 5 is not in use</NotInUse>
              <Cells n={6} label="If you have an entry in box 3 enter the date from which the UK part of the year begins or ends  DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(sa.splitYearDate)} />
              <TickRow n={7} on={sa.thirdAutoOverseasTest}>If you meet the third automatic overseas test, put ‘X’ in the box</TickRow>
              <TickRow n={8} on={sa.gapBetweenEmployments}>If you had a gap between employments in 2025–26, put ‘X’ in the box</TickRow>
            </div>
            <div>
              <TickRow n={9} on={sa.homeOverseas}>If you had a home overseas in 2025–26, put ‘X’ in the box</TickRow>
              <NumCells n={10} label="Number of days spent in the UK during 2025–26" cells={3} value={sa.daysInUk} />
              <NumCells n={11} label="Number of days in box 10 attributed to exceptional circumstances" cells={2} value={sa.daysExceptional} />
              <NumCells n="11.1" label="Number of days when you were in the UK at midnight during 2025–26, but you were in transit – do not include these days in any entry in box 10" cells={3} value={sa.daysTransit} />
              <NumCells n={12} label="How many ties to the UK did you have in 2025–26?" cells={3} value={sa.ukTies} />
              <NumCells n={13} label="Number of days you worked for more than 3 hours in the UK in 2025–26" cells={3} value={sa.workdaysUk} />
              <NumCells n={14} label="Number of days you worked for more than 3 hours overseas in 2025–26" cells={3} value={sa.workdaysOverseas} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── RR 2 ── */}
      <Page tag="RR 2" code="SA109">
        <Head>Personal allowances for non-residents and dual residents</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={15} on={sa.paUnderDta}>If you are entitled to claim personal allowances as a non-resident because of the terms of a Double Taxation Agreement, put ‘X’ in the box</TickRow>
              <TickRow n={16} on={sa.paOtherBasis}>If you are entitled to claim personal allowances as a non-resident on some other basis, or as a dual resident remittance basis user under the terms of certain Double Taxation Agreements (read the notes), put ‘X’ in the box</TickRow>
            </div>
            <div>
              <CodeRows n={17} label="Enter the codes for the country or countries of which you are a national and/or resident" value={sa.nationalResidentCountries} rows={3} />
            </div>
          </div>
        </Panel>
        <Head>Residence in other countries</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <CodeRows n={18} label="Enter the codes for the country or countries, other than the UK, in which you were resident for tax purposes for 2025–26" value={sa.residentCountryCodes} rows={2} />
              <CodeRows n={19} label="If you were also resident in either or both of the countries above for 2024–25, enter the appropriate codes" value={sa.residentCountryCodesPrior} rows={2} />
              <Money n={20} label="Amount of Double Taxation Agreement income for which partial relief is being claimed" value={sa.dtaIncomeReliefAmount} />
            </div>
            <div>
              <Money n={21} label="Relief under Double Taxation Agreements between the UK and other countries – amount claimed because of an agreement awarding residence to another country – read ‘Helpsheet 302’" value={sa.dtaReliefResidence} />
              <Money n={22} label="Relief claimed because of other provisions of the relevant Double Taxation Agreements – read ‘Helpsheet 304’" value={sa.dtaReliefOther} />
              <Note>If you are claiming relief in box 21 or box 22, fill in the appropriate claim form in ‘Helpsheet 302’ or ‘Helpsheet 304’ and send this as well.</Note>
            </div>
          </div>
        </Panel>
        <Head>Foreign income and gains (FIG) regime, Overseas Workday Relief (OWR) and temporary repatriation facility (TRF)</Head>
        <Note>Please read the ‘Residence and foreign income and gains (FIG) regime etc notes’ before you fill in boxes 23 to 53.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Cells n={23} label="What was your date of arrival in the UK  DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(sa.figArrivalDate)} />
              <Cells n={24} label="If you were UK resident in a tax year prior to your most recent arrival enter the year  YYYY–YY" groups={[4, 2]} sep="–" value={yr} />
            </div>
            <div>
              <NotInUse>Boxes 25 to 27 are not in use</NotInUse>
            </div>
          </div>
        </Panel>
        <Head>Foreign income and gains (FIG) regime</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={28} on={sa.figIncomeClaim}>If you’re making a claim for relief on foreign income under the FIG regime, put ‘X’ in the box</TickRow>
              <TickRow n={29} on={sa.figGainsClaim}>If you’re making a claim for relief on foreign gains under the FIG regime, put ‘X’ in the box</TickRow>
            </div>
            <div>
              <TickRow n={30} on={sa.qahcDeemedForeign}>If you have UK income or gains deemed to be foreign under qualifying asset holding company rules, put ‘X’ in the box</TickRow>
              <NotInUse>Boxes 31 to 36 are not in use</NotInUse>
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── RR 3 ── */}
      <Page tag="RR 3" code="SA109">
        <Head>Remittance basis for foreign income and gains prior to 6 April 2025</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={37} on={sa.remittedNominated}>If you have remitted nominated income or gains during this tax year, put ‘X’ in the box unless what you have remitted is within the £10 aggregate limit</TickRow>
              <Money n={38} label="If you are claiming relief from UK tax for foreign income or gains invested in a qualifying business, enter the total amount invested and the Company Registration Numbers below" value={box38 || undefined} />
              {[0, 1, 2].map(i => (
                <div key={i} className="mb-2">
                  <p className="mb-1 text-[10.5px] text-black">Company {i + 1}</p>
                  <div className="flex items-center gap-[3px]">{Array.from({ length: 8 }).map((_, k) => <Cell key={k} ch={(companies[i]?.companyNumber || '').toUpperCase()[k]} />)}</div>
                </div>
              ))}
              <Note>If you have invested in more than 3 companies, use the ‘Any other information’ box 54, to enter the information.</Note>
            </div>
            <div>
              <TickRow n={39} on={sa.investmentNoLongerQualifies}>If you have previously claimed relief for a qualifying investment and the investment no longer qualifies for relief, put ‘X’ in the box</TickRow>
            </div>
          </div>
        </Panel>
        <Head>Overseas Workday Relief (OWR)</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={40} on={sa.owrElection}>If you’re making an election for Overseas Workday Relief, put ‘X’ in the box</TickRow>
              <TickRow n={41} on={sa.owrClaim}>If you’re making a claim for Overseas Workday Relief, put ‘X’ in the box</TickRow>
              <NotInUse>Box 42 is not in use</NotInUse>
              <TickRow n={43} on={sa.owrTransitional}>If you qualify for the OWR transitional provisions in any year for which you’re making a claim, put ‘X’ in the box</TickRow>
              <Money n={44} label="Qualifying employment income after deductions" value={sa.owrQualifyingEmpIncome} />
            </div>
            <div>
              <NotInUse>Box 45 is not in use</NotInUse>
              <Money n={46} label="Qualifying foreign employment income after deductions" value={sa.owrQualifyingForeignEmpIncome} />
              <Money n={47} label="Maximum relief available under the financial limit" value={sa.owrMaxRelief} />
              <Money n={48} label="OWR claimed on the qualifying employment income" value={sa.owrClaimedOnEmpIncome} />
              <Money n={49} label="If you’re making one or more claims for OWR, put the total amount of relief claimed for this tax year" value={sa.owrTotalRelief} />
            </div>
          </div>
        </Panel>
        <Head>Temporary repatriation facility (TRF)</Head>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <TickRow n={50} on={sa.trfElection}>If you’re making an election under the TRF, put ‘X’ in the box</TickRow>
              <Money n={51} label="Amount that relates to personal TRF designations  Use the ‘Any other information’ box 54" value={sa.trfPersonalDesignations} />
            </div>
            <div>
              <Money n={52} label="Amount that relates to capital payments and benefits received from trusts  Use the ‘Any other information’ box 54" value={sa.trfTrustPayments} />
              <Money n={53} label="Amount of TRF designations remitted in this tax year  Use the ‘Any other information’ box 54" value={sa.trfRemitted} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── RR 4 — Any other information ── */}
      <Page tag="RR 4" code="SA109">
        <div className="flex h-full flex-col">
          <Head>Any other information</Head>
          <Note>Boxes 3, 3.1, 8, 11.1, 16, 37, 38, 39, 51, 52 and 53 may require more information to be provided in box 54. Please refer to the ‘Residence and foreign income and gains (FIG) regime etc notes’ on these boxes for more information about this.</Note>
          <Panel className="flex flex-1 flex-col">
            <Label n={54}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{sa.otherInformation}</div>
          </Panel>
        </div>
      </Page>
    </FormThemeContext.Provider>
  );
}
