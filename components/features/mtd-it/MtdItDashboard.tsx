'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CalendarCheck, Plus, Search, ChevronDown, Loader2, Upload, Filter,
  AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, Download, SlidersHorizontal,
  Users as UsersIcon, ShieldCheck, HelpCircle, X, History, CheckCircle2,
} from 'lucide-react';

// Inline traffic-light SVG used as the status-filter icon. Three vertically
// stacked dots inside a small rectangle, drawn monochrome (currentColor) so
// it inherits the button's text colour like the other Lucide icons in the
// pill.
function TrafficLight({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="6" height="14" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="4.25"  r="1.1" fill="currentColor" />
      <circle cx="8" cy="8"     r="1.1" fill="currentColor" />
      <circle cx="8" cy="11.75" r="1.1" fill="currentColor" />
    </svg>
  );
}
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import MtdItClientRow, { type MtdItColumnKey } from './MtdItClientRow';
import MtdItHelpModal from './MtdItHelpModal';
import MtdItHistoryModal from './MtdItHistoryModal';
import MtdItQuarterStats from './MtdItQuarterStats';
import AddMtdClientModal from './AddMtdClientModal';
import BulkImportMtdModal from './BulkImportMtdModal';
import EditMtdClientModal from './EditMtdClientModal';
import { selectableTaxYears, taxYearLabel } from '@/lib/mtdIt/quarters';
import { evaluateThreshold } from '@/lib/mtdIt/thresholds';
import type { MtdItClientRow as Row } from '@/types';

type StatusFilter = 'all' | 'not_discovered' | 'unmapped' | 'ready';
type ThresholdFilter = 'all' | 'flagged' | 'unflagged';
type SortKey = 'name' | 'client_ref' | 'status' | 'utr_number' | 'national_insurance_number' | 'date_of_birth' | 'address' | 'contact_email';
type SortDir = 'asc' | 'desc';

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all',            label: 'All HMRC statuses' },
  { value: 'not_discovered', label: 'Not discovered'    },
  { value: 'unmapped',       label: 'Unmapped'          },
  { value: 'ready',          label: 'Ready'             },
];

// HMRC-setup status for a client, from its source-mapping progress.
function hmrcStatusKey(c: Row): 'not_discovered' | 'unmapped' | 'ready' {
  const t = c.sources?.total ?? 0, m = c.sources?.mapped ?? 0;
  if (t > 0 && m === t) return 'ready';
  if (t > 0) return 'unmapped';
  return 'not_discovered';
}
// A client is "ready to file" if any of its quarters has been approved by the
// client but not yet submitted to HMRC.
function isReadyToFile(c: Row): boolean {
  return Object.values(c.quarters ?? {}).includes('approved');
}
const HMRC_STATUS_LABEL: Record<string, string> = {
  not_discovered: 'Not discovered', unmapped: 'Unmapped', ready: 'Ready',
};
const HMRC_STATUS_ORDER: Record<string, number> = { not_discovered: 0, unmapped: 1, ready: 2 };

const COLUMN_OPTIONS: Array<{ key: MtdItColumnKey; label: string; defaultVisible: boolean }> = [
  { key: 'client_ref',                 label: 'Code',      defaultVisible: true  },
  { key: 'status',                     label: 'HMRC status', defaultVisible: true  },
  // Identity/reference fields default to the expandable panel to keep the row
  // uncluttered — toggle them back on here if you want them as columns.
  { key: 'utr_number',                 label: 'UTR',       defaultVisible: false },
  { key: 'national_insurance_number',  label: 'NI Number', defaultVisible: true  },
  { key: 'date_of_birth',              label: 'DOB',       defaultVisible: false },
  { key: 'address',                    label: 'Address',   defaultVisible: false },
  { key: 'contact_email',              label: 'Email',     defaultVisible: true  },
];

