'use client';

import { useMemo, useState } from 'react';
import { X, Printer, FileText, FileDown, Loader2 } from 'lucide-react';
import type { TaxReturn } from '../types';
import { buildFilingForms, buildTaxCalcForm, type FilingForm, type FilingRow } from './filingModel';
import { downloadSa100Pdf } from './sa100Stamp';
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
import PropertyFacsimile from './PropertyFacsimile';
import PartnershipFacsimile from './PartnershipFacsimile';
import PartnershipShortFacsimile from './PartnershipShortFacsimile';
import { employmentTaxable, tradeTaxableProfit, sa108HasData, foreignTotals, welshAssemblyHasData, assemblyHasData, parliamentHasData, scottishParliamentHasData } from '../calc';

// Print stylesheet: when printing, show only the preview sheets (the browser's
// "Save as PDF" then produces a clean, vector, multi-page client copy).
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #sa-filing-preview, #sa-filing-preview * { visibility: visible !important; }
  #sa-filing-preview { position: absolute; inset: 0; margin: 0; padding: 0; background: #fff; overflow: visible; }
  #sa-filing-preview .no-print { display: none !important; }
  #sa-filing-preview .sa-sheet { box-shadow: none !important; margin: 0 auto 0 auto !important; page-break-after: always; border: none !important; }
  /* The facsimile sheets are already exactly A4 (210×297mm) with their own inner
     padding, so print with a zero page margin to map one sheet to one A4 page. */
  @page { size: A4; margin: 0; }
}`;

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
    <div className="sa-sheet mx-auto mb-6 w-[210mm] max-w-full rounded-sm border border-slate-200 bg-white p-[14mm] shadow-sm">
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
  const [stamping, setStamping] = useState(false);
  const [stampErr, setStampErr] = useState<string | null>(null);
  async function downloadOfficial() {
    setStamping(true); setStampErr(null);
    try { await downloadSa100Pdf(ret); }
    catch (e) { setStampErr(e instanceof Error ? e.message : 'Could not build the PDF.'); }
    finally { setStamping(false); }
  }
  // SA100 + SA102 render as HMRC facsimiles; the rest (tax calc + remaining
  // supplementary pages) render as structured sheets until they get facsimiles.
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
  const showProperty = useMemo(() => (ret.income.property ?? []).length > 0, [ret]);
  const fullPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form !== 'short' && (p.profit || p.name || p.utr)), [ret]);
  const shortPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form === 'short' && (p.profit || p.name || p.utr)), [ret]);
  const rest = useMemo(() => [buildTaxCalcForm(ret), ...buildFilingForms(ret).slice(1).filter(f => f.code !== 'SA102' && f.code !== 'SA103F' && f.code !== 'SA103S' && f.code !== 'SA108' && f.code !== 'SA106' && f.code !== 'SA102WAM' && f.code !== 'SA102MLA' && f.code !== 'SA102MP' && f.code !== 'SA102MSP' && f.code !== 'SA104F' && f.code !== 'SA104S' && f.code !== 'SA109' && f.code !== 'SA105')], [ret]);
  const totalForms = rest.length + 1 + emps.length + trades.length + shortTrades.length + (showCgt ? 1 : 0) + (showForeign ? 1 : 0) + (showWelsh ? 1 : 0) + (showNI ? 1 : 0) + (showMP ? 1 : 0) + (showScottish ? 1 : 0) + (showResidence ? 1 : 0) + (showProperty ? 1 : 0) + fullPartners.length + shortPartners.length;

  return (
    <div id="sa-filing-preview" className="fixed inset-0 z-50 overflow-auto bg-slate-100">
      <style>{PRINT_CSS}</style>
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-[var(--accent)]" />
          <div>
            <p className="text-[13px] font-bold text-slate-900">Filing preview — {ret.clientName}</p>
            <p className="text-[11px] text-slate-500">SA100 {ret.taxYear} · {totalForms} form{totalForms === 1 ? '' : 's'} · main form always shown, supplementary pages only where there are entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stampErr && <span className="text-[11px] font-medium text-rose-600">{stampErr}</span>}
          <button onClick={downloadOfficial} disabled={stamping} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 disabled:opacity-50" title="Stamp the figures onto HMRC's official blank SA100 PDF (proof — calibrating box positions)">
            {stamping ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />} Official SA100 (proof)
          </button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90">
            <Printer size={14} /> Print / Save as PDF
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
            <X size={14} /> Close
          </button>
        </div>
      </div>
      {/* Sheets */}
      <div className="px-4 py-6">
        <Sa100Facsimile ret={ret} />
        {emps.map((e, idx) => <EmploymentFacsimile key={`emp-${idx}`} ret={ret} emp={e} />)}
        {trades.map((tr, idx) => <SelfEmploymentFacsimile key={`se-${idx}`} ret={ret} trade={tr} />)}
        {shortTrades.map((tr, idx) => <SelfEmploymentShortFacsimile key={`ses-${idx}`} ret={ret} trade={tr} />)}
        {showCgt && <CapitalGainsFacsimile ret={ret} />}
        {showForeign && <ForeignFacsimile ret={ret} />}
        {showWelsh && ret.income.welshAssembly && <WelshParliamentFacsimile ret={ret} office={ret.income.welshAssembly} />}
        {showNI && ret.income.niAssembly && <NIAssemblyFacsimile ret={ret} office={ret.income.niAssembly} />}
        {showMP && ret.income.parliament && <ParliamentFacsimile ret={ret} office={ret.income.parliament} />}
        {showScottish && ret.income.scottishParliament && <ScottishParliamentFacsimile ret={ret} office={ret.income.scottishParliament} />}
        {fullPartners.map((pt, idx) => <PartnershipFacsimile key={`ptf-${idx}`} ret={ret} partner={pt} />)}
        {shortPartners.map((pt, idx) => <PartnershipShortFacsimile key={`pts-${idx}`} ret={ret} partner={pt} />)}
        {showProperty && <PropertyFacsimile ret={ret} />}
        {showResidence && <ResidenceFacsimile ret={ret} />}
        {rest.map((f, idx) => <Sheet key={`${f.code}-${idx}`} form={f} />)}
        <p className="no-print mx-auto mb-8 max-w-[210mm] text-center text-[11px] text-slate-400">
          This is a working copy of the return as entered. It becomes the client’s filed copy once the return is submitted to HMRC. For mortgage use, provide the tax calculation together with the HMRC Tax Year Overview.
        </p>
      </div>
    </div>
  );
}
