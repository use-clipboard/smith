'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calculator, ArrowLeft, Plus, Trash2, Loader2, Briefcase, House, Globe2,
  AlertTriangle, RotateCcw, Download, Search, Sparkles,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import {
  SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES,
  UK_RENTAL_INCOME, UK_RENTAL_EXPENSES,
  CONSOLIDATED_REPORTING_LIMIT,
} from '@/lib/mtdIt/categories';
import { thresholdForYear, MTD_IT_THRESHOLDS } from '@/lib/mtdIt/thresholds';
import { fmtMoneyGbp } from '@/lib/mtdIt/pnl';
import type { MtdItStream, MtdItStreams } from '@/types';

// ── In-memory calculator types ────────────────────────────────────────
// Deliberately minimal — only the fields the user can edit. No share %,
// no FX (we treat everything as GBP for simplicity), no flagging, no
// IDs. The calculator never persists anything.

interface CalcEntry {
  _id:           string;
  stream:        MtdItStream;
  entry_type:    'income' | 'expense';
  category:      string;
  description:   string;
  gross_amount:  number;
}

const STREAM_META: Record<MtdItStream, { label: string; Icon: typeof Briefcase; accent: string }> = {
  sole:           { label: 'Sole Trader',     Icon: Briefcase, accent: 'border-orange-300 bg-orange-50/40' },
  uk_rental:      { label: 'UK Rental',       Icon: House,     accent: 'border-blue-300 bg-blue-50/40'   },
  foreign_rental: { label: 'Foreign Rental',  Icon: Globe2,    accent: 'border-emerald-300 bg-emerald-50/40' },
};

