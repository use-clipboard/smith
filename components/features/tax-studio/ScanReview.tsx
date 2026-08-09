'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, FileText, Sparkles, AlertTriangle, HelpCircle, MessageSquare, Send } from 'lucide-react';
import { fmtMoney } from './data';
import {
  buildScanProposals, applyScanProposals, SCAN_DESTS, scanDestLabel,
  type Sa100Extraction, type ScanProposal,
} from './extract';
import type { TaxReturn } from './types';

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

// Two-panel scan-review lightbox. LEFT: what SMITH found — editable proposals
// (amount + destination) and a "set aside" list with plain-English reasons.
// RIGHT: a chat panel (wired in Phase 2). Nothing imports until you press Import.
export default function ScanReview({ ret, patch, extraction, batchId, onClose }: {
  ret: TaxReturn; patch: Patch; extraction: Sa100Extraction; batchId: string; onClose: () => void;
}) {
  const [proposals, setProposals] = useState<ScanProposal[]>(() => buildScanProposals(extraction));
  const [imported, setImported] = useState(false);

  const upd = (id: string, u: Partial<ScanProposal>) => setProposals(ps => ps.map(p => p.id === id ? { ...p, ...u } : p));
  const included = proposals.filter(p => p.dest !== 'exclude');
  const total = included.reduce((a, p) => a + (p.amount || 0), 0);

  function doImport() {
    patch(r => ({
      ...r,
      income: applyScanProposals(r.income, proposals, batchId),
      timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: `Imported ${included.length} figure${included.length === 1 ? '' : 's'} from a scan` }],
    }));
    setImported(true);
    setTimeout(onClose, 600);
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="flex items-center gap-2 text-[15px] font-bold text-[var(--text-primary)]"><Sparkles size={16} className="text-[var(--accent)]" /> Review scan</p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_320px]">
          {/* LEFT — proposals */}
          <div className="min-h-0 overflow-auto border-r border-black/5 px-5 py-4">
            {extraction.documents.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Documents read</p>
                <div className="space-y-1">
                  {extraction.documents.map((d, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><FileText size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)]" /><span><span className="font-semibold text-[var(--text-primary)]">{d.docType}</span> — {d.summary}</span></p>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Figures found {included.length > 0 && <span className="text-[var(--accent)]">({included.length})</span>}</p>
            {proposals.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">No figures picked up — see “Set aside” below, or enter them manually.</p>
            ) : (
              <div className="space-y-1.5">
                {proposals.map(p => {
                  const on = p.dest !== 'exclude';
                  return (
                    <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${on ? 'border-[var(--accent)]/30 bg-[var(--accent)]/[0.03]' : 'border-[var(--border)] bg-black/[0.015] opacity-70'}`}>
                      <input type="checkbox" checked={on} onChange={e => upd(p.id, { dest: e.target.checked ? (p.origin === 'exclude' ? 'otherIncome' : p.origin) : 'exclude' })} className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-[var(--accent)]" aria-label="Include" />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[var(--text-primary)]">{p.label}</span>
                      <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1.5">
                        <span className="text-[11px] text-[var(--text-muted)]">£</span>
                        <input type="number" value={p.amount || ''} onChange={e => upd(p.id, { amount: Number(e.target.value) || 0 })} className="w-20 bg-transparent py-1 text-right text-[12px] outline-none" />
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)]">→</span>
                      <select value={p.dest} onChange={e => upd(p.id, { dest: e.target.value as ScanProposal['dest'] })} className={`rounded-md border py-1 text-[11.5px] ${p.dest !== p.origin && on ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-[var(--border)] bg-white text-[var(--text-secondary)]'}`}>
                        {SCAN_DESTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

            {extraction.setAside.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700"><AlertTriangle size={12} /> Set aside ({extraction.setAside.length})</p>
                <div className="space-y-1.5">
                  {extraction.setAside.map((s, i) => (
                    <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">{s.label}</p>
                      <p className="text-[11px] text-amber-800">{s.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {extraction.needs.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><HelpCircle size={12} /> SMITH would like to know ({extraction.needs.length})</p>
                <ul className="space-y-1">
                  {extraction.needs.map((n, i) => <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" /> {n}</li>)}
                </ul>
                <p className="mt-1.5 text-[10.5px] italic text-[var(--text-muted)]">You’ll be able to answer these in the chat (coming next).</p>
              </div>
            )}
          </div>

          {/* RIGHT — chat (Phase 2 placeholder) */}
          <div className="flex min-h-0 flex-col bg-black/[0.015]">
            <div className="flex items-center gap-1.5 border-b border-black/5 px-4 py-2.5 text-[12px] font-bold text-[var(--text-primary)]"><MessageSquare size={13} className="text-[var(--accent)]" /> Ask SMITH</div>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
              <MessageSquare size={22} className="text-[var(--text-muted)]/50" />
              <p className="text-[12px] font-semibold text-[var(--text-secondary)]">Chat with SMITH is coming next</p>
              <p className="text-[11px] text-[var(--text-muted)]">You’ll be able to answer SMITH’s questions, add a missing document, or refine any figure — and it’ll update the list on the left.</p>
            </div>
            <div className="flex items-center gap-2 border-t border-black/5 px-3 py-2.5">
              <input disabled placeholder="Ask SMITH about this scan…" className="input-base flex-1 py-1.5 text-[12px] opacity-60" />
              <button disabled className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/40 text-white"><Send size={14} /></button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <p className="text-[12px] text-[var(--text-muted)]">Importing <span className="font-bold text-[var(--text-primary)]">{included.length}</span> figure{included.length === 1 ? '' : 's'} · <span className="font-bold text-[var(--text-primary)]">{fmtMoney(total)}</span> — added to what’s already on the return.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={doImport} disabled={included.length === 0} className="btn-primary disabled:opacity-40">{imported ? <Check size={15} /> : <Check size={15} />} {imported ? 'Imported' : `Import ${included.length}`}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
