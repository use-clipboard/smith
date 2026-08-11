'use client';

import { useMemo } from 'react';
import { X, Printer, FileText } from 'lucide-react';
import type { TaxReturn } from '../types';
import { buildFilingForms, buildTaxCalcForm, type FilingForm, type FilingRow } from './filingModel';

// Print stylesheet: when printing, show only the preview sheets (the browser's
// "Save as PDF" then produces a clean, vector, multi-page client copy).
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #sa-filing-preview, #sa-filing-preview * { visibility: visible !important; }
  #sa-filing-preview { position: absolute; inset: 0; margin: 0; padding: 0; background: #fff; overflow: visible; }
  #sa-filing-preview .no-print { display: none !important; }
  #sa-filing-preview .sa-sheet { box-shadow: none !important; margin: 0 auto 0 auto !important; page-break-after: always; border: none !important; }
  @page { size: A4; margin: 14mm; }
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
  const forms = useMemo(() => {
    const base = buildFilingForms(ret);
    // Insert the SA302 tax calculation right after the SA100 main form.
    return [base[0], buildTaxCalcForm(ret), ...base.slice(1)];
  }, [ret]);

  return (
    <div id="sa-filing-preview" className="fixed inset-0 z-50 overflow-auto bg-slate-100">
      <style>{PRINT_CSS}</style>
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-[var(--accent)]" />
          <div>
            <p className="text-[13px] font-bold text-slate-900">Filing preview — {ret.clientName}</p>
            <p className="text-[11px] text-slate-500">SA100 {ret.taxYear} · {forms.length} form{forms.length === 1 ? '' : 's'} · main form always shown, supplementary pages only where there are entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
        {forms.map((f, idx) => <Sheet key={`${f.code}-${idx}`} form={f} />)}
        <p className="no-print mx-auto mb-8 max-w-[210mm] text-center text-[11px] text-slate-400">
          This is a working copy of the return as entered. It becomes the client’s filed copy once the return is submitted to HMRC. For mortgage use, provide the tax calculation together with the HMRC Tax Year Overview.
        </p>
      </div>
    </div>
  );
}
