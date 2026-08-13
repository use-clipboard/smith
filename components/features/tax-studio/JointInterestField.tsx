'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Trash2, X, Check, ArrowUpRight, Loader2 } from 'lucide-react';
import FieldHelp from './FieldHelp';
import { fmtMoney } from './data';
import { ownerShareFraction } from './calc';
import OwnershipEditor from './OwnershipEditor';
import { interestCoOwners, findCoOwnerReturn, pushInterestToCoOwner, type InterestCoOwnerGroup } from './interestCoOwner';
import type { CgtOwner, TaxedInterestItem, SavingsItem, TaxReturn, ReturnTypeId } from './types';

export type InterestItem = { id: string; description?: string; net?: number; tax?: number; amount?: number; owners?: CgtOwner[] };

let _oid = 0;
const oid = () => `io-${Date.now()}-${_oid++}`;

const rowWhole = (t: InterestItem, kind: 'taxed' | 'untaxed') => kind === 'taxed' ? (t.net || 0) + (t.tax || 0) : (t.amount || 0);

/** Interest breakdown (taxed box 1 / untaxed box 2) that supports JOINT accounts:
 *  mark an entry joint, split it any way between the taxpayer and co-owners, and
 *  push each co-owner's share to their own return. The field total shows only the
 *  taxpayer's share. */
export default function JointInterestField({ box, label, title, help, kind, items, onChange, taxYear, taxpayerName, returnType }: {
  box: number | string; label: string; title: string; help?: string;
  kind: 'taxed' | 'untaxed';
  items: InterestItem[];
  onChange: (items: InterestItem[]) => void;
  taxYear: string; taxpayerName: string; returnType?: ReturnTypeId;
}) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((a, t) => a + rowWhole(t, kind) * ownerShareFraction(t.owners), 0);
  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)]">
        <span data-editbox={box != null ? String(box) : undefined} className="rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{box}</span>
        {label}{items.length > 0 && <span className="font-bold text-[var(--text-secondary)]"> ({items.length})</span>}{help && <FieldHelp help={help} label={label} />}
        <button onClick={() => setOpen(true)} className="ml-auto flex h-4 w-4 items-center justify-center rounded bg-[var(--accent)]/10 text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20" aria-label={`Itemise ${label}`}><Plus size={11} /></button>
      </label>
      <button onClick={() => setOpen(true)} className="input-base flex w-full items-center justify-between py-1 text-[12.5px]">
        <span className="text-[var(--text-muted)]">{items.length ? `${items.length} entr${items.length === 1 ? 'y' : 'ies'}` : 'Add entries'}</span>
        <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(total)}</span>
      </button>
      {open && <InterestModal box={box} title={title} kind={kind} items={items} onChange={onChange} onClose={() => setOpen(false)} taxYear={taxYear} taxpayerName={taxpayerName} returnType={returnType} />}
    </div>
  );
}

