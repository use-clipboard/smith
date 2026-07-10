'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Building2, RefreshCw, Download, Upload, ChevronDown, ChevronUp,
  ChevronRight, AlertTriangle, CheckCircle, Search, SlidersHorizontal,
  Eye, EyeOff, Users, List, X, Loader2, Info, Save, Trash2, Clock, Link2,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { useModules } from '@/components/ui/ModulesProvider';
import CHSettingsPanel from '@/components/features/ch-secretarial/CHSettingsPanel';
import CHExpandedRow from '@/components/features/ch-secretarial/CHExpandedRow';
import LinkDeadlineTaskModal, { type DeadlineType } from '@/components/features/ch-secretarial/LinkDeadlineTaskModal';
import { exportCHWorkbook } from '@/utils/chExport';
import { CH_COLUMNS } from '@/types/ch';
import type { CHCompanyData, CHSortField } from '@/types/ch';
import { createClient } from '@/lib/supabase';

// Status-band filter token used by the stat-panel buttons. Declared at module
// scope so SWC doesn't have to re-parse it on every render, and so any
// component-internal reference resolves predictably.
type MetricFilter =
  | null
  | 'accounts_overdue' | 'accounts_soon'
  | 'cs_overdue'       | 'cs_soon'
  | 'officer_idv_overdue' | 'officer_idv_soon'
  | 'psc_idv_overdue'  | 'psc_idv_soon'
  // Task-link filters — gated on Tasks + CH Sec both being active. "linked"
  // = company has at least one CH deadline link; "unlinked" = none.
  | 'has_linked_task'  | 'no_linked_task';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

// Safely coerce any error-like value into a string for rendering. Cached
// company rows can carry `error` as an object (Postgrest / Gmail / Supabase
// error shapes leak through if anything wrote one in) — and rendering an
// object as a JSX child crashes React with "Objects are not valid as a React
// child". Pull a useful message out where we can.
function errorToString(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as { message?: unknown; error?: unknown; code?: unknown };
    if (typeof e.message === 'string') return e.message;
    if (typeof e.error === 'string')   return e.error;
    if (typeof e.code === 'string')    return e.code;
    try { return JSON.stringify(err); } catch { return 'Error'; }
  }
  return String(err);
}

