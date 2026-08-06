'use client';

import { useRef, useState } from 'react';
import {
  ScanText, UploadCloud, Loader2, Download, Check, X, Sparkles, Info, FileText,
} from 'lucide-react';
import { StudioCard } from './primitives';
import { fmtMoney } from './data';
import {
  encodeFile, fetchExtraction, mergeExtractionIntoIncome, extractionHasData,
  type Sa100Extraction,
} from './extract';
import type { TaxReturn } from './types';

export default function DocumentExtract({ ret, patch }: { ret: TaxReturn; patch: (u: (r: TaxReturn) => TaxReturn) => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [scanning, setScanning] = useState(false);
  const [extraction, setExtraction] = useState<Sa100Extraction | null>(null);
  const [error, setError] = useState('');
  const [imported, setImported] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles(prev => [...prev, ...Array.from(list)].slice(0, 12));
    setExtraction(null); setError('');
  }

  async function scan() {
    if (files.length === 0) return;
    setScanning(true); setError(''); setExtraction(null);
    try {
      const encoded = await Promise.all(files.map(encodeFile));
      setExtraction(await fetchExtraction(ret.taxYear, encoded));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the documents.');
    } finally {
      setScanning(false);
    }
  }

  function doImport() {
    if (!extraction) return;
    const count = extraction.documents.length || files.length;
    patch(r => ({
      ...r,
      income: mergeExtractionIntoIncome(r.income, extraction),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Extracted figures from ${count} document${count === 1 ? '' : 's'}` }],
    }));
    setImported(true); setTimeout(() => setImported(false), 2500);
  }

  const has = extraction ? extractionHasData(extraction) : false;
  const empTotal = extraction ? extraction.employment.reduce((a, e) => a + e.pay, 0) : 0;

  return (
    <StudioCard className="overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-black/5 px-5 py-3.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><ScanText size={18} /></div>
        <div>
          <p className="text-[13.5px] font-bold text-[var(--text-primary)]">Extract from documents</p>
          <p className="text-[11.5px] text-[var(--text-muted)]">Upload P60s, P11Ds, dividend vouchers, interest certificates — SMITH reads them.</p>
        </div>
      </div>

      <div className="px-5 py-4">
        {/* Dropzone */}
        <label
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? 'border-[var(--accent)] bg-[var(--accent)]/[0.05]' : 'border-[var(--border)] hover:border-[var(--accent)]/40'}`}
        >
          <UploadCloud size={22} className="text-[var(--accent)]" />
          <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Drop documents here or click to browse</p>
          <p className="text-[11px] text-[var(--text-muted)]">PDF, image, or CSV · up to 12 files</p>
          <input ref={inputRef} type="file" multiple accept=".pdf,image/*,.csv,.txt" className="hidden" onChange={e => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }} />
        </label>

        {/* Staged files */}
        {files.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white/60 px-2.5 py-1 text-[11.5px] text-[var(--text-secondary)]">
                <FileText size={12} className="text-[var(--text-muted)]" /> <span className="max-w-[160px] truncate">{f.name}</span>
                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-[var(--text-muted)] hover:text-rose-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}

        {files.length > 0 && !extraction && (
          <div className="mt-3 flex justify-end">
            <button onClick={scan} disabled={scanning} className="btn-primary disabled:opacity-50">
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {scanning ? 'Reading documents…' : `Scan ${files.length} document${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{error}</p>}

        {/* Results */}
        {extraction && (
          <div className="mt-4">
            {extraction.documents.length > 0 && (
              <div className="mb-3 space-y-1">
                {extraction.documents.map((d, i) => (
                  <p key={i} className="flex items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
                    <Check size={12} className="text-emerald-500" /> <span className="font-semibold text-[var(--text-primary)]">{d.docType}</span> — {d.summary}
                  </p>
                ))}
              </div>
            )}

            {has ? (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {extraction.employment.length > 0 && <Figure label={`Employment (${extraction.employment.length})`} value={fmtMoney(empTotal)} />}
                  {extraction.selfEmployment.length > 0 && <Figure label={`Self-employment (${extraction.selfEmployment.length})`} value={fmtMoney(extraction.selfEmployment.reduce((a, s) => a + s.profit, 0))} />}
                  {extraction.partnerships.length > 0 && <Figure label={`Partnership (${extraction.partnerships.length})`} value={fmtMoney(extraction.partnerships.reduce((a, p) => a + p.profit, 0))} />}
                  {extraction.property.length > 0 && <Figure label={`Property (${extraction.property.length})`} value={fmtMoney(extraction.property.reduce((a, p) => a + p.profit, 0))} />}
                  {extraction.dividends > 0 && <Figure label="Dividends" value={fmtMoney(extraction.dividends)} />}
                  {extraction.savingsInterest > 0 && <Figure label="Savings interest" value={fmtMoney(extraction.savingsInterest)} />}
                  {extraction.pensionsIncome > 0 && <Figure label="Pensions income" value={fmtMoney(extraction.pensionsIncome)} />}
                  {extraction.statePension > 0 && <Figure label="State pension" value={fmtMoney(extraction.statePension)} />}
                  {extraction.foreignIncome > 0 && <Figure label="Foreign income" value={fmtMoney(extraction.foreignIncome)} />}
                  {extraction.pensionContributions > 0 && <Figure label="Pension contrib." value={fmtMoney(extraction.pensionContributions)} />}
                  {extraction.giftAid > 0 && <Figure label="Gift Aid" value={fmtMoney(extraction.giftAid)} />}
                  {extraction.childBenefit > 0 && <Figure label="Child benefit" value={fmtMoney(extraction.childBenefit)} />}
                  {extraction.otherIncome > 0 && <Figure label="Other income" value={fmtMoney(extraction.otherIncome)} />}
                </div>

                {extraction.notes.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {extraction.notes.map((n, i) => (
                      <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700"><Info size={12} className="mt-0.5 shrink-0" /> {n}</p>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[11px] text-[var(--text-muted)]">Review then import — you can edit every figure in the next step.</p>
                  <button onClick={doImport} className="btn-primary">{imported ? <Check size={15} /> : <Download size={15} />} {imported ? 'Imported' : 'Import figures'}</button>
                </div>
              </>
            ) : (
              <div className="flex items-start gap-2 rounded-xl border border-[var(--border)] bg-white/60 px-4 py-3 text-[12px] text-[var(--text-secondary)]">
                <Info size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" /> SMITH couldn’t find SA100 figures in these documents. Check they’re for {ret.taxYear}, or enter the figures manually.
                {extraction.notes.length > 0 && <span className="block">{extraction.notes[0]}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </StudioCard>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2">
      <p className="truncate text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="text-[13px] font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
