'use client';

/**
 * BankCsvImportModal — import a statement into the ACTIVE reconciliation from a
 * Bank-to-CSV analysis the firm already ran and saved.
 *
 * No AI, no re-upload: the Bank-to-CSV tool already extracted (and the user may
 * have reviewed/edited) the transactions, stored on the `outputs` table as
 * `result_data.transactions` (BankCsvTransaction[] — Date / Description /
 * Money In / Money Out / Balance). We list those saved analyses, let the user
 * pick one, map each row to the same { date, description, amount } shape the
 * CSV/PDF paths produce (amount = MoneyIn − MoneyOut, so direction is exact),
 * and hand them up via onParsedRows. The workspace then seeds the Manual entry
 * sheet for review → allocate → post, identical to every other import source.
 */

import { useState, useEffect, useCallback } from 'react';
import { X, FileSpreadsheet, Loader2, AlertCircle, Check, ChevronLeft } from 'lucide-react';
import type { BankCsvTransaction } from '@/types';

interface ParsedLine {
  date: string;        // ISO yyyy-mm-dd
  description: string;
  amount: number;      // signed — positive = money in
}

interface OutputRow {
  id: string;
  client_id: string | null;
  client_name: string | null;
  transaction_count: number | null;
  source_filenames: string[] | null;
  created_at: string;
  user: { full_name: string | null } | null;
  client: { name: string | null } | null;
}

