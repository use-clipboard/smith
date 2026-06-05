'use client';

/**
 * AddAccountModal — quick "create an account in an existing ledger" dialog,
 * launched from the Home tab's Quick Actions.
 *
 * Deliberately does NOT let users create new LEDGERS — the ledger structure
 * drives reports, the fixed-asset register, VAT routing and account-type
 * inference, so it stays fixed. You pick from the book's existing ledgers and
 * add an account inside one. The account_type defaults from the ledger but can
 * be overridden.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, Check, Plus } from 'lucide-react';
import type { BookAccountRef } from '@/types/bookkeeping';

type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

const LEDGER_DEFAULT_TYPE: Record<string, AccountType> = {
  Income: 'income', 'Cost of sales': 'expense', Expenses: 'expense', Taxation: 'expense',
  'FA - intangible': 'asset', 'FA - land and buildings': 'asset', 'FA - plant and machinery': 'asset',
  'FA - equipment, fixtures & fittings': 'asset', 'FA - vehicles': 'asset',
  'Investments - fixed': 'asset', 'Investments - current': 'asset', Stocks: 'asset',
  Customers: 'asset', Debtors: 'asset', Bank: 'asset',
  Suppliers: 'liability', Creditors: 'liability', 'Deferred tax': 'liability',
  'Share capital': 'equity', 'Share premium': 'equity', 'Revaluation reserve': 'equity',
  'Profit and loss account': 'equity',
};

const TYPE_OPTIONS: { id: AccountType; label: string }[] = [
  { id: 'asset', label: 'Asset' },
  { id: 'liability', label: 'Liability' },
  { id: 'equity', label: 'Equity' },
  { id: 'income', label: 'Income' },
  { id: 'expense', label: 'Expense' },
];

export default function AddAccountModal({
  bookId, onClose, onCreated,
}: {
  bookId: string;
  onClose: () => void;
  onCreated?: (account: BookAccountRef) => void;
}) {
  const [ledgers, setLedgers] = useState<string[]>([]);
  const [ledger, setLedger] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('expense');
  const [typeTouched, setTypeTouched] = useState(false);
  const [loadingLedgers, setLoadingLedgers] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  // Load the book's existing ledgers (distinct, non-null).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`);
        const d = await r.json().catch(() => ({}));
        const list = [...new Set((d.accounts ?? []).map((a: { ledger: string | null }) => a.ledger).filter(Boolean))] as string[];
        list.sort((a, b) => a.localeCompare(b));
        if (!cancelled) {
          setLedgers(list);
          if (list.length > 0) setLedger(list[0]);
        }
      } finally {
        if (!cancelled) setLoadingLedgers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  // Default the type from the chosen ledger unless the user overrode it.
  useEffect(() => {
    if (!typeTouched && ledger && LEDGER_DEFAULT_TYPE[ledger]) {
      setAccountType(LEDGER_DEFAULT_TYPE[ledger]);
    }
  }, [ledger, typeTouched]);

  async function save() {
    if (!ledger || !name.trim()) { setError('Choose a ledger and enter an account name.'); return; }
    setSaving(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), ledger, account_type: accountType }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not create the account.');
      onCreated?.(d.account as BookAccountRef);
      setDone(`${ledger}: ${name.trim()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Plus size={15} /></span>
          <h2 className="text-sm font-semibold text-slate-900 flex-1">Add account</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        {done ? (
          <div className="p-6 text-center">
            <div className="inline-flex w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 items-center justify-center mb-2"><Check size={18} /></div>
            <p className="text-sm font-medium text-slate-900">Account created</p>
            <p className="text-xs text-slate-500 mt-0.5">{done}</p>
            <div className="flex items-center justify-center gap-2 mt-4">
              <button type="button" onClick={() => { setDone(null); setName(''); }} className="btn-secondary text-sm">Add another</button>
              <button type="button" onClick={onClose} className="btn-primary text-sm">Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3">
              {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Ledger</span>
                {loadingLedgers ? (
                  <div className="mt-1 text-xs text-slate-400 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading ledgers…</div>
                ) : (
                  <select
                    value={ledger}
                    onChange={e => setLedger(e.target.value)}
                    className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 outline-none focus:border-indigo-400 bg-white"
                  >
                    {ledgers.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                )}
                <span className="text-[11px] text-slate-400">New ledgers can&apos;t be added — accounts live inside the existing ones.</span>
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Account name</span>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') save(); }}
                  placeholder="e.g. Subscriptions"
                  autoFocus
                  className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 outline-none focus:border-indigo-400"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">Type</span>
                <select
                  value={accountType}
                  onChange={e => { setAccountType(e.target.value as AccountType); setTypeTouched(true); }}
                  className="mt-1 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 outline-none focus:border-indigo-400 bg-white"
                >
                  {TYPE_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <span className="text-[11px] text-slate-400">Defaulted from the ledger — change only if needed.</span>
              </label>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2">
              <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !name.trim() || !ledger} className="btn-primary text-sm disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {saving ? 'Creating…' : 'Create account'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
