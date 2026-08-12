'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Printer, FileText, Search, Plus, Minus, ChevronRight, List } from 'lucide-react';
import type { TaxReturn } from '../types';
import { buildFilingForms, type FilingForm, type FilingRow } from './filingModel';
import Sa100Facsimile from './Sa100Facsimile';
import EmploymentFacsimile from './EmploymentFacsimile';
import SelfEmploymentFacsimile from './SelfEmploymentFacsimile';
import SelfEmploymentShortFacsimile from './SelfEmploymentShortFacsimile';
import CapitalGainsFacsimile from './CapitalGainsFacsimile';
import ForeignFacsimile from './ForeignFacsimile';
import WelshParliamentFacsimile from './WelshParliamentFacsimile';
import NIAssemblyFacsimile from './NIAssemblyFacsimile';
import ParliamentFacsimile from './ParliamentFacsimile';
import ScottishParliamentFacsimile from './ScottishParliamentFacsimile';
import ResidenceFacsimile from './ResidenceFacsimile';
import AdditionalFacsimile from './AdditionalFacsimile';
import PropertyFacsimile from './PropertyFacsimile';
import LloydsFacsimile from './LloydsFacsimile';
import MinisterFacsimile from './MinisterFacsimile';
import TrustsFacsimile from './TrustsFacsimile';
import TaxCalcSummaryFacsimile from './TaxCalcSummaryFacsimile';
import PartnershipFacsimile from './PartnershipFacsimile';
import PartnershipShortFacsimile from './PartnershipShortFacsimile';
import { employmentTaxable, tradeTaxableProfit, sa108HasData, foreignTotals, welshAssemblyHasData, assemblyHasData, parliamentHasData, scottishParliamentHasData, lloydsHasData, ministerHasData } from '../calc';

// Print stylesheet: when printing, show only the preview sheets (the browser's
// "Save as PDF" then produces a clean, vector, multi-page client copy). The
// contents sidebar, toolbar and zoom are all neutralised for print.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #sa-filing-preview, #sa-filing-preview * { visibility: visible !important; }
  #sa-filing-preview { position: absolute; inset: 0; margin: 0; padding: 0; background: #fff; overflow: visible; }
  #sa-filing-preview .no-print { display: none !important; }
  #sa-filing-preview .sa-body { display: block !important; }
  #sa-filing-preview .sa-main-scroll { overflow: visible !important; position: static !important; }
  #sa-filing-preview .sa-sheets-wrap { zoom: 1 !important; padding: 0 !important; }
  #sa-filing-preview .sa-sheet { box-shadow: none !important; margin: 0 auto 0 auto !important; page-break-after: always; border: none !important; }
  @page { size: A4; margin: 0; }
}`;

// Friendly names for each HMRC form code, shown in the contents list.
const FORM_NAMES: Record<string, string> = {
  SA100: 'Tax return', SA101: 'Additional information', SA102: 'Employment',
  SA102M: 'Ministers of religion', SA102MS: 'Welsh Parliament (Senedd)', SA102WAM: 'Welsh Parliament (Senedd)',
  SA102MLA: 'NI Legislative Assembly', SA102MP: 'Parliament (MPs)', SA102MSP: 'Scottish Parliament',
  SA103F: 'Self-employment (full)', SA103S: 'Self-employment (short)', SA103L: 'Lloyd’s underwriters',
  SA104F: 'Partnership (full)', SA104S: 'Partnership (short)', SA105: 'UK property', SA106: 'Foreign',
  SA107: 'Trusts etc', SA108: 'Capital gains', SA109: 'Residence & FIG', SA110: 'Tax calculation summary',
};

interface OutlineBox { key: string; id: string; num: string; label: string }
interface OutlineSection { key: string; id: string; title: string; boxes: OutlineBox[] }
interface OutlineForm { key: string; code: string; name: string; sections: OutlineSection[] }

// Walk the rendered sheets and build a form → section → box outline. Every
// facsimile uses the shared primitives, so sheets carry data-sa-code/-page and
// each box chip carries data-boxnum — we assign scroll-target ids as we go.
function buildOutline(root: HTMLElement): OutlineForm[] {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.sa-sheet'));
  const forms: OutlineForm[] = [];
  const byCode = new Map<string, OutlineForm>();
  let uid = 0;
  for (const sheet of sheets) {
    const code = sheet.dataset.saCode || sheet.getAttribute('data-sa-code') || '—';
    let form = byCode.get(code);
    if (!form) { form = { key: `f${forms.length}`, code, name: FORM_NAMES[code] || code, sections: [] }; byCode.set(code, form); forms.push(form); }
    let section: OutlineSection | null = null;
    const nodes = Array.from(sheet.querySelectorAll<HTMLElement>('h3, h4, [data-boxnum]'));
    for (const el of nodes) {
      if (el.matches('h3, h4')) {
        if (!el.id) el.id = `sao-${uid++}`;
        const title = (el.textContent || '').trim();
        if (!title) continue;
        section = { key: el.id, id: el.id, title, boxes: [] };
        form.sections.push(section);
      } else {
        const num = el.getAttribute('data-boxnum') || '';
        const wrap = el.parentElement;                       // chip wrapper span
        const textSpan = wrap?.nextElementSibling as HTMLElement | null;
        const target = wrap?.parentElement || el;            // the whole labelled row
        if (!target.id) target.id = `sao-${uid++}`;
        let label = (textSpan?.textContent || '').trim();
        if (!label) label = (target.textContent || '').trim().replace(new RegExp('^' + num.replace(/[.]/g, '\\.')), '').trim();
        if (!section) { section = { key: `${sheet.id || (sheet.id = `sao-${uid++}`)}-top`, id: sheet.id, title: FORM_NAMES[code] || code, boxes: [] }; form.sections.push(section); }
        section.boxes.push({ key: target.id, id: target.id, num, label: label.slice(0, 120) });
      }
    }
  }
  return forms;
}

function navTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const prev = el.style.backgroundColor;
  el.style.transition = 'background-color 0.25s';
  el.style.backgroundColor = 'rgba(99,102,241,0.16)';
  setTimeout(() => { el.style.backgroundColor = prev; }, 950);
}

function Row({ r }: { r: FilingRow }) {
  if (r.heading) return <p className="col-span-full mt-2 text-[11px] font-semibold text-slate-500">{r.label}</p>;
  return (
    <div className={`flex items-baseline gap-2 py-[3px] ${r.strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      {r.box != null ? <span className="mt-px inline-flex min-w-[26px] shrink-0 justify-center rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{r.box}</span> : <span className="min-w-[26px] shrink-0" />}
      <span className="flex-1 text-[11.5px] leading-snug">{r.label}</span>
      <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums">{r.value ?? r.text ?? ''}</span>
    </div>
  );
}

