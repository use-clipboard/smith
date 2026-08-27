'use client';

// "Pull from Bookkeeping" — imports a client's fixed-asset register from the
// bookkeeping tool into the Capital Allowances register. Fetches the book's
// assets (with a suggested CA treatment per accounts category), lets the
// accountant tick which to import and confirm the treatment, then appends them
// as CA additions. The accounts cost/category seed the assets — the accountant
// sets the tax treatment (accounts depreciation ≠ capital allowances).

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Database, Loader2, Check, Download } from 'lucide-react';
import { fetchJson } from '@/lib/fetchJson';
import { fmtMoney, fmtDateUK } from './data';
import type { CapexAddition } from './types';

interface PulledAsset {
  id: string;
  description: string;
  cost: number;
  category: string;
  purchaseDate: string;
  broughtForward: boolean;
  disposed: boolean;
  disposalDate: string | null;
  disposalProceeds: number | null;
  assetType: 'plant' | 'car' | 'van' | 'other';
  treatment: 'aia' | 'main' | 'special';
  excluded: boolean;
  note?: string;
}
interface PullData { found: boolean; book?: { id: string; name: string }; multipleBooks?: boolean; assets: PulledAsset[] }

const rid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
const shortCat = (c: string) => c.replace(/^FA\s*-\s*/i, '').replace(/\b\w/g, m => m.toUpperCase());
const ASSET_TYPES = ['plant', 'car', 'van', 'other'] as const;
const TREATMENTS: { value: PulledAsset['treatment']; label: string }[] = [
  { value: 'aia', label: 'AIA' }, { value: 'main', label: 'Main pool' }, { value: 'special', label: 'Special rate' },
];

export default function BookkeepingAssetPull({ clientId, onImport }: {
  clientId: string;
  onImport: (additions: CapexAddition[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PullData | null>(null);
  const [rows, setRows] = useState<PulledAsset[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});

  async function load() {
    setOpen(true); setLoading(true); setError(null);
    try {
      const d = await fetchJson<PullData>(`/api/tax-studio/integrations/bookkeeping-assets?clientId=${clientId}`);
      setData(d);
      setRows(d.assets ?? []);
      // Default-tick assets that map cleanly: not excluded, and either bought this
      // period (source=addition) or disposed. Brought-forward held assets are
      // already in the tax pool, so leave them unticked.
      const s: Record<string, boolean> = {};
      for (const a of d.assets ?? []) s[a.id] = !a.excluded && (!a.broughtForward || a.disposed);
      setSel(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the bookkeeping register.');
    } finally { setLoading(false); }
  }

  const upd = (id: string, u: Partial<PulledAsset>) => setRows(r => r.map(a => a.id === id ? { ...a, ...u } : a));
  const chosen = rows.filter(a => sel[a.id] && !a.excluded);

  function doImport() {
    const additions: CapexAddition[] = chosen.map(a => ({
      id: rid('bk'),
      description: a.description,
      cost: a.cost,
      treatment: a.treatment,
      assetType: a.assetType,
      acquisitionDate: a.purchaseDate || undefined,
      newUnused: true,
      broughtForward: a.broughtForward && !a.disposed ? true : undefined,
      disposed: a.disposed || undefined,
      disposalDate: a.disposalDate || undefined,
      proceeds: a.disposalProceeds ?? undefined,
    }));
    onImport(additions);
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={load} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--accent)] hover:underline">
        <Database size={12} /> Pull from Bookkeeping
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-black/5 px-5 py-3">
              <div>
                <p className="flex items-center gap-1.5 text-[14px] font-bold text-[var(--text-primary)]"><Database size={14} className="text-[var(--accent)]" /> Pull from Bookkeeping</p>
                <p className="text-[11.5px] text-[var(--text-muted)]">{data?.book ? `Fixed-asset register — ${data.book.name}` : 'Client fixed-asset register'}{data?.multipleBooks ? ' (most recent book)' : ''}</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /> Loading the register…</div>
              ) : error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-center text-[12px] text-rose-700">{error}</p>
              ) : !data?.found ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">No bookkeeping book found for this client — nothing to pull.</p>
              ) : rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12.5px] text-[var(--text-muted)]">This book has no fixed assets in its register.</p>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[24px_1fr_84px_96px_84px_96px] gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span></span><span>Asset · category</span><span className="text-right">Cost</span><span>Type</span><span>Treatment</span><span className="text-right">Status</span>
                  </div>
                  {rows.map(a => (
                    <div key={a.id} className={`grid grid-cols-[24px_1fr_84px_96px_84px_96px] items-center gap-2 rounded-lg px-1 py-1 ${a.excluded ? 'opacity-55' : ''}`}>
                      <input type="checkbox" disabled={a.excluded} checked={!!sel[a.id] && !a.excluded} onChange={e => setSel(s => ({ ...s, [a.id]: e.target.checked }))} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{a.description}</p>
                        <p className="truncate text-[10px] text-[var(--text-muted)]">{shortCat(a.category)}{a.purchaseDate ? ` · ${fmtDateUK(a.purchaseDate)}` : ''}{a.note ? ` — ${a.note}` : ''}</p>
                      </div>
                      <span className="text-right text-[12px] font-medium tabular-nums text-[var(--text-secondary)]">{fmtMoney(a.cost)}</span>
                      <select disabled={a.excluded} value={a.assetType} onChange={e => upd(a.id, { assetType: e.target.value as PulledAsset['assetType'] })} className="input-base px-1 py-1 text-[11px]">
                        {ASSET_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                      </select>
                      <select disabled={a.excluded || a.assetType === 'car'} value={a.treatment} onChange={e => upd(a.id, { treatment: e.target.value as PulledAsset['treatment'] })} className="input-base px-1 py-1 text-[11px]">
                        {TREATMENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <span className="text-right text-[10.5px] font-semibold">{a.disposed ? <span className="text-amber-600">Disposed</span> : a.broughtForward ? <span className="text-slate-400">B/fwd</span> : <span className="text-[var(--accent)]">New</span>}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[10.5px] text-[var(--text-muted)]">Accounts cost &amp; category seed each asset — set the tax treatment here or after import. Land / intangibles are excluded (greyed). Cars route by CO₂ (enter it in the register after import). Brought-forward assets are unticked (already in the pool b/fwd).</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-black/5 px-5 py-3">
              <span className="text-[11.5px] text-[var(--text-muted)]">{chosen.length} selected</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setOpen(false)} className="btn-secondary bg-white">Cancel</button>
                <button onClick={doImport} disabled={chosen.length === 0} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50">
                  <Download size={14} /> Import {chosen.length || ''} {chosen.length === 1 ? 'asset' : 'assets'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
