'use client';

/**
 * OpeningBalancesModal — AI opening-balances wizard.
 *
 * Step 1 (upload): the user drops a prior-year trial balance / set of accounts
 * (PDF, image, CSV or Excel). PDFs and images go to the AI as base64; CSV/Excel
 * are parsed to text client-side first.
 * Step 2 (review): the AI returns the opening figures mapped to this book's
 * chart of accounts. The user reviews/edits each line (account, debit, credit),
 * resolves any new-account suggestions, makes it balance, then posts a single
 * opening journal through the existing /transactions endpoint.
 *
 * Nothing posts without the user's click — the AI only prepares the proposal.
 */

import { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  X, UploadCloud, Loader2, Sparkles, FileText, Check, Plus, Trash2,
  AlertTriangle, ShieldCheck, Scale,
} from 'lucide-react';
import AccountPicker from '../input/AccountPicker';
import DateInput, { toIso, fromIso } from '../input/DateInput';
import { formatMoney } from '@/lib/bookkeeping/formatMoney';
import { fileToBase64, readFileAsText, compressImage } from '@/utils/fileUtils';
import type { BookAccountRef } from '@/types/bookkeeping';

interface ApiLine {
  account_id: string | null;
  account_name: string;
  account_ledger: string | null;
  new_account: { name: string; ledger: string; account_type: string } | null;
  label: string;
  debit: number;
  credit: number;
}

interface EditLine {
  key: string;
  account_id: string | null;
  account_display: string;
  suggestedNew: { name: string; ledger: string; account_type: string } | null;
  label: string;
  debit: number;
  credit: number;
}

let keySeq = 0;
const nextKey = () => `ob${++keySeq}`;

function isPdf(f: File) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); }
function isImage(f: File) { return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(f.name); }
function isSheet(f: File) { return /\.(csv|xlsx?|xls)$/i.test(f.name) || f.type.includes('csv') || f.type.includes('sheet') || f.type.includes('excel'); }