function Sheet({ form }: { form: FilingForm }) {
  return (
    <div data-sa-code={form.code} data-sa-page={form.pageTag} className="sa-sheet mx-auto mb-6 w-[210mm] max-w-full rounded-sm border border-slate-200 bg-white p-[14mm] shadow-sm">
      <div className="mb-4 flex items-baseline justify-between border-b-2 border-slate-800 pb-2">
        <h2 className="text-[15px] font-bold text-slate-900">{form.name}</h2>
        <span className="text-[11px] font-semibold text-slate-500">{form.code} · Page {form.pageTag}</span>
      </div>
      <div className="space-y-3">
        {form.sections.filter(s => s.rows.length > 0).map((s, si) => (
          <div key={si}>
            <p className="mb-1 text-[12px] font-bold uppercase tracking-wide text-slate-600">{s.title}</p>
            <div className="border-t border-slate-100">
              {s.rows.map((r, ri) => <Row key={ri} r={r} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FilingPreview({ ret, onClose }: { ret: TaxReturn; onClose: () => void }) {
  const sheetsRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<OutlineForm[]>([]);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [openForms, setOpenForms] = useState<Record<string, boolean>>({});
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  const [sidebar, setSidebar] = useState(true);

  const emps = useMemo(() => ret.income.employment.filter(e => employmentTaxable(e) !== 0 || e.employer), [ret]);
  const trades = useMemo(() => ret.income.selfEmployment.filter(t => t.form !== 'short' && (tradeTaxableProfit(t) !== 0 || t.name)), [ret]);
  const shortTrades = useMemo(() => ret.income.selfEmployment.filter(t => t.form === 'short' && (tradeTaxableProfit(t) !== 0 || t.name)), [ret]);
  const showCgt = useMemo(() => sa108HasData(ret.income.sa108), [ret]);
  const showForeign = useMemo(() => { const t = foreignTotals(ret.income); return !!(t.interest || t.dividends || t.other || t.taxClaimed); }, [ret]);
  const showWelsh = useMemo(() => welshAssemblyHasData(ret.income.welshAssembly), [ret]);
  const showNI = useMemo(() => assemblyHasData(ret.income.niAssembly), [ret]);
  const showMP = useMemo(() => parliamentHasData(ret.income.parliament), [ret]);
  const showScottish = useMemo(() => scottishParliamentHasData(ret.income.scottishParliament), [ret]);
  const showResidence = useMemo(() => { const r = ret.income.residence; return !!r && Object.values(r).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!v)); }, [ret]);
  const showAdditional = useMemo(() => { const r = ret.income.additional; return !!r && Object.values(r).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : !!v)); }, [ret]);
  const showProperty = useMemo(() => (ret.income.property ?? []).length > 0, [ret]);
  const showLloyds = useMemo(() => lloydsHasData(ret.income.lloyds), [ret]);
  const showMinister = useMemo(() => ministerHasData(ret.income.minister), [ret]);
  const showTrusts = useMemo(() => { const s = ret.income.sa107; return !!s && Object.values(s).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : !!v)); }, [ret]);
  const fullPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form !== 'short' && (p.profit || p.name || p.utr)), [ret]);
  const shortPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form === 'short' && (p.profit || p.name || p.utr)), [ret]);
  const rest = useMemo(() => buildFilingForms(ret).slice(1).filter(f => f.code !== 'SA102' && f.code !== 'SA103F' && f.code !== 'SA103S' && f.code !== 'SA108' && f.code !== 'SA106' && f.code !== 'SA102WAM' && f.code !== 'SA102MLA' && f.code !== 'SA102MP' && f.code !== 'SA102MSP' && f.code !== 'SA104F' && f.code !== 'SA104S' && f.code !== 'SA109' && f.code !== 'SA105' && f.code !== 'SA103L' && f.code !== 'SA101' && f.code !== 'SA102M' && !(f.code === 'SA107' && showTrusts)), [ret, showTrusts]);
  const totalForms = rest.length + 2 + emps.length + trades.length + shortTrades.length + (showCgt ? 1 : 0) + (showForeign ? 1 : 0) + (showWelsh ? 1 : 0) + (showNI ? 1 : 0) + (showMP ? 1 : 0) + (showScottish ? 1 : 0) + (showResidence ? 1 : 0) + (showProperty ? 1 : 0) + (showLloyds ? 1 : 0) + (showAdditional ? 1 : 0) + (showMinister ? 1 : 0) + (showTrusts ? 1 : 0) + fullPartners.length + shortPartners.length;

  // Build the contents outline once the sheets are in the DOM.
  useEffect(() => {
    const root = sheetsRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => setOutline(buildOutline(root)));
    return () => cancelAnimationFrame(raf);
  }, [ret, totalForms]);

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  return (
    <div id="sa-filing-preview" className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <style>{PRINT_CSS}</style>
      {/* Toolbar */}
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebar(s => !s)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50" aria-label="Toggle contents">
            <List size={15} /> Contents
          </button>
          <FileText size={16} className="ml-1 text-[var(--accent)]" />
          <div>
            <p className="text-[13px] font-bold text-slate-900">Filing preview — {ret.clientName}</p>
            <p className="text-[11px] text-slate-500">SA100 {ret.taxYear} · {totalForms} form{totalForms === 1 ? '' : 's'} · supplementary pages shown only where there are entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 px-1 py-0.5">
            <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Zoom out"><Minus size={14} /></button>
            <button onClick={() => setZoom(1)} className="w-11 text-center text-[11px] font-semibold tabular-nums text-slate-600 hover:text-slate-900" aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Zoom in"><Plus size={14} /></button>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90">
            <Printer size={14} /> Print / Save as PDF
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
            <X size={14} /> Close
          </button>
        </div>
      </div>

      <div className="sa-body flex min-h-0 flex-1">
        {/* Contents sidebar */}
        {sidebar && (
          <div className="no-print flex w-[288px] shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <Search size={14} className="text-slate-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search boxes, headings, forms…" className="w-full bg-transparent text-[12px] text-slate-700 outline-none placeholder:text-slate-400" />
                {query && <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
              {outline.map(form => {
                const formMatch = matches(form.name) || matches(form.code);
                const secs = form.sections.map(sec => {
                  const secMatch = formMatch || matches(sec.title);
                  const boxes = sec.boxes.filter(b => secMatch || matches(b.num) || matches(b.label));
                  return { sec, boxes, show: secMatch || boxes.length > 0 };
                }).filter(s => s.show);
                if (q && !formMatch && secs.length === 0) return null;
                const formOpen = q ? true : (openForms[form.key] ?? false);
                return (
                  <div key={form.key} className="px-1">
                    <button onClick={() => setOpenForms(o => ({ ...o, [form.key]: !formOpen }))}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50">
                      <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${formOpen ? 'rotate-90' : ''}`} />
                      <span className="inline-flex shrink-0 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--accent)]">{form.code}</span>
                      <span className="flex-1 truncate text-[12px] font-semibold text-slate-700">{form.name}</span>
                    </button>
                    {formOpen && secs.map(({ sec, boxes }) => {
                      const secOpen = q ? true : (openSecs[sec.key] ?? false);
                      return (
                        <div key={sec.key} className="ml-4">
                          <div className="flex items-center">
                            <button onClick={() => setOpenSecs(o => ({ ...o, [sec.key]: !secOpen }))} className="shrink-0 rounded p-0.5 text-slate-300 hover:text-slate-500">
                              <ChevronRight size={12} className={`transition-transform ${secOpen ? 'rotate-90' : ''}`} />
                            </button>
                            <button onClick={() => navTo(sec.id)} className="flex-1 truncate rounded px-1 py-1 text-left text-[11.5px] font-medium text-slate-600 hover:bg-slate-50 hover:text-[var(--accent)]" title={sec.title}>{sec.title}</button>
                          </div>
                          {secOpen && boxes.map(b => (
                            <button key={b.key} onClick={() => navTo(b.id)} className="flex w-full items-start gap-1.5 rounded px-1 py-[3px] pl-7 text-left hover:bg-slate-50" title={b.label}>
                              <span className="mt-px inline-flex min-w-[22px] shrink-0 justify-center rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{b.num}</span>
                              <span className="flex-1 truncate text-[11px] leading-snug text-slate-500">{b.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {outline.length === 0 && <p className="px-4 py-6 text-center text-[11px] text-slate-400">Building contents…</p>}
            </div>
          </div>
        )}

        {/* Sheets */}
        <div className="sa-main-scroll min-w-0 flex-1 overflow-auto">
          <div ref={sheetsRef} className="sa-sheets-wrap px-4 py-6" style={{ zoom }}>
            <Sa100Facsimile ret={ret} />
            {emps.map((e, idx) => <EmploymentFacsimile key={`emp-${idx}`} ret={ret} emp={e} />)}
            {trades.map((tr, idx) => <SelfEmploymentFacsimile key={`se-${idx}`} ret={ret} trade={tr} />)}
            {shortTrades.map((tr, idx) => <SelfEmploymentShortFacsimile key={`ses-${idx}`} ret={ret} trade={tr} />)}
            {showLloyds && <LloydsFacsimile ret={ret} />}
            {showCgt && <CapitalGainsFacsimile ret={ret} />}
            {showForeign && <ForeignFacsimile ret={ret} />}
            {showWelsh && ret.income.welshAssembly && <WelshParliamentFacsimile ret={ret} office={ret.income.welshAssembly} />}
            {showNI && ret.income.niAssembly && <NIAssemblyFacsimile ret={ret} office={ret.income.niAssembly} />}
            {showMP && ret.income.parliament && <ParliamentFacsimile ret={ret} office={ret.income.parliament} />}
            {showScottish && ret.income.scottishParliament && <ScottishParliamentFacsimile ret={ret} office={ret.income.scottishParliament} />}
            {showMinister && <MinisterFacsimile ret={ret} />}
            {fullPartners.map((pt, idx) => <PartnershipFacsimile key={`ptf-${idx}`} ret={ret} partner={pt} />)}
            {shortPartners.map((pt, idx) => <PartnershipShortFacsimile key={`pts-${idx}`} ret={ret} partner={pt} />)}
            {showProperty && <PropertyFacsimile ret={ret} />}
            {showTrusts && <TrustsFacsimile ret={ret} />}
            {showResidence && <ResidenceFacsimile ret={ret} />}
            {showAdditional && <AdditionalFacsimile ret={ret} />}
            <TaxCalcSummaryFacsimile ret={ret} />
            {rest.map((f, idx) => <Sheet key={`${f.code}-${idx}`} form={f} />)}
            <p className="no-print mx-auto mb-8 max-w-[210mm] text-center text-[11px] text-slate-400">
              This is a working copy of the return as entered. It becomes the client’s filed copy once the return is submitted to HMRC. For mortgage use, provide the tax calculation together with the HMRC Tax Year Overview.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
