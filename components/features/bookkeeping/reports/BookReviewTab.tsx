'use client';

/**
 * BookReviewTab — AI-assisted book health-check.
 *
 * Runs on demand. The server computes the issues deterministically (suspense
 * balances, duplicate transactions, overdrawn bank) and links each to its
 * source row; Claude adds an overall assessment and a one-line "why / fix" note
 * per issue. Nothing is auto-posted — this is advisory.
 */

import { useState } from 'react';
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, Wallet, Copy, ShieldCheck,
  TrendingDown, Scale, Users,
} from 'lucide-react';
import { AccountLink, TxnRefLink } from '../book/BookNavigationContext';
import { formatMoney } from '@/lib/bookkeeping/formatMoney';
import type { TransactionType } from '@/types/bookkeeping';

type Severity = 'high' | 'medium' | 'low';
type Category = 'suspense' | 'bank' | 'duplicate' | 'depreciation' | 'reconciliation' | 'balances';
interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  note?: string;
  account?: { id: string; name: string; ledger: string | null };
  refTxns?: { id: string; type: TransactionType; ref_no: string }[];
  items?: { account: { id: string; name: string; ledger: string | null }; amount: number }[];
}
interface ReviewResult {
  overview: string;
  findings: Finding[];
  observations: string[];
  generatedAt: string;
  period: string;
}

const SEV_META: Record<Severity, { label: string; chip: string }> = {
  high:   { label: 'High',   chip: 'bg-rose-100 text-rose-700' },
  medium: { label: 'Review', chip: 'bg-amber-100 text-amber-700' },
  low:    { label: 'Note',   chip: 'bg-slate-100 text-slate-600' },
};
const CAT_ICON: Record<Category, typeof AlertTriangle> = {
  suspense: AlertTriangle,
  bank: Wallet,
  duplicate: Copy,
  depreciation: TrendingDown,
  reconciliation: Scale,
  balances: Users,
};

export default function BookReviewTab({ bookId, fromIso, toIso }: { bookId: string; fromIso: string | null; toIso: string | null }) {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromIso, to: toIso }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not run the review.');
      setResult(d as ReviewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not run the review.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-900 inline-flex items-center gap-2">
            <Sparkles size={15} className="text-indigo-600" /> AI Book Review
          </h2>
          <p className="text-xs text-slate-500">Checks for suspense balances, duplicate entries and overdrawn bank accounts, with AI commentary.</p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {loading ? 'Reviewing…' : result ? 'Re-run review' : 'Run review'}
        </button>
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {!result && !loading && (
        <div className="text-center py-12 px-6 border border-slate-200 rounded-xl bg-white shadow-sm">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-indigo-50 text-indigo-600 mb-2">
            <Sparkles size={18} />
          </div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Run an AI review of this book</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">SMITH scans the current period for common issues and gives you a prioritised, explained list — each linked to the entry it relates to. It never changes anything.</p>
        </div>
      )}

      {result && (
        <>
          {/* Overview */}
          {result.overview && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3">
              <p className="text-sm text-slate-800 leading-relaxed">{result.overview}</p>
            </div>
          )}

          {/* Findings */}
          {result.findings.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
              <ShieldCheck size={16} className="text-emerald-600" />
              No issues found by the automated checks for this period.
            </div>
          ) : (
            <ul className="space-y-2">
              {result.findings.map(f => {
                const sev = SEV_META[f.severity] ?? SEV_META.low;
                const Icon = CAT_ICON[f.category] ?? AlertTriangle;
                return (
                  <li key={f.id} className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3">
                    <div className="flex items-start gap-3">
                      <Icon size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${sev.chip}`}>{sev.label}</span>
                          <span className="text-sm font-medium text-slate-900">{f.title}</span>
                        </div>
                        {(f.note || f.detail) && (
                          <p className="text-xs text-slate-600 mt-1 leading-snug">{f.note || f.detail}</p>
                        )}
                        <div className="mt-1.5 text-xs flex items-center gap-2 flex-wrap">
                          {f.account && <AccountLink account={f.account} />}
                          {f.refTxns && f.refTxns.map((t, i) => (
                            <span key={t.id} className="inline-flex items-center gap-2">
                              {i > 0 && <span className="text-slate-300">·</span>}
                              <TxnRefLink txn={t} />
                            </span>
                          ))}
                        </div>
                        {f.items && f.items.length > 0 && (
                          <ul className="mt-2 border-t border-slate-100 divide-y divide-slate-100">
                            {f.items.map(it => (
                              <li key={it.account.id} className="flex items-center justify-between gap-3 py-1 text-xs">
                                <AccountLink account={it.account} showLedger={false} />
                                <span className="tabular-nums text-slate-700">{formatMoney(it.amount)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* AI observations */}
          {result.observations.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Also worth checking</p>
              <ul className="space-y-1">
                {result.observations.map((o, i) => (
                  <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-slate-400 mt-0.5">•</span> {o}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Reviewed {result.period} · AI-assisted — always verify against the book. Nothing has been changed or posted.
          </p>
        </>
      )}
    </div>
  );
}
