'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  X, ChevronRight, Loader2, Search, CheckSquare, Square, Package, Layers,
  Users, Building2, CheckCircle2, AlertCircle, Info, ArrowRight,
} from 'lucide-react';
import { FREQUENCY_LABEL, vatSuffix, type ServiceFrequency } from '@/lib/services/serviceTypes';

// ─── Wire shapes (local) ────────────────────────────────────────────────────
interface CatalogueSvc {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  base_price: number;
  fee_type: 'fixed' | 'tiered';
  frequency: string;
  vat_treatment: string | null;
  active: boolean;
  tiers?: Array<{ label: string; price: number }>;
}
interface Pkg { id: string; name: string; serviceIds: string[]; }
interface Client {
  id: string;
  name: string;
  client_ref: string;
  business_type?: string | null;
  status?: string | null;
}
interface AllocationResult { clientId: string; clientName: string; created: number; skipped: number; error?: string; }

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', limited_company: 'Limited Company',
  individual: 'Individual', trust: 'Trust', charity: 'Charity', rental_landlord: 'Rental Landlord',
};
const CLIENT_STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  active:   { label: 'Active',   colour: 'bg-green-100 text-green-700 border-green-200' },
  hold:     { label: 'Hold',     colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  inactive: { label: 'Inactive', colour: 'bg-gray-100 text-gray-500 border-gray-200'   },
};

type Step = 'services' | 'clients' | 'review' | 'results';
const STEP_LABELS: Record<Step, string> = {
  services: '1. Services', clients: '2. Clients', review: '3. Review', results: '4. Results',
};
const STEP_ORDER: Step[] = ['services', 'clients', 'review', 'results'];

interface Props { onClose: () => void; onComplete?: () => void; }

function freqLabel(f: string) { return FREQUENCY_LABEL[f as ServiceFrequency] ?? f; }
function priceLabel(svc: CatalogueSvc): string {
  if (svc.fee_type === 'tiered') return `Tiered (${(svc.tiers ?? []).length} tier${(svc.tiers ?? []).length === 1 ? '' : 's'})`;
  const suffix = vatSuffix(svc.vat_treatment);
  return `£${Number(svc.base_price).toFixed(2)} / ${freqLabel(svc.frequency)}${suffix ? ` · ${suffix}` : ''}`;
}

