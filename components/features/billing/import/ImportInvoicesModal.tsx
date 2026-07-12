'use client';

import { useRef, useState } from 'react';
import { X, UploadCloud, Loader2, Check, Undo2, ArrowRight, Sparkles, AlertTriangle } from 'lucide-react';
import { fmtPence } from '@/lib/billing/totals';

interface AnalyzedRow {
  index: number; number: string | null; clientName: string;
  issueDate: string | null; dueDate: string | null;
  totalPence: number; amountPaidPence: number;
  status: 'paid' | 'part_paid' | 'outstanding' | 'skip';
  match: { clientId: string | null; confidence: 'high' | 'medium' | 'none' };
}
interface Analysis {
  source: string; sourceLabel: string; rows: AnalyzedRow[];
  summary: { total: number; importable: number; skipped: number; outstandingCount: number; outstandingPence: number; paidCount: number; matched: number; unmatched: number };
}

type Stage = 'upload' | 'analyzing' | 'review' | 'committing' | 'done';

function fmtDate(iso: string | null) { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}-${m}-${y}`; }

export default function ImportInvoicesModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [stage, setStage] = useState<Stage>('upload');
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [filename, setFilename] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [autoCreate, setAutoCreate] = useState(true);
  const [createRecurring, setCreateRecurring] = useState(false);
  const [result, setResult] = useState<{ batchId: string; invoiceCount: number; clientCreatedCount: number; recurringCount: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (file) e.target.value = '';
    if (!file) return;
    setFilename(file.name); setError(null); setStage('analyzing');
    const base64 = await new Promise<string>((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(String(rd.result).split(',')[1] ?? '');
      rd.onerror = rej; rd.readAsDataURL(file);
    });
    const r = await fetch('/api/billing/import/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, base64, mimeType: file.type }) });
    const d = await r.json().catch(() => null);
    if (r.ok && d) { setAnalysis(d); setExcluded(new Set()); setStage('review'); }
    else { setError(d?.error ?? 'Could not read that file.'); setStage('upload'); }
  }

  function toggle(i: number) { setExcluded(s => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; }); }

  async function commit() {
    if (!analysis) return;
    setStage('committing');
    const rows = analysis.rows
      .filter(r => r.status !== 'skip' && !excluded.has(r.index))
      .map(r => ({
        number: r.number, clientName: r.clientName, clientId: r.match.clientId,
        createClient: !r.match.clientId && autoCreate,
        issueDate: r.issueDate, dueDate: r.dueDate, totalPence: r.totalPence, amountPaidPence: r.amountPaidPence,
        status: r.status as 'paid' | 'part_paid' | 'outstanding', description: '',
      }));
    const r = await fetch('/api/billing/import/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: analysis.source, filename, createRecurring, rows }) });
    const d = await r.json().catch(() => null);
    if (r.ok && d) { setResult(d); setStage('done'); onImported(); }
    else { setError(d?.error ?? 'Import failed.'); setStage('review'); }
  }

  async function undo() {
    if (!result) return;
    await fetch(`/api/billing/import/${result.batchId}`, { method: 'DELETE' });
    onImported(); onClose();
  }

  const rows = analysis?.rows ?? [];
  const shown = rows.slice(0, 250);
  const includedCount = rows.filter(r => r.status !== 'skip' && !excluded.has(r.index)).length;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm animate-fade-in" onClick={stage === 'analyzing' || stage === 'committing' ? undefined : onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] flex max-h-[88vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-4">
          <div>
            <h3 className="text-[16px] font-bold text-[var(--text-primary)]">Import invoices</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Bring outstanding balances & history from Xero, QuickBooks, Sage, VT or any CSV/Excel.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-black/5"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5">
          {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-600"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}

          {stage === 'upload' && (
            <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-black/15 bg-black/[0.02] py-14 transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/[0.03]">
              <UploadCloud size={34} className="text-[var(--accent)]" />
              <span className="text-[14px] font-semibold text-[var(--text-primary)]">Choose a CSV or Excel export</span>
              <span className="text-[12px] text-[var(--text-muted)]">SMITH detects the format and maps the columns for you</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={onFile} className="hidden" />

          {stage === 'analyzing' && (
            <div className="flex flex-col items-center gap-3 py-16 text-[var(--text-muted)]"><Loader2 size={28} className="animate-spin text-[var(--accent)]" /><p className="text-sm">Reading {filename}…</p></div>
          )}

          {stage === 'review' && analysis && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[var(--accent)]/[0.05] px-4 py-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-[var(--accent)] shadow-sm"><Sparkles size={12} /> {analysis.sourceLabel}</span>
                <span className="text-[13px] text-[var(--text-secondary)]"><b>{includedCount}</b> to import · <b>{analysis.summary.outstandingCount}</b> outstanding ({fmtPence(analysis.summary.outstandingPence)}) · <b>{analysis.summary.paidCount}</b> paid</span>
                <span className="text-[12px] text-[var(--text-muted)]">{analysis.summary.matched} matched, {analysis.summary.unmatched} new</span>
              </div>

              <div className="flex flex-wrap gap-4">
                <Toggle label="Auto-create clients that don't match" checked={autoCreate} onChange={setAutoCreate} />
                <Toggle label="Detect recurring schedules from repeats" checked={createRecurring} onChange={setCreateRecurring} />
              </div>

              <div className="overflow-hidden rounded-xl border border-black/5">
                <div className="max-h-[38vh] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-[12.5px]">
                    <thead className="sticky top-0 bg-white/95 backdrop-blur"><tr className="border-b border-black/5 text-left text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                      <th className="px-3 py-2 font-semibold" /><th className="px-3 py-2 font-semibold">Invoice</th><th className="px-3 py-2 font-semibold">Client</th><th className="px-3 py-2 font-semibold">Issued</th><th className="px-3 py-2 text-right font-semibold">Total</th><th className="px-3 py-2 text-right font-semibold">Balance</th>
                    </tr></thead>
                    <tbody>
                      {shown.map(r => {
                        const skip = r.status === 'skip'; const excl = excluded.has(r.index);
                        const bal = r.totalPence - r.amountPaidPence;
                        return (
                          <tr key={r.index} className={`border-b border-black/[0.03] ${skip || excl ? 'opacity-40' : ''}`}>
                            <td className="px-3 py-1.5">{!skip && <input type="checkbox" checked={!excl} onChange={() => toggle(r.index)} />}</td>
                            <td className="px-3 py-1.5 font-semibold text-[var(--text-primary)]">{r.number ?? '—'}</td>
                            <td className="px-3 py-1.5">
                              <span className="text-[var(--text-secondary)]">{r.clientName}</span>{' '}
                              {skip ? <em className="text-[10px] text-[var(--text-muted)]">void</em> : r.match.clientId ? <span className="text-[10px] text-emerald-600">✓ matched</span> : <span className="text-[10px] text-amber-600">{autoCreate ? 'will create' : 'no client'}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-[var(--text-muted)]">{fmtDate(r.issueDate)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtPence(r.totalPence)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{r.status === 'paid' ? <span className="text-emerald-600">paid</span> : fmtPence(bal)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows.length > shown.length && <p className="border-t border-black/5 px-3 py-1.5 text-[11px] text-[var(--text-muted)]">Showing first {shown.length} of {rows.length}. All will be imported.</p>}
              </div>
            </div>
          )}

          {stage === 'committing' && (
            <div className="flex flex-col items-center gap-3 py-16 text-[var(--text-muted)]"><Loader2 size={28} className="animate-spin text-[var(--accent)]" /><p className="text-sm">Importing {includedCount} invoices…</p></div>
          )}

          {stage === 'done' && result && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600"><Check size={28} /></div>
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Imported</h3>
              <p className="text-sm text-[var(--text-muted)]">{result.invoiceCount} invoices{result.clientCreatedCount > 0 ? `, ${result.clientCreatedCount} new clients` : ''}{result.recurringCount > 0 ? `, ${result.recurringCount} recurring schedules` : ''}.</p>
              <p className="max-w-sm text-[12px] text-[var(--text-muted)]">Outstanding invoices now feed aged debtors and credit control. Their original numbers were kept and your next number continues after the highest.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          {stage === 'done' ? (
            <>
              <button onClick={undo} className="btn-secondary text-[var(--danger)]"><Undo2 size={14} /> Undo import</button>
              <button onClick={onClose} className="btn-primary">Done</button>
            </>
          ) : stage === 'review' ? (
            <>
              <button onClick={() => { setStage('upload'); setAnalysis(null); }} className="btn-secondary">Back</button>
              <button onClick={commit} disabled={includedCount === 0} className="btn-primary disabled:opacity-50">Import {includedCount} invoices <ArrowRight size={14} /></button>
            </>
          ) : <span />}
        </div>
      </div>
    </>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? 'bg-[var(--accent)]' : 'bg-black/15'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}
