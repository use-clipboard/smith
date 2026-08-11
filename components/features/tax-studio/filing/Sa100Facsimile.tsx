// A faithful HTML facsimile of HMRC's SA100 main form (2025–26), styled to match
// the official form — teal section headings, pale-teal field panels, segmented
// "comb" £ boxes, Yes/No tick boxes — populated from the return. This is HMRC's
// functional tax-return layout (Open Government Licence); rendered so it holds
// this client's figures, as commercial tax software does.

import type React from 'react';
import type { TaxReturn } from '../types';
import { filingChecklist } from './filingModel';

const TEAL = '#00928f';
const PANEL_BG = '#eaf4f3';
const PANEL_BORDER = '#bcdedb';
const CELL = '#a9d3d0';
const RED = '#d4351c';

// ── primitives ───────────────────────────────────────────────────────────────
function Teal({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 border-b-2 pb-1 text-[15px] font-bold" style={{ color: TEAL, borderColor: TEAL }}>{children}</h3>;
}
function SubHead({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 mt-3 text-[14px] font-normal text-black">{children}</p>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] leading-snug text-black">{children}</p>;
}
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`mb-3 p-3 ${className}`} style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}` }}>{children}</div>;
}
function BoxNum({ n }: { n: React.ReactNode }) {
  return <span className="flex h-[15px] min-w-[15px] shrink-0 items-center justify-center px-0.5 text-[9.5px] font-bold text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{n}</span>;
}
function Label({ n, children }: { n?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-1 flex gap-1.5 text-[10.5px] font-bold leading-tight text-black">
      {n != null && <BoxNum n={n} />}
      <span>{children}</span>
    </div>
  );
}

// Segmented £ box: £ · pound cells · decimal · pence cells. Value right-aligned.
function Money({ n, label, value, cells = 9 }: { n?: React.ReactNode; label: React.ReactNode; value?: number | null; cells?: number }) {
  const digits = value ? Math.round(Math.abs(value)).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < digits.length && k < cells; k++) arr[cells - 1 - k] = digits[digits.length - 1 - k];
  return (
    <div className="mb-2.5">
      <Label n={n}>{label}</Label>
      <div className="flex items-stretch text-[12px]" style={{ height: 20 }}>
        <span className="flex w-4 items-center justify-center text-[12px] text-slate-500">£</span>
        <div className="flex flex-1" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>
          {arr.map((d, idx) => (
            <span key={idx} className="flex flex-1 items-center justify-center text-[11.5px] font-medium text-black" style={{ borderRight: idx < cells - 1 ? `1px solid ${CELL}` : 'none' }}>{d}</span>
          ))}
        </div>
        <span className="flex items-center px-0.5 text-[13px] font-bold text-black">·</span>
        <div className="flex" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>
          <span className="flex w-4 items-center justify-center text-[11px] text-slate-300" style={{ borderRight: `1px solid ${CELL}` }}>0</span>
          <span className="flex w-4 items-center justify-center text-[11px] text-slate-300">0</span>
        </div>
      </div>
    </div>
  );
}

// A row of character cells (for text: name, NINO, sort code, phone, dates).
function Comb({ n, label, value = '', cells = 12 }: { n?: React.ReactNode; label?: React.ReactNode; value?: string; cells?: number }) {
  const chars = (value || '').toUpperCase().replace(/\s/g, '').split('');
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < chars.length && k < cells; k++) arr[k] = chars[k];
  return (
    <div className="mb-2.5">
      {label != null && <Label n={n}>{label}</Label>}
      <div className="flex" style={{ border: `1px solid ${CELL}`, background: '#fff', height: 20 }}>
        {arr.map((c, idx) => (
          <span key={idx} className="flex w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ borderRight: idx < cells - 1 ? `1px solid ${CELL}` : 'none' }}>{c}</span>
        ))}
      </div>
    </div>
  );
}

// A plain full-width text line (name/address boxes).
function Line({ n, label, value, lines = 1 }: { n?: React.ReactNode; label?: React.ReactNode; value?: string; lines?: number }) {
  return (
    <div className="mb-2.5">
      {label != null && <Label n={n}>{label}</Label>}
      <div className="whitespace-pre-line px-1.5 py-1 text-[11px] font-medium leading-tight text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', minHeight: 20 * lines }}>{value || ''}</div>
    </div>
  );
}

function Tick({ on }: { on?: boolean }) {
  return <span className="inline-flex h-4 w-4 items-center justify-center text-[13px] font-bold leading-none text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{on ? 'X' : ''}</span>;
}
function YesNo({ yes }: { yes?: boolean | null }) {
  return (
    <div className="flex items-center gap-5 text-[11px] text-black">
      <span className="flex items-center gap-2">Yes <Tick on={yes === true} /></span>
      <span className="flex items-center gap-2">No <Tick on={yes === false} /></span>
    </div>
  );
}

function HmrcLogo() {
  return (
    <div className="flex items-center gap-2">
      <svg width="34" height="38" viewBox="0 0 34 38" aria-hidden className="shrink-0">
        <g fill="#000">
          <circle cx="17" cy="4.5" r="2.6" /><circle cx="6" cy="9" r="2.1" /><circle cx="28" cy="9" r="2.1" />
          <path d="M4 13 L6.5 25 H27.5 L30 13 L24 18 L17 10 L10 18 Z" />
          <rect x="4.5" y="26" width="25" height="3.6" /><rect x="3.5" y="31" width="27" height="4.4" />
        </g>
      </svg>
      <span className="text-[16px] font-bold leading-[1.03] text-black">HM Revenue<br />&amp; Customs</span>
    </div>
  );
}
function BracketBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const c: React.CSSProperties = { position: 'absolute', width: 9, height: 9, borderColor: '#000' };
  return (
    <div className={`relative px-2 py-1.5 ${className}`}>
      <span style={{ ...c, top: 0, left: 0, borderTop: '1px solid #000', borderLeft: '1px solid #000' }} />
      <span style={{ ...c, top: 0, right: 0, borderTop: '1px solid #000', borderRight: '1px solid #000' }} />
      <span style={{ ...c, bottom: 0, left: 0, borderBottom: '1px solid #000', borderLeft: '1px solid #000' }} />
      <span style={{ ...c, bottom: 0, right: 0, borderBottom: '1px solid #000', borderRight: '1px solid #000' }} />
      {children}
    </div>
  );
}
function Page({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="sa-sheet relative mx-auto mb-6 w-[210mm] max-w-full bg-white p-[13mm] shadow-sm" style={{ border: `1px solid ${PANEL_BORDER}`, fontFamily: 'Helvetica, Arial, sans-serif' }}>
      {children}
      <div className="mt-5 flex items-center justify-between border-t pt-1 text-[10px] font-bold tracking-wide text-black" style={{ borderColor: TEAL }}>
        <span>SA100 2026</span><span>Page {tag}</span><span className="font-normal text-slate-400">HMRC 12/25</span>
      </div>
    </div>
  );
}

// TR2 supplementary-page questions carry HMRC's per-form colour coding.
const Q_COLOR: Record<string, string> = {
  employment: '#d5008f', selfemp: '#f47738', partnership: '#00928f', property: '#d4351c',
  foreign: '#8f9b00', trusts: '#b06a2c', cgt: '#00928f', residence: '#00928f', additional: '#00928f',
};
function Question({ n, k, title, children, yes, extra }: { n: number; k: string; title: string; children: React.ReactNode; yes: boolean; extra?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5"><BoxNum n={n} /><span className="text-[12.5px] font-bold" style={{ color: Q_COLOR[k] }}>{title}</span></div>
      <p className="mb-1.5 text-[9.5px] leading-snug text-black">{children}</p>
      <div className="flex items-center gap-6"><YesNo yes={yes} />{extra}</div>
    </div>
  );
}

// ── the form ─────────────────────────────────────────────────────────────────
export default function Sa100Facsimile({ ret }: { ret: TaxReturn }) {
  const i = ret.income;
  const has = filingChecklist(ret);
  const taxedInterest = (i.taxedInterestItems ?? []).reduce((a, t) => a + (t.net || 0), 0);
  const dob = ret.taxpayer?.dateOfBirth;
  const dobCells = dob ? dob.split('-').reverse().join('') : ''; // yyyy-mm-dd → ddmmyyyy

  return (
    <>
      {/* ── TR1 — cover ── */}
      <Page tag="TR 1">
        <div className="mb-3 flex items-start justify-between">
          <HmrcLogo />
          <div className="text-right"><h2 className="text-[22px] font-bold leading-none text-black">Tax Return 2026</h2><p className="mt-2 text-[11px] text-black">Tax year 6 April 2025 to 5 April 2026 (2025–26)</p></div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-x-8 text-[11px] text-black">
          <div>
            <div className="space-y-1">
              <div className="flex gap-3"><span className="w-32 shrink-0">UTR</span><span className="font-semibold">{ret.utr || ''}</span></div>
              <div className="flex gap-3"><span className="w-32 shrink-0">NINO</span><span className="font-semibold">{ret.taxpayer?.nino || ''}</span></div>
              <div className="flex gap-3"><span className="w-32 shrink-0">Employer reference</span></div>
              <div className="flex gap-3 pt-1"><span className="w-32 shrink-0">Date</span></div>
            </div>
            <p className="pt-3">HM Revenue and Customs office address</p>
            <BracketBox className="mt-1 h-20"><span /></BracketBox>
            <p className="pt-2">Telephone</p>
          </div>
          <div>
            <p className="mb-1">Issue address</p>
            <BracketBox className="min-h-[7rem]">
              <div className="whitespace-pre-line text-[11px] font-medium leading-relaxed text-black">{ret.clientName || ''}{ret.taxpayer?.address ? `\n\n${ret.taxpayer.address}` : ''}</div>
            </BracketBox>
            <p className="mt-3">For</p><p>Reference</p>
          </div>
        </div>
        <Teal>Your tax return</Teal>
        <div className="grid grid-cols-2 gap-x-8 text-[9.5px] leading-snug text-black">
          <div>
            <p>This notice requires you, by law, to make a return of your taxable income and capital gains, and any documents requested, for the year from 6 April 2025 to 5 April 2026</p>
            <div className="mt-2 p-2.5" style={{ border: `1px solid ${RED}` }}>
              <p className="mb-1 text-[12px] font-bold" style={{ color: TEAL }}>Deadlines</p>
              <p>We must receive your tax return by these dates:</p>
              <p className="mt-1">• if you’re using a paper return – by 31 October 2026 (or 3 months after the date of this notice if that’s later)</p>
              <p className="mt-1">• if you’re filing a return online – by 31 January 2027 (or 3 months after the date of this notice if that’s later)</p>
              <p className="mt-1">If your return is late you’ll be charged a £100 penalty. If your return is more than 3 months late, you’ll be charged daily penalties of £10 a day.</p>
              <p className="mt-1">If you pay late you’ll be charged interest and a late payment penalty.</p>
            </div>
          </div>
          <div>
            <p className="mb-1 text-[12px] font-bold" style={{ color: TEAL }}>Most people file online</p>
            <p>It’s quick and easy to file online. Get started by typing www.gov.uk/log-in-file-self-assessment-tax-return into your internet browser address bar to go directly to our official website.</p>
            <p className="mt-1.5">Do not use a search website to find HMRC services online. If you have not sent a tax return online before, why not join the 97% of people who already do it online?</p>
            <p className="mt-1.5">To file on paper, please fill in this form using the following rules:</p>
            <p className="mt-1">• enter your figures in whole pounds – ignore the pence</p>
            <p>• round down income and round up expenses and tax paid, it is to your benefit</p>
            <p>• if a box does not apply, please leave it blank – do not strike through empty boxes or write anything else</p>
          </div>
        </div>
        <Teal>Starting your tax return</Teal>
        <p className="mb-3 text-[9.5px] leading-snug text-black">Before you start to fill it in, look through your tax return to make sure there is a section for all your income and claims – you may need some separate supplementary pages (see page TR 2 and the Tax Return notes). For help filling in this form, go to www.gov.uk/taxreturnforms and read the notes and helpsheets.</p>
        <p className="mb-2 text-[14px] text-black">Your personal details</p>
        <Panel>
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Comb n={1} label="Your date of birth — it helps get your tax right — DD MM YYYY" value={dobCells} cells={8} />
              <Line n={2} label="Your name and address — if it is different from what is on the front of this form, write the correct details" value={ret.clientName} lines={2} />
            </div>
            <div>
              <Comb n={3} label="Your phone number" value="" cells={14} />
              <Comb n={4} label="Your National Insurance number — leave blank if the correct number is shown above" value={ret.taxpayer?.nino} cells={9} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR2 — what makes up your tax return ── */}
      <Page tag="TR 2">
        <Teal>What makes up your tax return</Teal>
        <p className="mb-3 text-[9.5px] leading-snug text-black">To make a complete return of your taxable income and gains for the year to 5 April 2026 you may need to complete some separate supplementary pages. Answer the following questions by putting ‘X’ in the ‘Yes’ or ‘No’ box.</p>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Question n={1} k="employment" title="Employment" yes={has.employment} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8 items-center justify-center text-[11px]" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{has.employment ? i.employment.length : ''}</span></span>}>Were you an employee, director, office holder or agency worker in the year to 5 April 2026?</Question>
              <Question n={2} k="selfemp" title="Self-employment" yes={has.selfemp} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8" style={{ border: `1px solid ${CELL}`, background: '#fff' }} /></span>}>If you worked for yourself in the year to 5 April 2026 (answer ‘Yes’ if you were a ‘Name’ at Lloyd’s).</Question>
              <Question n={3} k="partnership" title="Partnership" yes={has.partnership} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8" style={{ border: `1px solid ${CELL}`, background: '#fff' }} /></span>}>Were you in a partnership?</Question>
              <Question n={4} k="property" title="UK property" yes={has.property}>If you received income from UK property (including rents and other income from land you own or lease out).</Question>
              <Question n={5} k="foreign" title="Foreign" yes={has.foreign}>If you were entitled to any foreign income, received income or benefit from a person abroad, or want to claim relief for foreign tax paid.</Question>
              <Question n={6} k="trusts" title="Trusts etc" yes={has.trusts}>Did you receive, or are you treated as having received, income from a trust, settlement or the residue of a deceased person’s estate?</Question>
            </div>
            <div>
              <Question n={7} k="cgt" title="Capital Gains Tax summary" yes={has.cgt} extra={<span className="flex items-center gap-2 text-[10px]">Computations provided <Tick /></span>}>If you sold or disposed of any assets (for example, shares, land and property, a business), or had any chargeable gains. If you do, you must also provide separate computations.</Question>
              <Question n={8} k="residence" title="Residence and foreign income and gains (FIG) regime etc" yes={has.residence}>If you were, for all or part of the year, not resident or dual resident in the UK, or are making a FIG regime / Overseas Workday Relief / Business Investment Relief claim.</Question>
              <Question n={9} k="additional" title="Additional information" yes={has.additional}>Less common kinds of income and tax reliefs — Married Couple’s Allowance, life insurance / chargeable event gains, Seafarer’s Earnings Deduction and disclosed tax avoidance schemes.</Question>
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR3 — income ── */}
      <Page tag="TR 3">
        <Teal>Income</Teal>
        <SubHead>Dividends and interest from UK banks and building societies</SubHead>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Taxed UK interest — the net amount after tax has been taken off" value={taxedInterest} />
              <Money n={2} label="Untaxed UK interest — amounts which have not had tax taken off" value={i.savingsInterest} />
              <Money n={3} label="Untaxed foreign interest (up to £2,000)" value={i.untaxedForeignInterest} cells={6} />
              <Money n={4} label="Dividends from UK companies — the amount received" value={i.dividends} />
            </div>
            <div>
              <Money n={5} label="Other dividends — the amount received" value={i.otherDividends} />
              <Money n={6} label="Foreign dividends (up to £500) — the amount in sterling after foreign tax was taken off" value={i.foreignDividendsMain} cells={6} />
              <Money n={7} label="Tax taken off foreign dividends — the sterling equivalent" value={i.foreignDividendsTax} cells={6} />
            </div>
          </div>
        </Panel>
        <SubHead>UK pensions, annuities and other state benefits received</SubHead>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={8} label="State Pension — amount you were entitled to receive in the year" value={i.statePension} cells={6} />
              <Money n={9} label="State Pension lump sum — the gross amount of any lump sum" value={undefined} cells={6} />
              <Money n={10} label="Tax taken off box 9" value={undefined} cells={6} />
              <Money n={11} label="Pensions (other than State Pension), retirement annuities and taxable lump sums — the gross amount" value={i.pensionsIncome} />
            </div>
            <div>
              <Money n={12} label="Tax taken off box 11" value={undefined} />
              <Money n={13} label="Taxable Incapacity Benefit and contribution-based ESA" value={i.incapacityBenefit} cells={6} />
              <Money n={14} label="Tax taken off Incapacity Benefit in box 13" value={undefined} cells={6} />
              <Money n={15} label="Jobseeker’s Allowance" value={i.jobseekersAllowance} cells={6} />
              <Money n={16} label="Total of any other taxable State Pensions and benefits" value={i.otherPensionsBenefits} cells={6} />
            </div>
          </div>
        </Panel>
        <SubHead>Other UK income not included on supplementary pages</SubHead>
        <Note>Do not use this section for income that should be returned on supplementary pages. Share schemes, gilts, stock dividends, life insurance gains and certain other kinds of income go on the ‘Additional information’ pages.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={17} label="Other taxable income — before expenses and tax taken off" value={i.otherIncome} />
              <Money n={18} label="Total amount of allowable expenses" value={undefined} />
              <Money n={19} label="Any tax taken off box 17" value={undefined} />
            </div>
            <div>
              <Money n={20} label="Benefit from pre-owned assets" value={undefined} />
              <Line n={21} label="Description of income in boxes 17 and 20 — if there’s not enough space, give details in box 19 on page TR 7" value={i.otherIncomeDescription} lines={3} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR4 — tax reliefs ── */}
      <Page tag="TR 4">
        <Teal>Tax reliefs</Teal>
        <SubHead>Paying into registered pension schemes and overseas pension schemes</SubHead>
        <Note>Do not include payments to your employer’s pension scheme deducted from your pay before tax, or payments made by your employer.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Payments to registered pension schemes where basic rate tax relief will be claimed by your pension provider (‘relief at source’). Enter the payments and basic rate tax" value={i.pensionContributions} />
              <Money n="1.1" label="Total of any ‘one-off’ payments in box 1" value={undefined} />
              <Money n={2} label="Payments to a retirement annuity contract where basic rate tax relief will not be claimed by your provider" value={undefined} />
            </div>
            <div>
              <Money n={3} label="Payments to your employer’s scheme which were not deducted from your pay before tax — this will be unusual" value={undefined} />
              <Money n={4} label="Payments to an overseas pension scheme, not UK-registered, eligible for tax relief and not deducted from your pay before tax" value={undefined} />
            </div>
          </div>
        </Panel>
        <SubHead>Charitable giving</SubHead>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={5} label="Gift Aid payments made in the year to 5 April 2026" value={i.giftAid} />
              <Money n={6} label="Total of any ‘one-off’ payments in box 5" value={undefined} />
              <Money n={7} label="Gift Aid payments made in the year to 5 April 2026 but treated as if made in the year to 5 April 2025" value={undefined} />
            </div>
            <div>
              <Money n={8} label="Gift Aid payments made after 5 April 2026 but to be treated as if made in the year to 5 April 2026" value={undefined} />
              <Money n={9} label="Value of qualifying shares or securities gifted to charity" value={undefined} />
              <Money n={10} label="Value of qualifying land and buildings gifted to charity" value={undefined} />
              <div className="mt-1 flex justify-center py-1 text-[10px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>Boxes 11 and 12 are not in use</div>
            </div>
          </div>
        </Panel>
        <SubHead>Blind Person’s Allowance</SubHead>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <div className="mb-2 flex items-start gap-2"><Label n={13}>If you’re registered blind, or severely sight impaired, and your name is on a local authority or other register, put ‘X’ in the box</Label></div>
              <Tick on={!!i.registeredBlind} />
              <div className="mt-3"><Line n={14} label="Enter the name of the local authority or other register" value={i.blindAuthority} lines={2} /></div>
            </div>
            <div>
              <div className="mb-2"><Label n={15}>If you want your spouse’s, or civil partner’s, surplus allowance, put ‘X’ in the box</Label><Tick on={!!i.blindSpouseSurplusClaim} /></div>
              <div className="mt-3"><Label n={16}>If you want your spouse, or civil partner, to have your surplus allowance, put ‘X’ in the box</Label><Tick on={!!i.blindSpouseSurplusSurrender} /></div>
            </div>
          </div>
        </Panel>
        <p className="text-[10px] text-black">ℹ Other less common reliefs are on the ‘Additional information’ pages.</p>
      </Page>

      {/* ── TR5 — student loan / HICBC / WFP / Marriage Allowance ── */}
      <Page tag="TR 5">
        <Teal>Student Loan and Postgraduate Loan repayments</Teal>
        <Note>Please read the notes before filling in boxes 1 to 3.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={1}>If you’ve received notification from the Student Loans Company that your repayment of an Income Contingent Loan was due before 6 April 2026, put ‘X’ in the box</Label><Tick on={!!i.studentLoanPlan} /></div>
            <div>
              <Money n={2} label="If your employer has deducted Student Loan repayments enter the amount deducted" value={undefined} />
              <Money n={3} label="If your employer has deducted Postgraduate Loan repayments enter the amount deducted" value={undefined} />
            </div>
          </div>
        </Panel>
        <Teal>High Income Child Benefit Charge</Teal>
        <Note>Only fill in this section if: your income was over £60,000; you or your partner got Child Benefit; and (couples only) your income was higher than your partner’s.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Enter the total amount of Child Benefit you and your partner got for the year to 5 April 2026" value={i.childBenefit} cells={5} />
              <Comb n={2} label="Enter the number of children you and your partner got Child Benefit for on 5 April 2026" value="" cells={2} />
            </div>
            <div><Comb n={3} label="Enter the date that you and your partner stopped getting all Child Benefit payments if this was before 6 April 2026 — DD MM YYYY" value="" cells={8} /></div>
          </div>
        </Panel>
        <Teal>Marriage Allowance</Teal>
        <Note>If your income was less than £12,570 you can transfer £1,260 of your Personal Allowance to your spouse or civil partner. Fill in this section if you want to make the transfer.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Your spouse or civil partner’s first name" value={i.spouseFirstName} />
              <Line n={2} label="Your spouse or civil partner’s last name" value={i.spouseLastName} />
              <Comb n={3} label="Your spouse or civil partner’s National Insurance number" value={i.spouseNino} cells={9} />
            </div>
            <div>
              <Comb n={4} label="Your spouse or civil partner’s date of birth — DD MM YYYY" value={i.spouseDob ? i.spouseDob.split('-').reverse().join('') : ''} cells={8} />
              <Comb n={5} label="Date of marriage or civil partnership — DD MM YYYY" value={i.marriageDate ? i.marriageDate.split('-').reverse().join('') : ''} cells={8} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR6 — finishing ── */}
      <Page tag="TR 6">
        <Teal>Finishing your tax return</Teal>
        <Note>ℹ Calculating your tax — if we receive this paper tax return by 31 October 2026 or if you file online, we’ll do the calculation for you and tell you how much you have to pay (or your repayment) before 31 January 2027.</Note>
        <SubHead>Tax refunded or set off</SubHead>
        <Panel><Money n={1} label="If you’ve had any 2025–26 Income Tax refunded or set off by us or Jobcentre Plus, enter the amount" value={undefined} /></Panel>
        <SubHead>If you have not paid enough tax</SubHead>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={2}>If you owe less than £3,000 for 2025–26 (excluding Class 2 NICs) and you file by the deadline, we’ll try to collect the tax through your 2027–28 tax code. If you do not want us to do this, put ‘X’ in the box</Label><Tick /></div>
            <div><Label n={3}>If you owe tax on savings, casual earnings and/or the High Income Child Benefit Charge for 2026–27, we’ll try to collect it via your 2026–27 tax code. If you do not want this, put ‘X’ in the box</Label><Tick /></div>
          </div>
        </Panel>
        <SubHead>If you have paid too much tax</SubHead>
        <Note>To claim a repayment, fill in boxes 4 to 14 below.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={4} label="Name of bank or building society" value={i.repayBankName} />
              <Line n={5} label="Name of account holder (or nominee)" value={i.repayAccountHolder} />
              <Comb n={6} label="Branch sort code" value={i.repaySortCode} cells={6} />
              <Comb n={7} label="Account number" value={i.repayAccountNumber} cells={8} />
              <Comb n={8} label="Building society reference number" value={i.repayBuildingSocRef} cells={12} />
              <div className="mt-1"><Label n={9}>If you or your nominee do not have a UK bank or building society account, put ‘X’ in the box</Label><Tick on={!!i.repayNoUkAccount} /></div>
            </div>
            <div>
              <div className="mb-2"><Label n={10}>If you’ve entered a nominee’s name in box 5, put ‘X’ in the box</Label><Tick on={!!i.repayNomineeNameEntered} /></div>
              <div className="mb-2"><Label n={11}>If your nominee is your tax adviser, put ‘X’ in the box</Label><Tick on={!!i.repayNomineeIsAdviser} /></div>
              <Line n={12} label="Nominee’s address" value={i.repayNomineeAddress} lines={2} />
              <Comb n={13} label="and postcode" value={i.repayNomineePostcode} cells={8} />
              <Line n={14} label="To authorise your nominee to receive any repayment, you must sign in the box. A photocopy of your signature will not do" value="" lines={2} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR7 — adviser + any other information ── */}
      <Page tag="TR 7">
        <p className="mb-1 text-[14px] text-black">Your tax adviser, if you have one</p>
        <Note>This section is optional. Please read the notes about authorising your tax adviser.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={15} label="Your tax adviser’s name" value={i.adviserName} lines={2} />
              <Comb n={16} label="Their phone number" value={i.adviserPhone} cells={14} />
            </div>
            <div>
              <Line n={17} label="The first line of their address including the postcode" value={i.adviserAddress} lines={3} />
              <Comb n={18} label="The reference your adviser uses for you" value={i.adviserReference} cells={16} />
            </div>
          </div>
        </Panel>
        <p className="mb-1 text-[14px] text-black">Any other information</p>
        <Panel>
          <Label n={19}>Please give any other information in this space</Label>
          <div style={{ border: `1px solid ${CELL}`, background: '#fff', minHeight: 360 }} />
        </Panel>
      </Page>

      {/* ── TR8 — signing ── */}
      <Page tag="TR 8">
        <p className="mb-1 text-[14px] text-black">Signing your form and sending it back</p>
        <Note>Please fill in this section and sign and date the declaration at box 22.</Note>
        <Panel>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <div className="mb-3"><Label n={20}>If this tax return contains provisional figures, put ‘X’ in the box — in the ‘Any other information’ box on page TR7, tell us why and when you expect to give us your final figures</Label><Tick /></div>
              <div className="mb-3"><Label n={21}>If you’re enclosing separate supplementary pages, put ‘X’ in the box</Label><Tick on={Object.values(has).some(Boolean)} /></div>
              <Label n={22}>Declaration</Label>
              <p className="mb-1 text-[10px] leading-snug text-black">I declare that the information I’ve given on this tax return and any supplementary pages is correct and complete to the best of my knowledge and belief.</p>
              <p className="mb-2 text-[10px] leading-snug text-black">I understand that I may have to pay financial penalties and face prosecution if I give false information.</p>
              <p className="text-[10.5px] font-bold text-black">Signature</p>
              <div className="mb-2" style={{ border: `1px solid ${RED}`, background: '#fff', height: 46 }} />
              <Comb label={<span className="font-bold">Date — DD MM YYYY</span>} value="" cells={8} />
            </div>
            <div>
              <Line n={23} label="If you’ve signed on behalf of someone else, enter the capacity. For example, executor, receiver" value="" lines={2} />
              <Line n={24} label="Enter the name of the person you’ve signed for" value="" lines={2} />
              <Line n={25} label="If you filled in boxes 23 and 24 enter your name" value="" lines={2} />
              <Line n={26} label="and your address" value="" lines={3} />
            </div>
          </div>
        </Panel>
      </Page>
    </>
  );
}