export default function BulkServiceAllocationModal({ onClose, onComplete }: Props) {
  const [step, setStep] = useState<Step>('services');
  const [error, setError] = useState('');

  // ── Catalogue + packages ──────────────────────────────────────────────────
  const [catalogue, setCatalogue] = useState<CatalogueSvc[]>([]);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [catLoading, setCatLoading] = useState(true);
  const [svcSearch, setSvcSearch] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setCatLoading(true);
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/proposals/services'),
          fetch('/api/proposals/packages'),
        ]);
        const sJson = sRes.ok ? await sRes.json() : { services: [] };
        const pJson = pRes.ok ? await pRes.json() : { packages: [] };
        setCatalogue((sJson.services ?? []).filter((s: CatalogueSvc) => s.active !== false));
        setPackages((pJson.packages ?? []).map((p: { id: string; name: string; items?: Array<{ service_id: string | null }> }) => ({
          id: p.id, name: p.name,
          serviceIds: (p.items ?? []).map(i => i.service_id).filter((x): x is string => !!x),
        })));
      } finally { setCatLoading(false); }
    })();
  }, []);

  const filteredCatalogue = useMemo(() => {
    const q = svcSearch.trim().toLowerCase();
    if (!q) return catalogue;
    return catalogue.filter(s =>
      s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q));
  }, [catalogue, svcSearch]);

  function toggleService(id: string) {
    setSelectedServiceIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function applyPackage(pkg: Pkg) {
    setSelectedServiceIds(prev => {
      const next = new Set(prev);
      // Only add services that still exist in the (active) catalogue.
      const valid = new Set(catalogue.map(c => c.id));
      pkg.serviceIds.forEach(id => { if (valid.has(id)) next.add(id); });
      return next;
    });
  }

  // ── Clients ────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState<Client[]>([]);
  const [clLoading, setClLoading] = useState(false);
  const [clSearch, setClSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // Persist selected client id → {name, ref} so review/results survive refilters.
  const [selectedClients, setSelectedClients] = useState<Map<string, { name: string; ref: string }>>(new Map());

  useEffect(() => {
    if (step !== 'clients') return;
    const params = new URLSearchParams();
    if (clSearch) params.set('search', clSearch);
    if (typeFilter) params.set('type', typeFilter);
    if (statusFilter) params.set('status', statusFilter);
    setClLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clients?${params.toString()}`);
        if (r.ok) { const d = await r.json(); setClients(d.clients ?? []); }
      } finally { setClLoading(false); }
    }, clSearch ? 200 : 0);
    return () => clearTimeout(timer);
  }, [step, clSearch, typeFilter, statusFilter]);

  function toggleClient(c: Client) {
    setSelectedClients(prev => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, { name: c.name, ref: c.client_ref });
      return next;
    });
  }
  function toggleSelectAllVisible() {
    const allSelected = clients.length > 0 && clients.every(c => selectedClients.has(c.id));
    setSelectedClients(prev => {
      const next = new Map(prev);
      if (allSelected) clients.forEach(c => next.delete(c.id));
      else clients.forEach(c => next.set(c.id, { name: c.name, ref: c.client_ref }));
      return next;
    });
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const selectedServices = useMemo(
    () => catalogue.filter(s => selectedServiceIds.has(s.id)),
    [catalogue, selectedServiceIds]);
  const totalAllocations = selectedServiceIds.size * selectedClients.size;

  // ── Submit ─────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<AllocationResult[]>([]);
  const [totals, setTotals] = useState<{ created: number; skipped: number }>({ created: 0, skipped: 0 });

  async function handleAllocate() {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/services/bulk-allocate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogue_ids: [...selectedServiceIds],
          client_ids: [...selectedClients.keys()],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Something went wrong (HTTP ${res.status}).`);
        return;
      }
      setResults(data.results ?? []);
      setTotals({ created: data.totalCreated ?? 0, skipped: data.totalSkipped ?? 0 });
      setStep('results');
      onComplete?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally { setSubmitting(false); }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function next() {
    setError('');
    if (step === 'services') {
      if (selectedServiceIds.size === 0) { setError('Pick at least one service.'); return; }
      setStep('clients');
    } else if (step === 'clients') {
      if (selectedClients.size === 0) { setError('Pick at least one client.'); return; }
      setStep('review');
    }
  }
  function back() {
    setError('');
    if (step === 'clients') setStep('services');
    else if (step === 'review') setStep('clients');
  }

  const currentIdx = STEP_ORDER.indexOf(step);

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0 bg-gray-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-600" />
            <h1 className="text-base font-bold text-gray-900">Bulk Service Allocation</h1>
          </div>
          <div className="hidden sm:flex items-center gap-1">
            {STEP_ORDER.map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  step === s ? 'bg-indigo-600 text-white'
                  : STEP_ORDER.indexOf(s) < currentIdx ? 'bg-indigo-100 text-indigo-600'
                  : 'text-gray-400'
                }`}>{STEP_LABELS[s]}</span>
                {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {/* ── STEP 1: Services ─────────────────────────────────────────────── */}
        {step === 'services' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 max-w-4xl w-full mx-auto">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Which services?</h2>
              <p className="text-sm text-gray-500">Pick the catalogue services to add to each client — or start from a package. Fee, frequency and VAT are copied from the catalogue.</p>
            </div>

            {/* Packages quick-add */}
            {packages.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
                <span className="text-xs font-semibold text-gray-500 flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Packages:</span>
                {packages.map(p => (
                  <button key={p.id} onClick={() => applyPackage(p)}
                    className="text-xs border border-gray-200 rounded-lg px-2.5 py-1 hover:border-indigo-400 hover:text-indigo-700 transition-colors">
                    {p.name} <span className="text-gray-400">· {p.serviceIds.length}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex-shrink-0">
              <Search className="h-4 w-4 text-gray-400" />
              <input autoFocus value={svcSearch} onChange={e => setSvcSearch(e.target.value)}
                placeholder="Search services…" className="flex-1 text-sm bg-transparent outline-none" />
              <span className="text-xs text-gray-400">{selectedServiceIds.size} selected</span>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
              {catLoading ? (
                <div className="h-full flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
              ) : filteredCatalogue.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-16">
                  <Layers className="h-10 w-10 text-gray-200" />
                  <p className="text-sm">{catalogue.length === 0 ? 'No services in the catalogue yet.' : 'No services match your search.'}</p>
                </div>
              ) : filteredCatalogue.map(svc => {
                const checked = selectedServiceIds.has(svc.id);
                return (
                  <button key={svc.id} onClick={() => toggleService(svc.id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${checked ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}>
                    {checked ? <CheckSquare className="h-4 w-4 text-indigo-600 flex-shrink-0 mt-0.5" /> : <Square className="h-4 w-4 text-gray-300 flex-shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">{svc.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {priceLabel(svc)}{svc.category ? ` · ${svc.category}` : ''}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 2: Clients ──────────────────────────────────────────────── */}
        {step === 'clients' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 max-w-4xl w-full mx-auto">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Which clients?</h2>
              <p className="text-sm text-gray-500">Filter and tick the clients to receive these {selectedServiceIds.size} service{selectedServiceIds.size === 1 ? '' : 's'}. A service a client already has is skipped.</p>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg flex-1 min-w-[220px]">
                <Search className="h-4 w-4 text-gray-400" />
                <input value={clSearch} onChange={e => setClSearch(e.target.value)}
                  placeholder="Search clients…" className="flex-1 text-sm bg-transparent outline-none" />
              </div>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="">All types</option>
                {Object.entries(CLIENT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="">All statuses</option>
                {Object.entries(CLIENT_STATUS_LABELS).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
              </select>
            </div>

            {/* Select-all + count */}
            <div className="flex items-center justify-between flex-shrink-0">
              <button onClick={toggleSelectAllVisible} disabled={clients.length === 0}
                className="text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:text-gray-300 inline-flex items-center gap-1.5">
                {clients.length > 0 && clients.every(c => selectedClients.has(c.id))
                  ? <><CheckSquare className="h-3.5 w-3.5" /> Deselect all shown</>
                  : <><Square className="h-3.5 w-3.5" /> Select all shown</>}
              </button>
              <span className="text-xs text-gray-400">{selectedClients.size} client{selectedClients.size === 1 ? '' : 's'} selected</span>
            </div>

            {/* List */}
            <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
              {clLoading ? (
                <div className="h-full flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-gray-300" /></div>
              ) : clients.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-16">
                  <Users className="h-10 w-10 text-gray-200" />
                  <p className="text-sm">No clients match your filters.</p>
                </div>
              ) : clients.map(c => {
                const checked = selectedClients.has(c.id);
                const st = c.status ? CLIENT_STATUS_LABELS[c.status] : null;
                return (
                  <button key={c.id} onClick={() => toggleClient(c)}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${checked ? 'bg-indigo-50/60' : 'hover:bg-gray-50'}`}>
                    {checked ? <CheckSquare className="h-4 w-4 text-indigo-600 flex-shrink-0" /> : <Square className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                    <Building2 className="h-4 w-4 text-gray-300 flex-shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{c.name}</span>
                    {c.client_ref && <span className="text-[11px] text-gray-400 font-mono flex-shrink-0">{c.client_ref}</span>}
                    {c.business_type && <span className="text-[11px] text-gray-500 flex-shrink-0 hidden sm:inline">{CLIENT_TYPE_LABELS[c.business_type] ?? c.business_type}</span>}
                    {st && <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium flex-shrink-0 ${st.colour}`}>{st.label}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP 3: Review ───────────────────────────────────────────────── */}
        {step === 'review' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 max-w-3xl w-full mx-auto overflow-auto">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Review</h2>
              <p className="text-sm text-gray-500">These services will be added to each selected client. Services a client already has are skipped automatically.</p>
            </div>

            <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <div className="text-center px-3">
                <p className="text-2xl font-bold text-indigo-700">{selectedServiceIds.size}</p>
                <p className="text-[11px] text-indigo-500 uppercase tracking-wide">Services</p>
              </div>
              <X className="h-4 w-4 text-indigo-300" />
              <div className="text-center px-3">
                <p className="text-2xl font-bold text-indigo-700">{selectedClients.size}</p>
                <p className="text-[11px] text-indigo-500 uppercase tracking-wide">Clients</p>
              </div>
              <ArrowRight className="h-4 w-4 text-indigo-300" />
              <div className="text-center px-3">
                <p className="text-2xl font-bold text-indigo-700">up to {totalAllocations}</p>
                <p className="text-[11px] text-indigo-500 uppercase tracking-wide">Services created</p>
              </div>
            </div>

            <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <p>Fees are informational — allocating services won&rsquo;t raise any invoices. You can adjust any client&rsquo;s services individually on its Services tab afterwards.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">Services ({selectedServices.length})</div>
                <div className="max-h-56 overflow-auto divide-y divide-gray-50">
                  {selectedServices.map(s => (
                    <div key={s.id} className="px-3 py-2">
                      <p className="text-sm font-medium text-gray-800">{s.name}</p>
                      <p className="text-[11px] text-gray-400">{priceLabel(s)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">Clients ({selectedClients.size})</div>
                <div className="max-h-56 overflow-auto divide-y divide-gray-50">
                  {[...selectedClients.entries()].map(([id, c]) => (
                    <div key={id} className="px-3 py-2 flex items-center gap-2">
                      <span className="text-sm text-gray-800 truncate flex-1">{c.name}</span>
                      {c.ref && <span className="text-[11px] text-gray-400 font-mono">{c.ref}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 4: Results ──────────────────────────────────────────────── */}
        {step === 'results' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4 max-w-2xl w-full mx-auto overflow-auto">
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="h-7 w-7 text-green-600" />
              </div>
              <h2 className="text-lg font-bold text-gray-900">Done</h2>
              <p className="text-sm text-gray-500">
                Added <strong className="text-gray-800">{totals.created}</strong> service{totals.created === 1 ? '' : 's'} across {results.length} client{results.length === 1 ? '' : 's'}
                {totals.skipped > 0 && <> · <span className="text-gray-400">{totals.skipped} already present, skipped</span></>}.
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="max-h-80 overflow-auto divide-y divide-gray-50">
                {results.map(r => (
                  <div key={r.clientId} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="flex-1 truncate text-sm font-medium text-gray-800">{r.clientName}</span>
                    {r.error ? (
                      <span className="text-xs text-red-600 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /> {r.error}</span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {r.created > 0 ? <span className="text-green-600 font-medium">+{r.created} added</span> : <span className="text-gray-400">none added</span>}
                        {r.skipped > 0 && <span className="text-gray-400"> · {r.skipped} skipped</span>}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
        <div className="text-xs text-red-600 font-medium">{error}</div>
        <div className="flex items-center gap-2">
          {step === 'results' ? (
            <button onClick={onClose} className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium">Close</button>
          ) : (
            <>
              {step !== 'services' && (
                <button onClick={back} className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100 font-medium">Back</button>
              )}
              {step === 'review' ? (
                <button onClick={handleAllocate} disabled={submitting}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium inline-flex items-center gap-2 disabled:opacity-50">
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Allocate services
                </button>
              ) : (
                <button onClick={next}
                  className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium inline-flex items-center gap-1.5">
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
