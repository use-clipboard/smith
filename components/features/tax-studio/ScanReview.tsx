'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, FileText, Sparkles, AlertTriangle, HelpCircle, MessageSquare, Send, Loader2, Plus, Upload } from 'lucide-react';
import { fmtMoney } from './data';
import {
  buildScanProposals, applyScanProposals, applyScanEdit, fetchScanChat, scanDestLabel, SCAN_DESTS,
  encodeFile, fetchExtraction,
  type Sa100Extraction, type ScanProposal, type ScanEdit,
} from './extract';
import type { TaxReturn } from './types';

interface ChatMsg { role: 'user' | 'assistant'; content: string; edits?: ScanEdit[]; appliedEdits?: Set<number> }

type Patch = (u: (r: TaxReturn) => TaxReturn) => void;

// Two-panel scan-review lightbox. LEFT: what SMITH found — editable proposals
// (amount + destination) and a "set aside" list with plain-English reasons.
// RIGHT: a chat panel (wired in Phase 2). Nothing imports until you press Import.
export default function ScanReview({ ret, patch, extraction, batchId, onClose }: {
  ret: TaxReturn; patch: Patch; extraction: Sa100Extraction; batchId: string; onClose: () => void;
}) {
  const [proposals, setProposals] = useState<ScanProposal[]>(() => buildScanProposals(extraction));
  const [imported, setImported] = useState(false);

  // Documents read / set-aside / needs start from the first scan but GROW as more
  // documents are scanned in-session (Phase 3).
  const [docs, setDocs] = useState(extraction.documents);
  const [setAside, setSetAside] = useState(extraction.setAside);
  const [needs, setNeeds] = useState(extraction.needs);

  // ── Ask-SMITH chat ──
  const [messages, setMessages] = useState<ChatMsg[]>(() => [{
    role: 'assistant',
    content: extraction.needs[0]
      ? `I've listed what I found on the left. A few things need your input — let's start there: ${extraction.needs[0]}`
      : `I've listed what I found on the left. Ask me anything, or tell me about anything I've set aside and I'll sort it.`,
  }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending, scanning]);

  const upd = (id: string, u: Partial<ScanProposal>) => setProposals(ps => ps.map(p => p.id === id ? { ...p, ...u } : p));
  const included = proposals.filter(p => p.dest !== 'exclude');
  // Headline £ = income brought on. PAYE tax and expenses are components of an
  // employment (a credit / a deduction), not income lines, so they're listed but
  // not summed here.
  const isIncomeFigure = (p: ScanProposal) => p.empField !== 'taxDeducted' && p.empField !== 'expenses';
  const total = included.reduce((a, p) => a + (isIncomeFigure(p) ? (p.amount || 0) : 0), 0);

  // ── Phase 3 — scan another document without leaving the review ──
  async function onScanMore(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length || scanning) return;
    setScanning(true);
    setMessages(ms => [...ms, { role: 'assistant', content: `Reading ${list.length === 1 ? list[0].name : `${list.length} documents`}…` }]);
    try {
      const encoded = await Promise.all(list.map(encodeFile));
      const ex = await fetchExtraction(ret.taxYear, encoded);
      const fresh = buildScanProposals(ex);
      setProposals(ps => [...ps, ...fresh]);
      setDocs(d => [...d, ...ex.documents]);
      setSetAside(s => [...s, ...ex.setAside]);
      setNeeds(n => Array.from(new Set([...n, ...ex.needs])));
      const found = fresh.filter(p => p.empField !== 'taxDeducted' && p.empField !== 'expenses');
      const summary = found.length
        ? `Read ${ex.documents.map(d => d.docType).join(', ') || 'the document'} — I've added ${fresh.length} figure${fresh.length === 1 ? '' : 's'} to the list on the left. Have a look and adjust anything that needs it.`
        : `I read ${ex.documents.map(d => d.docType).join(', ') || 'the document'} but couldn't pull out a clear figure — take a look at what I've set aside.`;
      setMessages(ms => [...ms, { role: 'assistant', content: summary }]);
    } catch (e) {
      setMessages(ms => [...ms, { role: 'assistant', content: e instanceof Error ? e.message : 'I couldn’t read that document — please try again.' }]);
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(history);
    setInput('');
    setSending(true);
    try {
      const { reply, edits } = await fetchScanChat({
        taxYear: ret.taxYear,
        documents: docs.map(d => ({ docType: d.docType, summary: d.summary })),
        proposals: proposals.filter(p => p.dest !== 'exclude').map(p => ({ label: p.label, amount: p.amount, dest: p.dest })),
        setAside,
        needs,
        messages: history.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(ms => [...ms, { role: 'assistant', content: reply, edits: edits.length ? edits : undefined, appliedEdits: new Set() }]);
    } catch (e) {
      setMessages(ms => [...ms, { role: 'assistant', content: e instanceof Error ? e.message : 'SMITH is unavailable right now.' }]);
    } finally {
      setSending(false);
    }
  }

  function applyEdit(msgIdx: number, editIdx: number, edit: ScanEdit) {
    setProposals(ps => applyScanEdit(ps, edit));
    setMessages(ms => ms.map((m, i) => i === msgIdx ? { ...m, appliedEdits: new Set([...(m.appliedEdits ?? []), editIdx]) } : m));
  }

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
            {docs.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Documents read</p>
                <div className="space-y-1">
                  {docs.map((d, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><FileText size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)]" /><span><span className="font-semibold text-[var(--text-primary)]">{d.docType}</span> — {d.summary}</span></p>
                  ))}
                </div>
              </div>
            )}

            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Figures found {included.length > 0 && <span className="text-[var(--accent)]">({included.length})</span>}</p>
            {proposals.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-[12px] text-[var(--text-muted)]">No figures picked up — see “Set aside” below, scan another document, or enter them manually.</p>
            ) : (
              <div className="space-y-1.5">
                {proposals.map(p => {
                  const on = p.dest !== 'exclude';
                  const isSub = !!p.empField && p.empField !== 'pay'; // an employment companion figure (tax/benefits/expenses)
                  return (
                    <div key={p.id} className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${isSub ? 'ml-5 border-l-2 border-l-[var(--accent)]/25' : ''} ${on ? 'border-[var(--accent)]/30 bg-[var(--accent)]/[0.03]' : 'border-[var(--border)] bg-black/[0.015] opacity-70'}`}>
                      <input type="checkbox" checked={on} onChange={e => upd(p.id, { dest: e.target.checked ? (p.origin === 'exclude' ? 'otherIncome' : p.origin) : 'exclude' })} className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-[var(--accent)]" aria-label="Include" />
                      <span className={`min-w-0 flex-1 truncate text-[12px] ${isSub ? 'text-[var(--text-secondary)]' : 'font-medium text-[var(--text-primary)]'}`}>{p.label}</span>
                      <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1.5">
                        <span className="text-[11px] text-[var(--text-muted)]">£</span>
                        <input type="number" value={p.amount || ''} onChange={e => upd(p.id, { amount: Number(e.target.value) || 0 })} className="w-20 bg-transparent py-1 text-right text-[12px] outline-none" />
                      </div>
                      <span className="text-[11px] text-[var(--text-muted)]">→</span>
                      {isSub ? (
                        <span className="rounded-md border border-[var(--border)] bg-black/[0.02] px-2 py-1 text-[11px] text-[var(--text-muted)]">Employment (SA102)</span>
                      ) : (
                        <select value={p.dest} onChange={e => upd(p.id, { dest: e.target.value as ScanProposal['dest'] })} className={`rounded-md border py-1 text-[11.5px] ${p.dest !== p.origin && on ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-[var(--border)] bg-white text-[var(--text-secondary)]'}`}>
                          {SCAN_DESTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Phase 3 — scan another document in-session */}
            <input ref={fileRef} type="file" multiple accept="application/pdf,image/*,.csv,.txt" className="hidden" onChange={e => onScanMore(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={scanning}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--accent)]/40 bg-[var(--accent)]/[0.03] px-3 py-2 text-[12px] font-semibold text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/[0.07] disabled:opacity-50">
              {scanning ? <><Loader2 size={13} className="animate-spin" /> Reading…</> : <><Upload size={13} /> Scan another document</>}
            </button>

            {setAside.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700"><AlertTriangle size={12} /> Set aside ({setAside.length})</p>
                <div className="space-y-1.5">
                  {setAside.map((s, i) => (
                    <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">{s.label}</p>
                      <p className="text-[11px] text-amber-800">{s.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {needs.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><HelpCircle size={12} /> SMITH would like to know ({needs.length})</p>
                <ul className="space-y-1">
                  {needs.map((n, i) => <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" /> {n}</li>)}
                </ul>
                <p className="mt-1.5 text-[10.5px] italic text-[var(--text-muted)]">Answer these in the chat, or scan the document above and I’ll fold it in.</p>
              </div>
            )}
          </div>

          {/* RIGHT — Ask SMITH chat */}
          <div className="flex min-h-0 flex-col bg-black/[0.015]">
            <div className="flex items-center gap-1.5 border-b border-black/5 px-4 py-2.5 text-[12px] font-bold text-[var(--text-primary)]"><MessageSquare size={13} className="text-[var(--accent)]" /> Ask SMITH</div>
            <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-auto px-3 py-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[88%] rounded-2xl px-3 py-1.5 text-[12px] leading-snug ${m.role === 'user' ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--text-primary)] shadow-sm'}`}>
                    {m.content}
                    {m.edits && m.edits.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {m.edits.map((e, j) => {
                          const applied = m.appliedEdits?.has(j);
                          const verb = e.action === 'exclude' ? 'Remove' : e.action === 'add' ? 'Add' : 'Update';
                          const target = e.action === 'add' ? e.label : e.target;
                          return (
                            <div key={j} className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] px-2 py-1.5">
                              <p className="text-[11px] font-semibold text-[var(--text-primary)]">{verb}: {target}{e.amount != null ? ` — ${fmtMoney(e.amount)}` : ''}{e.dest ? ` → ${scanDestLabel(e.dest)}` : ''}</p>
                              {e.reason && <p className="text-[10.5px] text-[var(--text-muted)]">{e.reason}</p>}
                              <button onClick={() => !applied && applyEdit(i, j, e)} disabled={applied}
                                className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-colors ${applied ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--accent)] text-white hover:opacity-90'}`}>
                                {applied ? <><Check size={11} /> Applied</> : <><Plus size={11} /> Apply</>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && <div className="flex justify-start"><div className="rounded-2xl bg-white px-3 py-1.5 text-[12px] text-[var(--text-muted)] shadow-sm"><Loader2 size={13} className="inline animate-spin" /> SMITH is thinking…</div></div>}
            </div>
            <div className="flex items-center gap-2 border-t border-black/5 px-3 py-2.5">
              <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Reply to SMITH…" className="input-base flex-1 py-1.5 text-[12px]" />
              <button onClick={send} disabled={sending || !input.trim()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"><Send size={14} /></button>
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
