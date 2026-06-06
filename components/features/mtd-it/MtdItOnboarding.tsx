'use client';

/**
 * MtdItOnboarding — bulk MTD-IT setup for an agent firm.
 *
 *   1. Connect the firm's HMRC agent account ONCE.
 *   2. Bulk-fill NINO / UTR for every MTD-IT client (grid edit or CSV import).
 *   3. Sweep HMRC for each client's businesses, then auto-map them to the
 *      client's trades/properties — resolving only the exceptions by hand.
 *
 * Admin only (the endpoints enforce it too).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck, Loader2, Upload, Check, AlertTriangle, Search, Plug, Unplug, Save, ArrowLeft, HelpCircle,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import MtdItHelpModal from './MtdItHelpModal';
import { collectFraudData, HMRC_OBLIGATION_SCENARIOS } from '@/lib/hmrc/clientFraudData';

interface ClientRow {
  id: string; name: string; client_ref: string | null;
  nino: string; self_assessment_utr: string;
  sources: { total: number; mapped: number };
}
interface HmrcBusiness { typeOfBusiness?: string; businessId?: string; tradingName?: string }
type DiscoverOutcome =
  | { clientId: string; name: string; status: 'ok'; businesses: HmrcBusiness[] }
  | { clientId: string; name: string; status: 'missing_nino' | 'needs_auth' | 'error'; error?: string };

const TYPE_LABEL: Record<string, string> = {
  'self-employment': 'Self-employment', 'uk-property': 'UK property', 'foreign-property': 'Foreign property',
};

export default function MtdItOnboarding() {
  const router = useRouter();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [edits, setEdits] = useState<Record<string, { nino?: string; utr?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [savingIds, setSavingIds] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [results, setResults] = useState<Record<string, DiscoverOutcome>>({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set()); // per-client discover in flight
  const [mapping, setMapping] = useState<Record<string, string>>({}); // clientId → status text
  const [testScenario, setTestScenario] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'no_nino' | 'undiscovered' | 'unmapped' | 'ready'>('all');
  const [showHelp, setShowHelp] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    const r = await fetch('/api/mtd-it/agent/status');
    if (r.ok) { const d = await r.json(); setConnected(d.connected); setConfigured(d.configured); }
  }, []);
  const loadClients = useCallback(async () => {
    const r = await fetch('/api/mtd-it/agent/clients');
    if (r.status === 403) { setForbidden(true); return; }
    if (r.ok) { const d = await r.json(); setClients(d.clients ?? []); }
  }, []);

  useEffect(() => {
    (async () => { setLoading(true); await Promise.all([loadStatus(), loadClients()]); setLoading(false); })();
    // Surface the OAuth round-trip result if we just came back from HMRC.
    const p = new URLSearchParams(window.location.search).get('hmrc');
    if (p === 'connected') setBanner({ kind: 'ok', text: 'HMRC agent account connected.' });
    else if (p) setBanner({ kind: 'err', text: `HMRC connection ${p.replace(/_/g, ' ')}.` });
  }, [loadStatus, loadClients]);

  function setEdit(id: string, field: 'nino' | 'utr', value: string) {
    setEdits(e => ({ ...e, [id]: { ...e[id], [field]: value } }));
  }
  const dirtyRows = useMemo(() => Object.entries(edits)
    .map(([clientId, v]) => ({ clientId, nino: v.nino, utr: v.utr }))
    .filter(r => r.nino !== undefined || r.utr !== undefined), [edits]);

  async function saveIdentifiers(rows: { clientId?: string; clientRef?: string; nino?: string; utr?: string }[]) {
    if (rows.length === 0) return;
    setSavingIds(true);
    try {
      const r = await fetch('/api/mtd-it/agent/import-identifiers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setBanner({ kind: 'err', text: d.error ?? 'Could not save identifiers.' }); return; }
      setBanner({ kind: 'ok', text: `Saved ${d.updated} client${d.updated === 1 ? '' : 's'}.${d.skipped?.length ? ` ${d.skipped.length} skipped.` : ''}` });
      setEdits({});
      await loadClients();
    } finally { setSavingIds(false); }
  }

  async function onCsv(file: File) {
    const text = await file.text();
    const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(line => {
      const [clientRef, nino, utr] = line.split(',').map(s => s?.trim());
      return { clientRef, nino, utr };
    }).filter(r => r.clientRef && r.clientRef.toLowerCase() !== 'client_ref');
    if (rows.length === 0) { setBanner({ kind: 'err', text: 'No usable rows in the CSV (expected client_ref,nino,utr).' }); return; }
    await saveIdentifiers(rows);
  }

  // Discover businesses for a specific client, or for ALL clients (clientIds
  // omitted). HMRC rate-limits hard, so "all" needs an explicit confirm and a
  // per-client option exists for targeted/sandbox testing.
  async function discover(clientIds?: string[]) {
    if (!clientIds) {
      const withNino = clients.filter(c => (edits[c.id]?.nino ?? c.nino).trim()).length;
      if (!window.confirm(`This makes one HMRC call per client (${withNino} with a NINO). HMRC rate-limits bulk requests — run it in smaller batches if you hit a quota error. Continue?`)) return;
    }
    if (clientIds) setBusyIds(s => new Set(s).add(clientIds[0])); else { setDiscovering(true); setResults({}); }
    try {
      const fraudData = collectFraudData();
      const r = await fetch('/api/mtd-it/agent/discover-businesses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fraudData, testScenario: testScenario || undefined, clientIds }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setBanner({ kind: 'err', text: d.error ?? 'Discovery failed.' }); return; }
      const incoming = (d.results ?? []) as DiscoverOutcome[];
      setResults(prev => {
        const next = clientIds ? { ...prev } : {} as Record<string, DiscoverOutcome>;
        for (const o of incoming) next[o.clientId] = o;
        return next;
      });
      if (!clientIds) setBanner({ kind: 'ok', text: `Swept ${d.summary?.total ?? 0} clients · ${d.summary?.ok ?? 0} ok · ${d.summary?.needs_auth ?? 0} not authorised · ${d.summary?.missing_nino ?? 0} missing NINO.` });
    } finally {
      if (clientIds) setBusyIds(s => { const n = new Set(s); n.delete(clientIds[0]); return n; }); else setDiscovering(false);
    }
  }

  async function autoMap(clientId: string, businesses: HmrcBusiness[]) {
    setMapping(m => ({ ...m, [clientId]: 'Mapping…' }));
    const r = await fetch('/api/mtd-it/agent/auto-map', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, businesses }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setMapping(m => ({ ...m, [clientId]: d.error ?? 'Failed' })); return; }
    const linked = d.linked?.length ?? 0, created = d.created?.length ?? 0, attention = d.mismatches?.length ?? 0;
    const parts = [linked ? `linked ${linked}` : '', created ? `created ${created}` : ''].filter(Boolean);
    setMapping(m => ({ ...m, [clientId]: `${parts.length ? parts.join(' · ') : 'Nothing to link'}${attention ? ` · ${attention} to review` : ''}` }));
    await loadClients();
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  }
  if (forbidden) {
    return <div className="p-6"><div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 inline-flex items-center gap-2"><AlertTriangle size={14} /> MTD IT onboarding is available to firm admins only.</div></div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button
        onClick={() => router.push('/mtd-it')}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft size={14} /> Back to MTD IT dashboard
      </button>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">MTD IT — HMRC setup</h1>
          <p className="text-sm text-slate-500 mt-0.5">Connect once, fill in NINOs, then discover and map every client&apos;s HMRC businesses in one pass.</p>
        </div>
        <button onClick={() => setShowHelp(true)} className="shrink-0 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
          <HelpCircle size={14} /> Help
        </button>
      </div>
      {showHelp && <MtdItHelpModal onClose={() => setShowHelp(false)} />}

      {banner && (
        <div className={`rounded-lg border px-3 py-2 text-sm ${banner.kind === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>
          {banner.text}
        </div>
      )}

      {/* 1 — Connection */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className={connected ? 'text-emerald-600' : 'text-slate-400'} />
            <div>
              <p className="text-sm font-medium text-slate-800">Step 1 · Agent connection</p>
              <p className="text-xs text-slate-500">{!configured ? 'HMRC is not configured for this environment yet.' : connected ? 'Connected to HMRC. This one connection covers every authorised client.' : 'Not connected.'}</p>
            </div>
          </div>
          {configured && (connected ? (
            <button
              onClick={async () => { await fetch('/api/hmrc/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ service: 'mtd_it', kind: 'agent' }) }); await loadStatus(); }}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"
            ><Unplug size={13} /> Disconnect</button>
          ) : (
            <a href="/api/hmrc/connect?service=mtd_it&kind=agent" className="btn-primary inline-flex items-center gap-1.5 text-sm"><Plug size={13} /> Connect HMRC agent</a>
          ))}
        </div>
      </section>

      {/* 2 — Clients (unified: identifiers + discover + map) */}
      {(() => {
        const ninoOf = (c: ClientRow) => (edits[c.id]?.nino ?? c.nino).trim();
        const counts = {
          total: clients.length,
          noNino: clients.filter(c => !ninoOf(c)).length,
          undiscovered: clients.filter(c => ninoOf(c) && !results[c.id]).length,
          unmapped: clients.filter(c => c.sources.total > 0 && c.sources.mapped < c.sources.total).length,
          ready: clients.filter(c => c.sources.total > 0 && c.sources.mapped === c.sources.total).length,
        };
        const matchesFilter = (c: ClientRow) => {
          switch (filter) {
            case 'no_nino':      return !ninoOf(c);
            case 'undiscovered': return Boolean(ninoOf(c)) && !results[c.id];
            case 'unmapped':     return c.sources.total > 0 && c.sources.mapped < c.sources.total;
            case 'ready':        return c.sources.total > 0 && c.sources.mapped === c.sources.total;
            default:             return true;
          }
        };
        const q = search.trim().toLowerCase();
        const shown = clients.filter(c =>
          matchesFilter(c) &&
          (!q || c.name.toLowerCase().includes(q) || (c.client_ref ?? '').toLowerCase().includes(q)));

        const CHIPS: { id: typeof filter; label: string; n: number }[] = [
          { id: 'all', label: 'All', n: counts.total },
          { id: 'no_nino', label: 'Needs NINO', n: counts.noNino },
          { id: 'undiscovered', label: 'Not discovered', n: counts.undiscovered },
          { id: 'unmapped', label: 'Unmapped', n: counts.unmapped },
          { id: 'ready', label: 'Ready', n: counts.ready },
        ];

        return (
          <section className="rounded-xl border border-slate-200 bg-white">
            {/* Toolbar */}
            <div className="px-4 py-3 border-b border-slate-100 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sm font-medium text-slate-800">Step 2 · Clients <span className="text-slate-400 font-normal">({shown.length} of {counts.total})</span></p>
                <div className="flex items-center gap-2">
                  <select value={testScenario} onChange={e => setTestScenario(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-200 rounded bg-white">
                    {HMRC_OBLIGATION_SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onCsv(f); e.currentTarget.value = ''; }} />
                  <Tooltip label="CSV columns: client_ref, nino, utr">
                    <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700"><Upload size={13} /> Import CSV</button>
                  </Tooltip>
                  <Tooltip label={connected ? 'Discover HMRC businesses for the clients currently shown' : 'Connect the agent first'}>
                    <button onClick={() => void discover(shown.map(c => c.id))} disabled={!connected || discovering || shown.length === 0} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40">
                      {discovering ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Discover shown
                    </button>
                  </Tooltip>
                  <button onClick={() => void saveIdentifiers(dirtyRows)} disabled={savingIds || dirtyRows.length === 0} className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
                    {savingIds ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save {dirtyRows.length ? `(${dirtyRows.length})` : ''}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or code…" className="text-sm pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {CHIPS.map(chip => (
                  <button key={chip.id} onClick={() => setFilter(chip.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${filter === chip.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
                    {chip.label} <span className={filter === chip.id ? 'opacity-80' : 'text-slate-400'}>{chip.n}</span>
                  </button>
                ))}
              </div>
            </div>

            {clients.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400">No MTD-IT clients yet. Flag clients as MTD IT first.</p>
            ) : shown.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400">No clients match this filter.</p>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide z-10">
                    <tr>
                      <th className="text-left px-4 py-2">Client</th>
                      <th className="text-left px-4 py-2">NINO</th>
                      <th className="text-left px-4 py-2">UTR</th>
                      <th className="text-left px-4 py-2">
                        <Tooltip label="Income sources linked to an HMRC business ÷ total sources. Discover + auto-map fills these in; submit skips any unmapped source.">
                          <span className="inline-flex items-center gap-1 border-b border-dotted border-slate-300 cursor-help">Sources</span>
                        </Tooltip>
                      </th>
                      <th className="text-right px-4 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shown.map(c => {
                      const e = edits[c.id] ?? {};
                      const o = results[c.id];
                      const hasNino = Boolean(ninoOf(c));
                      const busy = busyIds.has(c.id);
                      return (
                        <tr key={c.id} className="align-top">
                          <td className="px-4 py-2"><span className="font-medium text-slate-800">{c.name}</span>{c.client_ref && <span className="text-slate-400 ml-1.5 text-xs">{c.client_ref}</span>}</td>
                          <td className="px-4 py-2">
                            <input value={e.nino ?? c.nino} onChange={ev => setEdit(c.id, 'nino', ev.target.value.toUpperCase())} placeholder="AB123456C" className="w-32 text-sm px-2 py-1 border border-slate-200 rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          </td>
                          <td className="px-4 py-2">
                            <input value={e.utr ?? c.self_assessment_utr} onChange={ev => setEdit(c.id, 'utr', ev.target.value.replace(/[^0-9]/g, ''))} placeholder="1234567890" maxLength={10} className="w-32 text-sm px-2 py-1 border border-slate-200 rounded tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                          </td>
                          <td className="px-4 py-2">
                            <span className={`tabular-nums ${c.sources.total > 0 && c.sources.mapped === c.sources.total ? 'text-emerald-700' : 'text-slate-600'}`}>{c.sources.mapped}/{c.sources.total}</span>
                            {o?.status === 'ok' && o.businesses.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {o.businesses.map(b => (
                                  <span key={b.businessId} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-500">
                                    {TYPE_LABEL[b.typeOfBusiness ?? ''] ?? b.typeOfBusiness} · <span className="font-mono">{b.businessId}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            {o && o.status !== 'ok' && (
                              <span className={`block mt-1 text-[11px] ${o.status === 'needs_auth' ? 'text-amber-700' : 'text-rose-700'}`}>
                                {o.status === 'missing_nino' ? 'Missing NINO' : o.status === 'needs_auth' ? 'Not authorised at HMRC' : (o.error ?? 'Error')}
                              </span>
                            )}
                            {mapping[c.id] && <span className="block text-[11px] text-slate-500 mt-0.5">{mapping[c.id]}</span>}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center justify-end gap-1.5">
                              {o?.status === 'ok' && o.businesses.length > 0 && (
                                <button onClick={() => void autoMap(c.id, o.businesses)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50"><Check size={12} /> Map</button>
                              )}
                              <Tooltip label={!connected ? 'Connect the agent first' : hasNino ? 'Fetch this client’s HMRC businesses' : 'Add a NINO first'}>
                                <button onClick={() => void discover([c.id])} disabled={busy || !hasNino || !connected} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} {o ? 'Re-check' : 'Discover'}
                                </button>
                              </Tooltip>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })()}
    </div>
  );
}