interface Props {
  bookId: string;
  /** The book's client — when set, the picker defaults to that client's
   *  analyses (with a toggle to show the whole firm's). */
  clientId: string | null;
  accountLabel: string;
  onClose: () => void;
  onParsedRows: (lines: ParsedLine[]) => void;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function formatDateUk(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** Map a saved Bank-to-CSV analysis to reconciliation lines. Money In − Money
 *  Out gives the signed amount; balance-only rows (both null) drop out. */
function mapTransactions(txns: BankCsvTransaction[]): { lines: ParsedLine[]; skipped: number } {
  const lines: ParsedLine[] = [];
  let skipped = 0;
  for (const t of txns) {
    const date = String(t.Date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    const moneyIn = Number(t['Money In'] ?? 0) || 0;
    const moneyOut = Number(t['Money Out'] ?? 0) || 0;
    const amount = r2(moneyIn - moneyOut);
    if (amount === 0) { skipped++; continue; }
    lines.push({ date, description: String(t.Description ?? '').trim().slice(0, 500), amount });
  }
  return { lines, skipped };
}

export default function BankCsvImportModal({ bookId, clientId, accountLabel, onClose, onParsedRows }: Props) {
  const [scope, setScope] = useState<'client' | 'all'>(clientId ? 'client' : 'all');
  const [outputs, setOutputs] = useState<OutputRow[] | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Selected-analysis preview state.
  const [selected, setSelected] = useState<OutputRow | null>(null);
  const [lines, setLines] = useState<ParsedLine[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [loadingLines, setLoadingLines] = useState(false);
  const [lineError, setLineError] = useState<string | null>(null);

  // Load the list (re-runs when the client/all scope changes).
  useEffect(() => {
    let cancelled = false;
    setLoadingList(true);
    setListError(null);
    const qs = new URLSearchParams({ feature: 'bank_to_csv' });
    if (scope === 'client' && clientId) qs.set('client_id', clientId);
    fetch(`/api/outputs?${qs.toString()}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load saved analyses')))
      .then(d => { if (!cancelled) setOutputs((d.outputs ?? []) as OutputRow[]); })
      .catch(e => { if (!cancelled) setListError(String(e.message ?? e)); })
      .finally(() => { if (!cancelled) setLoadingList(false); });
    return () => { cancelled = true; };
  }, [scope, clientId]);

  const pick = useCallback(async (row: OutputRow) => {
    setSelected(row);
    setLines(null);
    setLineError(null);
    setLoadingLines(true);
    try {
      const r = await fetch(`/api/outputs/${row.id}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setLineError(d.error ?? 'Could not open that analysis.'); return; }
      const txns = (d.output?.result_data?.transactions ?? []) as BankCsvTransaction[];
      if (!Array.isArray(txns) || txns.length === 0) {
        setLineError('That analysis has no transactions saved on it.');
        return;
      }
      const { lines: mapped, skipped: skip } = mapTransactions(txns);
      if (mapped.length === 0) {
        setLineError('None of the rows in that analysis had a usable amount.');
        return;
      }
      setLines(mapped);
      setSkipped(skip);
    } catch (e) {
      setLineError(String(e));
    } finally {
      setLoadingLines(false);
    }
  }, []);

  function back() { setSelected(null); setLines(null); setLineError(null); setSkipped(0); }

  function handleConfirm() {
    if (!lines || lines.length === 0) return;
    onParsedRows(lines);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[680px] max-w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2">
          {selected && (
            <button onClick={back} aria-label="Back to list" className="text-slate-400 hover:text-slate-700">
              <ChevronLeft size={16} />
            </button>
          )}
          <FileSpreadsheet size={16} className="text-indigo-600" />
          <h2 className="text-sm font-semibold text-slate-900">
            {selected ? 'Review extracted transactions' : 'Import from a Bank to CSV analysis'}
          </h2>
          <span className="text-xs text-slate-500 ml-2">→ {accountLabel}</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* ── List view ─────────────────────────────────────────────── */}
          {!selected && (
            <>
              {clientId && (
                <div className="flex items-center gap-1 mb-3 text-xs">
                  <span className="text-slate-500 mr-1">Show:</span>
                  <button
                    onClick={() => setScope('client')}
                    className={`px-2.5 py-1 rounded-full border transition-colors ${scope === 'client' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    This client
                  </button>
                  <button
                    onClick={() => setScope('all')}
                    className={`px-2.5 py-1 rounded-full border transition-colors ${scope === 'all' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    All clients
                  </button>
                </div>
              )}

              {loadingList && (
                <div className="py-12 text-center text-slate-500">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin text-indigo-500" />
                  <p className="text-xs">Loading saved analyses…</p>
                </div>
              )}

              {listError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                  <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-rose-800">{listError}</div>
                </div>
              )}

              {!loadingList && !listError && outputs && outputs.length === 0 && (
                <div className="py-12 text-center text-slate-500">
                  <FileSpreadsheet size={22} className="mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">No saved Bank to CSV analyses{scope === 'client' ? ' for this client' : ''}.</p>
                  <p className="text-xs mt-1">
                    Run a statement through the Bank to CSV tool and click Save{scope === 'client' && clientId ? ', or switch to “All clients”.' : '.'}
                  </p>
                </div>
              )}

              {!loadingList && !listError && outputs && outputs.length > 0 && (
                <div className="space-y-1.5">
                  {outputs.map(o => {
                    const files = (o.source_filenames ?? []).filter(Boolean);
                    const label = files.length ? files.join(', ') : 'Bank statement';
                    const who = o.user?.full_name ?? null;
                    const clientName = o.client?.name ?? o.client_name ?? null;
                    return (
                      <button
                        key={o.id}
                        onClick={() => void pick(o)}
                        className="w-full text-left rounded-lg border border-slate-200 px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors flex items-center gap-3"
                      >
                        <FileSpreadsheet size={15} className="text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-900 font-medium truncate">{label}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {formatDateUk(o.created_at)}
                            {o.transaction_count != null && <> · {o.transaction_count} transaction{o.transaction_count === 1 ? '' : 's'}</>}
                            {scope === 'all' && clientName && <> · {clientName}</>}
                            {who && <> · {who}</>}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ── Preview view ──────────────────────────────────────────── */}
          {selected && (
            <>
              {loadingLines && (
                <div className="py-12 text-center text-slate-500">
                  <Loader2 size={20} className="mx-auto mb-2 animate-spin text-indigo-500" />
                  <p className="text-xs">Opening analysis…</p>
                </div>
              )}

              {lineError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                  <AlertCircle size={14} className="text-rose-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-rose-800">{lineError}</div>
                </div>
              )}

              {lines && !loadingLines && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex items-start gap-2">
                    <Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                    <div className="text-xs text-emerald-900">
                      <strong>{lines.length}</strong> transaction{lines.length === 1 ? '' : 's'} ready to import.
                      {skipped > 0 && <> Skipped {skipped} row{skipped === 1 ? '' : 's'} with no movement (balance lines).</>}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-200 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-1.5 text-left w-20">Date</th>
                          <th className="px-2 py-1.5 text-left">Description</th>
                          <th className="px-2 py-1.5 text-right w-24">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.slice(0, 8).map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-2 py-1 text-slate-700 tabular-nums">{formatDateUk(l.date)}</td>
                            <td className="px-2 py-1 text-slate-900 truncate max-w-[300px]">{l.description}</td>
                            <td className={`px-2 py-1 text-right tabular-nums ${l.amount < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                              {l.amount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                        {lines.length > 8 && (
                          <tr className="border-t border-slate-100 text-center text-[11px] text-slate-400 italic">
                            <td colSpan={3} className="py-1">… {lines.length - 8} more</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2 bg-slate-50/40">
          <button onClick={onClose} className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!lines || lines.length === 0 || loadingLines}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
          >
            <FileSpreadsheet size={11} /> Continue to review
          </button>
        </div>
      </div>
    </div>
  );
}
