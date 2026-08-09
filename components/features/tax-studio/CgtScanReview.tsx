'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, FileText, Sparkles, AlertTriangle, HelpCircle, MessageSquare, Send, Loader2, Plus, Upload, Trash2 } from 'lucide-react';
import { fmtMoney } from './data';
import {
  encodeFile, fetchCgtExtraction, proposalsFromExtraction, proposalToDisposal, applyCgtScanEdit, fetchCgtScanChat, proposalGain,
  type CgtScanProposal, type CgtScanEdit,
} from './cgtScan';
import type { CgtCalcDisposal } from './types';

interface ChatMsg { role: 'user' | 'assistant'; content: string; edits?: CgtScanEdit[]; applied?: Set<number> }
const ASSET_LABELS: Record<CgtScanProposal['assetClass'], string> = {
  residential: 'Residential property', listed: 'Listed shares', unlisted: 'Unlisted shares', crypto: 'Cryptoassets', other: 'Other assets',
};

// Two-panel CGT document scanner. LEFT: proposed disposals (editable) from the
// scan(s). RIGHT: SMITH's relief interview. Applying adds the disposals to the
// calculator; nothing changes until you press Add.
export default function CgtScanReview({ taxYear, taxpayerName, onApply, onClose }: {
  taxYear: string; taxpayerName: string; onApply: (disposals: CgtCalcDisposal[]) => void; onClose: () => void;
}) {
  const [proposals, setProposals] = useState<CgtScanProposal[]>([]);
  const [docs, setDocs] = useState<{ docType: string; summary: string }[]>([]);
  const [setAside, setSetAside] = useState<{ label: string; reason: string }[]>([]);
  const [needs, setNeeds] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [added, setAdded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMsg[]>([{ role: 'assistant', content: `Drop a completion statement, contract note, broker certificate or CGT computation on the left and I'll pull out the disposals. I'll ask about anything that decides a relief (main home, dates, improvements).` }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [messages, sending, scanning]);

  const included = proposals.filter(p => p.include);
  const upd = (id: string, u: Partial<CgtScanProposal>) => setProposals(ps => ps.map(p => p.id === id ? { ...p, ...u } : p));

  async function onScan(files: FileList | null) {
    const list = files ? Array.from(files) : [];
    if (!list.length || scanning) return;
    setScanning(true);
    setMessages(ms => [...ms, { role: 'assistant', content: `Reading ${list.length === 1 ? list[0].name : `${list.length} documents`}…` }]);
    try {
      const encoded = await Promise.all(list.map(encodeFile));
      const ex = await fetchCgtExtraction(taxYear, encoded);
      const fresh = proposalsFromExtraction(ex);
      setProposals(ps => [...ps, ...fresh]);
      setDocs(d => [...d, ...ex.documents]);
      setSetAside(s => [...s, ...ex.setAside]);
      setNeeds(n => Array.from(new Set([...n, ...ex.needs])));
      const first = ex.needs[0];
      setMessages(ms => [...ms, { role: 'assistant', content: fresh.length ? `Found ${fresh.length} disposal${fresh.length === 1 ? '' : 's'}.${first ? ` First: ${first}` : ' Have a look on the left and adjust anything.'}` : `I read ${ex.documents.map(d => d.docType).join(', ') || 'the document'} but couldn't pull out a clear disposal — check what I've set aside.` }]);
    } catch (e) {
      setMessages(ms => [...ms, { role: 'assistant', content: e instanceof Error ? e.message : 'I couldn’t read that document — please try again.' }]);
    } finally { setScanning(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }];
    setMessages(history); setInput(''); setSending(true);
    try {
      const { reply, edits } = await fetchCgtScanChat({
        taxYear,
        documents: docs,
        disposals: included.map(p => ({ description: p.description, assetClass: p.assetClass, proceeds: p.proceeds, gain: proposalGain(p) })),
        needs,
        messages: history.map(m => ({ role: m.role, content: m.content })),
      });
      setMessages(ms => [...ms, { role: 'assistant', content: reply, edits: edits.length ? edits : undefined, applied: new Set() }]);
    } catch (e) {
      setMessages(ms => [...ms, { role: 'assistant', content: e instanceof Error ? e.message : 'SMITH is unavailable right now.' }]);
    } finally { setSending(false); }
  }

  function applyEdit(msgIdx: number, editIdx: number, edit: CgtScanEdit) {
    setProposals(ps => applyCgtScanEdit(ps, edit));
    setMessages(ms => ms.map((m, i) => i === msgIdx ? { ...m, applied: new Set([...(m.applied ?? []), editIdx]) } : m));
  }

  function doAdd() {
    onApply(included.map(proposalToDisposal));
    setAdded(true);
    setTimeout(onClose, 500);
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-3" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="flex items-center gap-2 text-[15px] font-bold text-[var(--text-primary)]"><Sparkles size={16} className="text-[var(--accent)]" /> Scan CGT documents</p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_340px]">
          {/* LEFT — disposals */}
          <div className="min-h-0 overflow-auto border-r border-black/5 px-5 py-4">
            {docs.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Documents read</p>
                <div className="space-y-1">
                  {docs.map((d, i) => <p key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><FileText size={12} className="mt-0.5 shrink-0 text-[var(--text-muted)]" /><span><span className="font-semibold text-[var(--text-primary)]">{d.docType}</span> — {d.summary}</span></p>)}
                </div>
              </div>
            )}

            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Disposals found {included.length > 0 && <span className="text-[var(--accent)]">({included.length})</span>}</p>
            {proposals.length === 0 ? (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--accent)]/40 bg-[var(--accent)]/[0.03] px-4 py-10 text-center hover:bg-[var(--accent)]/[0.06]">
                <input ref={fileRef} type="file" multiple accept="application/pdf,image/*,.csv,.txt" className="hidden" onChange={e => onScan(e.target.files)} />
                {scanning ? <><Loader2 size={20} className="animate-spin text-[var(--accent)]" /><span className="text-[12px] font-semibold text-[var(--accent)]">Reading…</span></> : <><Upload size={20} className="text-[var(--accent)]" /><span className="text-[12px] font-semibold text-[var(--accent)]">Choose CGT documents</span><span className="text-[11px] text-[var(--text-muted)]">Completion statements, contract notes, broker certificates, crypto CSVs, CGT computations</span></>}
              </label>
            ) : (
              <div className="space-y-2">
                {proposals.map(p => {
                  const gain = proposalGain(p);
                  return (
                    <div key={p.id} className={`rounded-xl border px-3 py-2 transition-colors ${p.include ? 'border-[var(--accent)]/30 bg-[var(--accent)]/[0.03]' : 'border-[var(--border)] bg-black/[0.015] opacity-70'}`}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <input type="checkbox" checked={p.include} onChange={e => upd(p.id, { include: e.target.checked })} className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-[var(--accent)]" aria-label="Include" />
                        <input value={p.description} onChange={e => upd(p.id, { description: e.target.value })} className="input-base flex-1 py-1 text-[12px] font-semibold" />
                        <select value={p.assetClass} onChange={e => upd(p.id, { assetClass: e.target.value as CgtScanProposal['assetClass'] })} className="input-base py-1 text-[11px]">
                          {(Object.keys(ASSET_LABELS) as CgtScanProposal['assetClass'][]).map(k => <option key={k} value={k}>{ASSET_LABELS[k]}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([['Proceeds', 'proceeds'], ['Acq. cost', 'acquisitionCost'], ['Buy/sell', 'incidentalCosts'], ['Improve', 'improvementCosts']] as const).map(([lbl, key]) => (
                          <div key={key}>
                            <label className="mb-0.5 block text-[9.5px] font-medium text-[var(--text-muted)]">{lbl}</label>
                            <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1"><span className="text-[10px] text-[var(--text-muted)]">£</span><input type="number" value={(p[key] as number) || ''} onChange={e => upd(p.id, { [key]: Number(e.target.value) || 0 })} className="w-full bg-transparent py-0.5 text-right text-[11.5px] outline-none" /></div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-[11px]">
                        {p.assetClass === 'residential'
                          ? <label className="flex items-center gap-1 text-[var(--text-muted)]"><input type="checkbox" checked={!!p.wasMainResidence} onChange={e => upd(p.id, { wasMainResidence: e.target.checked })} className="h-3 w-3 accent-[var(--accent)]" /> Was main home</label>
                          : <span />}
                        <span className={`font-bold ${gain < 0 ? 'text-rose-600' : 'text-[var(--text-primary)]'}`}>{gain < 0 ? `Loss ${fmtMoney(-gain)}` : `Gain ${fmtMoney(gain)}`}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {proposals.length > 0 && (
              <>
                <input ref={fileRef} type="file" multiple accept="application/pdf,image/*,.csv,.txt" className="hidden" onChange={e => onScan(e.target.files)} />
                <button onClick={() => fileRef.current?.click()} disabled={scanning} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--accent)]/40 bg-[var(--accent)]/[0.03] px-3 py-2 text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/[0.07] disabled:opacity-50">
                  {scanning ? <><Loader2 size={13} className="animate-spin" /> Reading…</> : <><Upload size={13} /> Scan another document</>}
                </button>
              </>
            )}

            {setAside.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-amber-700"><AlertTriangle size={12} /> Set aside ({setAside.length})</p>
                <div className="space-y-1.5">{setAside.map((s, i) => <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5"><p className="text-[12px] font-semibold text-[var(--text-primary)]">{s.label}</p><p className="text-[11px] text-amber-800">{s.reason}</p></div>)}</div>
              </div>
            )}
            {needs.length > 0 && (
              <div className="mt-4">
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]"><HelpCircle size={12} /> SMITH would like to know ({needs.length})</p>
                <ul className="space-y-1">{needs.map((n, i) => <li key={i} className="flex items-start gap-1.5 text-[11.5px] text-[var(--text-secondary)]"><span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" /> {n}</li>)}</ul>
                <p className="mt-1.5 text-[10.5px] italic text-[var(--text-muted)]">Answer these in the chat and I'll set the reliefs.</p>
              </div>
            )}
          </div>

          {/* RIGHT — relief chat */}
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
                          const applied = m.applied?.has(j);
                          const target = e.action === 'add' ? (e.patch?.description ?? 'new disposal') : e.target;
                          return (
                            <div key={j} className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/[0.05] px-2 py-1.5">
                              <p className="text-[11px] font-semibold text-[var(--text-primary)]">{e.action === 'add' ? 'Add' : 'Update'}: {target}</p>
                              {e.reason && <p className="text-[10.5px] text-[var(--text-muted)]">{e.reason}</p>}
                              <button onClick={() => !applied && applyEdit(i, j, e)} disabled={applied} className={`mt-1 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold transition-colors ${applied ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--accent)] text-white hover:opacity-90'}`}>{applied ? <><Check size={11} /> Applied</> : <><Plus size={11} /> Apply</>}</button>
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

        <div className="flex items-center justify-between border-t border-black/5 px-5 py-3">
          <p className="text-[12px] text-[var(--text-muted)]">Adding <span className="font-bold text-[var(--text-primary)]">{included.length}</span> disposal{included.length === 1 ? '' : 's'} to the calculator.</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={doAdd} disabled={included.length === 0} className="btn-primary disabled:opacity-40"><Check size={15} /> {added ? 'Added' : `Add ${included.length}`}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
