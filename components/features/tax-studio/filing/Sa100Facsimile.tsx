// A faithful HTML facsimile of HMRC's SA100 main form (2025–26), styled to match
// the official form — teal section headings, numbered grey £ boxes, Yes/No tick
// boxes — populated from the return. Rendered on screen and printable to PDF.
// The form's field structure is HMRC's functional tax-return layout.

import type { TaxReturn } from '../types';
import { filingChecklist } from './filingModel';

const TEAL = '#00928f';
const GREY = '#b1b4b6';

// Whole pounds + pence, HMRC-style (value in the £ cell, pence in the small cell).
function poundsPence(n: number | undefined | null): { pounds: string; pence: string } {
  const v = Math.round(Math.abs(n || 0));
  return { pounds: v ? v.toLocaleString('en-GB') : '', pence: v ? '0 0' : '' };
}

// A numbered £ entry box: number chip · £ · right-aligned value · pence cell.
function Box({ n, label, value, note }: { n: number | string; label: React.ReactNode; value?: number | null; note?: string }) {
  const { pounds, pence } = poundsPence(value);
  return (
    <div className="mb-2">
      <div className="mb-1 flex gap-1.5 text-[10.5px] leading-tight text-black">
        <span className="font-bold" style={{ color: TEAL }}>{n}</span>
        <span>{label}</span>
      </div>
      <div className="flex items-stretch" style={{ border: `1px solid ${GREY}`, height: 22 }}>
        <span className="flex w-5 items-center justify-center border-r text-[11px] text-black" style={{ borderColor: GREY }}>£</span>
        <span className="flex flex-1 items-center justify-end px-1.5 text-[11.5px] font-medium text-black">{pounds}</span>
        <span className="flex w-8 items-center justify-center border-l text-[10px] text-slate-400" style={{ borderColor: GREY }}>{pence}</span>
      </div>
      {note && <p className="mt-0.5 text-[9px] text-slate-500">{note}</p>}
    </div>
  );
}

// A short text/date field (no £).
function TextBox({ n, label, value }: { n?: number | string; label: React.ReactNode; value?: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex gap-1.5 text-[10.5px] leading-tight text-black">
        {n != null && <span className="font-bold" style={{ color: TEAL }}>{n}</span>}
        <span>{label}</span>
      </div>
      <div className="flex items-center px-1.5 text-[11.5px] font-medium text-black" style={{ border: `1px solid ${GREY}`, height: 22 }}>{value || ''}</div>
    </div>
  );
}

// Yes / No tick boxes (X in the chosen box). `yes` selects which is ticked.
function TickBox({ on }: { on: boolean }) {
  return <span className="inline-flex h-3.5 w-3.5 items-center justify-center align-middle text-[11px] font-bold leading-none text-black" style={{ border: `1px solid ${GREY}` }}>{on ? 'X' : ''}</span>;
}
function YesNo({ yes }: { yes: boolean }) {
  return (
    <div className="flex items-center gap-4 text-[10.5px] text-black">
      <span className="flex items-center gap-1.5">Yes <TickBox on={yes} /></span>
      <span className="flex items-center gap-1.5">No <TickBox on={!yes} /></span>
    </div>
  );
}

// A numbered supplementary-page question for TR2.
function Question({ n, title, children, yes }: { n: number; title: string; children: React.ReactNode; yes: boolean }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] font-bold"><span style={{ color: TEAL }}>{n}</span> <span className="text-black">{title}</span></p>
      <p className="mb-1.5 text-[9.5px] leading-snug text-slate-600">{children}</p>
      <YesNo yes={yes} />
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-1 border-b pb-1 text-[13px] font-bold" style={{ color: TEAL, borderColor: GREY }}>{children}</h3>;
}

function Page({ tag, children }: { tag: string; children: React.ReactNode }) {
  return (
    <div className="sa-sheet relative mx-auto mb-6 w-[210mm] max-w-full bg-white p-[14mm] shadow-sm" style={{ border: `1px solid ${GREY}`, fontFamily: 'Helvetica, Arial, sans-serif' }}>
      {children}
      <div className="mt-6 flex items-center justify-between border-t pt-1 text-[9px] text-slate-500" style={{ borderColor: GREY }}>
        <span>SA100 2026</span><span>Page {tag}</span>
      </div>
    </div>
  );
}

