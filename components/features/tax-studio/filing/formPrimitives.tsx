// Shared HMRC-form facsimile primitives used by the SA100 main form and the
// supplementary-page facsimiles (SA102, SA103F, …). The only thing that varies
// per form is the field-panel colour (teal / pink / cream) — supplied via
// FormThemeContext; everything else (teal headings, teal cells, £ boxes, tick
// boxes, ruled lines) is constant. HMRC's functional layout (Open Government
// Licence), rendered to hold this client's figures like commercial tax software.

'use client';

import type React from 'react';
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

export const TEAL = '#00928f';
export const CELL = '#a9d3d0';
export const MONEY_TINT = '#d4e9e6';
export const CELL_SHADOW = '0 1px 1.5px rgba(0,0,0,0.13)';
export const RED = '#d4351c';

export interface FormTheme { panelBg: string; panelBorder: string; dense?: boolean }
export const TEAL_THEME: FormTheme = { panelBg: '#eaf4f3', panelBorder: '#bcdedb' };
export const PINK_THEME: FormTheme = { panelBg: '#fbe4ea', panelBorder: '#eec2ce' };
export const CREAM_THEME: FormTheme = { panelBg: '#faf3e6', panelBorder: '#e6dcc4' };
export const PEACH_THEME: FormTheme = { panelBg: '#fce9e2', panelBorder: '#f0d3c6' };
export const FormThemeContext = createContext<FormTheme>(TEAL_THEME);
const useTheme = () => useContext(FormThemeContext);
const useDense = () => useContext(FormThemeContext).dense;

// Which source record (employer / trade / partnership id) the pages under this
// provider belong to. Stamped onto each sheet as data-sa-record so the filing
// preview can scope a click-to-edit to the matching editor card when a return
// has several records of the same form (otherwise the first one always wins).
export const RecordContext = createContext<string | null>(null);
const useRecord = () => useContext(RecordContext);