function InterestModal({ box, title, kind, items, onChange, onClose, taxYear, taxpayerName, returnType }: {
  box: number | string; title: string; kind: 'taxed' | 'untaxed'; items: InterestItem[];
  onChange: (items: InterestItem[]) => void; onClose: () => void; taxYear: string; taxpayerName: string; returnType?: ReturnTypeId;
}) {
  const upd = (id: string, u: Partial<InterestItem>) => onChange(items.map(x => x.id === id ? { ...x, ...u } : x));
  const add = () => onChange([...items, { id: oid() }]);
  const del = (id: string) => onChange(items.filter(x => x.id !== id));
  const setJoint = (it: InterestItem, on: boolean) => upd(it.id, { owners: on ? [{ id: oid(), name: taxpayerName || 'You', sharePct: 50, isTaxpayer: true }, { id: oid(), name: '', sharePct: 50 }] : undefined });

  const groups = interestCoOwners(kind === 'taxed' ? (items as TaxedInterestItem[]) : [], kind === 'untaxed' ? (items as SavingsItem[]) : []).filter(g => g.clientId);
  const [coBusy, setCoBusy] = useState<string | null>(null);
  const [coMsg, setCoMsg] = useState<string | null>(null);
  const [coConfirm, setCoConfirm] = useState<{ group: InterestCoOwnerGroup; existing: TaxReturn | null } | null>(null);

  async function pushCo(group: InterestCoOwnerGroup) {
    if (!returnType) { setCoMsg('Pushing to a co-owner’s return is only available from a live return.'); return; }
    setCoBusy(group.clientId); setCoMsg(null);
    try {
      const { ret, hasInterest } = await findCoOwnerReturn(group.clientId, taxYear);
      if (hasInterest && ret) { setCoConfirm({ group, existing: ret }); return; }
      const { created } = await pushInterestToCoOwner({ group, taxYear, returnType, existing: ret, mode: 'replace' });
      setCoMsg(`${created ? 'Created a new return for' : 'Added to'} ${group.name}’s ${taxYear} return — their ${fmtMoney(group.totalShare)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }
  async function doCoPush(mode: 'replace' | 'add') {
    if (!coConfirm || !returnType) return;
    const { group, existing } = coConfirm; setCoBusy(group.clientId); setCoConfirm(null);
    try {
      await pushInterestToCoOwner({ group, taxYear, returnType, existing, mode });
      setCoMsg(`${mode === 'replace' ? 'Replaced' : 'Added to'} ${group.name}’s ${taxYear} return — their ${fmtMoney(group.totalShare)} share.`);
    } catch (e) { setCoMsg(e instanceof Error ? e.message : 'Could not push to the co-owner’s return.'); }
    finally { setCoBusy(null); }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
          <p className="text-[15px] font-bold text-[var(--text-primary)]">{title} <span className="text-[12px] font-medium text-[var(--text-muted)]">· box {box}</span></p>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>
        <div className="flex-1 space-y-2.5 overflow-auto px-5 py-4">
          {items.length === 0 && <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-[12px] text-[var(--text-muted)]">No entries yet — add one.</p>}
          {items.map(it => {
            const joint = !!it.owners;
            const share = ownerShareFraction(it.owners);
            const whole = rowWhole(it, kind);
            return (
              <div key={it.id} className="rounded-xl border border-[var(--border)] bg-white/70 p-3">
                <div className="flex items-center gap-2">
                  <input value={it.description ?? ''} placeholder="Account / provider" onChange={e => upd(it.id, { description: e.target.value })} className="input-base flex-1 py-1 text-[12.5px] font-semibold" />
                  {kind === 'taxed' ? (
                    <>
                      <NumBox label="Net" value={it.net} onChange={v => upd(it.id, { net: v })} />
                      <NumBox label="Tax" value={it.tax} onChange={v => upd(it.id, { tax: v })} />
                    </>
                  ) : (
                    <NumBox label="Amount" value={it.amount} onChange={v => upd(it.id, { amount: v })} />
                  )}
                  <button onClick={() => del(it.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-rose-50 hover:text-rose-500"><Trash2 size={13} /></button>
                </div>
                <div className="mt-1.5 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)]"><input type="checkbox" checked={joint} onChange={e => setJoint(it, e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" /> Joint account</label>
                  {joint && <span className="text-[11px] text-[var(--text-muted)]">Your share <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(Math.round(whole * share))}</span> of {fmtMoney(whole)}</span>}
                </div>
                {joint && <div className="mt-2 rounded-lg border border-[var(--border)] bg-black/[0.015] p-2"><OwnershipEditor owners={it.owners ?? []} onChange={o => upd(it.id, { owners: o })} taxpayerName={taxpayerName} /></div>}
              </div>
            );
          })}
          <button onClick={add} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline"><Plus size={13} /> Add entry</button>

          {groups.length > 0 && (
            <div className="mt-3 rounded-xl border border-[var(--border)] bg-white/60 p-3">
              <p className="text-[12px] font-bold text-[var(--text-primary)]">Co-owners</p>
              <p className="mt-0.5 text-[10.5px] text-[var(--text-muted)]">Push each co-owner’s share of the joint interest to their own return.</p>
              <div className="mt-2 space-y-1.5">
                {groups.map(g => (
                  <div key={g.clientId} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]">{g.name}</span>
                    <span className="text-[11px] text-[var(--text-muted)]">Share <span className="font-semibold text-[var(--text-primary)]">{fmtMoney(g.totalShare)}</span></span>
                    <button onClick={() => pushCo(g)} disabled={coBusy === g.clientId || !returnType} className="inline-flex items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-0.5 text-[10.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                      {coBusy === g.clientId ? <><Loader2 size={11} className="animate-spin" /> Pushing…</> : <><ArrowUpRight size={11} /> Push to their return</>}
                    </button>
                  </div>
                ))}
              </div>
              {coMsg && <p className="mt-1.5 text-[11px] font-semibold text-emerald-700">{coMsg}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end border-t border-black/5 px-5 py-3">
          <button onClick={onClose} className="btn-primary"><Check size={14} /> Done</button>
        </div>
      </div>

      {coConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => setCoConfirm(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <p className="text-[15px] font-bold text-[var(--text-primary)]">Add to {coConfirm.group.name}’s return</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{coConfirm.group.name}’s {taxYear} return already has interest. Replace it with their share, or add on top?</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button onClick={() => setCoConfirm(null)} className="btn-secondary">Cancel</button>
              <button onClick={() => doCoPush('add')} className="btn-secondary bg-white">Add to existing</button>
              <button onClick={() => doCoPush('replace')} className="btn-primary">Replace</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function NumBox({ label, value, onChange }: { label: string; value?: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-white px-1.5">
      <span className="text-[10px] text-[var(--text-muted)]">{label} £</span>
      <input type="number" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)} className="w-20 bg-transparent py-1 text-right text-[12px] outline-none" />
    </div>
  );
}