export default function Sa100Facsimile({ ret }: { ret: TaxReturn }) {
  const i = ret.income;
  const has = filingChecklist(ret);
  const taxedInterest = (i.taxedInterestItems ?? []).reduce((a, t) => a + (t.net || 0), 0);

  return (
    <>
      {/* ── TR1 — personal details ── */}
      <Page tag="TR 1">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[16px] font-bold text-black">Tax Return 2026</h2>
          <span className="text-[10px] text-slate-500">Tax year 6 April 2025 to 5 April 2026 (2025–26)</span>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-x-8 text-[10.5px] text-black">
          <div><span className="text-slate-500">UTR</span> <span className="font-semibold">{ret.utr || ''}</span></div>
          <div><span className="text-slate-500">NINO</span> <span className="font-semibold">{ret.taxpayer?.nino || ''}</span></div>
        </div>
        <SectionHeading>Your personal details</SectionHeading>
        <div className="grid grid-cols-2 gap-x-8">
          <TextBox n={1} label="Your date of birth — DD MM YYYY" value={ret.taxpayer?.dateOfBirth} />
          <TextBox label="Your name and address" value={ret.clientName} />
          <TextBox n={4} label="Your National Insurance number" value={ret.taxpayer?.nino} />
        </div>
      </Page>

      {/* ── TR2 — what makes up your tax return ── */}
      <Page tag="TR 2">
        <SectionHeading>What makes up your tax return</SectionHeading>
        <p className="mb-3 text-[9.5px] leading-snug text-slate-600">To make a complete return of your taxable income and gains for the year to 5 April 2026 you may need to complete some separate supplementary pages. Answer the following questions by putting ‘X’ in the ‘Yes’ or ‘No’ box.</p>
        <div className="grid grid-cols-2 gap-x-10">
          <div>
            <Question n={1} title="Employment" yes={has.employment}>Were you an employee, director, office holder or agency worker in the year to 5 April 2026?</Question>
            <Question n={2} title="Self-employment" yes={has.selfemp}>If you worked for yourself in the year to 5 April 2026 (answer ‘Yes’ if you were a ‘Name’ at Lloyd’s).</Question>
            <Question n={3} title="Partnership" yes={has.partnership}>Were you in a partnership?</Question>
            <Question n={4} title="UK property" yes={has.property}>If you received income from UK property (including rents and other income from land you own or lease out).</Question>
            <Question n={5} title="Foreign" yes={has.foreign}>If you were entitled to any foreign income, or want to claim relief for foreign tax paid.</Question>
            <Question n={6} title="Trusts etc" yes={has.trusts}>Did you receive, or are you treated as having received, income from a trust, settlement or the estate of a deceased person?</Question>
          </div>
          <div>
            <Question n={7} title="Capital Gains Tax summary" yes={has.cgt}>If you sold or disposed of any assets (for example, shares, land and property, a business), or had any chargeable gains.</Question>
            <Question n={8} title="Residence and foreign income and gains (FIG) regime etc" yes={has.residence}>If you were not resident or dual resident in the UK, or are making a FIG / Overseas Workday Relief claim.</Question>
            <Question n={9} title="Additional information" yes={has.additional}>Less common kinds of income and tax reliefs — Married Couple’s Allowance, life insurance / chargeable event gains, and so on.</Question>
          </div>
        </div>
      </Page>

      {/* ── TR3 — income ── */}
      <Page tag="TR 3">
        <SectionHeading>Income</SectionHeading>
        <p className="mb-2 text-[11px] font-bold text-black">Interest and dividends from UK banks and building societies</p>
        <div className="grid grid-cols-2 gap-x-10">
          <div>
            <Box n={1} label="Taxed UK interest — the net amount after tax has been taken off" value={taxedInterest} />
            <Box n={2} label="Untaxed UK interest — amounts which have not had tax taken off" value={i.savingsInterest} />
            <Box n={3} label="Untaxed foreign interest (up to £2,000)" value={i.untaxedForeignInterest} />
            <Box n={4} label="Dividends from UK companies — the amount received" value={i.dividends} />
          </div>
          <div>
            <Box n={5} label="Other dividends — the amount received" value={i.otherDividends} />
            <Box n={6} label="Foreign dividends (up to £500) — the amount in sterling after foreign tax" value={i.foreignDividendsMain} />
            <Box n={7} label="Tax taken off foreign dividends — the sterling equivalent" value={i.foreignDividendsTax} />
          </div>
        </div>
        <p className="mb-2 mt-3 text-[11px] font-bold text-black">UK pensions, annuities and other state benefits received</p>
        <div className="grid grid-cols-2 gap-x-10">
          <div>
            <Box n={8} label="State Pension — amount you were entitled to receive in the year" value={i.statePension} />
            <Box n={11} label="Pensions (other than State Pension), retirement annuities and taxable lump sums — the gross amount" value={i.pensionsIncome} />
            <Box n={13} label="Taxable Incapacity Benefit and contribution-based ESA" value={i.incapacityBenefit} />
          </div>
          <div>
            <Box n={15} label="Jobseeker’s Allowance" value={i.jobseekersAllowance} />
            <Box n={16} label="Total of any other taxable State Pensions and benefits" value={i.otherPensionsBenefits} />
          </div>
        </div>
        <p className="mb-2 mt-3 text-[11px] font-bold text-black">Other UK income not included on supplementary pages</p>
        <div className="grid grid-cols-2 gap-x-10">
          <div>
            <Box n={17} label="Other taxable income — before expenses and tax taken off" value={i.otherIncome} />
            <Box n={18} label="Total amount of allowable expenses" value={undefined} />
          </div>
          <div>
            <TextBox n={21} label="Description of income in boxes 17 and 20" value={i.otherIncomeDescription} />
          </div>
        </div>
      </Page>
    </>
  );
}