// v3: leaner default columns — NI Number + Email on the row, UTR/DOB/Address in the panel.
const COLUMN_PREF_KEY = 'smith.mtd_it.dashboard.columns.v3';

const QUARTER_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started', draft: 'Draft', complete: 'Complete', sent: 'Sent', approved: 'Approved', submitted: 'Submitted',
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Stable comparator that handles null/empty values consistently (push to end)
function compareValues(a: string | number | null, b: string | number | null, dir: SortDir): number {
  const aEmpty = a === null || a === '' || a === undefined;
  const bEmpty = b === null || b === '' || b === undefined;
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;   // empties always at the bottom
  if (bEmpty) return -1;
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') cmp = a - b;
  else cmp = String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
}

// Stable initial value used during SSR + first client paint. Replaced with the
// "real" current tax year inside an effect below, which avoids hydration
// mismatches when the server clock rolls over a year boundary mid-render.
const INITIAL_TAX_YEAR = 2026;
const INITIAL_TAX_YEARS = [2026, 2027, 2028, 2029, 2030];

export default function MtdItDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-link from a client page: /mtd-it?expand={clientId}. The matching
  // row mounts expanded and scrolls into view. The id is consumed once and
  // then nulled so a re-expand isn't triggered on subsequent re-renders.
  const expandClientId = searchParams?.get('expand') ?? null;
  const [taxYears, setTaxYears] = useState<number[]>(INITIAL_TAX_YEARS);
  const [taxYear,  setTaxYear]  = useState<number>(INITIAL_TAX_YEAR);
  // HMRC agent connection status — drives the "HMRC setup" button's connected state.
  const [hmrc, setHmrc] = useState<{ connected: boolean; connectedAt: string | null; connectedBy: string | null } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const loadHmrc = useCallback(() => {
    fetch('/api/mtd-it/agent/status').then(r => r.ok ? r.json() : null).then(d => { if (d) setHmrc(d); }).catch(() => {});
  }, []);
  useEffect(() => { loadHmrc(); }, [loadHmrc]);
  useEffect(() => {
    const computed = selectableTaxYears();
    setTaxYears(computed);
    // Only bump the selected year if the user hasn't already changed it
    setTaxYear(prev => (prev === INITIAL_TAX_YEAR ? computed[0] : prev));
  }, []);
  const [clients, setClients] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [thresholdFilter, setThresholdFilter] = useState<ThresholdFilter>('all');
  // "Ready to file" = quarters the client has approved but that haven't been
  // filed with HMRC yet. The agent reviews + submits these.
  const [readyToFileOnly, setReadyToFileOnly] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function toggleSort(key: SortKey) {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('asc');
      return key;
    });
  }

  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // ── Toolbar pill popovers ──────────────────────────────────────────────
  const [statusPopOpen,    setStatusPopOpen]    = useState(false);
  const [thresholdPopOpen, setThresholdPopOpen] = useState(false);
  const [colPickerOpen,    setColPickerOpen]    = useState(false);
  const statusPopRef    = useRef<HTMLDivElement>(null);
  const thresholdPopRef = useRef<HTMLDivElement>(null);
  const colPickerRef    = useRef<HTMLDivElement>(null);

  // ── Column visibility (persisted) ──────────────────────────────────────
  // Start with the static defaults so SSR + first client render match, then
  // hydrate from localStorage in an effect to avoid React hydration warnings.
  // The preference is keyed by the signed-in user's id so two people sharing
  // a browser keep their own column choices. `userId` is null until /me
  // resolves; until then we fall back to the legacy shared key.
  const [colPrefUserId, setColPrefUserId] = useState<string | null>(null);
  const colPrefKey = useCallback(
    (uid: string | null) => (uid ? `${COLUMN_PREF_KEY}.${uid}` : COLUMN_PREF_KEY),
    [],
  );
  const [visibleCols, setVisibleCols] = useState<Set<MtdItColumnKey>>(
    () => new Set(COLUMN_OPTIONS.filter(c => c.defaultVisible).map(c => c.key))
  );
  useEffect(() => {
    let cancelled = false;
    fetch('/api/users/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const uid: string | null = d?.userId ?? null;
        setColPrefUserId(uid);
        try {
          const valid = new Set(COLUMN_OPTIONS.map(c => c.key));
          const userKey = colPrefKey(uid);
          // Prefer the per-user preference; if absent, migrate the legacy
          // shared one across so nobody loses their existing layout.
          let raw = window.localStorage.getItem(userKey);
          if (!raw && uid) {
            const legacy = window.localStorage.getItem(COLUMN_PREF_KEY);
            if (legacy) { raw = legacy; window.localStorage.setItem(userKey, legacy); }
          }
          if (!raw) return;
          const arr = JSON.parse(raw) as MtdItColumnKey[];
          if (Array.isArray(arr)) setVisibleCols(new Set(arr.filter(k => valid.has(k))));
        } catch { /* ignore corrupt JSON */ }
      })
      .catch(() => {/* ignore — keep defaults */});
    return () => { cancelled = true; };
  }, [colPrefKey]);
  function toggleCol(key: MtdItColumnKey) {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try { window.localStorage.setItem(colPrefKey(colPrefUserId), JSON.stringify([...next])); } catch { /* quota / disabled */ }
      return next;
    });
  }

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

  // HMRC login opens in a new tab — refresh connection + client state when the
  // user returns to this tab so a connection made elsewhere shows up here.
  useEffect(() => {
    function onVisible() { if (document.visibilityState === 'visible') { loadHmrc(); void load(taxYear); } }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadHmrc, load, taxYear]);

  // ── Unread approval notifications, grouped by client + quarter ──────
  // Drives the "NEW APPROVAL" badge on each row and (via the same API) the
  // sidebar dot in AppShell. Polled on mount; refreshed when the user
  // navigates back from a quarter page (the focus listener picks it up).
  const [unreadByClient, setUnreadByClient] = useState<Record<string, number>>({});
  const loadUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/mtd-it/approvals/unread');
      if (!res.ok) return;
      const j = await res.json();
      setUnreadByClient((j.by_client ?? {}) as Record<string, number>);
    } catch { /* non-fatal */ }
  }, []);
  useEffect(() => {
    void loadUnread();
    function onFocus() { void loadUnread(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadUnread]);

  // Close any open dropdown / popover on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (actionsRef.current    && !actionsRef.current.contains(t))    setActionsOpen(false);
      if (statusPopRef.current  && !statusPopRef.current.contains(t))  setStatusPopOpen(false);
      if (thresholdPopRef.current && !thresholdPopRef.current.contains(t)) setThresholdPopOpen(false);
      if (colPickerRef.current  && !colPickerRef.current.contains(t))  setColPickerOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = clients.filter(c => {
      if (q) {
        const hay = `${c.name} ${c.client_ref ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter !== 'all' && hmrcStatusKey(c) !== statusFilter) return false;
      if (thresholdFilter !== 'all') {
        const t = evaluateThreshold(c.mtd_it_prior_year_income, taxYear);
        if (thresholdFilter === 'flagged'   && !t.belowThreshold) return false;
        if (thresholdFilter === 'unflagged' &&  t.belowThreshold) return false;
      }
      if (readyToFileOnly && !isReadyToFile(c)) return false;
      return true;
    });
    // Sort in-place on a copy. DOB is stored YYYY-MM-DD (lexically sortable);
    // status uses the visible label so 'On Hold' sorts where the user expects.
    return [...list].sort((a, b) => {
      // The 'status' column now shows HMRC-setup status — sort by its rank.
      const av = sortKey === 'status' ? String(HMRC_STATUS_ORDER[hmrcStatusKey(a)]) : (a as Record<SortKey, string | null>)[sortKey];
      const bv = sortKey === 'status' ? String(HMRC_STATUS_ORDER[hmrcStatusKey(b)]) : (b as Record<SortKey, string | null>)[sortKey];
      return compareValues(av, bv, sortDir);
    });
  }, [clients, search, statusFilter, thresholdFilter, readyToFileOnly, taxYear, sortKey, sortDir]);

  const flaggedCount = useMemo(
    () => clients.filter(c => evaluateThreshold(c.mtd_it_prior_year_income, taxYear).belowThreshold).length,
    [clients, taxYear],
  );

  // Total quarters across all clients that are approved but not yet filed.
  const readyToFileCount = useMemo(
    () => clients.reduce((n, c) => n + Object.values(c.quarters ?? {}).filter(s => s === 'approved').length, 0),
    [clients],
  );

  // Total <th>/<td> count for colSpan: chevron + name + each visible column +
  // quarters + streams + threshold-warning + edit + remove. Keep in sync with
  // the table markup.
  const totalCols = 1 + 1 + visibleCols.size + 1 + 1 + 1 + 1 + 1;

  async function handleRemove(clientId: string) {
    const res = await fetch(`/api/mtd-it/clients?client_id=${clientId}`, { method: 'DELETE' });
    if (res.ok) {
      setClients(prev => prev.filter(c => c.id !== clientId));
    }
  }

  function openQuarter(clientId: string, quarter: 1 | 2 | 3 | 4) {
    // Soft client-side nav so the TabContext stays in sync and the MTD IT
    // tab remains active (full reloads tend to drop the tab back to Dashboard
    // on slow connections / pre-hydration).
    router.push(`/mtd-it/${clientId}/${taxYear}/${quarter}`);
  }

  function exportCsv() {
    // Header always starts with Client; optional columns follow visibility,
    // then the four quarter columns are always included so the export still
    // captures the per-quarter status no matter which info columns are hidden.
    const headers: string[] = ['Client'];
    if (visibleCols.has('client_ref'))                headers.push('Code');
    if (visibleCols.has('status'))                    headers.push('HMRC status');
    if (visibleCols.has('utr_number'))                headers.push('UTR');
    if (visibleCols.has('national_insurance_number')) headers.push('NI Number');
    if (visibleCols.has('date_of_birth'))             headers.push('DOB');
    if (visibleCols.has('address'))                   headers.push('Address');
    if (visibleCols.has('contact_email'))             headers.push('Email');
    headers.push('Q1', 'Q2', 'Q3', 'Q4');
    headers.push('Streams');

    const rows = filtered.map(c => {
      const row: (string | null)[] = [c.name];
      if (visibleCols.has('client_ref'))                row.push(c.client_ref ?? '');
      if (visibleCols.has('status'))                    row.push(HMRC_STATUS_LABEL[hmrcStatusKey(c)]);
      if (visibleCols.has('utr_number'))                row.push(c.utr_number ?? '');
      if (visibleCols.has('national_insurance_number')) row.push(c.national_insurance_number ?? '');
      if (visibleCols.has('date_of_birth'))             row.push(c.date_of_birth ?? '');
      if (visibleCols.has('address'))                   row.push(c.address ?? '');
      if (visibleCols.has('contact_email'))             row.push(c.contact_email ?? '');
      row.push(
        c.quarters[1] ? QUARTER_STATUS_LABEL[c.quarters[1]] : '',
        c.quarters[2] ? QUARTER_STATUS_LABEL[c.quarters[2]] : '',
        c.quarters[3] ? QUARTER_STATUS_LABEL[c.quarters[3]] : '',
        c.quarters[4] ? QUARTER_STATUS_LABEL[c.quarters[4]] : '',
      );
      const streams: string[] = [];
      if (c.mtd_it_streams.sole)           streams.push('Sole Trader');
      if (c.mtd_it_streams.uk_rental)      streams.push('UK Rental');
      if (c.mtd_it_streams.foreign_rental) streams.push('Foreign Rental');
      row.push(streams.join(', '));
      return row;
    });

    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mtd_it_${taxYearLabel(taxYear).replace('/', '-')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function SortHeader({ label, field, className = '', style }: { label: string; field: SortKey; className?: string; style?: React.CSSProperties }) {
    const active = sortKey === field;
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th className={`px-3 py-2 font-medium ${className}`} style={style}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className={`group inline-flex items-center gap-1 text-[11px] uppercase tracking-wide hover:text-gray-700 ${active ? 'text-gray-700' : 'text-gray-500'}`}
        >
          {label}
          <Icon size={11} className={active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'} />
        </button>
      </th>
    );
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

        {/* Ready to file — quick filter for quarters the client has approved but
            that haven't been submitted to HMRC yet. Only shown when there are
            any, styled as a call-to-action. */}
        {readyToFileCount > 0 && (
          <Tooltip label={readyToFileOnly ? 'Showing only clients with approved, unfiled quarters' : 'Show only clients with quarters approved by the client and ready to file with HMRC'}>
            <button
              onClick={() => setReadyToFileOnly(v => !v)}
              aria-pressed={readyToFileOnly}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-sm transition-colors ${
                readyToFileOnly
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
              }`}
            >
              <CheckCircle2 size={13} />
              Ready to file
              <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold ${readyToFileOnly ? 'bg-white/25 text-white' : 'bg-emerald-600 text-white'}`}>{readyToFileCount}</span>
              {readyToFileOnly && <X size={12} className="ml-0.5" />}
            </button>
          </Tooltip>
        )}

        {/* Active filter pills — obvious when filters are applied; they stack. */}
        {statusFilter !== 'all' && (
          <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30">
            HMRC: {HMRC_STATUS_LABEL[statusFilter] ?? statusFilter}
            <button
              onClick={() => setStatusFilter('all')}
              aria-label="Clear HMRC status filter"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--accent)]/20"
            ><X size={11} /></button>
          </span>
        )}
        {thresholdFilter !== 'all' && (
          <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/30">
            {thresholdFilter === 'flagged' ? `Below ${taxYearLabel(taxYear)} threshold` : `Above ${taxYearLabel(taxYear)} threshold`}
            <button
              onClick={() => setThresholdFilter('all')}
              aria-label="Clear threshold filter"
              className="inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--accent)]/20"
            ><X size={11} /></button>
          </span>
        )}
        {(statusFilter !== 'all' && thresholdFilter !== 'all') && (
          <button
            onClick={() => { setStatusFilter('all'); setThresholdFilter('all'); }}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2"
          >Clear all</button>
        )}

        {/* ── Pill toolbar (next to search) ─────────────────────────────── */}
        {/* All four buttons share the same w-7 h-7 box and inline-flex centring
            so the icons sit on a single baseline regardless of their natural
            glyph metrics. */}
        <div className="flex items-center gap-1 glass-solid rounded-full border border-[var(--border)] px-2 py-1 shadow-sm">

          {/* Status filter */}
          <div className="relative" ref={statusPopRef}>
            <Tooltip label={statusFilter === 'all' ? 'Filter by HMRC status' : `HMRC status: ${HMRC_STATUS_LABEL[statusFilter] ?? statusFilter}`}>
              <button
                onClick={() => { setStatusPopOpen(o => !o); setThresholdPopOpen(false); setColPickerOpen(false); }}
                aria-label="Filter by HMRC status"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${statusFilter !== 'all' || statusPopOpen ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'}`}
              >
                <TrafficLight size={15} />
              </button>
            </Tooltip>
            {statusPopOpen && (
              <div className="absolute left-0 top-full mt-2 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-2 w-44">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide px-2 mb-1">HMRC status</p>
                {STATUS_FILTER_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    onClick={() => { setStatusFilter(o.value); setStatusPopOpen(false); }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${statusFilter === o.value ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'}`}
                  >
                    <span>{o.label}</span>
                    {statusFilter === o.value && <span aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span aria-hidden className="w-px h-4 bg-[var(--border)]" />

          {/* Threshold ("All clients") filter */}
          <div className="relative" ref={thresholdPopRef}>
            <Tooltip label={thresholdFilter === 'all' ? 'All clients' : thresholdFilter === 'flagged' ? `Below ${taxYearLabel(taxYear)} threshold` : `Above ${taxYearLabel(taxYear)} threshold`}>
              <button
                onClick={() => { setThresholdPopOpen(o => !o); setStatusPopOpen(false); setColPickerOpen(false); }}
                aria-label="Filter by MTD threshold"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${thresholdFilter !== 'all' || thresholdPopOpen ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'}`}
              >
                <UsersIcon size={15} />
              </button>
            </Tooltip>
            {thresholdPopOpen && (
              <div className="absolute left-0 top-full mt-2 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-2 w-56">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide px-2 mb-1">MTD threshold</p>
                {([
                  { value: 'all',       label: 'All clients' },
                  { value: 'flagged',   label: `Below threshold${flaggedCount ? ` (${flaggedCount})` : ''}` },
                  { value: 'unflagged', label: 'Above threshold' },
                ] as { value: ThresholdFilter; label: string }[]).map(o => (
                  <button
                    key={o.value}
                    onClick={() => { setThresholdFilter(o.value); setThresholdPopOpen(false); }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors ${thresholdFilter === o.value ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'}`}
                  >
                    <span>{o.label}</span>
                    {thresholdFilter === o.value && <span aria-hidden>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span aria-hidden className="w-px h-4 bg-[var(--border)]" />

          {/* Export to CSV */}
          <Tooltip label="Export view to CSV">
            <button
              onClick={exportCsv}
              disabled={filtered.length === 0}
              aria-label="Export view to CSV"
              className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)]"
            >
              <Download size={15} />
            </button>
          </Tooltip>
          <span aria-hidden className="w-px h-4 bg-[var(--border)]" />

          {/* Column picker */}
          <div className="relative" ref={colPickerRef}>
            <Tooltip label="Show / hide columns">
              <button
                onClick={() => { setColPickerOpen(o => !o); setStatusPopOpen(false); setThresholdPopOpen(false); }}
                aria-label="Show / hide columns"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${colPickerOpen ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'}`}
              >
                <SlidersHorizontal size={15} />
              </button>
            </Tooltip>
            {colPickerOpen && (
              <div className="absolute left-0 top-full mt-2 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-3 w-48 space-y-1">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide px-1 mb-2">Show / hide columns</p>
                {COLUMN_OPTIONS.map(col => (
                  <label key={col.key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] cursor-pointer transition-colors">
                    <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)} className="accent-[var(--accent)] w-3.5 h-3.5" />
                    <span className="text-sm text-[var(--text-primary)]">{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right-side cluster: tax year + add */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Tax year</span>
          <select
            value={taxYear}
            onChange={e => setTaxYear(parseInt(e.target.value, 10))}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white font-medium"
          >
            {taxYears.map(y => <option key={y} value={y}>{taxYearLabel(y)}</option>)}
          </select>

          {/* Calculator & Demo pills — quick-access utilities that sit
              alongside Add client rather than inside the dashboard table.
              Calculator opens an in-memory P&L calculator; Demo spins up
              a sandboxed client with sample data the user can play with. */}
          <Tooltip label="Activity history — drafts saved, emails sent, client approvals and HMRC submissions across the firm.">
            <button
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg shadow-sm border bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              <History size={14} /> History
            </button>
          </Tooltip>
          <Tooltip label="How MTD IT works — authorising, discovering, mapping and submitting.">
            <button
              onClick={() => setShowHelp(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg shadow-sm border bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              <HelpCircle size={14} /> Help
            </button>
          </Tooltip>
          <Tooltip label={hmrc?.connected
            ? `Connected to HMRC${hmrc.connectedAt ? ` on ${new Date(hmrc.connectedAt).toLocaleDateString('en-GB')}` : ''}${hmrc.connectedBy ? ` by ${hmrc.connectedBy}` : ''} — click to manage clients, discovery & mapping.`
            : 'Connect your HMRC agent account and bulk-set up clients for Making Tax Digital for Income Tax (NINOs, business discovery and mapping).'}>
            <button
              onClick={() => router.push('/mtd-it/onboarding')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg shadow-sm border ${hmrc?.connected
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}
            >
              <ShieldCheck size={14} /> {hmrc?.connected ? 'HMRC connected' : 'HMRC setup'}
            </button>
          </Tooltip>
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

      {/* ── Quarter status donuts ────────────────────────────────────────── */}
      <MtdItQuarterStats clients={clients} taxYear={taxYear} />

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

      {/* ── Table (HR-Tracker style: bounded scroll container so sticky <th>
              cells pin to the top of THIS box, not the page) ──────────── */}
      <div className="bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl overflow-auto max-h-[calc(100vh-220px)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 w-8"></th>
              <SortHeader label="Client"    field="name"                          className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />
              {visibleCols.has('client_ref')                && <SortHeader label="Code"      field="client_ref"                className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('status')                    && <SortHeader label="HMRC"      field="status"                    className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('utr_number')                && <SortHeader label="UTR"       field="utr_number"                className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('national_insurance_number') && <SortHeader label="NI Number" field="national_insurance_number" className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('date_of_birth')             && <SortHeader label="DOB"       field="date_of_birth"             className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('address')                   && <SortHeader label="Address"   field="address"                   className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              {visibleCols.has('contact_email')             && <SortHeader label="Email"     field="contact_email"             className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200" />}
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-medium text-[11px] uppercase tracking-wide text-gray-500">Quarters</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-medium text-[11px] uppercase tracking-wide text-gray-500">Streams</th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 w-8"></th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 w-8"></th>
              <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 w-8"></th>
            </tr>
          </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-12 text-center text-sm text-gray-500">
                    <Loader2 size={16} className="inline animate-spin mr-2" /> Loading clients…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={totalCols} className="px-3 py-12 text-center text-sm text-gray-500">
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
                    visibleCols={visibleCols}
                    totalCols={totalCols}
                    unreadApprovals={unreadByClient[c.id] ?? 0}
                    onOpenQuarter={openQuarter}
                    onEdit={(id) => setEditingClientId(id)}
                    onRemove={handleRemove}
                    onNotesSaved={(id, notes) =>
                      setClients(prev => prev.map(x => x.id === id ? { ...x, mtd_it_notes: notes } : x))
                    }
                    onRefresh={() => void load(taxYear)}
                    forceExpand={c.id === expandClientId}
                  />
                ))
              )}
            </tbody>
          </table>

        {/* Footer summary */}
        {!loading && clients.length > 0 && (
          <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 text-xs text-gray-500 flex items-center justify-between sticky bottom-0">
            <span>{filtered.length} of {clients.length} client{clients.length === 1 ? '' : 's'}</span>
            <span>
              <Filter size={11} className="inline mr-1" /> Showing {taxYearLabel(taxYear)}
            </span>
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {showHelp && <MtdItHelpModal onClose={() => setShowHelp(false)} />}
      {showHistory && <MtdItHistoryModal onClose={() => setShowHistory(false)} />}
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
      {editingClientId && (() => {
        const target = clients.find(c => c.id === editingClientId);
        if (!target) return null;
        return (
          <EditMtdClientModal
            client={target}
            onClose={() => setEditingClientId(null)}
            onSaved={() => { void load(taxYear); }}
          />
        );
      })()}
    </ToolLayout>
  );
}