export function Teal({ children }: { children: React.ReactNode }) {
  return <h3 className={`border-b-2 pb-1 text-[15px] font-bold ${useDense() ? 'mb-1.5' : 'mb-2'}`} style={{ color: TEAL, borderColor: TEAL }}>{children}</h3>;
}
export function SubHead({ children }: { children: React.ReactNode }) {
  return <p data-sa-subhead className={`font-normal text-black ${useDense() ? 'mb-1 mt-1.5 text-[13.5px]' : 'mb-1 mt-2 text-[14px]'}`}>{children}</p>;
}
export function Note({ children }: { children: React.ReactNode }) {
  return <p className={`text-[10px] leading-snug text-black ${useDense() ? 'mb-1.5' : 'mb-2'}`}>{children}</p>;
}
export function Bullets({ intro, items, after }: { intro: string; items: string[]; after?: React.ReactNode }) {
  return (
    <div className="mb-2 text-[9.5px] leading-snug text-black">
      <p>{intro}</p>
      {items.map((it, k) => <p key={k} className="pl-3 -indent-2">• {it}</p>)}
      {after}
    </div>
  );
}
export function InfoDot() {
  return <span className="mr-1 inline-flex h-[15px] w-[15px] shrink-0 translate-y-[2px] items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: TEAL, fontFamily: 'Georgia, "Times New Roman", serif' }}>i</span>;
}
export function Panel({ children, className = '', divided }: { children: React.ReactNode; className?: string; divided?: boolean }) {
  const t = useTheme();
  return (
    <div className={`relative ${t.dense ? 'mb-2.5 p-2.5' : 'mb-3 p-3'} ${className}`} style={{ background: t.panelBg, border: `1px solid ${t.panelBorder}` }}>
      {divided && <div className="absolute bottom-2 top-2 w-px" style={{ left: '50%', background: t.panelBorder }} />}
      {children}
    </div>
  );
}
export function BoxNum({ n }: { n: React.ReactNode }) {
  // min-w keeps single-digit boxes at the standard size; long codes (e.g. 52EG.1)
  // grow the box instead of overflowing it.
  return <span data-boxnum={n != null ? String(n) : undefined} className="flex h-[15px] min-w-[19px] shrink-0 items-center justify-center whitespace-nowrap px-[2px] text-[9.5px] font-bold text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{n}</span>;
}
export function Label({ n, children, ghost }: { n?: React.ReactNode; children: React.ReactNode; ghost?: boolean }) {
  return (
    <div className="mb-1 flex items-start text-[10.5px] font-bold leading-tight text-black">
      {/* The chip is pulled to the panel's left edge (-ml-3); the label text is a
          flex sibling so it always clears the chip, however wide the code is. */}
      {n != null && <span className="-ml-3 mr-1 mt-[1px] shrink-0"><BoxNum n={n} /></span>}
      {/* `ghost` keeps the label text in the layout (so a box lines up with its
          twin in another column) but hides it — used for the SA103F disallowable
          column, which shows only box numbers against the allowable labels. */}
      <span className={`min-w-0 flex-1${ghost ? ' invisible' : ''}`} aria-hidden={ghost || undefined}>{children}</span>
    </div>
  );
}
export function Money({ n, label, value, cells = 8, minus, ghost }: { n?: React.ReactNode; label?: React.ReactNode; value?: number | null; cells?: number; minus?: boolean; ghost?: boolean }) {
  const neg = (value || 0) < 0;
  const digits = value ? Math.round(Math.abs(value)).toString() : '';
  const arr: string[] = Array(cells).fill('');
  for (let k = 0; k < digits.length && k < cells; k++) arr[cells - 1 - k] = digits[digits.length - 1 - k];
  const base: React.CSSProperties = { border: `1px solid ${CELL}`, boxShadow: CELL_SHADOW };
  const dense = useDense();
  return (
    <div className={dense ? 'mb-2.5' : 'mb-4'}>
      {(n != null || label != null) && <Label n={n} ghost={ghost}>{label}</Label>}
      <div className="fac-boxrow flex items-stretch gap-[3px]" style={{ height: 20 }}>
        <span className="flex w-[15px] items-center justify-center text-[12px] text-slate-500" style={base}><span className="fac-boxval">£</span></span>
        {/* HMRC "sign" box: a pre-printed white bar by default; a hand-entered
            style minus only when the figure is actually negative. */}
        {minus && (
          <span className="flex w-[14px] items-center justify-center" style={{ ...base, background: MONEY_TINT }}>
            {neg ? <span className="text-[12px] font-bold text-black">−</span> : <span className="block" style={{ width: 9, height: 3, background: '#fff' }} />}
          </span>
        )}
        {arr.map((d, idx) => (
          <span key={idx} className="flex w-[15px] items-center justify-center bg-white text-[11.5px] font-medium text-black" style={base}><span className="fac-boxval">{d}</span></span>
        ))}
        <span className="flex w-[6px] items-end justify-center pb-[2px] text-[13px] font-bold text-black">·</span>
        <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={base}><span className="fac-boxval">0</span></span>
        <span className="flex w-[14px] items-center justify-center text-[11px] text-slate-400" style={base}><span className="fac-boxval">0</span></span>
      </div>
    </div>
  );
}
export function Ruled({ n, label, lines = 3 }: { n?: React.ReactNode; label?: React.ReactNode; lines?: number }) {
  return (
    <div className={useDense() ? 'mb-2' : 'mb-2.5'}>
      {label != null && <Label n={n}>{label}</Label>}
      <div>
        {Array.from({ length: lines }).map((_, k) => (
          <div key={k} style={{ border: `1px solid ${CELL}`, borderTop: k === 0 ? `1px solid ${CELL}` : 'none', background: '#fff', height: 19 }} />
        ))}
      </div>
    </div>
  );
}
export function Line({ n, label, value, lines = 1, watermark }: { n?: React.ReactNode; label?: React.ReactNode; value?: string; lines?: number; watermark?: string }) {
  return (
    <div className={useDense() ? 'mb-2' : 'mb-2.5'}>
      {label != null && <Label n={n}>{label}</Label>}
      <div>
        {Array.from({ length: lines }).map((_, k) => (
          <div key={k} className="fac-boxrow flex items-center overflow-hidden whitespace-pre px-1.5 text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, borderTop: k === 0 ? `1px solid ${CELL}` : 'none', background: '#fff', height: 19 }}>
            {k === 0 && value ? <span className="fac-boxval">{value}</span> : (k === lines - 1 && watermark ? <span className="font-normal text-slate-300">{watermark}</span> : '')}
          </div>
        ))}
      </div>
    </div>
  );
}
export function Cells({ n, label, groups, value = '', sep }: { n?: React.ReactNode; label?: React.ReactNode; groups: number[]; value?: string; sep?: string }) {
  const chars = (value || '').toUpperCase().replace(/\s/g, '').split('');
  let idx = 0;
  return (
    <div className={useDense() ? 'mb-2' : 'mb-2.5'}>
      {label != null && <Label n={n}>{label}</Label>}
      <div className="fac-boxrow flex items-center" style={{ gap: sep ? 6 : 10 }}>
        {groups.map((g, gi) => (
          <div key={gi} className="flex items-center gap-[3px]">
            {gi > 0 && sep && <span className="mr-1 text-[12px] font-bold text-black">{sep}</span>}
            {Array.from({ length: g }).map((_, k) => {
              const ch = chars[idx++] || '';
              return <span key={k} className="flex h-[18px] w-[16px] items-center justify-center text-[11px] font-medium text-black" style={{ border: `1px solid ${CELL}`, background: '#fff', boxShadow: CELL_SHADOW }}><span className="fac-boxval">{ch}</span></span>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
export function toDDMMYYYY(d?: string): string {
  if (!d) return '';
  const p = d.split(/[-/.]/);
  if (p.length !== 3) return d.replace(/\D/g, '');
  return p[0].length === 4
    ? p[2].padStart(2, '0') + p[1].padStart(2, '0') + p[0]
    : p[0].padStart(2, '0') + p[1].padStart(2, '0') + (p[2].length === 2 ? '19' + p[2] : p[2]);
}
export function Tick({ on }: { on?: boolean }) {
  return <span className="inline-flex h-4 w-4 items-center justify-center text-[13px] font-bold leading-none text-black" style={{ border: `1px solid ${CELL}`, background: '#fff' }}>{on ? 'X' : ''}</span>;
}
export function YesNo({ yes }: { yes?: boolean | null }) {
  return (
    <div className="flex items-center gap-5 text-[11px] text-black">
      <span className="flex items-center gap-2">Yes <Tick on={yes === true} /></span>
      <span className="flex items-center gap-2">No <Tick on={yes === false} /></span>
    </div>
  );
}
export function HmrcLogo() {
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
// Masthead used by supplementary pages: logo left, form title right, then a
// Name / UTR reference panel.
export function SuppHead({ title, name, utr, note }: { title: string; name?: string; utr?: string; note?: React.ReactNode }) {
  const dense = useDense();
  return (
    <>
      <div className={`flex items-start justify-between ${dense ? 'mb-2' : 'mb-3'}`}>
        <HmrcLogo />
        <div className="max-w-[60%] text-right"><h2 className="text-[22px] font-bold leading-tight text-black">{title}</h2><p className="mt-2 text-[11px] text-black">Tax year 6 April 2025 to 5 April 2026 (2025–26)</p></div>
      </div>
      {note}
      <Panel>
        <div className="grid grid-cols-2 gap-x-8">
          <Line label="Your name" value={name} />
          <Cells label="Your Unique Taxpayer Reference (UTR)" groups={[5, 5]} value={utr} />
        </div>
      </Panel>
    </>
  );
}
// Keeps every supplementary page on a single A4 sheet with the identical roomy
// (main-form) spacing. The layout is never compressed; a page is only ever
// scaled down as a whole — and only when its content would otherwise run past
// the sheet — so pages that already fit are rendered pixel-for-pixel unchanged.
function FitContent({ origin = 'top center', children }: { origin?: string; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current, inner = innerRef.current;
    if (!box || !inner) return;
    const avail = box.clientHeight;
    const natural = inner.scrollHeight; // transforms don't affect scrollHeight
    // Scale to a hair less than the available height so a shrunk page keeps a
    // small gap above the footer instead of butting right up against it.
    const k = natural > avail + 1 ? Math.max(0.72, (avail - 16) / natural) : 1;
    setScale(s => (Math.abs(s - k) > 0.002 ? k : s));
  });
  return (
    <div ref={boxRef} className="relative min-h-0 flex-1">
      {/* When a page must shrink to fit, anchor the shrink to the edge it bleeds
          toward (origin) so a full-bleed panel keeps touching that page edge. */}
      <div ref={innerRef} className="h-full" style={{ transformOrigin: origin, transform: scale < 1 ? `scale(${scale})` : undefined }}>
        {children}
      </div>
    </div>
  );
}
export function Page({ tag, code = 'SA100', fitOrigin = 'top center', children }: { tag: string; code?: string; fitOrigin?: string; children: React.ReactNode }) {
  const t = useTheme();
  const record = useRecord();
  // The HMRC "12/25" print date appears only on the first page of each form
  // section (page tag ending in "1"), like the real forms. No footer rule.
  const isFirst = tag.trim().split(/\s+/).pop() === '1';
  return (
    <div data-sa-code={code} data-sa-page={tag} data-sa-record={record ?? undefined} className={`sa-sheet relative mx-auto mb-6 flex h-[297mm] w-[210mm] max-w-full flex-col overflow-hidden bg-white shadow-sm ${t.dense ? 'px-[11mm]' : 'px-[13mm]'} py-[7mm]`} style={{ border: `1px solid ${t.panelBorder}`, fontFamily: 'Helvetica, Arial, sans-serif' }}>
      <FitContent origin={fitOrigin}>{children}</FitContent>
      <div className="mt-1 grid grid-cols-3 items-center text-[11px] font-bold text-black">
        <span style={{ letterSpacing: '0.18em' }}>{code} 2026</span>
        <span className="text-center" style={{ letterSpacing: '0.18em' }}>Page {tag}</span>
        <span className="text-right font-normal text-slate-400" style={{ letterSpacing: '0.12em' }}>{isFirst ? 'HMRC 12/25' : ''}</span>
      </div>
    </div>
  );
}