function categoriesFor(stream: MtdItStream, type: 'income' | 'expense'): readonly string[] {
  if (stream === 'sole') return type === 'income' ? SOLE_TRADER_INCOME : SOLE_TRADER_EXPENSES;
  return type === 'income' ? UK_RENTAL_INCOME : UK_RENTAL_EXPENSES;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Component ─────────────────────────────────────────────────────────
export default function MtdItCalculator() {
  const router = useRouter();
  const [streams, setStreams] = useState<MtdItStreams>({ sole: true, uk_rental: false, foreign_rental: false });
  const [entries, setEntries] = useState<CalcEntry[]>([]);

  // Optional client-quarter loader
  const [loadOpen, setLoadOpen] = useState(false);

  function toggleStream(s: MtdItStream) {
    setStreams(prev => ({ ...prev, [s]: !prev[s] }));
  }

  function addEntry(stream: MtdItStream, entry_type: 'income' | 'expense') {
    const cats = categoriesFor(stream, entry_type);
    setEntries(prev => [...prev, {
      _id: uid(), stream, entry_type, category: cats[0], description: '', gross_amount: 0,
    }]);
  }

  function patchEntry(id: string, patch: Partial<CalcEntry>) {
    setEntries(prev => prev.map(e => e._id === id ? { ...e, ...patch } : e));
  }

  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e._id !== id));
  }

  function resetAll() {
    if (entries.length > 0 && !confirm('Clear all entries?')) return;
    setEntries([]);
  }

  function loadFromQuarter(loaded: CalcEntry[], loadedStreams: MtdItStreams) {
    setEntries(loaded);
    setStreams(loadedStreams);
    setLoadOpen(false);
  }

  // ── Totals ──────────────────────────────────────────────────────────
  const activeStreams: MtdItStream[] = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);

  const totalsByStream = useMemo(() => {
    const map: Record<MtdItStream, { income: number; expense: number; net: number }> = {
      sole:           { income: 0, expense: 0, net: 0 },
      uk_rental:      { income: 0, expense: 0, net: 0 },
      foreign_rental: { income: 0, expense: 0, net: 0 },
    };
    for (const e of entries) {
      if (e.entry_type === 'income') map[e.stream].income += e.gross_amount || 0;
      else                            map[e.stream].expense += e.gross_amount || 0;
    }
    for (const k of Object.keys(map) as MtdItStream[]) map[k].net = map[k].income - map[k].expense;
    return map;
  }, [entries]);

  const grand = useMemo(() => {
    let income = 0, expense = 0;
    for (const s of activeStreams) { income += totalsByStream[s].income; expense += totalsByStream[s].expense; }
    return { income, expense, net: income - expense };
  }, [activeStreams, totalsByStream]);

  // Which mandation threshold tier does the running annual income trigger?
  // We extrapolate to a full year by multiplying by 4 (rough), then see which
  // is the lowest published threshold this income exceeds. Purely indicative
  // — gives the user a "you'd be in scope for 2027/28" cue.
  const annualised = grand.income * 4;
  const sortedThresholds = Object.entries(MTD_IT_THRESHOLDS).map(([y, v]) => ({ year: Number(y), amount: v })).sort((a, b) => b.amount - a.amount);
  const tierHit = sortedThresholds.find(t => annualised >= t.amount);
  const overConsolidated = grand.income >= CONSOLIDATED_REPORTING_LIMIT;

  return (
    <ToolLayout title="MTD IT — Calculator">
      <div className="space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/mtd-it')} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={14} /> Back to MTD IT
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center">
              <Calculator size={18} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">P&amp;L Calculator</h1>
              <p className="text-xs text-gray-500">In-memory only — nothing here is saved.</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setLoadOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
              <Download size={14} /> Load from a quarter
            </button>
            <button onClick={resetAll} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Kpi label="Income"  value={grand.income}  tone="income" />
          <Kpi label="Expense" value={grand.expense} tone="expense" />
          <Kpi label="Net"     value={grand.net}     tone={grand.net >= 0 ? 'income' : 'expense'} />
          <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-col justify-center">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">MTD threshold (annualised)</div>
            <div className={`text-base font-semibold mt-1 ${tierHit ? 'text-amber-700' : 'text-gray-500'}`}>
              {tierHit ? `In scope for ${tierHit.year}/${String((tierHit.year + 1) % 100).padStart(2, '0')}` : 'Below all tiers'}
            </div>
            <div className="text-[11px] text-gray-500">
              {tierHit ? `£${tierHit.amount.toLocaleString()} mandation hit` : `Below £${thresholdForYear(2028).toLocaleString()}`}
            </div>
          </div>
        </div>

        {overConsolidated && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            Combined gross income is at or above £{CONSOLIDATED_REPORTING_LIMIT.toLocaleString()} — HMRC&apos;s simplified consolidated reporting wouldn&apos;t be permitted for a real client at this level.
          </div>
        )}

        {/* Stream toggles */}
        <div className="flex items-center gap-2">
          {(['sole','uk_rental','foreign_rental'] as const).map(s => {
            const meta = STREAM_META[s];
            const on = streams[s];
            return (
              <button
                key={s}
                onClick={() => toggleStream(s)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${on
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                <meta.Icon size={12} /> {meta.label}
              </button>
            );
          })}
        </div>

        {/* Per-stream entry tables */}
        {activeStreams.length === 0 ? (
          <div className="text-center text-sm text-gray-500 py-10">
            Toggle at least one income stream above to start adding entries.
          </div>
        ) : (
          <div className="space-y-4">
            {activeStreams.map(s => {
              const meta = STREAM_META[s];
              const totals = totalsByStream[s];
              const rows = entries.filter(e => e.stream === s);
              return (
                <section key={s} className={`border rounded-xl overflow-hidden ${meta.accent}`}>
                  <header className="flex items-center gap-2 px-4 py-2 bg-white border-b border-gray-200">
                    <meta.Icon size={14} className="text-gray-600" />
                    <h2 className="text-sm font-semibold text-gray-900 flex-1">{meta.label}</h2>
                    <div className="text-[11px] text-gray-500">
                      <span className="text-green-700 font-medium">{fmtMoneyGbp(totals.income)}</span>
                      <span className="mx-1.5">·</span>
                      <span className="text-red-700 font-medium">{fmtMoneyGbp(totals.expense)}</span>
                      <span className="mx-1.5">·</span>
                      <span className={`font-semibold ${totals.net >= 0 ? 'text-green-700' : 'text-red-700'}`}>Net {fmtMoneyGbp(totals.net)}</span>
                    </div>
                  </header>

                  <div className="bg-white px-3 py-2">
                    {rows.length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-2">No entries yet.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                            <th className="px-2 py-1 text-left w-[110px]">Type</th>
                            <th className="px-2 py-1 text-left">Category</th>
                            <th className="px-2 py-1 text-left">Description</th>
                            <th className="px-2 py-1 text-right w-[120px]">Amount</th>
                            <th className="px-2 py-1 w-[40px]"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map(r => (
                            <tr key={r._id} className="border-t border-gray-100">
                              <td className="px-2 py-1">
                                <select
                                  value={r.entry_type}
                                  onChange={e => {
                                    const t = e.target.value as 'income' | 'expense';
                                    const cats = categoriesFor(s, t);
                                    patchEntry(r._id, { entry_type: t, category: cats[0] });
                                  }}
                                  className={`w-full px-1.5 py-0.5 text-xs rounded border ${r.entry_type === 'income' ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
                                >
                                  <option value="income">Income</option>
                                  <option value="expense">Expense</option>
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <select
                                  value={r.category}
                                  onChange={e => patchEntry(r._id, { category: e.target.value })}
                                  className="w-full px-1.5 py-0.5 text-xs border border-gray-200 rounded"
                                >
                                  {categoriesFor(s, r.entry_type).map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  value={r.description}
                                  onChange={e => patchEntry(r._id, { description: e.target.value })}
                                  placeholder="What is it?"
                                  className="w-full px-1.5 py-0.5 text-xs border border-gray-200 rounded"
                                />
                              </td>
                              <td className="px-2 py-1">
                                <input
                                  type="number"
                                  value={r.gross_amount}
                                  onChange={e => patchEntry(r._id, { gross_amount: Number(e.target.value) || 0 })}
                                  className="w-full px-1.5 py-0.5 text-xs border border-gray-200 rounded text-right tabular-nums"
                                />
                              </td>
                              <td className="px-2 py-1 text-right">
                                <button onClick={() => removeEntry(r._id)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" aria-label="Remove">
                                  <Trash2 size={12} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <button onClick={() => addEntry(s, 'income')} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-green-700 hover:bg-green-50 rounded">
                        <Plus size={11} /> Income
                      </button>
                      <button onClick={() => addEntry(s, 'expense')} className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-700 hover:bg-red-50 rounded">
                        <Plus size={11} /> Expense
                      </button>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <p className="text-[11px] text-gray-500 leading-relaxed text-center pt-2">
          Nothing on this page is persisted. Refresh the page or click Reset to start over.
        </p>
      </div>

      {loadOpen && (
        <LoadQuarterModal
          onClose={() => setLoadOpen(false)}
          onLoad={loadFromQuarter}
        />
      )}
    </ToolLayout>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────
function Kpi({ label, value, tone }: { label: string; value: number; tone: 'income' | 'expense' }) {
  const accent = tone === 'income' ? 'text-green-700' : 'text-red-700';
  const stripe = tone === 'income' ? 'bg-green-500' : 'bg-red-500';
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3 relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-full h-0.5 ${stripe}`} />
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">{label}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${accent}`}>{fmtMoneyGbp(value)}</div>
    </div>
  );
}

// ── Load-from-quarter modal ───────────────────────────────────────────
interface QuarterPick {
  client_id: string;
  client_name: string;
  client_ref: string | null;
  tax_year: number;
  quarter: 1 | 2 | 3 | 4;
  status: string;
  quarter_id: string;
}

function LoadQuarterModal({ onClose, onLoad }: {
  onClose: () => void;
  onLoad: (entries: CalcEntry[], streams: MtdItStreams) => void;
}) {
  const [clients, setClients] = useState<Array<{ id: string; name: string; client_ref: string | null; quarters: Partial<Record<1|2|3|4, string>> }>>([]);
  const [taxYear, setTaxYear] = useState(2026);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void fetch(`/api/mtd-it/clients?tax_year=${taxYear}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(j => setClients((j.clients ?? []) as Array<{ id: string; name: string; client_ref: string | null; quarters: Partial<Record<1|2|3|4, string>> }>))
      .catch(() => setError('Failed to load clients'))
      .finally(() => setLoading(false));
  }, [taxYear]);

  // Flatten into one row per (client, quarter-that-has-status)
  const picks: QuarterPick[] = useMemo(() => {
    const out: QuarterPick[] = [];
    for (const c of clients) {
      for (const q of [1, 2, 3, 4] as const) {
        const status = c.quarters?.[q];
        if (!status) continue;
        if (status !== 'draft' && status !== 'complete' && status !== 'sent' && status !== 'approved' && status !== 'submitted') continue;
        out.push({
          client_id: c.id,
          client_name: c.name,
          client_ref: c.client_ref,
          tax_year: taxYear,
          quarter: q,
          status,
          // The dashboard endpoint doesn't return quarter_id directly — we'll
          // fetch it lazily when the user picks a row.
          quarter_id: '',
        });
      }
    }
    const q = search.trim().toLowerCase();
    return q ? out.filter(p => p.client_name.toLowerCase().includes(q) || (p.client_ref ?? '').toLowerCase().includes(q)) : out;
  }, [clients, search, taxYear]);

  async function pickQuarter(p: QuarterPick) {
    setBusy(true); setError(null);
    try {
      // Resolve quarter_id via the create-on-visit endpoint
      const qRes = await fetch(`/api/mtd-it/quarters?client_id=${p.client_id}&tax_year=${p.tax_year}&quarter=${p.quarter}`);
      if (!qRes.ok) throw new Error('Failed to resolve quarter');
      const qJson = await qRes.json();
      const quarterId = (qJson.quarter?.id ?? '') as string;
      const streamsSnapshot = (qJson.quarter?.streams_snapshot ?? { sole: true, uk_rental: false, foreign_rental: false }) as MtdItStreams;

      // Pull entries
      const eRes = await fetch(`/api/mtd-it/entries?quarter_id=${quarterId}`);
      if (!eRes.ok) throw new Error('Failed to load entries');
      const eJson = await eRes.json();
      const raw = (eJson.entries ?? []) as Array<{ stream: MtdItStream; entry_type: 'income'|'expense'; category: string; description: string|null; gross_amount: number; flagged_reason: string | null; flag_dismissed: boolean | null }>;
      // Drop flagged rows — they aren't part of the clean P&L
      const clean = raw.filter(r => !(r.flagged_reason && !r.flag_dismissed));
      const mapped: CalcEntry[] = clean.map(r => ({
        _id: uid(),
        stream: r.stream,
        entry_type: r.entry_type,
        category: r.category,
        description: r.description ?? '',
        gross_amount: Number(r.gross_amount) || 0,
      }));
      onLoad(mapped, streamsSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={!busy ? onClose : undefined}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center">
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Load a quarter into the calculator</h3>
            <p className="text-xs text-gray-500">Only clean entries are imported. Editing here doesn&apos;t affect the saved quarter.</p>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-200 rounded-lg"
            />
          </div>
          <select
            value={taxYear}
            onChange={e => setTaxYear(Number(e.target.value))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white"
          >
            {[2026, 2027, 2028].map(y => <option key={y} value={y}>{y}/{String((y + 1) % 100).padStart(2, '0')}</option>)}
          </select>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-500"><Loader2 size={14} className="inline animate-spin mr-1.5" /> Loading…</div>
          ) : picks.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">No quarters with saved data for this tax year.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {picks.map((p, i) => (
                <li key={`${p.client_id}-${p.quarter}-${i}`}>
                  <button
                    onClick={() => void pickQuarter(p)}
                    disabled={busy}
                    className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 disabled:opacity-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 truncate">{p.client_name}</div>
                      <div className="text-[11px] text-gray-500">{p.client_ref ? `${p.client_ref} · ` : ''}Q{p.quarter} {p.tax_year}/{String((p.tax_year + 1) % 100).padStart(2, '0')}</div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{p.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 m-3 rounded-lg flex items-start gap-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} disabled={busy} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

