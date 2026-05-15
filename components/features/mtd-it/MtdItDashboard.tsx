'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  CalendarCheck, Plus, Search, ChevronDown, Loader2, Upload, Filter,
  AlertTriangle,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import MtdItClientRow from './MtdItClientRow';
import AddMtdClientModal from './AddMtdClientModal';
import BulkImportMtdModal from './BulkImportMtdModal';
import { selectableTaxYears, taxYearLabel } from '@/lib/mtdIt/quarters';
import { evaluateThreshold } from '@/lib/mtdIt/thresholds';
import type { MtdItClientRow as Row } from '@/types';

type StatusFilter = 'all' | 'active' | 'hold' | 'inactive';
type ThresholdFilter = 'all' | 'flagged' | 'unflagged';

export default function MtdItDashboard() {
  const taxYears = useMemo(() => selectableTaxYears(), []);
  const [taxYear, setTaxYear] = useState<number>(taxYears[0]);
  const [clients, setClients] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [thresholdFilter, setThresholdFilter] = useState<ThresholdFilter>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mtd-it/clients?tax_year=${year}`);
      if (!res.ok) throw new Error('Failed to load clients');
      const data = await res.json();
      setClients((data.clients ?? []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(taxYear); }, [taxYear, load]);

  // Close actions dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter(c => {
      if (q) {
        const hay = `${c.name} ${c.client_ref ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (thresholdFilter !== 'all') {
        const t = evaluateThreshold(c.mtd_it_prior_year_income, taxYear);
        if (thresholdFilter === 'flagged'   && !t.belowThreshold) return false;
        if (thresholdFilter === 'unflagged' &&  t.belowThreshold) return false;
      }
      return true;
    });
  }, [clients, search, statusFilter, thresholdFilter, taxYear]);

  const flaggedCount = useMemo(
    () => clients.filter(c => evaluateThreshold(c.mtd_it_prior_year_income, taxYear).belowThreshold).length,
    [clients, taxYear],
  );

  async function handleRemove(clientId: string) {
    const res = await fetch(`/api/mtd-it/clients?client_id=${clientId}`, { method: 'DELETE' });
    if (res.ok) {
      setClients(prev => prev.filter(c => c.id !== clientId));
    }
  }

  function openQuarter(clientId: string, quarter: 1 | 2 | 3 | 4) {
    // Stage A: navigate to the (not-yet-built) quarter page. Stage B will create it.
    window.location.href = `/mtd-it/${clientId}/${taxYear}/${quarter}`;
  }

  return (
    <ToolLayout
      title="MTD IT"
      description="Making Tax Digital for Income Tax — quarterly self-assessment prep."
      icon={CalendarCheck}
      iconColor="#2563eb"
      wide
    >
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-[320px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by client name or code…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="hold">On Hold</option>
          <option value="inactive">Inactive</option>
        </select>

        {/* Threshold filter */}
        <Tooltip label="Filter clients by MTD threshold flag (based on prior-year income)">
          <select
            value={thresholdFilter}
            onChange={e => setThresholdFilter(e.target.value as ThresholdFilter)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
          >
            <option value="all">All clients</option>
            <option value="flagged">Below threshold ({flaggedCount})</option>
            <option value="unflagged">Above threshold</option>
          </select>
        </Tooltip>

        {/* Tax year selector */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Tax year</span>
          <select
            value={taxYear}
            onChange={e => setTaxYear(parseInt(e.target.value, 10))}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white font-medium"
          >
            {taxYears.map(y => <option key={y} value={y}>{taxYearLabel(y)}</option>)}
          </select>

          {/* Add + bulk actions */}
          <div className="relative" ref={actionsRef}>
            <div className="flex items-stretch">
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-[var(--accent)] text-white rounded-l-lg hover:opacity-90"
              >
                <Plus size={14} /> Add client
              </button>
              <button
                onClick={() => setActionsOpen(o => !o)}
                aria-label="More actions"
                className="px-2 py-2 bg-[var(--accent)] text-white rounded-r-lg hover:opacity-90 border-l border-white/20"
              >
                <ChevronDown size={14} className={`transition-transform ${actionsOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
            {actionsOpen && (
              <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => { setShowBulk(true); setActionsOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Upload size={14} /> Bulk-add from CSV
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Threshold notice ─────────────────────────────────────────────── */}
      {flaggedCount > 0 && thresholdFilter === 'all' && (
        <div className="mb-3 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
          <AlertTriangle size={14} className="shrink-0 mt-px" />
          <div>
            <strong>{flaggedCount}</strong> client{flaggedCount === 1 ? ' has' : 's have'} prior-year income below the {taxYearLabel(taxYear)} MTD IT threshold. They may not be MTD-mandated yet — review before preparing.
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 font-medium">Client</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">UTR</th>
                <th className="px-3 py-2 font-medium">NI Number</th>
                <th className="px-3 py-2 font-medium">DOB</th>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Quarters</th>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-sm text-gray-500">
                    <Loader2 size={16} className="inline animate-spin mr-2" /> Loading clients…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-sm text-gray-500">
                    {clients.length === 0 ? (
                      <div className="space-y-2">
                        <div>No MTD IT clients yet.</div>
                        <button
                          onClick={() => setShowAdd(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded-lg hover:opacity-90"
                        >
                          <Plus size={12} /> Add your first client
                        </button>
                      </div>
                    ) : (
                      <>No clients match your filters.</>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <MtdItClientRow
                    key={c.id}
                    client={c}
                    taxYear={taxYear}
                    onOpenQuarter={openQuarter}
                    onRemove={handleRemove}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {!loading && clients.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
            <span>{filtered.length} of {clients.length} client{clients.length === 1 ? '' : 's'}</span>
            <span>
              <Filter size={11} className="inline mr-1" /> Showing {taxYearLabel(taxYear)}
            </span>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showAdd && (
        <AddMtdClientModal
          onClose={() => setShowAdd(false)}
          onAdded={() => { void load(taxYear); }}
        />
      )}
      {showBulk && (
        <BulkImportMtdModal
          onClose={() => setShowBulk(false)}
          onImported={() => { void load(taxYear); }}
        />
      )}
    </ToolLayout>
  );
}