export default function OpeningBalancesModal({
  bookId, bookName, firstPeriodStart, onClose, onPosted,
}: {
  bookId: string;
  bookName?: string;
  firstPeriodStart: string | null;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const [lines, setLines] = useState<EditLine[]>([]);
  const [dateUk, setDateUk] = useState('');
  const [posting, setPosting] = useState(false);
  const [postedRef, setPostedRef] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError('');
    setFiles(prev => [...prev, ...Array.from(list)]);
  }

  async function extract() {
    if (files.length === 0) { setError('Choose a trial balance or set of accounts first.'); return; }
    setBusy(true);
    setError('');
    try {
      const apiFiles: { name: string; mimeType: string; base64: string }[] = [];
      const textParts: string[] = [];
      for (const f of files) {
        if (isSheet(f)) {
          if (/\.(xlsx?|xls)$/i.test(f.name) || f.type.includes('sheet') || f.type.includes('excel')) {
            const buf = await f.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const csv = wb.SheetNames.map(n => XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n');
            textParts.push(`${f.name}:\n${csv}`);
          } else {
            textParts.push(`${f.name}:\n${await readFileAsText(f)}`);
          }
        } else if (isImage(f)) {
          const compressed = await compressImage(f).catch(() => f);
          apiFiles.push({ name: f.name, mimeType: 'image/jpeg', base64: await fileToBase64(compressed) });
        } else if (isPdf(f)) {
          apiFiles.push({ name: f.name, mimeType: 'application/pdf', base64: await fileToBase64(f) });
        } else {
          // Unknown — try as text.
          textParts.push(`${f.name}:\n${await readFileAsText(f).catch(() => '')}`);
        }
      }

      const r = await fetch(`/api/bookkeeping/books/${bookId}/opening-balances/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: apiFiles, textContent: textParts.join('\n\n') || null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not read the document.');

      const apiLines = (d.lines ?? []) as ApiLine[];
      if (apiLines.length === 0) throw new Error('No opening balances were found in that document.');
      setLines(apiLines.map(l => ({
        key: nextKey(),
        account_id: l.account_id,
        account_display: l.account_ledger ? `${l.account_ledger}: ${l.account_name}` : l.account_name,
        suggestedNew: l.new_account,
        label: l.label,
        debit: l.debit,
        credit: l.credit,
      })));
      setDateUk(fromIso(d.defaultDate ?? firstPeriodStart ?? new Date().toISOString().slice(0, 10)));
      setNote(d.note ?? '');
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the document.');
    } finally {
      setBusy(false);
    }
  }

  function patchLine(key: string, patch: Partial<EditLine>) {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  }
  function setAccount(key: string, account: BookAccountRef | null) {
    patchLine(key, {
      account_id: account?.id ?? null,
      account_display: account ? (account.ledger ? `${account.ledger}: ${account.name}` : account.name) : '',
      suggestedNew: null,
    });
  }
  function setAmount(key: string, side: 'debit' | 'credit', raw: string) {
    const n = Math.max(0, Number(raw.replace(/[^0-9.]/g, '')) || 0);
    patchLine(key, side === 'debit' ? { debit: n, credit: 0 } : { credit: n, debit: 0 });
  }

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const diff = +(totalDebit - totalCredit).toFixed(2);
  const balanced = Math.abs(diff) < 0.005;
  const allAccountsSet = lines.every(l => l.account_id);
  const canPost = balanced && allAccountsSet && lines.length > 0 && !posting && !postedRef;

  function addBalancingLine() {
    // Append a line carrying the difference on the side that squares the books.
    // The user picks the contra account (Opening balances contra / Suspense).
    setLines(prev => [...prev, {
      key: nextKey(), account_id: null, account_display: '', suggestedNew: null,
      label: 'Opening balance contra',
      debit: diff < 0 ? Math.abs(diff) : 0,
      credit: diff > 0 ? diff : 0,
    }]);
  }

  async function post() {
    if (!canPost) return;
    setPosting(true);
    setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'JRN',
          date: toIso(dateUk),
          details: 'Opening balances',
          total: +totalDebit.toFixed(2),
          vat_total: 0,
          vat_treatment: null,
          primary_account_id: null,
          splits: lines.map(l => ({
            account_id: l.account_id,
            debit: +l.debit.toFixed(2),
            credit: +l.credit.toFixed(2),
            entry_details: l.label || 'Opening balance',
          })),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not post the opening balances.');
      setPostedRef(d.transaction?.ref_no ?? 'JRN');
      onPosted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post the opening balances.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><Sparkles size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Opening Balances{bookName ? ` — ${bookName}` : ''}</h2>
            <p className="text-[11px] text-slate-500">Upload last year&apos;s accounts or trial balance — SMITH maps them to this book and prepares the opening journal.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="mb-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {step === 'upload' && (
            <div className="space-y-4">
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-10 px-6 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                <UploadCloud size={26} className="text-slate-400" />
                <span className="text-sm font-medium text-slate-700">Choose files to upload</span>
                <span className="text-xs text-slate-500">Trial balance or accounts — PDF, JPG, PNG, CSV or Excel</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.csv,.xlsx,.xls,.jpg,.jpeg,.png,image/*,application/pdf"
                  className="hidden"
                  onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
                />
              </label>

              {files.length > 0 && (
                <ul className="space-y-1.5">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                      <FileText size={14} className="text-slate-400 shrink-0" />
                      <span className="flex-1 truncate">{f.name}</span>
                      <span className="text-xs text-slate-400">{Math.round(f.size / 1024)} KB</span>
                      <button type="button" onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} aria-label="Remove" className="text-slate-400 hover:text-rose-500"><X size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex justify-end">
                <button type="button" onClick={extract} disabled={busy || files.length === 0} className="btn-primary text-sm disabled:opacity-50">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {busy ? 'Reading…' : 'Extract balances'}
                </button>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              {postedRef ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-800">
                  <ShieldCheck size={18} className="text-emerald-600" />
                  Opening balances posted as <span className="font-semibold">{postedRef}</span>.
                </div>
              ) : (
                <>
                  {note && (
                    <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <Sparkles size={13} className="mt-0.5 shrink-0" /> {note}
                    </div>
                  )}

                  <div className="flex items-center gap-3 flex-wrap">
                    <label className="text-xs text-slate-600 inline-flex items-center gap-2">
                      Opening date
                      <span className="w-32"><DateInput value={dateUk} onChange={setDateUk} ariaLabel="Opening balance date" /></span>
                    </label>
                    <span className="text-[11px] text-slate-400">Posted as a single opening journal on this date.</span>
                  </div>

                  {/* Grid */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-1.5 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 font-semibold">
                      <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span><span />
                    </div>
                    <div className="divide-y divide-slate-100">
                      {lines.map(l => (
                        <div key={l.key} className="grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-1.5 items-start">
                          <div>
                            <AccountPicker
                              bookId={bookId}
                              value={l.account_id}
                              valueDisplay={l.account_id ? l.account_display : undefined}
                              onChange={acct => setAccount(l.key, acct)}
                              placeholder={l.suggestedNew ? `New: ${l.suggestedNew.ledger}: ${l.suggestedNew.name}` : (l.label || 'Choose account')}
                            />
                            {l.suggestedNew && !l.account_id && (
                              <SuggestedAccountHint bookId={bookId} suggestion={l.suggestedNew} onCreated={acct => setAccount(l.key, acct)} />
                            )}
                            {!l.account_id && !l.suggestedNew && (
                              <p className="mt-0.5 text-[11px] text-amber-600">From “{l.label}” — choose an account.</p>
                            )}
                          </div>
                          <input type="text" inputMode="decimal" aria-label="Debit" value={l.debit ? String(l.debit) : ''} onChange={e => setAmount(l.key, 'debit', e.target.value)} placeholder="0.00" className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full" />
                          <input type="text" inputMode="decimal" aria-label="Credit" value={l.credit ? String(l.credit) : ''} onChange={e => setAmount(l.key, 'credit', e.target.value)} placeholder="0.00" className="text-right text-sm tabular-nums bg-white border border-slate-200 rounded-md px-1.5 py-1 outline-none focus:border-indigo-400 w-full" />
                          <div className="flex justify-center pt-1.5">
                            <button type="button" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))} aria-label="Remove line" className="text-slate-300 hover:text-rose-500"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    {/* Totals */}
                    <div className="grid grid-cols-[1fr_110px_110px_32px] gap-x-2 px-3 py-2 border-t border-slate-200 bg-slate-50/60 items-center text-sm">
                      <button type="button" onClick={() => setLines(prev => [...prev, { key: nextKey(), account_id: null, account_display: '', suggestedNew: null, label: '', debit: 0, credit: 0 }])} className="text-xs text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1 justify-self-start">
                        <Plus size={12} /> Add line
                      </button>
                      <span className="text-right tabular-nums font-semibold text-slate-800">{formatMoney(totalDebit)}</span>
                      <span className="text-right tabular-nums font-semibold text-slate-800">{formatMoney(totalCredit)}</span>
                      <span />
                    </div>
                  </div>

                  {/* Balance status */}
                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
                    {balanced ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-700"><ShieldCheck size={14} /> Balanced{!allAccountsSet ? ' — assign an account to every line' : ''}</span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-amber-700">
                        <AlertTriangle size={14} /> Out of balance by {formatMoney(Math.abs(diff))}
                        <button type="button" onClick={addBalancingLine} className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 underline"><Scale size={12} /> Add balancing line</button>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 'review' && (
          <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
            <button type="button" onClick={() => { setStep('upload'); setPostedRef(null); }} className="text-sm text-slate-500 hover:text-slate-700">{postedRef ? '← Start over' : '← Back'}</button>
            {postedRef ? (
              <button type="button" onClick={onClose} className="btn-primary text-sm">Done</button>
            ) : (
              <button type="button" onClick={post} disabled={!canPost} className="btn-primary text-sm disabled:opacity-50">
                {posting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {posting ? 'Posting…' : 'Post opening balances'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// "Create & use" for an AI-suggested new account.
function SuggestedAccountHint({
  bookId, suggestion, onCreated,
}: {
  bookId: string;
  suggestion: { name: string; ledger: string; account_type: string };
  onCreated: (acct: BookAccountRef) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function create() {
    setBusy(true); setErr('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(suggestion),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.account) { onCreated(d.account as BookAccountRef); return; }
      if (r.status === 409) {
        const g = await fetch(`/api/bookkeeping/books/${bookId}/accounts?ledger=${encodeURIComponent(suggestion.ledger)}&search=${encodeURIComponent(suggestion.name)}`);
        const gd = await g.json().catch(() => ({}));
        const match = (gd.accounts ?? []).find((a: BookAccountRef) => a.name.toLowerCase() === suggestion.name.toLowerCase());
        if (match) { onCreated(match); return; }
      }
      throw new Error(d.error ?? 'Could not create the account.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the account.');
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-0.5 text-[11px] text-indigo-600 flex items-center gap-1.5 flex-wrap">
      <Sparkles size={11} /><span>New account suggested</span>
      <button type="button" onClick={create} disabled={busy} className="underline hover:text-indigo-800 disabled:opacity-50 inline-flex items-center gap-1">{busy && <Loader2 size={10} className="animate-spin" />} Create &amp; use</button>
      {err && <span className="text-rose-600 w-full">{err}</span>}
    </div>
  );
}