function DueDateCell({ dateStr, overdue }: { dateStr: string | null; overdue?: boolean }) {
  if (!dateStr) return <span className="text-xs text-[var(--text-muted)]">—</span>;
  const days = daysUntil(dateStr);
  if (days === null) return <span className="text-xs">{dateStr}</span>;

  let cls = 'inline-flex flex-col items-start ';
  let badge = '';
  if (days < 0 || overdue) {
    badge = 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  } else if (days <= 30) {
    badge = 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  } else if (days <= 60) {
    badge = 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
  } else {
    badge = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  }

  const daysLabel = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`;
  return (
    <span className={cls}>
      <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">{dateStr}</span>
      <span className={`text-xs font-medium px-1.5 py-0.5 rounded mt-0.5 ${badge}`}>{daysLabel}</span>
    </span>
  );
}

function OverdueBadge({ overdue, count }: { overdue?: boolean; count?: number }) {
  if (count !== undefined) {
    if (count === 0) return <span className="text-xs text-[var(--text-muted)]">—</span>;
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">{count}</span>;
  }
  if (!overdue) return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">No</span>;
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Yes</span>;
}

function StatusBadge({ status }: { status: string }) {
  const lower = status.toLowerCase();
  let cls = 'text-xs font-medium px-2 py-0.5 rounded-full capitalize ';
  if (lower === 'active') cls += 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  else if (lower === 'dissolved') cls += 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
  else if (['liquidation', 'administration', 'insolvency-proceedings'].includes(lower))
    cls += 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  else if (lower === 'error') cls += 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  else cls += 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return <span className={cls}>{status.replace(/-/g, ' ')}</span>;
}

function timeAgo(isoStr: string | null): string {
  if (!isoStr) return '';
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// CH normalises company numbers (8-char zero-padded upper-case) — the same
// normalisation is applied when we populate clientCodeByCompanyNumber so the
// two sides line up regardless of how the user typed the number in.
function normaliseCompanyNumber(n: string): string {
  return n.trim().toUpperCase().padStart(8, '0');
}

function sortCompanies(
  companies: CHCompanyData[],
  field: CHSortField,
  dir: 'asc' | 'desc',
  clientCodeByCompanyNumber?: Map<string, string>,
): CHCompanyData[] {
  return [...companies].sort((a, b) => {
    const av: unknown = field === 'clientCode'
      ? (clientCodeByCompanyNumber?.get(normaliseCompanyNumber(a.companyNumber)) ?? '')
      : ((a as unknown as Record<string, unknown>)[field] ?? '');
    const bv: unknown = field === 'clientCode'
      ? (clientCodeByCompanyNumber?.get(normaliseCompanyNumber(b.companyNumber)) ?? '')
      : ((b as unknown as Record<string, unknown>)[field] ?? '');
    let cmp = 0;
    if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = Number(av) - Number(bv);
    else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CHSecretarialPage() {
  const { isModuleActive } = useModules();
  // Show the "linked / not linked" panels only when both modules are on —
  // there's no point counting linked tasks if the Tasks tool isn't in play.
  const tasksModuleActive = isModuleActive('tasks');
  const [userRole, setUserRole] = useState<string>('staff');

  // Source mode
  const [sourceMode, setSourceMode] = useState<'clients' | 'custom'>('clients');
  const [customNumbers, setCustomNumbers] = useState<string[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Saved firm list (shared across all users)
  const [firmSavedNumbers, setFirmSavedNumbers] = useState<string[] | null>(null);
  const [firmListLoading, setFirmListLoading] = useState(false);
  const [firmListSaving, setFirmListSaving] = useState(false);

  // Data
  const [companies, setCompanies] = useState<CHCompanyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<{ done: number; total: number; company?: string } | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  // Table state
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<CHSortField>('companyName');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [search, setSearch] = useState('');
  const [metricFilter, setMetricFilter] = useState<MetricFilter>(null);
  const [statsCollapsed, setStatsCollapsed] = useState(false);
  // Which deadline cell the user clicked the link button on — drives the
  // "Link task to deadline" modal. null when closed.
  const [linkModal, setLinkModal] = useState<null | {
    clientId: string;
    clientName: string;
    deadlineType: DeadlineType;
    currentDeadline: string | null;
  }>(null);

  // Map of (client_id, deadline_type) → array of links so the table cell
  // can show a small badge with the linked task count. Refetched on mount
  // and after the user creates a new link via the modal.
  const [deadlineLinksIndex, setDeadlineLinksIndex] = useState<Map<string, Array<{ id: string; status: 'active' | 'paused' | 'broken'; tasks: { id: string; title: string; status: string; due_date: string | null } | null }>>>(new Map());
  const refetchDeadlineLinks = useCallback(() => {
    void fetch('/api/ch-secretarial/deadline-links')
      .then(r => r.ok ? r.json() : null)
      .then((j: { links?: Array<{ id: string; client_id: string; deadline_type: string; status: 'active' | 'paused' | 'broken'; tasks: { id: string; title: string; status: string; due_date: string | null } | null }> } | null) => {
        if (!j?.links) return;
        const next = new Map<string, Array<{ id: string; status: 'active' | 'paused' | 'broken'; tasks: { id: string; title: string; status: string; due_date: string | null } | null }>>();
        for (const l of j.links) {
          const key = `${l.client_id}::${l.deadline_type}`;
          const existing = next.get(key) ?? [];
          existing.push({ id: l.id, status: l.status, tasks: l.tasks });
          next.set(key, existing);
        }
        setDeadlineLinksIndex(next);
      })
      .catch(() => {});
  }, []);
  useEffect(() => { refetchDeadlineLinks(); }, [refetchDeadlineLinks]);
  const [visibleCols, setVisibleCols] = useState<Set<CHSortField>>(
    new Set(CH_COLUMNS.filter(c => c.defaultVisible).map(c => c.key))
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Cache status (from Supabase)
  const [cacheStatus, setCacheStatus] = useState<{
    refreshedAt: string | null;
    status: string | null;
    error: string | null;
    companiesFetched: number | null;
    companiesTotal: number | null;
    refreshType: string | null;
  } | null>(null);

  // Scheduled refresh (admin only, Supabase-backed)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
  const [scheduleListType, setScheduleListType] = useState<'client_list' | 'custom_list'>('client_list');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [newScheduleTime, setNewScheduleTime] = useState('');

  // Load user role
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('users').select('role').eq('id', user.id).single()
        .then(({ data }) => { if (data?.role) setUserRole(data.role); });
    });
  }, []);

  // Load saved firm list whenever we switch to custom mode
  useEffect(() => {
    if (sourceMode !== 'custom') return;
    setFirmListLoading(true);
    fetch('/api/firms/ch-companies')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const saved: string[] | null = data?.numbers ?? null;
        setFirmSavedNumbers(saved);
        // Auto-populate the working list with the saved list if nothing is loaded yet
        if (saved && saved.length > 0 && customNumbers.length === 0) {
          setCustomNumbers(saved);
          setCsvFileName('');
        }
      })
      .catch(() => {})
      .finally(() => setFirmListLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  // Load cache from Supabase on mount
  useEffect(() => {
    fetch('/api/ch-secretarial/cache')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setCacheStatus({
          refreshedAt: data.refreshedAt ?? null,
          status: data.status ?? null,
          error: data.error ?? null,
          companiesFetched: data.companiesFetched ?? null,
          companiesTotal: data.companiesTotal ?? null,
          refreshType: data.refreshType ?? null,
        });
        if (data.companies && data.companies.length > 0) {
          setCompanies(data.companies);
        }
      })
      .catch(() => {});
  }, []);

  // Load schedule times and list type on mount (admin only)
  useEffect(() => {
    if (userRole !== 'admin') return;
    setScheduleLoading(true);
    fetch('/api/firms/ch-refresh-schedule')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.times) setScheduleTimes(data.times);
        if (data?.listType) setScheduleListType(data.listType as 'client_list' | 'custom_list');
      })
      .catch(() => {})
      .finally(() => setScheduleLoading(false));
  }, [userRole]);

  // Load client company numbers from Supabase when in 'clients' mode. We
  // also keep a parallel map of companies_house_id → client_ref so the
  // table can show the firm's internal client code next to each row and
  // the search box can match on it. Custom List mode is fed by uploaded
  // CSV numbers only — no client records there, so the map stays empty.
  const [clientNumbers, setClientNumbers] = useState<string[]>([]);
  const [clientCodeByCompanyNumber, setClientCodeByCompanyNumber] = useState<Map<string, string>>(new Map());
  // Same key (normalised CH number) → { id, name } so the "Link task" modal
  // can be opened with the right client without an extra lookup.
  const [clientByCompanyNumber, setClientByCompanyNumber] = useState<Map<string, { id: string; name: string }>>(new Map());
  useEffect(() => {
    if (sourceMode !== 'clients') return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('users').select('firm_id').eq('id', user.id).single().then(({ data: profile }) => {
        if (!profile?.firm_id) return;
        supabase
          .from('clients')
          .select('id, companies_house_id, business_type, name, client_ref')
          .eq('firm_id', profile.firm_id)
          .limit(100000)
          .then(({ data: clients }) => {
            if (!clients) return;
            // Companies House covers limited companies AND LLPs. Include
            // either by business_type, plus a fallback for any client that has
            // a Companies House number recorded regardless of type.
            const limited = clients.filter(c => {
              const bt = (c.business_type ?? '').toLowerCase();
              const isChType = bt.includes('limited') || bt.includes('ltd') || bt === 'limited_company'
                || bt.includes('llp') || bt === 'llp';
              return isChType || !!c.companies_house_id;
            });
            const nums = limited.map(c => c.companies_house_id).filter(Boolean) as string[];
            // CH normalises company numbers by upper-casing and zero-padding
            // to 8 chars; we do the same here so the lookup matches whatever
            // the refresh stored on each company row.
            const norm = (n: string) => n.trim().toUpperCase().padStart(8, '0');
            const codeMap   = new Map<string, string>();
            const clientMap = new Map<string, { id: string; name: string }>();
            for (const c of limited) {
              const ch   = c.companies_house_id as string | null;
              const ref  = c.client_ref         as string | null;
              const id   = c.id                 as string | null;
              const name = (c.name              as string | null) ?? '';
              if (!ch) continue;
              const key = norm(ch);
              if (ref) codeMap.set(key, ref);
              if (id)  clientMap.set(key, { id, name });
            }
            setClientNumbers(nums);
            setClientCodeByCompanyNumber(codeMap);
            setClientByCompanyNumber(clientMap);
          });
      });
    });
  }, [sourceMode]);

  // CSV upload — warn if it would replace the saved firm list
  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const doLoad = () => {
      setCsvFileName(file.name);
      const reader = new FileReader();
      reader.onload = ev => {
        const text = ev.target?.result as string;
        const nums = text.split(/[\r\n,;]+/)
          .map(s => s.trim().replace(/^"(.+)"$/, '$1').trim())
          .filter(s => /^\d{6,8}$/.test(s));
        setCustomNumbers(nums);
      };
      reader.readAsText(file);
    };

    if (firmSavedNumbers && firmSavedNumbers.length > 0) {
      const ok = window.confirm(
        `Your firm currently has a saved list of ${firmSavedNumbers.length} company numbers shared with all users.\n\nUploading "${file.name}" will load a new list locally. You can then save it to replace the firm list by clicking "Save as firm list".\n\nProceed?`
      );
      if (!ok) { e.target.value = ''; return; }
    }

    doLoad();
    e.target.value = '';
  }

  // Save current customNumbers as the firm's shared list
  async function handleSaveFirmList() {
    if (customNumbers.length === 0) return;
    setFirmListSaving(true);
    try {
      const res = await fetch('/api/firms/ch-companies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: customNumbers }),
      });
      if (res.ok) setFirmSavedNumbers(customNumbers);
    } finally {
      setFirmListSaving(false);
    }
  }

  // Clear the firm's saved list
  async function handleClearFirmList() {
    const ok = window.confirm(
      `This will remove the saved firm list of ${firmSavedNumbers?.length ?? 0} company numbers. All users will lose access to this shared list.\n\nAre you sure?`
    );
    if (!ok) return;
    await fetch('/api/firms/ch-companies', { method: 'DELETE' });
    setFirmSavedNumbers(null);
    setCustomNumbers([]);
    setCsvFileName('');
  }

  // Save schedule times + list type to Supabase (admin only)
  async function handleSaveSchedule(times: string[], listType?: 'client_list' | 'custom_list') {
    setScheduleSaving(true);
    const lt = listType ?? scheduleListType;
    try {
      const res = await fetch('/api/firms/ch-refresh-schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ times, listType: lt }),
      });
      if (res.ok) { setScheduleTimes(times); setScheduleListType(lt); }
    } finally {
      setScheduleSaving(false);
    }
  }

  // Whether the current working list differs from what's saved
  const listIsSaved = firmSavedNumbers !== null &&
    firmSavedNumbers.length === customNumbers.length &&
    firmSavedNumbers.every((n, i) => n === customNumbers[i]);

  // Start a visible countdown when rate limited (updates every second)
  function startRateLimitCountdown(seconds: number): Promise<void> {
    return new Promise(resolve => {
      setRateLimitCountdown(seconds);
      let remaining = seconds;
      if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current);
      rateLimitTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(rateLimitTimerRef.current!);
          rateLimitTimerRef.current = null;
          setRateLimitCountdown(null);
          resolve();
        } else {
          setRateLimitCountdown(remaining);
        }
      }, 1000);
    });
  }

  // Fetch data — one company at a time, client-side retry with visible countdown on 429
  const fetchData = useCallback(async () => {
    const numbers = sourceMode === 'clients' ? clientNumbers : customNumbers;
    if (numbers.length === 0) {
      setError(sourceMode === 'clients'
        ? 'No limited company clients found. Make sure your clients have a Company Number set as their Client Ref, and their business type includes "Limited".'
        : 'No company numbers loaded. Upload a CSV or load the saved firm list first.');
      return;
    }

    setLoading(true);
    setError(null);
    setRateLimitCountdown(null);
    setLoadingProgress({ done: 0, total: numbers.length });

    const allCompanies: CHCompanyData[] = [];

    for (let i = 0; i < numbers.length; i++) {
      const n = numbers[i];
      setLoadingProgress({ done: i, total: numbers.length, company: n });

      // CH rate limit: ~200 companies per 5 min window. On 429, wait the full window.
      let retryDelay = 310; // 5 minutes 10 seconds
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await fetch('/api/ch-secretarial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyNumber: n }),
        });

        if (res.status === 429) {
          // Visible countdown — user sees exactly what is happening
          await startRateLimitCountdown(retryDelay);
          continue;
        }

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (err.error === 'NO_API_KEY') {
            setError('No Companies House API key configured. Click "Settings" to add one.');
            setShowSettings(true);
            setLoading(false);
            setLoadingProgress(null);
            return;
          }
          // Non-retryable error — skip this company and continue
          allCompanies.push({
            companyNumber: n,
            companyName: '',
            status: 'error',
            incorporationDate: '',
            type: '',
            sicCodes: [],
            registeredOffice: {},
            accountsNextDue: null,
            accountsOverdue: false,
            csNextDue: null,
            csOverdue: false,
            nearestOfficerIdvDue: null,
            officersIdvOverdueCount: 0,
            nearestPscIdvDue: null,
            pscIdvOverdueCount: 0,
            activeOfficerCount: 0,
            activePscCount: 0,
            officers: [],
            pscs: [],
            chUrl: `https://find-and-update.company-information.service.gov.uk/company/${n}`,
            fetchedAt: new Date().toISOString(),
            error: err.error || 'Fetch failed',
          });
          break;
        }

        const data = await res.json();
        if (data.company) allCompanies.push(data.company);
        break;
      }

      setLoadingProgress({ done: i + 1, total: numbers.length });
    }

    setCompanies(allCompanies);
    setLastFetched(new Date());
    setLoading(false);
    setLoadingProgress(null);
    setRateLimitCountdown(null);

    // Save to Supabase cache (tagged as manual)
    const fetchErrorCount = allCompanies.filter(c => c.status === 'error').length;
    const cachePayload = {
      companies: allCompanies,
      status: fetchErrorCount === 0 ? 'success' : fetchErrorCount === allCompanies.length ? 'failed' : 'partial',
      companiesFetched: allCompanies.length - fetchErrorCount,
      companiesTotal: allCompanies.length,
      refreshType: 'manual' as const,
      ...(fetchErrorCount > 0 ? { error: `${fetchErrorCount} of ${allCompanies.length} companies failed` } : {}),
    };
    fetch('/api/ch-secretarial/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachePayload),
    }).then(r => r.ok ? r.json() : null).then(() => {
      setCacheStatus({
        refreshedAt: new Date().toISOString(),
        status: cachePayload.status,
        error: (cachePayload as { error?: string }).error ?? null,
        companiesFetched: cachePayload.companiesFetched,
        companiesTotal: cachePayload.companiesTotal,
        refreshType: 'manual',
      });
    }).catch(() => {});
  }, [sourceMode, clientNumbers, customNumbers]);

  // Derived: filter + sort. metricFilter narrows to a specific status band
  // (overdue vs due-soon) for one of the four headline metrics so the user
  // can click a stat panel and instantly see only the matching companies.
  const filteredCompanies = useMemo(() => {
    let list = companies;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c => {
        // Also match the firm's internal client code when in Client List mode
        // (the map is empty in Custom List mode, so this is a no-op there).
        const code = clientCodeByCompanyNumber.get(normaliseCompanyNumber(c.companyNumber)) ?? '';
        return (
          c.companyName.toLowerCase().includes(q) ||
          c.companyNumber.toLowerCase().includes(q) ||
          code.toLowerCase().includes(q)
        );
      });
    }
    if (metricFilter) {
      const soon = (date: string | null, overdue: boolean) => {
        if (overdue) return false;
        const d = daysUntil(date);
        return d !== null && d >= 0 && d <= 31;
      };
      switch (metricFilter) {
        case 'accounts_overdue':     list = list.filter(c => c.accountsOverdue); break;
        case 'accounts_soon':        list = list.filter(c => soon(c.accountsNextDue, c.accountsOverdue)); break;
        case 'cs_overdue':           list = list.filter(c => c.csOverdue); break;
        case 'cs_soon':              list = list.filter(c => soon(c.csNextDue, c.csOverdue)); break;
        case 'officer_idv_overdue':  list = list.filter(c => c.officersIdvOverdueCount > 0); break;
        case 'officer_idv_soon':     list = list.filter(c => c.officersIdvOverdueCount === 0 && soon(c.nearestOfficerIdvDue, false)); break;
        case 'psc_idv_overdue':      list = list.filter(c => c.pscIdvOverdueCount > 0); break;
        case 'psc_idv_soon':         list = list.filter(c => c.pscIdvOverdueCount === 0 && soon(c.nearestPscIdvDue, false)); break;
        case 'has_linked_task': {
          const linked = new Set<string>();
          for (const k of deadlineLinksIndex.keys()) linked.add(k.split('::')[0]);
          list = list.filter(c => {
            const cl = clientByCompanyNumber.get(normaliseCompanyNumber(c.companyNumber));
            return !!cl && linked.has(cl.id);
          });
          break;
        }
        case 'no_linked_task': {
          const linked = new Set<string>();
          for (const k of deadlineLinksIndex.keys()) linked.add(k.split('::')[0]);
          list = list.filter(c => {
            const cl = clientByCompanyNumber.get(normaliseCompanyNumber(c.companyNumber));
            // Custom-List rows (no client record) can't be linked at all —
            // show them in the "not linked" bucket so the filter accounts
            // for the full list, not just client-mapped rows.
            return !cl || !linked.has(cl.id);
          });
          break;
        }
      }
    }
    return sortCompanies(list, sortField, sortDir, clientCodeByCompanyNumber);
  }, [companies, search, metricFilter, sortField, sortDir, clientCodeByCompanyNumber, clientByCompanyNumber, deadlineLinksIndex]);

  function toggleSort(field: CHSortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  function toggleRow(num: string) {
    setExpandedRows(prev => {
      const s = new Set(prev);
      s.has(num) ? s.delete(num) : s.add(num);
      return s;
    });
  }

  function toggleCol(key: CHSortField) {
    setVisibleCols(prev => {
      const s = new Set(prev);
      s.has(key) ? s.delete(key) : s.add(key);
      return s;
    });
  }

  const activeCols = CH_COLUMNS.filter(c => visibleCols.has(c.key));
  const activeNumbers = sourceMode === 'clients' ? clientNumbers : customNumbers;

  // Summary counts. "Soon" means due within 31 days AND not already overdue
  // — matches the amber band used by DueDateCell so the panel counts line up
  // visually with the table badges.
  const SOON_DAYS = 31;
  function withinSoon(dateStr: string | null, overdue: boolean): boolean {
    if (overdue) return false;
    const d = daysUntil(dateStr);
    return d !== null && d >= 0 && d <= SOON_DAYS;
  }
  const overdueAccounts    = companies.filter(c => c.accountsOverdue).length;
  const overdueCS          = companies.filter(c => c.csOverdue).length;
  const overdueOfficerIdv  = companies.filter(c => c.officersIdvOverdueCount > 0).length;
  const overduePscIdv      = companies.filter(c => c.pscIdvOverdueCount > 0).length;
  const soonAccounts       = companies.filter(c => withinSoon(c.accountsNextDue, c.accountsOverdue)).length;
  const soonCS             = companies.filter(c => withinSoon(c.csNextDue, c.csOverdue)).length;
  const soonOfficerIdv     = companies.filter(c => c.officersIdvOverdueCount === 0 && withinSoon(c.nearestOfficerIdvDue, false)).length;
  const soonPscIdv         = companies.filter(c => c.pscIdvOverdueCount === 0 && withinSoon(c.nearestPscIdvDue, false)).length;

  // Per-company link state — a Set of client_ids that have at least one
  // active or paused CH deadline link. Broken links count too (the link
  // exists; the user just needs to fix it). Used by both the new status
  // panels and the linkage filter.
  const linkedClientIds = useMemo(() => {
    const ids = new Set<string>();
    for (const key of deadlineLinksIndex.keys()) {
      const clientId = key.split('::')[0];
      if (clientId) ids.add(clientId);
    }
    return ids;
  }, [deadlineLinksIndex]);
  // Helper — given a row, does its underlying client have any link?
  function rowIsLinked(c: CHCompanyData): boolean {
    const cl = clientByCompanyNumber.get(normaliseCompanyNumber(c.companyNumber));
    return !!cl && linkedClientIds.has(cl.id);
  }
  // Only companies that have a client record in the firm count toward the
  // linkage totals — Custom-List rows without a client can't be linked.
  const companiesWithClient = companies.filter(c => !!clientByCompanyNumber.get(normaliseCompanyNumber(c.companyNumber)));
  const linkedCompanies   = companiesWithClient.filter(rowIsLinked).length;
  const unlinkedCompanies = companiesWithClient.length - linkedCompanies;

  return (
    <ToolLayout
      title="CH Secretarial Link"
      description="Live Companies House data for all your limited company clients — due dates, officers, and PSCs at a glance."
      icon={Building2}
      iconColor="#1d4ed8"
      wide
    >
      <div className="space-y-4">

        {/* Settings panel */}
        <CHSettingsPanel isAdmin={userRole === 'admin'} />

        {/* Source toggle + controls */}
        <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-1 p-1 bg-[var(--bg-nav-hover)] rounded-xl shrink-0">
              {(['clients', 'custom'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setSourceMode(mode)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${sourceMode === mode ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {mode === 'clients'
                    ? <span className="flex items-center gap-1.5"><Users size={13} /> Client List</span>
                    : <span className="flex items-center gap-1.5"><List size={13} /> Custom List</span>}
                </button>
              ))}
            </div>

            {sourceMode === 'clients' && (
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Info size={13} className="text-[var(--text-muted)] shrink-0" />
                {clientNumbers.length > 0
                  ? <span>{clientNumbers.length} limited company client{clientNumbers.length !== 1 ? 's' : ''} found</span>
                  : <span className="text-[var(--text-muted)]">Clients with business type "limited" and a client ref will be loaded</span>
                }
              </div>
            )}

            <div className="flex items-center gap-2 sm:ml-auto shrink-0 relative">
              {/* Compact last-refresh status — folded in from the old banner to save space */}
              {cacheStatus?.refreshedAt && (
                <Tooltip label={
                  cacheStatus.status === 'failed'
                    ? 'Last refresh failed — all companies failed, check your API key'
                    : cacheStatus.status === 'partial'
                      ? `Partial refresh${cacheStatus.error ? ` · ${errorToString(cacheStatus.error)}` : ''}`
                      : `Last refreshed successfully${cacheStatus.refreshType === 'scheduled' ? ' (scheduled)' : cacheStatus.refreshType === 'manual' ? ' (manual)' : ''}`
                }>
                  <span className={`flex items-center gap-1.5 text-xs font-medium mr-1 whitespace-nowrap ${
                    cacheStatus.status === 'failed' ? 'text-red-600 dark:text-red-400'
                    : cacheStatus.status === 'partial' ? 'text-amber-600 dark:text-amber-400'
                    : 'text-[var(--text-muted)]'
                  }`}>
                    {cacheStatus.status === 'success'
                      ? <CheckCircle size={12} className="text-emerald-500 shrink-0" />
                      : <AlertTriangle size={12} className="shrink-0" />}
                    {timeAgo(cacheStatus.refreshedAt)}
                    {cacheStatus.companiesFetched !== null && cacheStatus.companiesTotal !== null && (
                      <span className="text-[var(--text-muted)]">· {cacheStatus.companiesFetched}/{cacheStatus.companiesTotal}</span>
                    )}
                    {cacheStatus.refreshType === 'scheduled' && <Clock size={10} className="text-blue-500 shrink-0" />}
                  </span>
                </Tooltip>
              )}

              {companies.length > 0 && (
                <button
                  onClick={() => exportCHWorkbook(filteredCompanies, `ch_secretarial_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Download size={14} /> Export
                </button>
              )}

              {/* Schedule button — admin only */}
              {userRole === 'admin' && (
                <div className="relative">
                  <Tooltip label="Schedule automatic refreshes (admin only)">
                  <button
                    onClick={() => setShowSchedulePanel(v => !v)}
                    aria-label="Schedule automatic refreshes"
                    className={`btn-secondary flex items-center gap-2 text-sm ${scheduleTimes.length > 0 ? 'text-[var(--accent)] border-[var(--accent)]' : ''}`}
                  >
                    <Clock size={14} />
                    {scheduleLoading
                      ? <Loader2 size={12} className="animate-spin" />
                      : scheduleTimes.length > 0
                        ? <span>{scheduleTimes.length} scheduled</span>
                        : 'Schedule'}
                  </button>
                  </Tooltip>

                  {showSchedulePanel && (
                    <div className="absolute right-0 top-full mt-2 z-40 glass-solid rounded-xl shadow-xl border border-[var(--border)] p-4 w-80 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-[var(--text-primary)]">Scheduled Refreshes</p>
                        <button onClick={() => setShowSchedulePanel(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          <X size={14} />
                        </button>
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">
                        The server will automatically refresh Companies House data at these times each day (London time), even when no one is logged in.
                      </p>

                      {/* List type selector */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Refresh which list</p>
                        <div className="flex gap-2">
                          {([
                            ['client_list', 'Client List', Users],
                            ['custom_list', 'Custom List', List],
                          ] as const).map(([val, label, Icon]) => (
                            <button
                              key={val}
                              type="button"
                              onClick={() => void handleSaveSchedule(scheduleTimes, val)}
                              disabled={scheduleSaving}
                              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 ${
                                scheduleListType === val
                                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                              }`}
                            >
                              <Icon size={12} />{label}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-[var(--text-muted)]">
                          {scheduleListType === 'client_list'
                            ? 'Refreshes all limited company clients using their Companies House ID.'
                            : 'Refreshes the saved custom company number list.'}
                        </p>
                      </div>

                      {/* Existing times */}
                      {scheduleTimes.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {[...scheduleTimes].sort().map(t => (
                            <span key={t} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--accent-light)] text-[var(--accent)] border border-[var(--accent)]/20">
                              {t}
                              <button
                                onClick={() => handleSaveSchedule(scheduleTimes.filter(x => x !== t))}
                                className="hover:text-red-500 transition-colors"
                                disabled={scheduleSaving}
                              >
                                <X size={10} />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-[var(--text-muted)] italic">No times set yet.</p>
                      )}

                      {/* Add new time */}
                      <div className="flex gap-2">
                        <input
                          type="time"
                          value={newScheduleTime}
                          onChange={e => setNewScheduleTime(e.target.value)}
                          className="input-base text-sm flex-1"
                        />
                        <button
                          onClick={() => {
                            if (!newScheduleTime || scheduleTimes.includes(newScheduleTime)) return;
                            const updated = [...scheduleTimes, newScheduleTime];
                            setNewScheduleTime('');
                            handleSaveSchedule(updated);
                          }}
                          disabled={!newScheduleTime || scheduleTimes.includes(newScheduleTime) || scheduleSaving}
                          className="btn-primary text-sm px-3 disabled:opacity-50"
                        >
                          {scheduleSaving ? <Loader2 size={12} className="animate-spin" /> : 'Add'}
                        </button>
                      </div>

                      {scheduleTimes.length > 0 && (
                        <button
                          onClick={() => handleSaveSchedule([])}
                          disabled={scheduleSaving}
                          className="w-full text-xs text-[var(--text-muted)] hover:text-red-500 transition-colors text-center pt-1 disabled:opacity-50"
                        >
                          Clear all schedules
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={fetchData}
                disabled={loading || activeNumbers.length === 0}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {companies.length === 0 ? 'Load Data' : 'Refresh'}
              </button>
            </div>
          </div>

          {/* Custom list controls */}
          {sourceMode === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-[var(--border)]">
              {/* Upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-secondary flex items-center gap-2 text-sm shrink-0"
              >
                <Upload size={14} /> Upload CSV
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvUpload} />

              {/* Current list status */}
              {firmListLoading ? (
                <span className="text-sm text-[var(--text-muted)] flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Loading saved list…
                </span>
              ) : customNumbers.length > 0 ? (
                <span className="text-sm text-[var(--text-secondary)] flex items-center gap-1.5">
                  {listIsSaved
                    ? <><CheckCircle size={13} className="text-emerald-500 shrink-0" /> Firm list · {customNumbers.length} numbers</>
                    : <><Info size={13} className="text-[var(--text-muted)] shrink-0" />
                        {csvFileName
                          ? <>{csvFileName} · {customNumbers.length} numbers</>
                          : <>{customNumbers.length} numbers loaded</>
                        }
                      </>
                  }
                </span>
              ) : (
                <span className="text-sm text-[var(--text-muted)] italic">
                  Upload a CSV with one company number per line
                </span>
              )}

              {/* Save / unsaved indicator */}
              {customNumbers.length > 0 && !listIsSaved && (
                <button
                  onClick={handleSaveFirmList}
                  disabled={firmListSaving}
                  className="flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline disabled:opacity-50 shrink-0"
                >
                  {firmListSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={13} />}
                  Save as firm list
                </button>
              )}

              {/* Clear saved firm list */}
              {firmSavedNumbers && firmSavedNumbers.length > 0 && (
                <button
                  onClick={handleClearFirmList}
                  className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-red-500 transition-colors shrink-0 ml-auto"
                >
                  <Trash2 size={13} /> Clear firm list
                </button>
              )}
            </div>
          )}
        </div>

        {/* Loading progress */}
        {loading && loadingProgress && (
          <div className={`bg-white/[0.78] backdrop-blur-md rounded-xl p-4 space-y-2 ${rateLimitCountdown !== null ? 'border border-amber-300 dark:border-amber-700' : ''}`}>
            <div className="flex items-center justify-between text-sm gap-3">
              {rateLimitCountdown !== null ? (
                <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-medium">
                  <Loader2 size={14} className="animate-spin shrink-0" />
                  Companies House has rate limited us — waiting {rateLimitCountdown}s before retrying…
                </span>
              ) : (
                <span className="text-[var(--text-secondary)]">
                  Fetching {loadingProgress.company ? <span className="font-mono text-xs">{loadingProgress.company}</span> : ''}…
                </span>
              )}
              <span className="text-[var(--text-muted)] shrink-0">{loadingProgress.done} / {loadingProgress.total}</span>
            </div>
            <div className="w-full h-2 bg-[var(--bg-nav-hover)] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${rateLimitCountdown !== null ? 'bg-amber-400' : 'bg-[var(--accent)]'}`}
                style={{ width: `${(loadingProgress.done / loadingProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-3 p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl">
            <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{errorToString(error)}</p>
          </div>
        )}

        {/* Summary stats — collapsible. Two rows: red (overdue) and amber
            (due within 31 days). Each panel is a button that toggles the
            metricFilter to its bucket; clicking the active panel again
            clears the filter. */}
        {companies.length > 0 && !loading && (
          <div className="rounded-xl border border-[var(--border)] bg-white/[0.78] backdrop-blur-md overflow-hidden">
            <button
              type="button"
              onClick={() => setStatsCollapsed(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2 hover:bg-[var(--bg-nav-hover)] transition-colors"
              aria-expanded={!statsCollapsed}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                Status overview
                {metricFilter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-[var(--accent-light)] text-[var(--accent)]">
                    Filter active
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setMetricFilter(null); }}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setMetricFilter(null); } }}
                      className="ml-0.5 hover:text-[var(--text-primary)] cursor-pointer"
                      aria-label="Clear filter"
                    >
                      <X size={10} />
                    </span>
                  </span>
                )}
              </div>
              <ChevronDown
                size={16}
                className={`text-[var(--text-muted)] transition-transform ${statsCollapsed ? '' : 'rotate-180'}`}
              />
            </button>
            {!statsCollapsed && (
              <div className="px-4 pb-4 pt-1 border-t border-[var(--border)] space-y-3">
                {/* Row 1 — overdue (red) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([
                    { label: 'Accounts Overdue',      count: overdueAccounts,   filter: 'accounts_overdue'    },
                    { label: 'CS Overdue',            count: overdueCS,         filter: 'cs_overdue'          },
                    { label: 'Officers IDV Overdue',  count: overdueOfficerIdv, filter: 'officer_idv_overdue' },
                    { label: 'PSCs IDV Overdue',      count: overduePscIdv,     filter: 'psc_idv_overdue'     },
                  ] as { label: string; count: number; filter: MetricFilter }[]).map(({ label, count, filter }) => {
                    const isActive = metricFilter === filter;
                    const hasItems = count > 0;
                    // Empty panels stay green; non-empty panels read red, with
                    // an extra accent ring when they're the active filter.
                    const tone = hasItems
                      ? 'border-red-200 bg-red-50 hover:bg-red-100/70 dark:bg-red-900/10 dark:border-red-800'
                      : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800';
                    const ring = isActive ? 'ring-2 ring-[var(--accent)]' : '';
                    const numCol = hasItems ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={!hasItems}
                        onClick={() => setMetricFilter(prev => prev === filter ? null : filter)}
                        aria-pressed={isActive}
                        className={`rounded-xl border p-3 text-center transition-all ${tone} ${ring} ${hasItems ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                      >
                        <p className={`text-2xl font-bold ${numCol}`}>{count}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
                      </button>
                    );
                  })}
                </div>
                {/* Row 2 — due within 31 days (amber) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {([
                    { label: 'Accounts Due ≤ 31d',     count: soonAccounts,   filter: 'accounts_soon'     },
                    { label: 'CS Due ≤ 31d',           count: soonCS,         filter: 'cs_soon'           },
                    { label: 'Officers IDV ≤ 31d',     count: soonOfficerIdv, filter: 'officer_idv_soon'  },
                    { label: 'PSCs IDV ≤ 31d',         count: soonPscIdv,     filter: 'psc_idv_soon'      },
                  ] as { label: string; count: number; filter: MetricFilter }[]).map(({ label, count, filter }) => {
                    const isActive = metricFilter === filter;
                    const hasItems = count > 0;
                    const tone = hasItems
                      ? 'border-amber-200 bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-900/10 dark:border-amber-800'
                      : 'border-[var(--border)] bg-[var(--bg-page)]';
                    const ring = isActive ? 'ring-2 ring-[var(--accent)]' : '';
                    const numCol = hasItems ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)]';
                    return (
                      <button
                        key={label}
                        type="button"
                        disabled={!hasItems}
                        onClick={() => setMetricFilter(prev => prev === filter ? null : filter)}
                        aria-pressed={isActive}
                        className={`rounded-xl border p-3 text-center transition-all ${tone} ${ring} ${hasItems ? 'cursor-pointer' : 'cursor-default opacity-90'}`}
                      >
                        <p className={`text-2xl font-bold ${numCol}`}>{count}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
                      </button>
                    );
                  })}
                </div>
                {/* Row 3 — task-link summary (only when Tasks is active too).
                    Kept slim — single horizontal pill row instead of full
                    panels so the overview stays compact. */}
                {tasksModuleActive && sourceMode === 'clients' && companiesWithClient.length > 0 && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Task links</span>
                    {([
                      { label: 'Linked',     count: linkedCompanies,   filter: 'has_linked_task' as MetricFilter },
                      { label: 'Not linked', count: unlinkedCompanies, filter: 'no_linked_task' as MetricFilter  },
                    ]).map(({ label, count, filter }) => {
                      const isActive = metricFilter === filter;
                      const hasItems = count > 0;
                      const tone = filter === 'has_linked_task'
                        ? (hasItems ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/30' : 'bg-[var(--bg-page)] text-[var(--text-muted)] border-[var(--border)]')
                        : (hasItems ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/10 dark:border-sky-800' : 'bg-[var(--bg-page)] text-[var(--text-muted)] border-[var(--border)]');
                      const ring = isActive ? 'ring-2 ring-[var(--accent)]' : '';
                      return (
                        <button
                          key={label}
                          type="button"
                          disabled={!hasItems}
                          onClick={() => setMetricFilter(prev => prev === filter ? null : filter)}
                          aria-pressed={isActive}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium transition-all ${tone} ${ring} ${hasItems ? 'cursor-pointer hover:opacity-80' : 'cursor-default opacity-70'}`}
                        >
                          <span className="font-bold">{count}</span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Table toolbar */}
        {companies.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={sourceMode === 'clients' ? 'Search by name, number, or client code…' : 'Search by name or number…'}
                className="w-full h-9 pl-9 pr-9 text-sm rounded-lg bg-white border border-[var(--border)] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none transition shadow-md focus:border-[var(--accent)] focus:bg-white"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-xs font-semibold text-[var(--text-primary)]">
                {filteredCompanies.length} of {companies.length} companies
                {lastFetched && <> · Refreshed {lastFetched.toLocaleTimeString()}</>}
              </span>
              <div className="relative">
                <button
                  onClick={() => setColMenuOpen(v => !v)}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 h-9 rounded-lg bg-white border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors shadow-md"
                >
                  <SlidersHorizontal size={13} /> Columns
                </button>
                {colMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 glass-solid rounded-xl shadow-xl border border-[var(--border)] p-3 min-w-[200px] space-y-1">
                    <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Toggle Columns</p>
                    {CH_COLUMNS.map(col => (
                      <label key={col.key} className="flex items-center gap-2.5 cursor-pointer py-0.5 hover:text-[var(--text-primary)]">
                        <input
                          type="checkbox"
                          checked={visibleCols.has(col.key)}
                          onChange={() => toggleCol(col.key)}
                          className="rounded accent-[var(--accent)]"
                        />
                        <span className="text-sm text-[var(--text-secondary)]">{col.label}</span>
                        {visibleCols.has(col.key) ? <Eye size={12} className="ml-auto text-[var(--text-muted)]" /> : <EyeOff size={12} className="ml-auto text-[var(--text-muted)]" />}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        {companies.length > 0 && (
          <div
            className="bg-white/[0.78] backdrop-blur-md rounded-xl border border-[var(--border)] overflow-hidden"
            onClick={() => { setColMenuOpen(false); setShowSchedulePanel(false); }}
          >
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 320px)' }}>
              <table className="w-full text-sm" style={{ minWidth: `${activeCols.length * 130 + 40}px`, borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th className="w-8 px-3 py-3" style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'var(--bg-card-solid)', boxShadow: '0 1px 0 var(--border)' }} />
                    {activeCols.map(col => (
                      <th key={col.key} className="px-3 py-3 text-left" style={{ position: 'sticky', top: 0, zIndex: 20, backgroundColor: 'var(--bg-card-solid)', boxShadow: '0 1px 0 var(--border)' }}>
                        <button
                          onClick={() => toggleSort(col.key)}
                          className="flex items-center gap-1 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
                        >
                          {col.label}
                          {sortField === col.key
                            ? sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
                            : <ChevronDown size={11} className="opacity-20" />
                          }
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filteredCompanies.length === 0 && (
                    <tr><td colSpan={activeCols.length + 1} className="text-center py-12 text-sm text-[var(--text-muted)]">No companies match the current search.</td></tr>
                  )}
                  {filteredCompanies.map(company => {
                    const isExpanded = expandedRows.has(company.companyNumber);
                    const hasAlert = company.accountsOverdue || company.csOverdue || company.officersIdvOverdueCount > 0 || company.pscIdvOverdueCount > 0;
                    return (
                      <>
                        <tr
                          key={company.companyNumber}
                          onClick={() => toggleRow(company.companyNumber)}
                          className={`cursor-pointer transition-colors group ${isExpanded ? 'bg-[var(--accent-light)]' : hasAlert ? 'hover:bg-red-50/30 dark:hover:bg-red-900/5' : 'hover:bg-[var(--bg-nav-hover)]'} ${hasAlert ? 'border-l-2 border-l-red-400' : ''}`}
                        >
                          <td className="px-3 py-3 w-8">
                            <ChevronRight size={14} className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </td>
                          {activeCols.map(col => (
                            <td key={col.key} className="px-3 py-3 align-top">
                              {col.key === 'companyNumber' && <span className="text-xs font-mono text-[var(--text-secondary)]">{company.companyNumber}</span>}
                              {col.key === 'companyName' && (
                                <span className="font-medium text-[var(--text-primary)]">
                                  {company.companyName || <span className="text-red-500 text-xs italic">{errorToString(company.error) || 'Error'}</span>}
                                </span>
                              )}
                              {col.key === 'clientCode' && (() => {
                                // Resolve the firm's internal client code from the
                                // CH number we already fetched. Custom List mode has
                                // no clients map, so this renders an em-dash.
                                const code = clientCodeByCompanyNumber.get(normaliseCompanyNumber(company.companyNumber));
                                return code
                                  ? <span className="text-xs font-mono text-[var(--text-secondary)]">{code}</span>
                                  : <span className="text-xs text-[var(--text-muted)]">—</span>;
                              })()}
                              {col.key === 'status' && <StatusBadge status={company.status} />}
                              {col.key === 'incorporationDate' && <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">{company.incorporationDate || '—'}</span>}
                              {col.key === 'accountsNextDue' && (() => {
                                const cl = clientByCompanyNumber.get(normaliseCompanyNumber(company.companyNumber));
                                return (
                                  <DueWithLinkButton
                                    dateStr={company.accountsNextDue}
                                    overdue={company.accountsOverdue}
                                    client={cl}
                                    deadlineType="accounts_due"
                                    links={cl ? (deadlineLinksIndex.get(`${cl.id}::accounts_due`) ?? []) : []}
                                    onLink={setLinkModal}
                                  />
                                );
                              })()}
                              {col.key === 'accountsOverdue' && <OverdueBadge overdue={company.accountsOverdue} />}
                              {col.key === 'csNextDue' && (() => {
                                const cl = clientByCompanyNumber.get(normaliseCompanyNumber(company.companyNumber));
                                return (
                                  <DueWithLinkButton
                                    dateStr={company.csNextDue}
                                    overdue={company.csOverdue}
                                    client={cl}
                                    deadlineType="cs_due"
                                    links={cl ? (deadlineLinksIndex.get(`${cl.id}::cs_due`) ?? []) : []}
                                    onLink={setLinkModal}
                                  />
                                );
                              })()}
                              {col.key === 'csOverdue' && <OverdueBadge overdue={company.csOverdue} />}
                              {col.key === 'nearestOfficerIdvDue' && (() => {
                                const cl = clientByCompanyNumber.get(normaliseCompanyNumber(company.companyNumber));
                                return (
                                  <DueWithLinkButton
                                    dateStr={company.nearestOfficerIdvDue}
                                    overdue={company.officersIdvOverdueCount > 0}
                                    client={cl}
                                    deadlineType="officer_idv_due"
                                    links={cl ? (deadlineLinksIndex.get(`${cl.id}::officer_idv_due`) ?? []) : []}
                                    onLink={setLinkModal}
                                  />
                                );
                              })()}
                              {col.key === 'officersIdvOverdueCount' && <OverdueBadge count={company.officersIdvOverdueCount} />}
                              {col.key === 'nearestPscIdvDue' && (() => {
                                const cl = clientByCompanyNumber.get(normaliseCompanyNumber(company.companyNumber));
                                return (
                                  <DueWithLinkButton
                                    dateStr={company.nearestPscIdvDue}
                                    overdue={company.pscIdvOverdueCount > 0}
                                    client={cl}
                                    deadlineType="psc_idv_due"
                                    links={cl ? (deadlineLinksIndex.get(`${cl.id}::psc_idv_due`) ?? []) : []}
                                    onLink={setLinkModal}
                                  />
                                );
                              })()}
                              {col.key === 'pscIdvOverdueCount' && <OverdueBadge count={company.pscIdvOverdueCount} />}
                            </td>
                          ))}
                        </tr>
                        {isExpanded && (
                          <tr key={`${company.companyNumber}-expanded`}>
                            <td colSpan={activeCols.length + 1} className="p-0">
                              <CHExpandedRow company={company} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty state */}
        {companies.length === 0 && !loading && !error && (
          <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-12 text-center space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto">
              <Building2 size={28} className="text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-base font-semibold text-[var(--text-primary)]">No data loaded yet</p>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              {sourceMode === 'clients'
                ? 'Click "Load Data" to fetch live Companies House information for your limited company clients.'
                : activeNumbers.length > 0
                  ? `${activeNumbers.length} company numbers ready — click "Load Data" to fetch from Companies House.`
                  : 'Upload a CSV of company numbers, then click "Load Data".'}
            </p>
            {activeNumbers.length > 0 && (
              <button onClick={fetchData} disabled={loading} className="btn-primary mx-auto flex items-center gap-2">
                <Building2 size={14} /> Load {activeNumbers.length} {sourceMode === 'clients' ? 'Client' : 'Company'}{activeNumbers.length !== 1 ? 's' : ''}
              </button>
            )}
          </div>
        )}

      </div>

      {linkModal && (
        <LinkDeadlineTaskModal
          clientId={linkModal.clientId}
          clientName={linkModal.clientName}
          deadlineType={linkModal.deadlineType}
          currentDeadline={linkModal.currentDeadline}
          onClose={() => setLinkModal(null)}
          onLinked={() => refetchDeadlineLinks()}
        />
      )}
    </ToolLayout>
  );
}

// Deadline cell + an inline "Link task" button + a permanent badge showing
// the number of tasks already linked to this deadline. The link-CREATE
// button hides until hover so the table stays clean; the EXISTS badge is
// always visible so the user knows at a glance which deadlines already
// have tasks attached.
function DueWithLinkButton({
  dateStr, overdue, client, deadlineType, links, onLink,
}: {
  dateStr: string | null;
  overdue: boolean;
  client: { id: string; name: string } | undefined;
  deadlineType: DeadlineType;
  links: Array<{ id: string; status: 'active' | 'paused' | 'broken'; tasks: { id: string; title: string; status: string; due_date: string | null } | null }>;
  onLink: (m: { clientId: string; clientName: string; deadlineType: DeadlineType; currentDeadline: string | null }) => void;
}) {
  const linkedCount = links.length;
  const hasBroken   = links.some(l => l.status === 'broken');
  const badgeColour =
    hasBroken          ? 'bg-amber-100 text-amber-700 border-amber-200'
    : linkedCount > 0  ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/30'
    :                    '';
  return (
    <div className="flex items-center gap-1.5 group/cell">
      <DueDateCell dateStr={dateStr} overdue={overdue} />
      {linkedCount > 0 && (
        <Tooltip
          label={
            <div className="space-y-1 text-left">
              {links.map(l => (
                <div key={l.id} className="text-[11px]">
                  {l.tasks?.title ?? '(deleted task)'}
                  {l.status !== 'active' && (
                    <span className={`ml-1.5 ${l.status === 'broken' ? 'text-amber-300' : 'text-amber-200'}`}>
                      {l.status === 'broken' ? '· broken' : '· paused'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          }
        >
          <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded border text-[9px] font-semibold ${badgeColour}`}>
            <Link2 size={9} />
            {linkedCount}
          </span>
        </Tooltip>
      )}
      {client && (
        <button
          type="button"
          onClick={() => onLink({ clientId: client.id, clientName: client.name, deadlineType, currentDeadline: dateStr })}
          aria-label="Link task to this deadline"
          title="Link task to this deadline"
          className="opacity-0 group-hover/cell:opacity-100 transition-opacity p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)]"
        >
          <Link2 size={11} />
        </button>
      )}
    </div>
  );
}
