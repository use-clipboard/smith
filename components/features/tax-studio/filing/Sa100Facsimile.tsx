// A faithful HTML facsimile of HMRC's SA100 main form (2025–26), styled to match
// the official form — teal section headings, pale-teal field panels, segmented
// "comb" £ boxes, Yes/No tick boxes — populated from the return. This is HMRC's
// functional tax-return layout (Open Government Licence); rendered so it holds
// this client's figures, as commercial tax software does.

import type React from 'react';
import type { TaxReturn } from '../types';
import { filingChecklist } from './filingModel';
import { dividendsTotal, savingsInterestTotal } from '../calc';

const TEAL = '#00928f';
const PANEL_BG = '#eaf4f3';
const PANEL_BORDER = '#bcdedb';
const CELL = '#a9d3d0';
const MONEY_TINT = '#d4e9e6'; // light teal fill for the £ and pence cells
const CELL_SHADOW = '0 1px 1.5px rgba(0,0,0,0.13)'; // subtle drop shadow on each cell
const RED = '#d4351c';

// ── primitives ───────────────────────────────────────────────────────────────
function Teal({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 border-b-2 pb-1 text-[15px] font-bold" style={{ color: TEAL, borderColor: TEAL }}>{children}</h3>;
}
function SubHead({ children }: { children: React.ReactNode }) {
  return <p data-sa-subhead className="mb-2 mt-3 text-[14px] font-normal text-black">{children}</p>;
}
function Note({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-[10px] leading-snug text-black">{children}</p>;
}
// An intro line followed by a bulleted list (the HMRC 'only fill in if…' notes).
function Bullets({ intro, items, after }: { intro: string; items: string[]; after?: React.ReactNode }) {
  return (
    <div className="mb-2 text-[9.5px] leading-snug text-black">
      <p>{intro}</p>
      {items.map((it, k) => <p key={k} className="pl-3 -indent-2">• {it}</p>)}
      {after}
    </div>
  );
}
// Teal information dot (white 'i'), like the form's guidance markers.
function InfoDot() {
  return <span className="mr-1 inline-flex h-[15px] w-[15px] shrink-0 translate-y-[2px] items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: TEAL, fontFamily: 'Georgia, "Times New Roman", serif' }}>i</span>;
}
function Panel({ children, className = '', divided }: { children: React.ReactNode; className?: string; divided?: boolean }) {
  return (
    <div className={`relative mb-3 p-3 ${className}`} style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}` }}>
      {divided && <div className="absolute bottom-2 top-2 w-px" style={{ left: '50%', background: PANEL_BORDER }} />}
      {children}
    </div>
  );
}
// Fixed-width number chip so single- and double-digit markers are the same size
// (keeps a consistent gap to the label text).
function BoxNum({ n }: { n: React.ReactNode }) {
  return <span data-boxnum={n != null ? String(n) : undefined} className="flex h-[15px] w-[19px] shrink-0 items-center justify-center text-[9.5px] font-bold text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{n}</span>;
}
// Field label — the number chip sits flush to the panel's left edge (pulled out
// of the panel's padding), with the label text beside it at a consistent indent.
function Label({ n, children }: { n?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="relative mb-1 text-[10.5px] font-bold leading-tight text-black">
      {n != null && <span className="absolute -left-3 top-[1px]"><BoxNum n={n} /></span>}
      <span className={n != null ? 'block pl-3' : 'block'}>{children}</span>
    </div>
  );
}

// A single outlined £ box like the HMRC form: £ (grey) · pound cells · decimal ·
// pence cells (grey 0 0), all within one border. Value right-aligned in the pound
// cells. `minus` renders the sign marker to the left (− when the value is negative).
function Money({ n, label, value, cells = 8, minus }: { n?: React.ReactNode; label: React.ReactNode; value?: number | null; cells?: number; minus?: boolean }) {
  const neg = (value || 0) < 0;
  const digits = value ? Math.round(Math.abs(value)).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < digits.length && k < cells; k++) arr[cells - 1 - k] = digits[digits.length - 1 - k];
  const base: React.CSSProperties = { border: `1px solid ${CELL}`, boxShadow: CELL_SHADOW };
  return (
    <div className="mb-4">
      <Label n={n}>{label}</Label>
      <div className="flex items-stretch gap-[3px]" style={{ height: 20 }}>
        <span className="flex w-[15px] items-center justify-center text-[12px] text-slate-500" style={base}>£</span>
        {minus && <span className="flex w-[14px] items-center justify-center" style={{ ...base, background: MONEY_TINT }}>{neg ? <span className="text-[12px] font-bold text-black">−</span> : <span className="block" style={{ width: 9, height: 3, background: '#fff' }} />}</span>}
        {arr.map((d, idx) => (
          <span key={idx} className="flex w-[15px] items-center justify-center bg-white text-[11.5px] font-medium text-black" style={base}>{d}</span>
        ))}
        {/* decimal point sits on the panel background, not in a box */}
        <span className="flex w-[6px] items-end justify-center pb-[2px] text-[13px] font-bold text-black">·</span>
        <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={base}>0</span>
        <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={base}>0</span>
      </div>
    </div>
  );
}

// Ruled multi-line write-in area (e.g. box 21 description) — N stacked lines.
function Ruled({ n, label, lines = 3 }: { n?: React.ReactNode; label?: React.ReactNode; lines?: number }) {
  return (
    <div className="mb-2.5">
      {label != null && <Label n={n}>{label}</Label>}
      <div>
        {Array.from({ length: lines }).map((_, k) => (
          <div key={k} style={{ border: `1px solid ${CELL}`, borderTop: k === 0 ? `1px solid ${CELL}` : 'none', background: '#fff', height: 19 }} />
        ))}
      </div>
    </div>
  );
}

// A write-in text box drawn as N ruled lines (name/address boxes). The value sits
// on the first line; `watermark` shows a faint placeholder on the last line (e.g.
// 'Postcode').
function Line({ n, label, value, lines = 1, watermark }: { n?: React.ReactNode; label?: React.ReactNode; value?: string; lines?: number; watermark?: string }) {
  return (
    <div className="mb-2.5">
      {label != null && <Label n={n}>{label}</Label>}
      <div>
        {Array.from({ length: lines }).map((_, k) => (
          <div key={k} className="flex items-center overflow-hidden whitespace-pre px-1.5 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, borderTop: k === 0 ? `1px solid ${CELL}` : 'none', background: '#fff', height: 19 }}>
            {k === 0 && value ? value : (k === lines - 1 && watermark ? <span className="font-normal text-slate-300">{watermark}</span> : '')}
          </div>
        ))}
      </div>
    </div>
  );
}

// Individual character cells arranged in groups with gaps (dates, NINO, sort code,
// phone) — matches the HMRC combs where cells sit apart in DD·MM·YYYY / NINO groups.
function Cells({ n, label, groups, value = '', sep }: { n?: React.ReactNode; label?: React.ReactNode; groups: number[]; value?: string; sep?: string }) {
  const chars = (value || '').toUpperCase().replace(/\s/g, '').split('');
  let idx = 0;
  return (
    <div className="mb-2.5">
      {label != null && <Label n={n}>{label}</Label>}
      <div className="flex items-center" style={{ gap: sep ? 6 : 10 }}>
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-center gap-[3px]">
            {gi > 0 && sep && <span className="mr-1 text-[12px] font-bold text-black">{sep}</span>}
            {Array.from({ length: g }).map((_, k) => {
              const ch = chars[idx++] || '';
              return <span key={k} className="flex h-[18px] w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', boxShadow: CELL_SHADOW }}>{ch}</span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Normalise a stored date (dd-mm-yyyy or yyyy-mm-dd) to DDMMYYYY for the cells.
function toDDMMYYYY(d?: string): string {
  if (!d) return '';
  const p = d.split(/[-/.]/);
  if (p.length !== 3) return d.replace(/\D/g, '');
  return p[0].length === 4
    ? p[2].padStart(2, '0') + p[1].padStart(2, '0') + p[0]   // yyyy-mm-dd
    : p[0].padStart(2, '0') + p[1].padStart(2, '0') + (p[2].length === 2 ? '19' + p[2] : p[2]); // dd-mm-yyyy
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

// The official GOV.UK crown (Open Government Licence, from govuk-frontend) + the
// HM Revenue & Customs wordmark, matching the form's masthead.
function HmrcLogo() {
  const crown = (
    <svg width="21" height="18" viewBox="0 0 64 56" fill="#000" aria-hidden focusable="false">
      <g>
        <circle cx="20" cy="17.6" r="3.7" /><circle cx="10.2" cy="23.5" r="3.7" /><circle cx="3.7" cy="33.2" r="3.7" />
        <circle cx="31.7" cy="30.6" r="3.7" /><circle cx="43.3" cy="17.6" r="3.7" /><circle cx="53.2" cy="23.5" r="3.7" />
        <circle cx="59.7" cy="33.2" r="3.7" />
        <path d="M33.1,9.8c.2-.1.3-.3.5-.5l4.6,2.4v-6.8l-4.6,1.5c-.1-.2-.3-.3-.5-.5l1.9-5.9h-6.7l1.9,5.9c-.2.1-.3.3-.5.5l-4.6-1.5v6.8l4.6-2.4c.1.2.3.3.5.5l-2.6,8c-.9,2.8,1.2,5.7,4.1,5.7h0c3,0,5.1-2.9,4.1-5.7l-2.6-8ZM37,37.9s-3.4,3.8-4.1,6.1c2.2,0,4.2-.5,6.4-2.8l-.7,8.5c-2-2.8-4.4-4.1-5.7-3.8.1,3.1.5,6.7,5.8,7.2,3.7.3,6.7-1.5,7-3.8.4-2.6-2-4.3-3.7-1.6-1.4-4.5,2.4-6.1,4.9-3.2-1.9-4.5-1.8-7.7,2.4-10.9,3,4,2.6,7.3-1.2,11.1,2.4-1.3,6.2,0,4,4.6-1.2-2.8-3.7-2.2-4.2.2-.3,1.7.7,3.7,3,4.2,1.9.3,4.7-.9,7-5.9-1.3,0-2.4.7-3.9,1.7l2.4-8c.6,2.3,1.4,3.7,2.2,4.5.6-1.6.5-2.8,0-5.3l5,1.8c-2.6,3.6-5.2,8.7-7.3,17.5-7.4-1.1-15.7-1.7-24.5-1.7h0c-8.8,0-17.1.6-24.5,1.7-2.1-8.9-4.7-13.9-7.3-17.5l5-1.8c-.5,2.5-.6,3.7,0,5.3.8-.8,1.6-2.3,2.2-4.5l2.4,8c-1.5-1-2.6-1.7-3.9-1.7,2.3,5,5.2,6.2,7,5.9,2.3-.4,3.3-2.4,3-4.2-.5-2.4-3-3.1-4.2-.2-2.2-4.6,1.6-6,4-4.6-3.7-3.7-4.2-7.1-1.2-11.1,4.2,3.2,4.3,6.4,2.4,10.9,2.5-2.8,6.3-1.3,4.9,3.2-1.8-2.7-4.1-1-3.7,1.6.3,2.3,3.3,4.1,7,3.8,5.4-.5,5.7-4.2,5.8-7.2-1.3-.2-3.7,1-5.7,3.8l-.7-8.5c2.2,2.3,4.2,2.7,6.4,2.8-.7-2.3-4.1-6.1-4.1-6.1h10.6,0Z" />
      </g>
    </svg>
  );
  return (
    <div className="flex items-stretch gap-2">
      <div className="w-[2.5px] shrink-0 self-stretch bg-black" />
      <div className="flex flex-col items-start gap-1">
        <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full" style={{ border: '1.25px solid #000' }}>{crown}</span>
        <span className="text-[16px] font-semibold leading-[1.05] text-black" style={{ letterSpacing: '-0.2px' }}>HM Revenue<br />&amp; Customs</span>
      </div>
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
  // HMRC "12/25" print date only on the first page (TR 1); no footer rule.
  const isFirst = tag.trim().split(/\s+/).pop() === '1';
  return (
    <div data-sa-code="SA100" data-sa-page={tag} className="sa-sheet relative mx-auto mb-6 flex h-[297mm] w-[210mm] max-w-full flex-col overflow-hidden bg-white px-[13mm] py-[7mm] shadow-sm" style={{ border: `1px solid ${PANEL_BORDER}`, fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <div className="min-h-0 flex-1">{children}</div>
      <div className="mt-1 grid grid-cols-3 items-center text-[11px] font-bold text-black">
        <span style={{ letterSpacing: '0.18em' }}>SA100 2026</span>
        <span className="text-center" style={{ letterSpacing: '0.18em' }}>Page {tag}</span>
        <span className="text-right font-normal text-slate-400" style={{ letterSpacing: '0.12em' }}>{isFirst ? 'HMRC 12/25' : ''}</span>
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
  // Many boxes are itemised in the editor (an items array) — the box value is the
  // sum of those entries; scalar-only boxes just read their field.
  const sum = (items?: { amount?: number }[]) => (items ?? []).reduce((a, x) => a + (x.amount || 0), 0);
  const taxedInterest = (i.taxedInterestItems ?? []).reduce((a, t) => a + (t.net || 0), 0);
  const tp = ret.taxpayer;
  const changed = !!tp?.changedInYear;
  // The return's date is the day after the tax year ends (6 April of the second
  // year), and the reference shown is the firm's client reference.
  const endYear = 2000 + (parseInt(ret.taxYear.slice(-2), 10) || 26);
  const filingDate = `6 April ${endYear}`;
  // The SA100 Marriage Allowance section is completed only by the person
  // transferring their allowance OUT to their spouse; if they're receiving it
  // (IN), this section is left blank (their spouse fills it on their own return).
  const marriageOut = i.marriageAllowance === 'transferred';

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
              <div className="flex gap-3 pt-1"><span className="w-32 shrink-0">Date</span><span className="font-semibold">{filingDate}</span></div>
            </div>
            <p className="pt-3">HM Revenue and Customs office address</p>
            <BracketBox className="mt-1 h-20"><span /></BracketBox>
            <p className="pt-2">Telephone</p>
          </div>
          <div className="flex flex-col">
            <p className="mb-1">Issue address</p>
            <BracketBox className="min-h-[7rem]">
              <div className="whitespace-pre-line text-[11px] font-medium leading-relaxed text-black">{ret.clientName || ''}{ret.taxpayer?.address ? `\n\n${ret.taxpayer.address}` : ''}</div>
            </BracketBox>
            {/* Pushed to the bottom of the masthead so it sits on the "Your tax
                return" rule, and shows the firm's client reference. */}
            <div className="mt-auto pt-2"><p>For</p><p>Reference <span className="font-semibold">{ret.clientRef || ''}</span></p></div>
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
              <Cells n={1} label="Your date of birth — it helps get your tax right — DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(ret.taxpayer?.dateOfBirth)} />
              <div className="mb-2.5">
                <Label n={2}>Your name and address — if it is different from what is on the front of this form, please write the correct details underneath the wrong ones and put the date you changed address below — DD MM YYYY</Label>
                {changed && (tp?.changeTo || tp?.changeFrom) && (
                  <div className="mb-1 whitespace-pre-line px-1.5 py-1 text-[10px] font-medium leading-tight text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', minHeight: 34 }}>
                    {tp?.changeTo || ''}{tp?.changeFrom ? <span className="block text-[8.5px] text-slate-500">(previously: {tp.changeFrom.replace(/\n/g, ', ')})</span> : null}
                  </div>
                )}
                <Cells groups={[2, 2, 4]} value={changed ? toDDMMYYYY(tp?.changeDate) : ''} />
              </div>
            </div>
            <div>
              <Cells n={3} label="Your phone number" groups={[15]} value="" />
              <Cells n={4} label="Your National Insurance number — leave blank if the correct number is shown above" groups={[2, 2, 2, 2, 1]} value={ret.taxpayer?.nino} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR2 — what makes up your tax return ── */}
      <Page tag="TR 2">
        <Teal>What makes up your tax return</Teal>
        <p className="mb-3 text-[9.5px] leading-snug text-black">To make a complete return of your taxable income and gains for the year to 5 April 2026 you may need to complete some separate supplementary pages. Answer the following questions by putting ‘X’ in the ‘Yes’ or ‘No’ box.</p>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Question n={1} k="employment" title="Employment" yes={has.employment} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8 items-center justify-center text-[11px]" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{has.employment ? i.employment.length : ''}</span></span>}>Were you an employee, director, office holder or agency worker in the year to 5 April 2026? Please read the notes before answering. Fill in a separate ‘Employment’ page for each employment, directorship and so on. On each ‘Employment’ page you complete, enter any other payments, expenses or benefits related to that employment. Say how many ‘Employment’ pages you are completing in the ‘Number’ box below.</Question>
              <Question n={2} k="selfemp" title="Self-employment" yes={has.selfemp} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8" style={{ border: `1px solid ${CELL}`, background: '#fff' }} /></span>}>If you worked for yourself (on your ‘own account’ or in self-employment) in the year to 5 April 2026, read the notes to decide if you need to fill in the ‘Self-employment’ pages. You may not need to if this income is up to £1,000. Do you need to fill in the ‘Self-employment’ pages? Fill in a separate ‘Self-employment’ page for each business. On each ‘Self-employment’ page you complete, enter any payments or expenses related to that business. Say how many businesses you had in the ‘Number’ box below. (Answer ‘Yes’ if you were a ‘Name’ at Lloyd’s.)</Question>
              <Question n={3} k="partnership" title="Partnership" yes={has.partnership} extra={<span className="flex items-center gap-2 text-[11px]">Number <span className="flex h-4 w-8" style={{ border: `1px solid ${CELL}`, background: '#fff' }} /></span>}>Were you in a partnership? Fill in a separate ‘Partnership’ page for each partnership you were a partner in and say how many partnerships you had in the ‘Number’ box below.</Question>
              <Question n={4} k="property" title="UK property" yes={has.property}>If you received income from UK property (including rents and other income from land you own or lease out), read the notes to decide if you need to fill in the ‘UK property’ pages. You may not need to if this income is up to £1,000. Do you need to fill in the ‘UK property’ pages?</Question>
              <Question n={5} k="foreign" title="Foreign" yes={has.foreign}>If you: were entitled to any foreign income; have, or could have, received (directly or indirectly) income, or a capital payment or benefit from a person abroad as a result of any transfer of assets; or want to claim relief for foreign tax paid — read the notes to decide if you need to fill in the ‘Foreign’ pages. You may not need to if your only foreign income was from land and property abroad up to £1,000. Do you need to fill in the ‘Foreign’ pages?</Question>
              <Question n={6} k="trusts" title="Trusts etc" yes={has.trusts}>Did you receive, or are you treated as having received, income from a trust, settlement or the residue of a deceased person’s estate? This does not include cash lump sums/transfer of assets, otherwise known as capital distributions, received under a will.</Question>
            </div>
            <div>
              <Question n={7} k="cgt" title="Capital Gains Tax summary" yes={has.cgt} extra={<span className="flex items-center gap-2 text-[10px]">Computations provided <Tick /></span>}>If you sold or disposed of any assets (for example, stocks, shares, land and property, a business), or had any chargeable gains, read the notes to decide if you have to fill in the ‘Capital Gains Tax summary’ page. If you do, you must also provide separate computations. Do you need to fill in the ‘Capital Gains Tax summary’ page and provide computations?</Question>
              <Question n={8} k="residence" title="Residence and foreign income and gains (FIG) regime etc" yes={has.residence}>If you answer yes to one or more of the following questions, you need to complete the ‘Residence and foreign income and gains (FIG) regime etc’ pages. Were you, for all or part of the year to 5 April 2026, not resident in the UK or dual resident in the UK and another country? Are you making a claim under the foreign income and gains regime, electing to make a designation under the temporary repatriation facility or making an election and/or claim for relief under the Overseas Workday Relief regime? Are you making a claim for Business Investment Relief or has a previous investment ceased to qualify for Business Investment Relief? Have you, in the year to 5 April 2026, remitted any nominated income or gains? Do you need to fill in a ‘Residence and foreign income and gains (FIG) regime etc’ page?</Question>
              <Question n={9} k="additional" title="Additional information" yes={has.additional}>Some less common kinds of income and tax reliefs, for example, Married Couple’s Allowance, Life insurance gains, chargeable event gains, Seafarer’s Earnings Deduction and details of disclosed tax avoidance schemes, should be returned on the ‘Additional information’ pages. Do you need to fill in the ‘Additional information’ pages?</Question>
              <div className="mt-1">
                <p className="mb-1 text-[12.5px] font-bold" style={{ color: TEAL }}>If you need more pages</p>
                <p className="mb-1.5 text-[9.5px] leading-snug text-black">If you answered ‘Yes’ to any of questions 1 to 9, please check to see if within this return, there’s a page dealing with that kind of income or gain. If there’s not, you’ll need separate supplementary pages. Do you need to get and fill in separate supplementary pages?</p>
                {/* Yes when the return encloses any supplementary page (matches box 21 on TR8), No when it's a main-form-only return. */}
                <YesNo yes={Object.values(has).some(Boolean)} />
                <p className="mt-1.5 text-[9.5px] leading-snug text-black">If ‘Yes’, go to www.gov.uk/taxreturnforms to download them.</p>
              </div>
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR3 — income ── */}
      <Page tag="TR 3">
        <Teal>Income</Teal>
        <SubHead>Dividends and interest from UK banks and building societies</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Taxed UK interest — the net amount after tax has been taken off — read the notes" value={taxedInterest} />
              <Money n={2} label="Untaxed UK interest — amounts which have not had tax taken off — read the notes" value={savingsInterestTotal(i)} />
              <Money n={3} label="Untaxed foreign interest (up to £2,000) — amounts which have not had tax taken off — read the notes" value={i.untaxedForeignInterest} cells={6} />
              <Money n={4} label="Dividends from UK companies — the amount received — read the notes" value={dividendsTotal(i)} />
            </div>
            <div>
              <Money n={5} label="Other dividends — the amount received — read the notes" value={i.otherDividends} />
              <Money n={6} label="Foreign dividends (up to £500) — the amount in sterling after foreign tax was taken off. Do not include this amount in the ‘Foreign’ pages" value={i.foreignDividendsMain} cells={6} />
              <Money n={7} label="Tax taken off foreign dividends — the sterling equivalent" value={i.foreignDividendsTax} cells={6} />
            </div>
          </div>
        </Panel>
        <SubHead>UK pensions, annuities and other state benefits received</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={8} label="State Pension — amount you were entitled to receive in the year, not the weekly or 4-weekly amount — read the notes" value={i.statePension} cells={6} />
              <Money n={9} label="State Pension lump sum — the gross amount of any lump sum — read the notes" value={sum(i.statePensionLumpSumItems)} cells={6} />
              <Money n={10} label="Tax taken off box 9" value={sum(i.statePensionLumpSumTaxItems)} cells={6} />
              <Money n={11} label="Pensions (other than State Pension), retirement annuities and taxable lump sums treated as pensions — the gross amount. Tax taken off goes in box 12" value={i.pensionsIncome} />
            </div>
            <div>
              <Money n={12} label="Tax taken off box 11" value={sum(i.pensionsIncomeTaxItems)} minus />
              <Money n={13} label="Taxable Incapacity Benefit and contribution-based Employment and Support Allowance — read the notes" value={i.incapacityBenefit} cells={6} />
              <Money n={14} label="Tax taken off Incapacity Benefit in box 13" value={i.incapacityBenefitTax} cells={6} />
              <Money n={15} label="Jobseeker’s Allowance" value={i.jobseekersAllowance} cells={6} />
              <Money n={16} label="Total of any other taxable State Pensions and benefits" value={i.otherPensionsBenefits} cells={6} />
            </div>
          </div>
        </Panel>
        <SubHead>Other UK income not included on supplementary pages</SubHead>
        <Note>Do not use this section for income that should be returned on supplementary pages. Share schemes, gilts, stock dividends, life insurance gains and certain other kinds of income go on the ‘Additional information’ pages.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={17} label="Other taxable income — before expenses and tax taken off" value={i.otherIncome} />
              <Money n={18} label="Total amount of allowable expenses — read the notes" value={sum(i.otherIncomeExpensesItems)} />
              <Money n={19} label="Any tax taken off box 17" value={sum(i.otherIncomeTaxItems)} />
            </div>
            <div>
              <Money n={20} label="Benefit from pre-owned assets — read the notes" value={sum(i.preOwnedAssetsItems)} />
              <Line n={21} label="Description of income in boxes 17 and 20 — if there’s not enough space here please give details in the ‘Any other information’ box, box 19, on page TR 7" value={i.otherIncomeDescription} lines={3} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR4 — tax reliefs ── */}
      <Page tag="TR 4">
        <Teal>Tax reliefs</Teal>
        <SubHead>Paying into registered pension schemes and overseas pension schemes</SubHead>
        <Note>Do not include payments to your employer’s pension scheme deducted from your pay before tax, or payments made by your employer.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Payments to registered pension schemes where basic rate tax relief will be claimed by your pension provider (‘relief at source’). Enter the payments and basic rate tax" value={i.pensionContributions} />
              <Money n="1.1" label="Total of any ‘one-off’ payments in box 1" value={i.pensionOneOff} />
              <Money n={2} label="Payments to a retirement annuity contract where basic rate tax relief will not be claimed by your provider" value={sum(i.pensionRetirementAnnuityItems)} />
            </div>
            <div>
              <Money n={3} label="Payments to your employer’s scheme which were not deducted from your pay before tax — this will be unusual" value={sum(i.pensionEmployerSchemeItems)} />
              <Money n={4} label="Payments to an overseas pension scheme, not UK-registered, eligible for tax relief and not deducted from your pay before tax" value={sum(i.pensionOverseasItems)} />
            </div>
          </div>
        </Panel>
        <SubHead>Charitable giving</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={5} label="Gift Aid payments made in the year to 5 April 2026" value={i.giftAid} />
              <Money n={6} label="Total of any ‘one-off’ payments in box 5" value={sum(i.giftAidOneOffItems)} />
              <Money n={7} label="Gift Aid payments made in the year to 5 April 2026 but treated as if made in the year to 5 April 2025" value={sum(i.giftAidCarryBackItems)} />
            </div>
            <div>
              <Money n={8} label="Gift Aid payments made after 5 April 2026 but to be treated as if made in the year to 5 April 2026" value={sum(i.giftAidFutureItems)} />
              <Money n={9} label="Value of qualifying shares or securities gifted to charity" value={sum(i.giftAidSharesItems)} />
              <Money n={10} label="Value of qualifying land and buildings gifted to charity" value={sum(i.giftAidLandItems)} />
              <div className="mt-1 flex justify-center py-1 text-[10px] font-bold" style={{ color: TEAL, border: `1px solid ${CELL}` }}>Boxes 11 and 12 are not in use</div>
            </div>
          </div>
        </Panel>
        <SubHead>Blind Person’s Allowance</SubHead>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <div className="mb-2"><Label n={13}>If you’re registered blind, or severely sight impaired, and your name is on a local authority or other register, put ‘X’ in the box</Label><Tick on={!!i.registeredBlind} /></div>
              <div className="mt-3"><Line n={14} label="Enter the name of the local authority or other register" value={i.blindAuthority} lines={2} /></div>
            </div>
            <div>
              <div className="mb-2"><Label n={15}>If you want your spouse’s, or civil partner’s, surplus allowance, put ‘X’ in the box</Label><Tick on={!!i.blindSpouseSurplusClaim} /></div>
              <div className="mt-3"><Label n={16}>If you want your spouse, or civil partner, to have your surplus allowance, put ‘X’ in the box</Label><Tick on={!!i.blindSpouseSurplusSurrender} /></div>
            </div>
          </div>
        </Panel>
        <p className="text-[10px] text-black"><InfoDot /> Other less common reliefs are on the ‘Additional information’ pages.</p>
      </Page>

      {/* ── TR5 — student loan / HICBC / WFP / Marriage Allowance ── */}
      <Page tag="TR 5">
        <Teal>Student Loan and Postgraduate Loan repayments</Teal>
        <Note>Please read the notes before filling in boxes 1 to 3.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={1}>If you’ve received notification from the Student Loans Company that your repayment of an Income Contingent Loan was due before 6 April 2026, put ‘X’ in the box. We’ll use your plan and or loan type to calculate amounts due</Label><Tick on={!!i.studentLoanPlan} /></div>
            <div>
              <Money n={2} label="If your employer has deducted Student Loan repayments enter the amount deducted" value={i.studentLoanDeducted} />
              <Money n={3} label="If your employer has deducted Postgraduate Loan repayments enter the amount deducted" value={i.postgradLoanDeducted} />
            </div>
          </div>
        </Panel>
        <Teal>High Income Child Benefit Charge</Teal>
        <Bullets intro="Please read the notes before filling in this section. Only fill in this section if all of the following apply:" items={[
          'your income was over £60,000',
          'you or your partner (if you have one) got Child Benefit (this also applies if someone else claims Child Benefit for a child who lives with you and pays you or your partner for the child’s upkeep)',
          'couples only – your income was higher than your partner’s',
        ]} />
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Money n={1} label="Enter the total amount of Child Benefit you and your partner got for the year to 5 April 2026" value={i.childBenefit} cells={5} />
              <Cells n={2} label="Enter the number of children you and your partner got Child Benefit for on 5 April 2026" groups={[2]} value={i.childBenefitChildren ? String(i.childBenefitChildren) : ''} />
            </div>
            <div><Cells n={3} label="Enter the date that you and your partner stopped getting all Child Benefit payments if this was before 6 April 2026 — DD MM YYYY" groups={[2, 2, 4]} value={toDDMMYYYY(i.childBenefitStopDate)} /></div>
          </div>
        </Panel>
        <Teal>Winter Fuel Payment (WFP) and Pension Age Winter Heating Payment (PAWHP) charge</Teal>
        <Bullets intro="Please read the notes before filling in this section. Only fill in this section if all of the following apply:" items={[
          'you are over State Pension age',
          'your total income for the year was over £35,000',
          'you are not in receipt of a qualifying benefit – read the notes',
        ]} />
        <Panel>
          <Money n={1} label="Enter the total amount of WFP or PAWHP you got for the tax year to 5 April 2026 – read the notes" value={i.winterFuelPayment} cells={5} />
        </Panel>
        <Teal>Marriage Allowance</Teal>
        <Bullets intro="Please read the notes. If your income for the year ended 5 April 2026 was less than £12,570 you can transfer £1,260 of your Personal Allowance to your spouse or civil partner to reduce the amount of tax they pay if all of the following apply:" items={[
          'you were married to, or in a civil partnership with, the same person for all or part of the tax year',
          'you were both born on or after 6 April 1935',
          'your spouse or civil partner’s income was not taxed at the higher rate',
        ]} after={<p className="mb-2 text-[9.5px] font-bold text-black">Fill in this section if you want to make the transfer.</p>} />
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={1} label="Your spouse or civil partner’s first name" value={marriageOut ? i.spouseFirstName : ''} />
              <Line n={2} label="Your spouse or civil partner’s last name" value={marriageOut ? i.spouseLastName : ''} />
              <Cells n={3} label="Your spouse or civil partner’s National Insurance number" groups={[2, 2, 2, 2, 1]} value={marriageOut ? i.spouseNino : ''} />
            </div>
            <div>
              <Cells n={4} label="Your spouse or civil partner’s date of birth — DD MM YYYY" groups={[2, 2, 4]} value={marriageOut ? toDDMMYYYY(i.spouseDob) : ''} />
              <Cells n={5} label="Date of marriage or civil partnership — DD MM YYYY" groups={[2, 2, 4]} value={marriageOut ? toDDMMYYYY(i.marriageDate) : ''} />
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR6 — finishing ── */}
      <Page tag="TR 6">
        <Teal>Finishing your tax return</Teal>
        <div className="mb-2 text-[10px] leading-snug text-black">
          <p><InfoDot /> Calculating your tax — if we receive this paper tax return by 31 October 2026 or if you file online, we’ll do the calculation for you and tell you how much you have to pay (or what your repayment will be) before 31 January 2027. We’ll add the amount due to your Self Assessment Statement, together with any other amounts due.</p>
          <p className="mt-1.5">Do not enter payments on account, or other payments you’ve made towards the amounts due, on your tax return. We’ll deduct these on your Self Assessment Statement. If you want to calculate your tax, ask us for the ‘Tax calculation summary’ pages and notes. The notes will help you work out any tax due, or repayable, and if payments on account are necessary.</p>
        </div>
        <SubHead>Tax refunded or set off</SubHead>
        <Panel><Money n={1} label="If you’ve had any 2025–26 Income Tax refunded or set off by us or Jobcentre Plus, enter the amount - read the notes" value={i.taxRefundedOrSetOff} /></Panel>
        {/* Plain heading (not a section boundary): its boxes 2/3 live under the
            editor's 'Tax refunded or set off' sub, so they inherit that section. */}
        <p className="mb-2 mt-3 text-[14px] font-normal text-black">If you have not paid enough tax</p>
        <Note>We recommend you pay any tax due electronically. Read the notes.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div><Label n={2}>If you owe less than £3,000 for the 2025–26 tax year (excluding Class 2 NICs) and you send us your paper tax return by 31 October, or 30 December 2026 if you file online, we’ll try to collect the tax through your wages or pension by adjusting your 2027–28 tax code. If you do not want us to do this, put ‘X’ in the box - read the notes</Label><Tick on={!!i.noPayeCollectCurrentYear} /></div>
            <div><Label n={3}>If you owe tax on savings, casual earnings and/or the High Income Child Benefit Charge for the 2026–27 tax year, we’ll try to collect it through your wages or pension by adjusting your 2026–27 tax code. If you do not want us to do this, put ‘X’ in the box - read the notes</Label><Tick on={!!i.noPayeCollectNextYear} /></div>
          </div>
        </Panel>
        <SubHead>If you have paid too much tax</SubHead>
        <Note>To claim a repayment, fill in boxes 4 to 14 below. If you paid your tax by credit or debit card, we’ll always try to repay back to your card first before making any repayment as requested by you below. Please allow up to 4 weeks for any repayment to reach you before contacting us.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <Line n={4} label="Name of bank or building society" value={i.repayBankName} />
              <Line n={5} label="Name of account holder (or nominee)" value={i.repayAccountHolder} />
              <Cells n={6} label="Branch sort code" value={i.repaySortCode} groups={[2, 2, 2]} sep="–" />
              <Cells n={7} label="Account number" value={i.repayAccountNumber} groups={[8]} />
              <Cells n={8} label="Building society reference number" value={i.repayBuildingSocRef} groups={[15]} />
              <div className="mt-1"><Label n={9}>If you or your nominee do not have a UK bank or building society account, put ‘X’ in the box</Label><Tick on={!!i.repayNoUkAccount} /></div>
            </div>
            <div>
              <div className="mb-2"><Label n={10}>If you’ve entered a nominee’s name in box 5, put ‘X’ in the box</Label><Tick on={!!i.repayNomineeNameEntered} /></div>
              <div className="mb-2"><Label n={11}>If your nominee is your tax adviser, put ‘X’ in the box</Label><Tick on={!!i.repayNomineeIsAdviser} /></div>
              <Line n={12} label="Nominee’s address" value={i.repayNomineeAddress} lines={2} />
              <Cells n={13} label="and postcode" value={i.repayNomineePostcode} groups={[8]} />
              <div className="mb-2.5">
                <Label n={14}>To authorise your nominee to receive any repayment, you must sign in the box. A photocopy of your signature will not do</Label>
                <div style={{ border: `1px solid ${CELL}`, background: '#fff', height: 40 }} />
              </div>
            </div>
          </div>
        </Panel>
      </Page>

      {/* ── TR7 — adviser + any other information ── */}
      <Page tag="TR 7">
        <div className="flex h-full flex-col">
          <SubHead>Your tax adviser, if you have one</SubHead>
          <Note>This section is optional. Please read the notes about authorising your tax adviser.</Note>
          <Panel divided>
            <div className="grid grid-cols-2 gap-x-10">
              <div>
                <Line n={15} label="Your tax adviser’s name" value={i.adviserName} lines={2} />
                <Cells n={16} label="Their phone number" value={i.adviserPhone} groups={[14]} />
              </div>
              <div>
                <Line n={17} label="The first line of their address including the postcode" value={i.adviserAddress} lines={3} watermark="Postcode" />
                <Cells n={18} label="The reference your adviser uses for you" value={i.adviserReference} groups={[16]} />
              </div>
            </div>
          </Panel>
          <p className="mb-1 text-[14px] text-black">Any other information</p>
          <Panel className="flex flex-1 flex-col">
            <Label n={19}>Please give any other information in this space</Label>
            <div className="flex-1 whitespace-pre-wrap px-1.5 py-1 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{i.adviserOtherInfo}</div>
          </Panel>
        </div>
      </Page>

      {/* ── TR8 — signing ── */}
      <Page tag="TR 8">
        <SubHead>Signing your form and sending it back</SubHead>
        <Note>Please fill in this section and sign and date the declaration at box 22.</Note>
        <Panel divided>
          <div className="grid grid-cols-2 gap-x-10">
            <div>
              <div className="mb-3"><Label n={20}>If this tax return contains provisional figures, put ‘X’ in the box – in the ‘Any other information’ box on page TR7, tell us why you have used provisional amounts and when you expect to give us your final figures</Label><Tick on={!!i.provisionalFigures} /></div>
              <div className="mb-3"><Label n={21}>If you’re enclosing separate supplementary pages, put ‘X’ in the box</Label><Tick on={Object.values(has).some(Boolean)} /></div>
              <Label n={22}>Declaration</Label>
              <p className="mb-1 text-[10px] leading-snug text-black">I declare that the information I’ve given on this tax return and any supplementary pages is correct and complete to the best of my knowledge and belief.</p>
              <p className="mb-2 text-[10px] leading-snug text-black">I understand that I may have to pay financial penalties and face prosecution if I give false information.</p>
              <p className="mb-1 text-[10.5px] font-bold text-black">Signature</p>
              <div className="mb-2.5" style={{ border: `1px solid ${RED}`, background: '#fff', height: 46 }} />
              <Cells label={<span className="font-bold">Date DD MM YYYY</span>} groups={[2, 2, 4]} value={toDDMMYYYY(i.dateSigned)} />
            </div>
            <div>
              <Line n={23} label="If you’ve signed on behalf of someone else, enter the capacity. For example, executor, receiver" value={i.signingCapacity} lines={2} />
              <Line n={24} label="Enter the name of the person you’ve signed for" value={i.signedForPersonName} lines={2} />
              <Line n={25} label="If you filled in boxes 23 and 24 enter your name" value={i.signatoryName} lines={2} />
              <Line n={26} label="and your address" value={i.signatoryAddress} lines={3} watermark="Postcode" />
            </div>
          </div>
        </Panel>
      </Page>
    </>
  );
}
