'use client';

/**
 * VatReturnReviewPanel — AI pre-filing sanity-check for a VAT return.
 *
 * Rendered as the amber "AI review" sub-tab on the VAT return screen. Sends the
 * computed 9-box figures + a per-rate breakdown summary to the server, which
 * runs deterministic arithmetic guards and an AI review, then shows a
 * prioritised list of things to check before filing. Advisory only — nothing
 * is filed from here.
 */

import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, AlertTriangle, ShieldCheck, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface RateRow { rate: number; net: number; vat: number; count: number }
interface BreakdownLite { net: number; vat_total: number; vat_rate: number | null }

type Severity = 'high' | 'medium' | 'low';
interface Finding { id: string; severity: Severity; title: string; detail: string; note?: string }
interface ComparisonPeriod {
  label: string; from: string; to: string;
  sales: number; netVat: number;
  revenue: number; costOfSales: number; grossProfit: number; netProfit: number;
  gpPct: number | null; npPct: number | null; isCurrent: boolean;
}
interface ReviewResult { overview: string; findings: Finding[]; observations: string[]; comparison?: ComparisonPeriod[]; generatedAt: string }

function gbpShort(n: number): string {
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function pct(n: number | null): string {
  return n === null ? '—' : `${n.toFixed(1)}%`;
}
/** Trend arrow comparing a value to the previous period's. */
function Delta({ curr, prev, suffix = 'pp' }: { curr: number | null; prev: number | null | undefined; suffix?: string }) {
  if (curr === null || prev === null || prev === undefined) return null;
  const d = +(curr - prev).toFixed(1);
  if (Math.abs(d) < 0.05) return <span className="inline-flex items-center text-slate-400 text-[10px]"><Minus size={10} /></span>;
  const up = d > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${up ? 'text-emerald-600' : 'text-rose-600'}`}>
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}{up ? '+' : ''}{d}{suffix}
    </span>
  );
}

const SEV_META: Record<Severity, { label: string; chip: string }> = {
  high:   { label: 'High',   chip: 'bg-rose-100 text-rose-700' },
  medium: { label: 'Review', chip: 'bg-amber-100 text-amber-700' },
  low:    { label: 'Note',   chip: 'bg-slate-100 text-slate-600' },
};

/** Roll a breakdown side up into { count, net, vat, rates[] } for the API. */
function summariseSide(rows: BreakdownLite[]) {
  let net = 0, vat = 0;
  const byRate = new Map<number, RateRow>();
  for (const r of rows) {
    net += Number(r.net); vat += Number(r.vat_total);
    let rate = r.vat_rate ?? (r.net > 0 && r.vat_total > 0 ? Math.round((r.vat_total / r.net) * 1000) / 10 : 0);
    rate = Math.round(rate * 10) / 10;
    const e = byRate.get(rate) ?? { rate, net: 0, vat: 0, count: 0 };
    e.net = +(e.net + Number(r.net)).toFixed(2);
    e.vat = +(e.vat + Number(r.vat_total)).toFixed(2);
    e.count += 1;
    byRate.set(rate, e);
  }
  return {
    count: rows.length,
    net: +net.toFixed(2),
    vat: +vat.toFixed(2),
    rates: [...byRate.values()].sort((a, b) => b.net - a.net),
  };
}

export default function VatReturnReviewPanel({
  bookId, from, to, vatScheme, vatRegistered, boxes, lateEntryVat, outputs, inputs,
}: {
  bookId: string;
  from: string;
  to: string;
  vatScheme: string | null;
  vatRegistered: boolean;
  boxes: { box1: number; box2: number; box3: number; box4: number; box5: number; box6: number; box7: number; box8: number; box9: number };
  lateEntryVat: number;
  outputs: BreakdownLite[];
  inputs: BreakdownLite[];
}) {
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run() {
    setLoading(true); setError('');
    try {
      const r = await fetch(`/api/bookkeeping/books/${bookId}/vat-return/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from, to, vat_scheme: vatScheme, vat_registered: vatRegistered,
          boxes, late_entry_vat: lateEntryVat,
          outputs: summariseSide(outputs),
          inputs: summariseSide(inputs),
        }),
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
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
            <Sparkles size={14} className="text-amber-500" /> AI VAT review
          </h3>
          <p className="text-xs text-slate-500">A pre-filing sanity-check of the 9 boxes — effective rates, repayments, EU/reverse-charge and late entries.</p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
          {loading ? 'Reviewing…' : result ? 'Re-run review' : 'Run review'}
        </button>
      </div>

      {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

      {!result && !loading && (
        <div className="text-center py-10 px-6 border border-slate-200 rounded-xl bg-white">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-lg bg-amber-50 text-amber-600 mb-2"><Sparkles size={18} /></div>
          <p className="text-sm font-medium text-slate-900 mb-0.5">Review this return before filing</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">SMITH checks the boxes add up and looks for figures that warrant a second glance — miscoded VAT, an unexpected repayment, EU/reverse-charge entries, and more. It never files anything.</p>
        </div>
      )}

      {result && (
        <>
          {result.overview && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
              <p className="text-sm text-slate-800 leading-relaxed">{result.overview}</p>
            </div>
          )}

          {/* Quarter-on-quarter comparison */}
          {result.comparison && result.comparison.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100">
                <h4 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Quarter-on-quarter {result.comparison.length > 1 ? `(last ${result.comparison.length} periods)` : ''}
                </h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 text-[10px] uppercase tracking-wide">
                      <th className="text-left font-semibold px-4 py-1.5">Period</th>
                      <th className="text-right font-semibold px-3 py-1.5">Sales</th>
                      <th className="text-right font-semibold px-3 py-1.5">Gross profit %</th>
                      <th className="text-right font-semibold px-3 py-1.5">Net profit %</th>
                      <th className="text-right font-semibold px-4 py-1.5">Net VAT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {result.comparison.map((p, i) => {
                      const prev = i > 0 ? result.comparison![i - 1] : undefined;
                      return (
                        <tr key={p.to} className={p.isCurrent ? 'bg-amber-50/40' : ''}>
                          <td className="px-4 py-1.5 text-slate-700">
                            {p.label}{p.isCurrent && <span className="ml-1.5 text-[9px] font-semibold text-amber-700 uppercase">This return</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{gbpShort(p.sales)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            <span className="inline-flex items-center gap-1.5 justify-end">{pct(p.gpPct)} <Delta curr={p.gpPct} prev={prev?.gpPct} /></span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                            <span className="inline-flex items-center gap-1.5 justify-end">{pct(p.npPct)} <Delta curr={p.npPct} prev={prev?.npPct} /></span>
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">{gbpShort(p.netVat)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {result.comparison.length === 1 && (
                <p className="px-4 py-1.5 text-[10px] text-slate-400 border-t border-slate-100">No prior filed returns yet — margins shown for this period only.</p>
              )}
            </div>
          )}

          {result.findings.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-sm text-emerald-800">
              <ShieldCheck size={16} className="text-emerald-600" /> Nothing stood out — the boxes are consistent and the figures look reasonable.
            </div>
          ) : (
            <ul className="space-y-2">
              {result.findings.map(f => {
                const sev = SEV_META[f.severity] ?? SEV_META.low;
                return (
                  <li key={f.id} className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3">
                    <div className="flex items-start gap-3">
                      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-slate-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${sev.chip}`}>{sev.label}</span>
                          <span className="text-sm font-medium text-slate-900">{f.title}</span>
                        </div>
                        {(f.note || f.detail) && <p className="text-xs text-slate-600 mt-1 leading-snug">{f.note || f.detail}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {result.observations.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Also worth checking</p>
              <ul className="space-y-1">
                {result.observations.map((o, i) => (
                  <li key={i} className="text-sm text-slate-700 flex items-start gap-2"><span className="text-slate-400 mt-0.5">•</span> {o}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-slate-400">AI-assisted — always apply your own judgement. Nothing has been filed.</p>
        </>
      )}
    </div>
  );
}
