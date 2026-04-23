'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Building2, RefreshCw, Download, Upload, ChevronDown, ChevronUp,
  ChevronRight, AlertTriangle, CheckCircle, Search, SlidersHorizontal,
  Eye, EyeOff, Users, List, X, Loader2, Info, Save, Trash2, Clock,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import CHSettingsPanel from '@/components/features/ch-secretarial/CHSettingsPanel';
import CHExpandedRow from '@/components/features/ch-secretarial/CHExpandedRow';
import { exportCHWorkbook } from '@/utils/chExport';
import { CH_COLUMNS } from '@/types/ch';
import type { CHCompanyData, CHSortField } from '@/types/ch';
import { createClient } from '@/lib/supabase';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
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

function sortCompanies(companies: CHCompanyData[], field: CHSortField, dir: 'asc' | 'desc'): CHCompanyData[] {
  return [...companies].sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    let cmp = 0;
    if (typeof av === 'boolean' && typeof bv === 'boolean') cmp = Number(av) - Number(bv);
    else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv));
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CHSecretarialPage() {
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
  } | null>(null);

  // Scheduled refresh (admin only, Supabase-backed)
  const [scheduleTimes, setScheduleTimes] = useState<string[]>([]);
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
        });
        if (data.companies && data.companies.length > 0) {
          setCompanies(data.companies);
        }
      })
      .catch(() => {});
  }, []);

  // Load schedule times on mount (admin only)
  useEffect(() => {
    if (userRole !== 'admin') return;
    setScheduleLoading(true);
    fetch('/api/firms/ch-refresh-schedule')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.times) setScheduleTimes(data.times); })
      .catch(() => {})
      .finally(() => setScheduleLoading(false));
  }, [userRole]);

  // Load client company numbers from Supabase when in 'clients' mode
  const [clientNumbers, setClientNumbers] = useState<string[]>([]);
  useEffect(() => {
    if (sourceMode !== 'clients') return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from('users').select('firm_id').eq('id', user.id).single().then(({ data: profile }) => {
        if (!profile?.firm_id) return;
        supabase
          .from('clients')
          .select('companies_house_id, business_type, name')
          .eq('firm_id', profile.firm_id)
          .limit(100000)
          .then(({ data: clients }) => {
            if (!clients) return;
            const nums = clients
              .filter(c => {
                const bt = (c.business_type ?? '').toLowerCase();
                return bt.includes('limited') || bt.includes('ltd') || bt === 'limited_company';
              })
              .map(c => c.companies_house_id)
              .filter(Boolean) as string[];
            setClientNumbers(nums);
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

  // Save schedule times to Supabase (admin only)
  async function handleSaveSchedule(times: string[]) {
    setScheduleSaving(true);
    try {
      const res = await fetch('/api/firms/ch-refresh-schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ times }),
      });
      if (res.ok) setScheduleTimes(times);
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

    // Save to Supabase cache
    const fetchErrorCount = allCompanies.filter(c => c.status === 'error').length;
    const cachePayload = {
      companies: allCompanies,
      status: fetchErrorCount === 0 ? 'success' : fetchErrorCount === allCompanies.length ? 'failed' : 'partial',
      companiesFetched: allCompanies.length - fetchErrorCount,
      companiesTotal: allCompanies.length,
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
      });
    }).catch(() => {});
  }, [sourceMode, clientNumbers, customNumbers]);

  // Derived: filter + sort
  const filteredCompanies = useMemo(() => {
    let list = companies;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.companyName.toLowerCase().includes(q) ||
        c.companyNumber.toLowerCase().includes(q)
      );
    }
    return sortCompanies(list, sortField, sortDir);
  }, [companies, search, sortField, sortDir]);

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

  // Summary counts
  const overdueAccounts = companies.filter(c => c.accountsOverdue).length;
  const overdueCS = companies.filter(c => c.csOverdue).length;
  const overdueOfficerIdv = companies.filter(c => c.officersIdvOverdueCount > 0).length;
  const overduePscIdv = companies.filter(c => c.pscIdvOverdueCount > 0).length;

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

        {/* Cache status banner */}
        {cacheStatus?.refreshedAt && (
          <div className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm border ${
            cacheStatus.status === 'failed'
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              : cacheStatus.status === 'partial'
                ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
          }`}>
            {cacheStatus.status === 'failed'
              ? <AlertTriangle size={13} className="shrink-0" />
              : cacheStatus.status === 'partial'
                ? <AlertTriangle size={13} className="shrink-0" />
                : <CheckCircle size={13} className="shrink-0" />
            }
            <span>
              Last refreshed <strong>{timeAgo(cacheStatus.refreshedAt)}</strong>
              {cacheStatus.companiesFetched !== null && cacheStatus.companiesTotal !== null && (
                <> · {cacheStatus.companiesFetched}/{cacheStatus.companiesTotal} companies</>
              )}
              {cacheStatus.status === 'partial' && cacheStatus.error && (
                <> · {cacheStatus.error}</>
              )}
              {cacheStatus.status === 'failed' && (
                <> · All companies failed — check your API key</>
              )}
            </span>
            {cacheStatus.status === 'success' && (
              <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">Success</span>
            )}
          </div>
        )}

        {/* Source toggle + controls */}
        <div className="glass-solid rounded-xl p-4 space-y-3">
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
                  <button
                    onClick={() => setShowSchedulePanel(v => !v)}
                    className={`btn-secondary flex items-center gap-2 text-sm ${scheduleTimes.length > 0 ? 'text-[var(--accent)] border-[var(--accent)]' : ''}`}
                    title="Schedule automatic refreshes (admin only)"
                  >
                    <Clock size={14} />
                    {scheduleLoading
                      ? <Loader2 size={12} className="animate-spin" />
                      : scheduleTimes.length > 0
                        ? <span>{scheduleTimes.length} scheduled</span>
                        : 'Schedule'}
                  </button>

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
          <div className={`glass-solid rounded-xl p-4 space-y-2 ${rateLimitCountdown !== null ? 'border border-amber-300 dark:border-amber-700' : ''}`}>
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
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Summary stats */}
        {companies.length > 0 && !loading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Accounts Overdue', count: overdueAccounts, color: overdueAccounts > 0 ? 'red' : 'green' },
              { label: 'CS Overdue', count: overdueCS, color: overdueCS > 0 ? 'red' : 'green' },
              { label: 'Officers IDV Overdue', count: overdueOfficerIdv, color: overdueOfficerIdv > 0 ? 'red' : 'green' },
              { label: 'PSCs IDV Overdue', count: overduePscIdv, color: overduePscIdv > 0 ? 'red' : 'green' },
            ].map(({ label, count, color }) => (
              <div key={label} className={`rounded-xl border p-3 text-center ${color === 'red' ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800'}`}>
                <p className={`text-2xl font-bold ${color === 'red' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{count}</p>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Table toolbar */}
        {companies.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search companies…"
                className="input-base w-full pl-9 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <span className="text-xs text-[var(--text-muted)]">
                {filteredCompanies.length} of {companies.length} companies
                {lastFetched && <> · Refreshed {lastFetched.toLocaleTimeString()}</>}
              </span>
              <div className="relative">
                <button
                  onClick={() => setColMenuOpen(v => !v)}
                  className="btn-secondary flex items-center gap-1.5 text-sm"
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
            className="glass-solid rounded-xl border border-[var(--border)] overflow-hidden"
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
                                  {company.companyName || <span className="text-red-500 text-xs italic">{company.error ?? 'Error'}</span>}
                                </span>
                              )}
                              {col.key === 'status' && <StatusBadge status={company.status} />}
                              {col.key === 'incorporationDate' && <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">{company.incorporationDate || '—'}</span>}
                              {col.key === 'accountsNextDue' && <DueDateCell dateStr={company.accountsNextDue} overdue={company.accountsOverdue} />}
                              {col.key === 'accountsOverdue' && <OverdueBadge overdue={company.accountsOverdue} />}
                              {col.key === 'csNextDue' && <DueDateCell dateStr={company.csNextDue} overdue={company.csOverdue} />}
                              {col.key === 'csOverdue' && <OverdueBadge overdue={company.csOverdue} />}
                              {col.key === 'nearestOfficerIdvDue' && <DueDateCell dateStr={company.nearestOfficerIdvDue} overdue={company.officersIdvOverdueCount > 0} />}
                              {col.key === 'officersIdvOverdueCount' && <OverdueBadge count={company.officersIdvOverdueCount} />}
                              {col.key === 'nearestPscIdvDue' && <DueDateCell dateStr={company.nearestPscIdvDue} overdue={company.pscIdvOverdueCount > 0} />}
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
          <div className="glass-solid rounded-xl p-12 text-center space-y-3">
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
    </ToolLayout>
  );
}
