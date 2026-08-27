'use client';
import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { consumePendingClient } from '@/lib/pendingClient';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveLandlordModal from '@/components/features/landlord/SaveLandlordModal';
import LandlordEditModal from '@/components/features/landlord/LandlordEditModal';
import LandlordHistory, { type LandlordSeed } from '@/components/features/landlord/LandlordHistory';
import LandlordPropertiesPanel from '@/components/features/landlord/LandlordPropertiesPanel';
import LandlordApprovalPanel from '@/components/features/landlord/LandlordApprovalPanel';
import LandlordSendApprovalModal from '@/components/features/landlord/LandlordSendApprovalModal';
import PersonSettingsPanel from '@/components/features/landlord/PersonSettingsPanel';
import { useLandlordApprovalSend } from '@/components/features/landlord/useLandlordApprovalSend';
import { useModules } from '@/components/ui/ModulesProvider';
import type { IncomeRow, ExpenseRow } from '@/components/features/landlord/LandlordEditModal';
import {
  matchProperty, computePersonMatrix, matrixCell, findUnallocatedProperty, UNALLOCATED_LABEL,
  personShareRows, personShareAdjustments, normalizeForMatch, financeReducerFor,
} from '@/utils/landlordAllocation';
import { computeRentComputation, buildComparisonRows, PROPERTY_INCOME_ALLOWANCE, type LandlordEntityType, type RentComputationOpts, type RentComputation } from '@/utils/landlordComputation';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import {
  House, Download, Undo2, Redo2, AlertTriangle, Pencil, Flag,
  CheckCircle, ChevronDown, ChevronUp, LayoutList, LayoutGrid,
  Plus, Trash2, TrendingUp, ArrowLeft, ArrowRight, Sparkles,
  UploadCloud, Check, Building2, CalendarDays, ShieldCheck, Coins, Receipt, Calculator, X, Users, MapPin, FileText, Loader2, FileSpreadsheet, Info, Home,
} from 'lucide-react';
import { generatePdfBlob, downloadBlob } from '@/utils/pdfFromHtml';
import { exportLandlordWorkbook } from '@/utils/landlordExport';
import {
  buildLandlordPackHtml, buildLandlordMatrixPages, buildLandlordPersonPackData,
  DEFAULT_PERSON_SETTINGS, type LandlordPackData, type LandlordPersonSettings,
} from '@/lib/landlord/landlordPackHtml';
import { LANDLORD_EXPENSE_CATEGORIES, LANDLORD_INCOME_CATEGORIES, LANDLORD_FINANCE_COST_CATEGORY } from '@/components/features/landlord/categories';
import { fileToBase64 } from '@/utils/fileUtils';
import { spreadsheetToText, isSpreadsheetFile } from '@/utils/spreadsheetText';
import type { LandlordIncomeTransaction, LandlordExpenseTransaction, FlaggedEntry, DocumentScanResult, LandlordAdjustment, LandlordProperty, PropertyOwner } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'loading' | 'scan_results' | 'property_review' | 'success' | 'approval' | 'error';

/** Address used for the single combined property when "group all properties" is on. */
const GROUP_LABEL = 'All properties';
type LandlordView = 'properties' | 'income' | 'expenses' | 'rent_comp' | 'flagged';
type Breakdown = 'all' | 'property' | 'person';
type PropertyMode = 'suggest' | 'preset';
type TaggedIncome = LandlordIncomeTransaction & { _recordType: 'income' };
type TaggedExpense = LandlordExpenseTransaction & { _recordType: 'expense' };

interface LandlordStateData {
  income: IncomeRow[];
  expenses: ExpenseRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId() { return `ll_${++_idCounter}`; }

function normalizeAddress(addr: string): string {
  return (!addr || addr === 'No Address') ? 'Non Allocated' : addr;
}

function isInRange(date: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!date) return true;
  if (from && date < from) return false;
  if (to   && date > to)   return false;
  return true;
}

function detectDuplicates(income: IncomeRow[], expenses: ExpenseRow[]): void {
  // Income duplicates: same Date + Amount + PropertyAddress
  for (let i = 0; i < income.length; i++) {
    for (let j = i + 1; j < income.length; j++) {
      const a = income[i]; const b = income[j];
      if (a.Date === b.Date && Math.abs(a.Amount - b.Amount) < 0.01 && a.PropertyAddress === b.PropertyAddress) {
        if (!b._flagged) { b._flagged = true; b._flagReason = `Possible duplicate of row ${i + 1} (same date, amount & property)`; }
      }
    }
  }
  // Expense duplicates: same DueDate + Amount + Supplier
  for (let i = 0; i < expenses.length; i++) {
    for (let j = i + 1; j < expenses.length; j++) {
      const a = expenses[i]; const b = expenses[j];
      if (a.DueDate === b.DueDate && Math.abs(a.Amount - b.Amount) < 0.01 && a.Supplier === b.Supplier) {
        if (!b._flagged) { b._flagged = true; b._flagReason = `Possible duplicate of row ${i + 1} (same date, amount & supplier)`; }
      }
    }
  }
}

function buildIncomeRows(txs: (LandlordIncomeTransaction & { _forceInclude?: boolean })[], dateFrom: string, dateTo: string): IncomeRow[] {
  return txs.map(t => ({
    ...t,
    _id: nextId(),
    _flagged: false,
    _flagReason: undefined,
    _inRange: isInRange(t.Date, dateFrom, dateTo),
    _forceInclude: t._forceInclude === true,
  }));
}

function buildExpenseRows(txs: (LandlordExpenseTransaction & { _forceInclude?: boolean })[], dateFrom: string, dateTo: string): ExpenseRow[] {
  return txs.map(t => ({
    ...t,
    _id: nextId(),
    _flagged: false,
    _flagReason: undefined,
    _inRange: isInRange(t.DueDate, dateFrom, dateTo),
    _forceInclude: t._forceInclude === true,
  }));
}

/** Format an ISO date (YYYY-MM-DD) as UK dd-mm-yyyy for display. */
function fmtUKDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return (y && m && d) ? `${d}-${m}-${y}` : iso;
}

// Strip the internal row bookkeeping (_id/_flagged/…) for save + export, keeping
// _forceInclude — the export uses it to treat an included row as in-range.
function toExportIncome(rows: IncomeRow[]): (LandlordIncomeTransaction & { _forceInclude?: boolean })[] {
  return rows.map(r => ({
    fileName: r.fileName, Date: r.Date, PropertyAddress: r.PropertyAddress,
    Description: r.Description, Category: r.Category, Amount: r.Amount,
    ...(r._forceInclude ? { _forceInclude: true as const } : {}),
  }));
}

function toExportExpense(rows: ExpenseRow[]): (LandlordExpenseTransaction & { _forceInclude?: boolean })[] {
  return rows.map(r => ({
    fileName: r.fileName, DueDate: r.DueDate, Description: r.Description, Category: r.Category,
    Amount: r.Amount, Supplier: r.Supplier, TenantPayable: r.TenantPayable,
    CapitalExpense: r.CapitalExpense, PropertyAddress: r.PropertyAddress,
    ...(r._forceInclude ? { _forceInclude: true as const } : {}),
  }));
}

// Picking a category from the other group converts the entry: income and
// expenses are separate lists, so the row moves between them (carrying its id,
// flag and include state; the date field swaps name).
function expenseToIncomeRow(e: ExpenseRow, category: string, from: string, to: string): IncomeRow {
  return {
    _id: e._id, _flagged: e._flagged, _flagReason: e._flagReason,
    _inRange: isInRange(e.DueDate, from, to), _forceInclude: e._forceInclude,
    fileName: e.fileName, Date: e.DueDate, PropertyAddress: e.PropertyAddress,
    Description: e.Description, Category: category, Amount: e.Amount,
  };
}

function incomeToExpenseRow(i: IncomeRow, category: string, from: string, to: string): ExpenseRow {
  return {
    _id: i._id, _flagged: i._flagged, _flagReason: i._flagReason,
    _inRange: isInRange(i.Date, from, to), _forceInclude: i._forceInclude,
    fileName: i.fileName, DueDate: i.Date, Description: i.Description, Category: category,
    Amount: i.Amount, Supplier: '', TenantPayable: false, CapitalExpense: false,
    PropertyAddress: i.PropertyAddress,
  };
}

/** UK tax-year quick-pick presets (6 Apr → 5 Apr), current year first. */
function ukTaxYearPresets(): Array<{ label: string; from: string; to: string }> {
  const now = new Date();
  const y = now.getFullYear();
  const afterApr6 = now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6);
  const startYear = afterApr6 ? y : y - 1;
  const mk = (sy: number) => ({ label: `${sy}/${String(sy + 1).slice(2)}`, from: `${sy}-04-06`, to: `${sy + 1}-04-05` });
  return [mk(startYear), mk(startYear - 1), mk(startYear - 2)];
}

/** Rewrite each row's PropertyAddress to the matched registered property's
 *  canonical spelling, so scanned rows group under the client's chosen
 *  properties. Unmatched rows are left untouched (they stay for manual
 *  allocation). No-op when the client has no saved properties. */
function canonicalizeToRegister<T extends { PropertyAddress: string }>(rows: T[], properties: LandlordProperty[]): T[] {
  if (properties.length === 0) return rows;
  return rows.map(r => {
    const pid = matchProperty(r.PropertyAddress, properties);
    if (!pid) return r;
    const p = properties.find(x => x.id === pid);
    return (p && r.PropertyAddress !== p.address) ? { ...r, PropertyAddress: p.address } : r;
  });
}

// ─── Setup wizard ──────────────────────────────────────────────────────────

interface WizardStep { n: number; label: string }

const STEPS_BASE: WizardStep[] = [
  { n: 1, label: 'Select Client' },
  { n: 2, label: 'Upload Documents' },
  { n: 3, label: 'Analysis Results' },
  { n: 4, label: 'Client Approval' },
];

/** With property review (suggest / grouped mode) an extra step sits between
 *  Upload and Results so the user can edit properties + ownership first. */
const STEPS_WITH_REVIEW: WizardStep[] = [
  { n: 1, label: 'Select Client' },
  { n: 2, label: 'Upload Documents' },
  { n: 3, label: 'Review Properties' },
  { n: 4, label: 'Analysis Results' },
  { n: 5, label: 'Client Approval' },
];

function WizardStepper({ steps, current, onStep }: { steps: WizardStep[]; current: number; onStep?: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap">
      {steps.map((s, i) => {
        const done = s.n < current;
        const active = s.n === current;
        const clickable = !!onStep && s.n < current;
        return (
          <div key={s.n} className="flex items-center gap-1.5 sm:gap-2.5">
            <button type="button" disabled={!clickable} onClick={() => clickable && onStep?.(s.n)}
              className={`flex items-center gap-2 ${clickable ? 'cursor-pointer' : 'cursor-default'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors
                ${active ? 'bg-[var(--accent)] text-white' : done ? 'bg-[var(--accent)]/15 text-[var(--accent)]' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                {done ? <Check size={13} /> : s.n}
              </span>
              <span className={`text-xs font-semibold whitespace-nowrap ${active ? 'text-[var(--text-primary)]' : done ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>{s.label}</span>
            </button>
            {i < steps.length - 1 && <div className={`w-5 sm:w-10 h-px ${done ? 'bg-[var(--accent)]/40' : 'bg-[var(--border)]'}`} />}
          </div>
        );
      })}
    </div>
  );
}

const LANDLORD_OUTPUTS = [
  { icon: Coins, label: 'Rental income' },
  { icon: Receipt, label: 'Allowable expenses' },
  { icon: Building2, label: 'Per-property breakdown' },
  { icon: AlertTriangle, label: 'Duplicate detection' },
  { icon: Calculator, label: 'Rent computation' },
];

function isSupportedDoc(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    || f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(f.name)
    || isSpreadsheetFile(f);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ── Page wrapper: history dashboard or tool ──────────────────────────────────
export default function LandlordPage() {
  const [view, setView] = useState<'history' | 'tool'>('history');
  const [seed, setSeed] = useState<LandlordSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  return view === 'history' ? (
    <LandlordHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <LandlordTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
  );
}

function BackToHistory({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 mb-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
    >
      <ArrowLeft size={13} />
      Back to history
    </button>
  );
}

function LandlordTool({ seed, onBack }: { seed: LandlordSeed | null; onBack: () => void }) {
  const { isModuleActive } = useModules();
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/landlord', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setDocumentFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}-${f.size}`));
      return [...prev, ...files.filter(f => !seen.has(`${f.name}-${f.size}`))];
    });
  }, []);

  // ── Auto client-context: pulls past saved Landlord analyses for this client
  // and feeds them to the AI so it stays consistent with previously-chosen
  // categories, supplier names, addresses, and capital-vs-revenue calls.
  const [autoCtxIncome, setAutoCtxIncome]    = useState<{ Date: string; PropertyAddress: string; Description: string; Amount: number }[]>([]);
  const [autoCtxExpenses, setAutoCtxExpenses]= useState<{ DueDate: string; Description: string; Category: string; Supplier: string; PropertyAddress: string; Amount: number; CapitalExpense: boolean; TenantPayable: boolean }[]>([]);
  const [autoCtxAnalyses, setAutoCtxAnalyses]= useState(0);
  const [autoCtxLoading, setAutoCtxLoading]  = useState(false);
  const [useAutoContext, setUseAutoContext]  = useState(true);

  // ── Property register (shared with MTD IT) + ownership ─────────────────────
  const [properties, setProperties]   = useState<LandlordProperty[]>([]);
  const [propsLoading, setPropsLoading] = useState(false);
  const [propertyMode, setPropertyMode] = useState<PropertyMode>('suggest');
  // Combine every property into one "All properties" entity — income/expenses are
  // pooled and ownership is allocated once, rather than per property.
  const [groupAll, setGroupAll] = useState(false);
  // Entity type drives the finance-cost (mortgage interest) restriction in the
  // rent computation — individuals get a 20% tax reducer, companies deduct it.
  const [entityType, setEntityType] = useState<LandlordEntityType>('individual');
  // Property income allowance (£1,000 instead of actual expenses) + losses b/f + notes.
  const [useAllowance, setUseAllowance] = useState(false);
  const [broughtForwardLoss, setBroughtForwardLoss] = useState('');
  // The allowance, losses and the finance-cost restriction are personal reliefs,
  // so each owner gets their own settings for their own report. Keyed by person key.
  const [personSettings, setPersonSettings] = useState<Record<string, LandlordPersonSettings>>({});
  const [notes, setNotes] = useState('');
  // Prior-year comparison.
  const [showComparison, setShowComparison] = useState(false);
  const [priorComp, setPriorComp] = useState<RentComputation | null>(null);
  const [priorMeta, setPriorMeta] = useState<{ curLabel: string; priorLabel: string; periodLabel: string } | null>(null);
  const [priorState, setPriorState] = useState<'idle' | 'loading' | 'found' | 'none'>('idle');

  const refreshProperties = useCallback(async () => {
    if (!selectedClient?.id) { setProperties([]); return; }
    const clientId = selectedClient.id;
    setPropsLoading(true);
    try {
      const [pRes, oRes] = await Promise.all([
        fetch(`/api/mtd-it/properties?client_id=${clientId}`),
        fetch(`/api/landlord/property-owners?client_id=${clientId}`),
      ]);
      const pData = pRes.ok ? await pRes.json() : { properties: [] };
      const oData = oRes.ok ? await oRes.json() : { owners: [] };
      const owners = (oData.owners ?? []) as PropertyOwner[];
      type FetchedProp = { id: string; client_id: string; address: string; ownership_pct: number; property_type: 'uk' | 'foreign'; use_type?: 'residential' | 'commercial' | null; active: boolean };
      const merged: LandlordProperty[] = ((pData.properties ?? []) as FetchedProp[]).map(p => ({
        id: p.id, client_id: p.client_id, address: p.address,
        ownership_pct: Number(p.ownership_pct), property_type: p.property_type,
        use_type: p.use_type ?? null, active: p.active,
        owners: owners.filter(o => o.property_id === p.id),
      }));
      setProperties(merged);
    } catch { /* register is optional — ignore fetch errors */ }
    finally { setPropsLoading(false); }
  }, [selectedClient?.id]);

  useEffect(() => { void refreshProperties(); }, [refreshProperties]);

  // ── Prior-year comparison: find the client's saved analysis whose period ends
  //    one year before the current one, and compute its figures for a side column.
  const loadPrior = useCallback(async () => {
    const cid = selectedClient?.id;
    const curEndYear = dateTo ? parseInt(dateTo.slice(0, 4), 10) : (dateFrom ? parseInt(dateFrom.slice(0, 4), 10) + 1 : NaN);
    if (!cid || Number.isNaN(curEndYear)) { setPriorState('none'); setPriorComp(null); setPriorMeta(null); return; }
    setPriorState('loading');
    try {
      const list = await fetch(`/api/outputs?feature=landlord_analysis&client_id=${cid}`).then(r => r.ok ? r.json() : { outputs: [] });
      const outputs = (list.outputs ?? []) as Array<{ id: string; period_to: string | null; created_at: string }>;
      const candidates = outputs
        .filter(o => o.id !== seed?.id && o.period_to && parseInt(o.period_to.slice(0, 4), 10) === curEndYear - 1)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
      const chosen = candidates[0];
      if (!chosen) { setPriorState('none'); setPriorComp(null); setPriorMeta(null); return; }
      const detail = await fetch(`/api/outputs/${chosen.id}`).then(r => r.ok ? r.json() : null);
      const rd = detail?.output?.result_data as {
        income?: (LandlordIncomeTransaction & { _forceInclude?: boolean })[];
        expenses?: (LandlordExpenseTransaction & { _forceInclude?: boolean })[];
        adjustments?: LandlordAdjustment[];
        dateFrom?: string; dateTo?: string;
        entityType?: LandlordEntityType; useAllowance?: boolean; broughtForwardLoss?: number;
      } | undefined;
      if (!rd) { setPriorState('none'); setPriorComp(null); setPriorMeta(null); return; }
      const pFrom = rd.dateFrom ?? '', pTo = rd.dateTo ?? '';
      const pIncome = (rd.income ?? []).filter(r => isInRange(r.Date, pFrom, pTo) || r._forceInclude === true);
      const pExpenses = (rd.expenses ?? []).filter(r => isInRange(r.DueDate, pFrom, pTo) || r._forceInclude === true);
      const pComp = computeRentComputation(pIncome, pExpenses, rd.adjustments ?? [], {
        entityType: rd.entityType ?? 'individual', useAllowance: rd.useAllowance ?? false, broughtForwardLoss: rd.broughtForwardLoss ?? 0,
      });
      setPriorComp(pComp);
      setPriorMeta({
        curLabel: dateTo ? dateTo.slice(0, 4) : 'This year',
        priorLabel: pTo ? pTo.slice(0, 4) : 'Last year',
        periodLabel: (pFrom || pTo) ? `${fmtUKDate(pFrom)} – ${fmtUKDate(pTo)}` : '',
      });
      setPriorState('found');
    } catch { setPriorState('none'); setPriorComp(null); setPriorMeta(null); }
  }, [selectedClient?.id, dateFrom, dateTo, seed?.id]);

  useEffect(() => {
    if (appState === 'success' && selectedClient?.id && (dateFrom || dateTo)) { void loadPrior(); }
    else { setPriorState('idle'); setPriorComp(null); setPriorMeta(null); }
  }, [appState, selectedClient?.id, dateFrom, dateTo, loadPrior]);

  useEffect(() => {
    if (!selectedClient?.id) {
      setAutoCtxIncome([]); setAutoCtxExpenses([]); setAutoCtxAnalyses(0);
      return;
    }
    let cancelled = false;
    setAutoCtxLoading(true);
    fetch(`/api/landlord/client-context?clientId=${selectedClient.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        setAutoCtxIncome(d.pastIncome ?? []);
        setAutoCtxExpenses(d.pastExpenses ?? []);
        setAutoCtxAnalyses(d.analysisCount ?? 0);
      })
      .catch(() => {/* silent — context is optional */})
      .finally(() => { if (!cancelled) setAutoCtxLoading(false); });
    return () => { cancelled = true; };
  }, [selectedClient?.id]);

  // ── Seed loader: when opened from history dashboard, hydrate the success view
  const seedLoadedRef = useRef(false);
  useEffect(() => {
    if (!seed || seedLoadedRef.current) return;
    seedLoadedRef.current = true;
    if (seed.client) {
      setSelectedClient({
        id: seed.client.id,
        name: seed.client.name,
        client_ref: seed.client.client_ref,
        business_type: null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
    }
    setDateFrom(seed.dateFrom ?? '');
    setDateTo(seed.dateTo ?? '');
    setAdjustments(seed.adjustments ?? []);
    if (seed.entityType) setEntityType(seed.entityType);
    setUseAllowance(seed.useAllowance ?? false);
    setBroughtForwardLoss(seed.broughtForwardLoss != null ? String(seed.broughtForwardLoss) : '');
    setPersonSettings(seed.personSettings ?? {});
    setNotes(seed.notes ?? '');

    // Hydrate income/expense rows back into UI shape (re-tag with internal _id, _flagged etc.)
    const incomeRows = buildIncomeRows(seed.income, seed.dateFrom ?? '', seed.dateTo ?? '');
    const expenseRows = buildExpenseRows(seed.expenses, seed.dateFrom ?? '', seed.dateTo ?? '');

    // Re-flag the previously-flagged entries by matching fileName + amount + date
    for (const fi of seed.flaggedIncome ?? []) {
      const m = incomeRows.find(r => r.fileName === fi.fileName && Math.abs(r.Amount - fi.amount) < 0.01 && r.Date === fi.date);
      if (m) { m._flagged = true; m._flagReason = fi.reason; }
    }
    for (const fe of seed.flaggedExpenses ?? []) {
      const m = expenseRows.find(r => r.fileName === fe.fileName && Math.abs(r.Amount - fe.amount) < 0.01 && r.DueDate === fe.date);
      if (m) { m._flagged = true; m._flagReason = fe.reason; }
    }

    setHistory([{ income: incomeRows, expenses: expenseRows }]);
    setHistoryIndex(0);
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/landlord');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/landlord') return;
      const p = consumePendingClient('/landlord');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  const handleClientSelect = useCallback((c: SelectedClient | null) => {
    setSelectedClient(c);
  }, []);

  // Per-document scan state
  const [scanResults, setScanResults] = useState<DocumentScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const fileRefs = useRef<Map<string, File>>(new Map());

  // History for undo/redo
  const [history, setHistory] = useState<LandlordStateData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const current: LandlordStateData = history[historyIndex] ?? { income: [], expenses: [] };
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Adjustments (manual income/expense items for rent computation)
  const [adjustments, setAdjustments] = useState<LandlordAdjustment[]>([]);
  const [adjForm, setAdjForm] = useState<{ description: string; amount: string; type: 'income' | 'expense'; category: string; propertyAddress: string } | null>(null);
  const [adjEditId, setAdjEditId] = useState<string | null>(null);

  // View/UI state
  const [view, setView] = useState<LandlordView>('income');
  const [breakdown, setBreakdown] = useState<Breakdown>('all');
  const [showOutOfRange, setShowOutOfRange] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');
  // With Email Triage on, approval emails go to the in-app compose window for
  // the user to send, rather than being sent server-side.
  const triageActive = isModuleActive('email-triage');
  // Client approval (step 5). Approvals hang off the saved analysis, so the
  // output id is the anchor — reused so re-sending never duplicates history.
  const [outputId, setOutputId] = useState<string | null>(seed?.id ?? null);
  const [savingForApproval, setSavingForApproval] = useState(false);
  const [sendApprovalOpen, setSendApprovalOpen] = useState(false);
  const [approvalsRefresh, setApprovalsRefresh] = useState(0);
  // The client's contact email — SelectedClient doesn't carry it, so fetch it
  // to pre-fill the approval recipient.
  const [clientEmail, setClientEmail] = useState<string | null>(null);
  useEffect(() => {
    const id = selectedClient?.id;
    if (!id) { setClientEmail(null); return; }
    let cancelled = false;
    fetch(`/api/clients/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.client) setClientEmail(d.client.contact_email ?? null); })
      .catch(() => {/* optional */});
    return () => { cancelled = true; };
  }, [selectedClient?.id]);

  // Contact emails for owners who are linked clients, to pre-fill the
  // per-individual send. Owners recorded only by name have no email on file.
  const [ownerEmails, setOwnerEmails] = useState<Record<string, string | null>>({});
  const ownerClientIds = useMemo(
    () => Array.from(new Set(properties.flatMap(p => p.owners.map(o => o.owner_client_id).filter((x): x is string => !!x)))),
    [properties],
  );
  useEffect(() => {
    if (ownerClientIds.length === 0) { setOwnerEmails({}); return; }
    let cancelled = false;
    void Promise.all(ownerClientIds.map(async id => {
      try {
        const r = await fetch(`/api/clients/${id}`);
        if (!r.ok) return [id, null] as const;
        const d = await r.json();
        return [id, (d?.client?.contact_email ?? null) as string | null] as const;
      } catch { return [id, null] as const; }
    })).then(pairs => { if (!cancelled) setOwnerEmails(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [ownerClientIds]);

  // Selection state (by _id)
  const [selectedIncome, setSelectedIncome] = useState<Set<string>>(new Set());
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'flag' | 'edit-category' | 'edit-property' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  // Edit modal
  const [editItem, setEditItem] = useState<{ type: 'income' | 'expense'; id: string } | null>(null);

  // Include-out-of-range confirmation lightbox
  const [includeConfirm, setIncludeConfirm] = useState<{ type: 'income' | 'expense'; ids: string[] } | null>(null);

  // ─── Push history ───────────────────────────────────────────────────────────

  const pushHistory = useCallback((income: IncomeRow[], expenses: ExpenseRow[]) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, { income, expenses }];
    });
    setHistoryIndex(prev => prev + 1);
    setSelectedIncome(new Set());
    setSelectedExpenses(new Set());
    setBulkMode(null);
    setBulkValue('');
  }, [historyIndex]);

  // ─── Derived data ───────────────────────────────────────────────────────────

  const hasDateRange = !!(dateFrom || dateTo);

  const inRangeIncome   = useMemo(() => current.income.filter(r => !r._flagged && (r._inRange || r._forceInclude)),   [current.income]);
  const outRangeIncome  = useMemo(() => current.income.filter(r => !r._flagged && !r._inRange && !r._forceInclude),  [current.income]);
  const inRangeExpenses = useMemo(() => current.expenses.filter(r => !r._flagged && (r._inRange || r._forceInclude)), [current.expenses]);
  const outRangeExpenses= useMemo(() => current.expenses.filter(r => !r._flagged && !r._inRange && !r._forceInclude),[current.expenses]);
  const flaggedIncome   = useMemo(() => current.income.filter(r => r._flagged),   [current.income]);
  const flaggedExpenses = useMemo(() => current.expenses.filter(r => r._flagged), [current.expenses]);
  const allFlagged      = useMemo(() => [...flaggedIncome, ...flaggedExpenses],    [flaggedIncome, flaggedExpenses]);

  // Raw line-item totals for the Income / Expenses table footers (these list
  // every row as-is). The headline KPI strip uses `kpi` below, which restricts
  // residential finance for individuals.
  const incomeTotal    = useMemo(() => inRangeIncome.reduce((s, r) => s + (r.Amount || 0), 0),   [inRangeIncome]);
  const expensesTotal  = useMemo(() => inRangeExpenses.reduce((s, r) => s + (r.Amount || 0), 0), [inRangeExpenses]);

  // Property grouping
  const incomeByProperty = useMemo(() => {
    const map = new Map<string, IncomeRow[]>();
    for (const r of inRangeIncome) {
      const key = normalizeAddress(r.PropertyAddress);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [inRangeIncome]);

  const expensesByProperty = useMemo(() => {
    const map = new Map<string, ExpenseRow[]>();
    for (const r of inRangeExpenses) {
      const key = normalizeAddress(r.PropertyAddress);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [inRangeExpenses]);

  // Full per-person working: property × individual × category.
  const personMatrix = useMemo(() => {
    const pc = { id: selectedClient?.id ?? null, name: selectedClient?.name ?? 'This client' };
    const inc = [
      ...inRangeIncome.map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount, Category: r.Category })),
      ...adjustments.filter(a => a.type === 'income').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount, Category: a.category || LANDLORD_INCOME_CATEGORIES[0] })),
    ];
    const exp = [
      ...inRangeExpenses.filter(r => !r.CapitalExpense).map(r => ({ PropertyAddress: r.PropertyAddress, Amount: r.Amount, Category: r.Category })),
      ...adjustments.filter(a => a.type === 'expense').map(a => ({ PropertyAddress: a.propertyAddress, Amount: a.amount, Category: a.category || 'Other allowable property expenses' })),
    ];
    return computePersonMatrix(inc, exp, properties, pc, { entityType });
  }, [inRangeIncome, inRangeExpenses, adjustments, properties, selectedClient?.id, selectedClient?.name, entityType]);

  // Portfolio-level computation (for the allowance nudge in the options card).
  const rentCompAll = useMemo(
    () => computeRentComputation(inRangeIncome, inRangeExpenses, adjustments, { entityType, useAllowance, broughtForwardLoss: parseFloat(broughtForwardLoss) || 0 }),
    [inRangeIncome, inRangeExpenses, adjustments, entityType, useAllowance, broughtForwardLoss],
  );

  // Headline strip figures. Runs the full computation (so residential finance is
  // restricted for individuals — NOT counted as a deductible expense) but ignores
  // the £1,000 allowance and losses, which are computation refinements shown in
  // the Rent Computation tab, not headline totals.
  const kpi = useMemo(
    () => computeRentComputation(inRangeIncome, inRangeExpenses, adjustments, { entityType }),
    [inRangeIncome, inRangeExpenses, adjustments, entityType],
  );

  // One owner's own computation: scale their share of every row FIRST, then apply
  // their reliefs — the allowance, losses and finance-cost restriction are
  // personal, so a share of the portfolio's answer would be the wrong number.
  // Mirrors buildLandlordPersonPackData and the public approve route.
  const personComp = useCallback((personKey: string): RentComputation => {
    const pc = { id: selectedClient?.id ?? null, name: selectedClient?.name ?? 'This client' };
    const s = personSettings[personKey] ?? DEFAULT_PERSON_SETTINGS;
    return computeRentComputation(
      personShareRows(inRangeIncome, properties, pc, personKey),
      personShareRows(inRangeExpenses, properties, pc, personKey),
      personShareAdjustments(adjustments, properties, pc, personKey),
      { entityType: s.entityType, useAllowance: s.useAllowance, broughtForwardLoss: s.broughtForwardLoss },
    );
  }, [inRangeIncome, inRangeExpenses, adjustments, properties, selectedClient?.id, selectedClient?.name, personSettings]);

  // The owners we can send a personal report to, with a pre-filled email.
  const approvalPeople = useMemo(() => personMatrix.people.map(p => ({
    key: p.key,
    name: p.name,
    clientId: p.clientId,
    email: p.clientId
      ? (p.clientId === selectedClient?.id ? clientEmail : (ownerEmails[p.clientId] ?? null))
      : null,
  })), [personMatrix.people, ownerEmails, clientEmail, selectedClient?.id]);

  // Summary lines shown in the approval email — the recipient's own figures.
  const summaryFor = useCallback((person?: { key: string; name: string }) => {
    const c = person ? personComp(person.key) : rentCompAll;
    return [
      { label: 'Total income', value: fmt(c.totalIncome) },
      { label: c.allowanceUsed ? 'Total deduction' : 'Total expenses', value: fmt(c.totalExpenses) },
      { label: c.netProfit >= 0 ? 'Net profit' : 'Net loss', value: fmt(Math.abs(c.netProfit)) },
    ];
  }, [personComp, rentCompAll]);

  // ─── Scan logic ─────────────────────────────────────────────────────────────

  const scanFiles = useCallback(async (
    filesToScan: File[],
    clientId: string | null,
    clientCode: string | null,
  ): Promise<DocumentScanResult[]> => {
    const docResults: DocumentScanResult[] = [];
    const pastContext = (useAutoContext && (autoCtxIncome.length > 0 || autoCtxExpenses.length > 0))
      ? { pastIncome: autoCtxIncome, pastExpenses: autoCtxExpenses }
      : null;
    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });
      try {
        // Spreadsheets/CSV are converted to text client-side; everything else
        // goes as base64 (PDF document or image).
        const filePayload = isSpreadsheetFile(file)
          ? { name: file.name, mimeType: file.type || 'text/csv', text: await spreadsheetToText(file) }
          : { name: file.name, mimeType: file.type || 'application/pdf', base64: await fileToBase64(file) };
        const res = await fetch('/api/landlord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [filePayload], clientId, clientCode, pastContext }),
        });
        if (!res.ok) {
          const err = await res.json();
          docResults.push({ fileName: file.name, status: 'failed', validTransactions: [], flaggedEntries: [], errorMessage: err.error || 'Processing failed', errorCode: err.code });
        } else {
          const data = await res.json();
          // Force fileName to the actual uploaded file name so the document viewer can look it up
          const income: TaggedIncome[] = (data.income || []).filter(Boolean).map((t: LandlordIncomeTransaction) => ({ ...t, fileName: file.name, _recordType: 'income' as const }));
          const expenses: TaggedExpense[] = (data.expenses || []).filter(Boolean).map((t: LandlordExpenseTransaction) => ({ ...t, fileName: file.name, _recordType: 'expense' as const }));
          const flaggedEntries = (data.flaggedEntries || []).filter(Boolean).map((fe: { fileName?: string }) => ({ ...fe, fileName: file.name }));
          docResults.push({ fileName: file.name, status: 'success', validTransactions: [...income, ...expenses], flaggedEntries });
        }
      } catch (err) {
        docResults.push({ fileName: file.name, status: 'failed', validTransactions: [], flaggedEntries: [], errorMessage: err instanceof Error ? err.message : 'Unknown error' });
      }
      setScanResults(prev => {
        const map = new Map(prev.map(r => [r.fileName, r]));
        map.set(docResults[docResults.length - 1].fileName, docResults[docResults.length - 1]);
        return Array.from(map.values());
      });
    }
    return docResults;
  }, [useAutoContext, autoCtxIncome, autoCtxExpenses]);

  const applyAndProceed = useCallback((allScanResults: DocumentScanResult[], df: string, dt: string) => {
    const successful = allScanResults.filter(r => r.status === 'success');
    const allTagged = successful.flatMap(r => r.validTransactions as (TaggedIncome | TaggedExpense)[]).filter(Boolean);

    const rawIncome  = allTagged.filter((t): t is TaggedIncome  => t._recordType === 'income').map(({ _recordType: _, ...rest }) => rest as LandlordIncomeTransaction);
    const rawExpense = allTagged.filter((t): t is TaggedExpense => t._recordType === 'expense').map(({ _recordType: _, ...rest }) => rest as LandlordExpenseTransaction);

    // Also incorporate Claude's flaggedEntries as flagged expense rows where possible
    const apiFlagged = successful.flatMap(r => r.flaggedEntries as FlaggedEntry[]).filter(Boolean);

    const incomeRows  = buildIncomeRows(rawIncome, df, dt);
    const expenseRows = buildExpenseRows(rawExpense, df, dt);

    // Mark API flagged entries
    for (const fe of apiFlagged) {
      // Try to match to an existing income row
      const incMatch = incomeRows.find(r => !r._flagged && r.fileName === fe.fileName && (Math.abs(r.Amount - (fe.amount ?? 0)) < 0.01));
      if (incMatch) { incMatch._flagged = true; incMatch._flagReason = fe.reason; continue; }
      // Try to match to an existing expense row
      const expMatch = expenseRows.find(r => !r._flagged && r.fileName === fe.fileName && (Math.abs(r.Amount - (fe.amount ?? 0)) < 0.01));
      if (expMatch) { expMatch._flagged = true; expMatch._flagReason = fe.reason; continue; }
      // No match — add as a synthetic flagged expense row
      expenseRows.push({
        _id: nextId(), _flagged: true, _flagReason: fe.reason, _inRange: true,
        fileName: fe.fileName ?? '',
        DueDate: fe.date ?? '',
        Description: fe.description ?? '',
        Category: '',
        Amount: fe.amount ?? 0,
        Supplier: fe.supplier ?? '',
        TenantPayable: false,
        CapitalExpense: false,
        PropertyAddress: '',
      });
    }

    // Group mode — pool every row under one combined property so income and
    // expenses are analysed together and ownership is allocated once.
    if (groupAll) {
      for (const r of incomeRows)  r.PropertyAddress = GROUP_LABEL;
      for (const r of expenseRows) r.PropertyAddress = GROUP_LABEL;
    }

    detectDuplicates(incomeRows, expenseRows);

    // Allocate matched rows to the client's saved properties (canonical spelling).
    // Unmatched rows keep their extracted address for manual allocation.
    const finalIncome  = canonicalizeToRegister(incomeRows, properties);
    const finalExpense = canonicalizeToRegister(expenseRows, properties);

    setScanProgress(null);
    setHistory([{ income: finalIncome, expenses: finalExpense }]);
    setHistoryIndex(0);
    setAppState('success');
  }, [properties, groupAll]);

  // Suggested / grouped properties get a review step (2b) before the results, so
  // the user can edit the properties and allocate ownership first.
  const needsPropertyReview = !!selectedClient && (propertyMode === 'suggest' || groupAll);
  const wizardSteps = needsPropertyReview ? STEPS_WITH_REVIEW : STEPS_BASE;

  const proceedAfterScan = useCallback((results: DocumentScanResult[]) => {
    if (needsPropertyReview) {
      setScanResults(results);
      setScanProgress(null);
      setAppState('property_review');
    } else {
      applyAndProceed(results, dateFrom, dateTo);
    }
  }, [needsPropertyReview, applyAndProceed, dateFrom, dateTo]);

  const handleProcess = useCallback(async () => {
    if (documentFiles.length === 0) return;
    setAppState('loading');
    setError(null);
    setProgress(0);
    setScanResults([]);
    setScanProgress(null);
    fileRefs.current = new Map(documentFiles.map(f => [f.name, f]));

    const est = (5 + documentFiles.length * 4) * 1000;
    let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(90, (elapsed / est) * 100)); }, 100);

    const resolvedClientCode = selectedClient?.client_ref ?? null;
    const allResults = await scanFiles(documentFiles, selectedClient?.id ?? null, resolvedClientCode);
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setScanProgress(null);

    if (documentFiles.length === 1) {
      if (allResults[0].status === 'failed') {
        setError(allResults[0].errorMessage || 'Processing failed. Please try again.');
        setAppState('error');
      } else {
        proceedAfterScan(allResults);
      }
      return;
    }
    setAppState('scan_results');
  }, [documentFiles, selectedClient, scanFiles, proceedAfterScan]);

  const handleRescan = useCallback(async () => {
    const failed = scanResults.filter(r => r.status === 'failed');
    if (failed.length === 0) return;
    const files = failed.map(r => fileRefs.current.get(r.fileName)).filter(Boolean) as File[];
    setIsRescanning(true);
    const newResults = await scanFiles(files, selectedClient?.id ?? null, selectedClient?.client_ref ?? null);
    setScanResults(prev => { const m = new Map(newResults.map(r => [r.fileName, r])); return prev.map(r => m.get(r.fileName) ?? r); });
    setScanProgress(null);
    setIsRescanning(false);
  }, [scanResults, selectedClient, scanFiles]);

  const handleDismissAndContinue = useCallback(() => {
    proceedAfterScan(scanResults);
  }, [scanResults, proceedAfterScan]);

  // ─── Row edit handlers ──────────────────────────────────────────────────────

  const handleSaveRow = useCallback((updated: IncomeRow | ExpenseRow) => {
    if (!editItem) return;

    // Category picked from the other group → move the entry between income and expenses.
    const cat = (updated as { Category?: string }).Category ?? '';
    if (editItem.type === 'expense' && LANDLORD_INCOME_CATEGORIES.includes(cat)) {
      const e = updated as ExpenseRow;
      pushHistory(
        [...current.income, expenseToIncomeRow(e, cat, dateFrom, dateTo)],
        current.expenses.filter(r => r._id !== e._id),
      );
      setEditItem(null);
      return;
    }
    if (editItem.type === 'income' && LANDLORD_EXPENSE_CATEGORIES.includes(cat)) {
      const i = updated as IncomeRow;
      pushHistory(
        current.income.filter(r => r._id !== i._id),
        [...current.expenses, incomeToExpenseRow(i, cat, dateFrom, dateTo)],
      );
      setEditItem(null);
      return;
    }

    if (editItem.type === 'income') {
      // Re-evaluate in-range against the (possibly edited) date so a corrected
      // date moves the row into or out of the computation automatically.
      const row = { ...(updated as IncomeRow), _inRange: isInRange((updated as IncomeRow).Date, dateFrom, dateTo) };
      const newIncome = current.income.map(r => r._id === editItem.id ? row : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const row = { ...(updated as ExpenseRow), _inRange: isInRange((updated as ExpenseRow).DueDate, dateFrom, dateTo) };
      const newExpenses = current.expenses.map(r => r._id === editItem.id ? row : r);
      pushHistory(current.income, newExpenses);
    }
    setEditItem(null);
  }, [editItem, current, pushHistory, dateFrom, dateTo]);

  // Force-include one or more out-of-range rows into the computation.
  const handleIncludeRows = useCallback((ids: string[], type: 'income' | 'expense') => {
    const idSet = new Set(ids);
    if (type === 'income') {
      const newIncome = current.income.map(r => idSet.has(r._id) ? { ...r, _forceInclude: true } : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const newExpenses = current.expenses.map(r => idSet.has(r._id) ? { ...r, _forceInclude: true } : r);
      pushHistory(current.income, newExpenses);
    }
  }, [current, pushHistory]);

  // ── Grouped mode: the single combined property ──────────────────────────
  // In group mode every transaction lands on one "All properties" entry, and
  // ownership is allocated against that. It's a real register property so the
  // owners editor, the per-person split and next year's re-run all just work.
  const groupProperty = useMemo(
    () => properties.find(p => normalizeForMatch(p.address) === normalizeForMatch(GROUP_LABEL)) ?? null,
    [properties],
  );

  // Create it as soon as group mode is on, so ownership can be set upfront
  // rather than only after the scan.
  const [groupPropBusy, setGroupPropBusy] = useState(false);
  const [groupPropFailed, setGroupPropFailed] = useState(false);
  // One attempt per client: fetch doesn't reject on a 4xx, so without this a
  // failed create would refresh, still find no property, and re-fire this effect
  // forever. The review step's addDetectedProperties is the backstop.
  const groupPropTriedRef = useRef<string | null>(null);
  useEffect(() => {
    const clientId = selectedClient?.id;
    if (!groupAll || !clientId) { groupPropTriedRef.current = null; return; }
    if (propsLoading || groupProperty || groupPropTriedRef.current === clientId) return;
    groupPropTriedRef.current = clientId;
    let cancelled = false;
    setGroupPropBusy(true);
    setGroupPropFailed(false);
    void fetch('/api/mtd-it/properties', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, address: GROUP_LABEL, ownership_pct: 100, property_type: 'uk' }),
    })
      .then(async res => {
        if (cancelled) return;
        if (!res.ok) { setGroupPropFailed(true); return; }
        await refreshProperties();
      })
      .catch(() => { if (!cancelled) setGroupPropFailed(true); })
      .finally(() => { if (!cancelled) setGroupPropBusy(false); });
    return () => { cancelled = true; };
  }, [groupAll, selectedClient?.id, propsLoading, groupProperty, refreshProperties]);

  // Unticking: bin the combined property again, but ONLY while it's untouched.
  // mtd_it_properties is shared with MTD IT, so an idle tick mustn't leave a
  // stray "All properties" in the client's register — while a grouping set up
  // earlier (or last year) must survive.
  const handleGroupAllChange = useCallback(async (checked: boolean) => {
    setGroupAll(checked);
    if (checked || !groupProperty || groupProperty.owners.length > 0) return;
    await fetch(`/api/mtd-it/properties?id=${groupProperty.id}`, { method: 'DELETE' }).catch(() => {});
    await refreshProperties();
  }, [groupProperty, refreshProperties]);

  // Bulk-create the AI-detected addresses that aren't in the register yet.
  const addDetectedProperties = useCallback(async (addrs: string[]) => {
    if (!selectedClient?.id) return;
    for (const address of addrs) {
      await fetch('/api/mtd-it/properties', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: selectedClient.id, address, ownership_pct: 100, property_type: 'uk' }),
      }).catch(() => {/* skip failures, keep going */});
    }
    await refreshProperties();
  }, [selectedClient?.id, refreshProperties]);

  // Addresses detected by the scan (or the single combined property in group mode).
  const detectedFromScan = useMemo(() => {
    if (groupAll) return [GROUP_LABEL];
    const set = new Set<string>();
    for (const r of scanResults) {
      if (r.status !== 'success') continue;
      for (const t of (r.validTransactions as Array<{ PropertyAddress?: string }>)) {
        const a = normalizeAddress(t?.PropertyAddress ?? '');
        if (a && a !== 'Non Allocated') set.add(a);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [scanResults, groupAll]);

  // On entering the review step, add any detected properties that aren't in the
  // client's register yet so they can be edited and given owners.
  const reviewImportedRef = useRef(false);
  useEffect(() => {
    if (appState !== 'property_review') { reviewImportedRef.current = false; return; }
    if (reviewImportedRef.current || propsLoading) return;
    reviewImportedRef.current = true;
    const missing = detectedFromScan.filter(a => !matchProperty(a, properties));
    if (missing.length > 0) void addDetectedProperties(missing);
  }, [appState, detectedFromScan, properties, propsLoading, addDetectedProperties]);

  // Approvals need a persisted analysis to hang off. Save once and reuse the id,
  // so re-sending or re-approving never creates a duplicate history row.
  const ensureSavedOutput = useCallback(async (): Promise<string> => {
    // Re-save rather than skip when we already have an id: the client approves
    // against what's stored, so a settings change made after the first save has
    // to reach the row or the approve page would show stale figures.
    const res = await fetch('/api/outputs/landlord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: outputId ?? undefined,
        clientId: selectedClient?.id ?? null,
        clientName: selectedClient?.name ?? null,
        clientCode: selectedClient?.client_ref ?? null,
        income: toExportIncome(current.income.filter(r => !r._flagged)),
        expenses: toExportExpense(current.expenses.filter(r => !r._flagged)),
        adjustments,
        flaggedIncome: flaggedIncome.map(r => ({ date: r.Date, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName })),
        flaggedExpenses: flaggedExpenses.map(r => ({ date: r.DueDate, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName })),
        dateFrom, dateTo, entityType,
        useAllowance,
        broughtForwardLoss: parseFloat(broughtForwardLoss) || 0,
        personSettings,
        notes,
        sourceFilenames: Array.from(new Set(documentFiles.map(f => f.name))),
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) throw new Error(j.error ?? 'Failed to save the analysis');
    setOutputId(j.id as string);
    return j.id as string;
  }, [outputId, selectedClient, current.income, current.expenses, adjustments, flaggedIncome, flaggedExpenses,
      dateFrom, dateTo, entityType, useAllowance, broughtForwardLoss, personSettings, notes, documentFiles]);

  // Re-save before opening the send modal: the client approves against the stored
  // figures, so any per-person setting changed since the last save has to land
  // first or the approve page would contradict the PDF they were sent.
  const openSendApproval = useCallback(async () => {
    setSavingForApproval(true);
    setError(null);
    try {
      await ensureSavedOutput();
      setSendApprovalOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the analysis');
      setAppState('error');
    } finally {
      setSavingForApproval(false);
    }
  }, [ensureSavedOutput]);

  // Step 5 — saves the analysis first if it isn't saved yet.
  const goToApproval = useCallback(async () => {
    setSavingForApproval(true);
    setError(null);
    try {
      await ensureSavedOutput();
      setAppState('approval');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the analysis');
      setAppState('error');
    } finally {
      setSavingForApproval(false);
    }
  }, [ensureSavedOutput]);

  // Download just the workbook — no Drive upload, no history save.
  const handleDownloadExcel = useCallback(() => {
    const comparison = (showComparison && priorComp && priorMeta)
      ? { current: rentCompAll, prior: priorComp, curLabel: priorMeta.curLabel, priorLabel: priorMeta.priorLabel }
      : null;
    exportLandlordWorkbook({
      income: toExportIncome(current.income.filter(r => !r._flagged)),
      expenses: toExportExpense(current.expenses.filter(r => !r._flagged)),
      adjustments,
      flaggedIncome: flaggedIncome.map(r => ({ date: r.Date, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName })),
      flaggedExpenses: flaggedExpenses.map(r => ({ date: r.DueDate, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName })),
      clientName: selectedClient?.name ?? '',
      clientCode: selectedClient?.client_ref ?? '',
      dateFrom, dateTo,
      filename: `landlord_analysis_${new Date().toISOString().slice(0, 10)}.xlsx`,
      properties,
      primaryClientId: selectedClient?.id ?? null,
      primaryClientName: selectedClient?.name ?? '',
      entityType, useAllowance, broughtForwardLoss: parseFloat(broughtForwardLoss) || 0, notes,
      comparison,
    });
  }, [current.income, current.expenses, adjustments, flaggedIncome, flaggedExpenses, selectedClient, dateFrom, dateTo,
      properties, entityType, useAllowance, broughtForwardLoss, notes, showComparison, priorComp, priorMeta, rentCompAll]);

  // Build the client-ready Property Income Computation PDF (Accounts Studio house
  // style). Returns the blob so it can be downloaded or attached to an email.
  // `person` set → a personal pack: every row scaled to their share, their own
  // reliefs applied. Otherwise the whole-portfolio pack.
  // `onProgress` surfaces the render stages — PDF generation runs on the main
  // thread, so a long pack needs to show it's alive.
  const buildPdfBlob = useCallback(async (
    person?: { key: string; name: string },
    onProgress?: (label: string) => void,
  ): Promise<Blob> => {
    let firmName: string | null = null, logoUrl: string | null = null;
    try {
      const r = await fetch('/api/firm/branding');
      if (r.ok) { const b = await r.json(); firmName = b.firmName ?? null; logoUrl = b.logoUrl ?? null; }
    } catch { /* branding is optional */ }
    const comparison = (showComparison && priorComp && priorMeta)
      ? { current: rentCompAll, prior: priorComp, curLabel: priorMeta.curLabel, priorLabel: priorMeta.priorLabel }
      : null;
    let packData: LandlordPackData = {
      clientName: selectedClient?.name ?? '',
      clientCode: selectedClient?.client_ref ?? '',
      dateFrom, dateTo, firmName, logoUrl,
      income: inRangeIncome, expenses: inRangeExpenses, adjustments,
      properties,
      primaryClientId: selectedClient?.id ?? null,
      primaryClientName: selectedClient?.name ?? 'This client',
      entityType, useAllowance, broughtForwardLoss: parseFloat(broughtForwardLoss) || 0, notes,
      comparison,
    };
    if (person) {
      packData = buildLandlordPersonPackData(packData, person, personSettings[person.key] ?? DEFAULT_PERSON_SETTINGS);
    }
    const html = buildLandlordPackHtml(packData);
    // The full per-person working goes on landscape pages at the end, chunked
    // by column group so no column is cut and every page repeats its headers.
    // (Skipped on a personal pack — it's a single column.)
    const landscapePages = buildLandlordMatrixPages(packData);
    // avoidSplitSelector keeps table rows whole so no line is ever cut in half
    // by a page break.
    return generatePdfBlob(html, undefined, {
      hardPageBreaks: true, pageNumbers: true, avoidSplitSelector: 'tbody tr', landscapePages,
      onProgress: (stage, done, total) => onProgress?.(total > 1 ? `${stage} ${done + 1}/${total}` : `${stage}…`),
    });
  }, [selectedClient, dateFrom, dateTo, inRangeIncome, inRangeExpenses, adjustments, properties, entityType, useAllowance, broughtForwardLoss, notes, showComparison, priorComp, priorMeta, rentCompAll, personSettings]);

  // Approval sending lives in a hook, not the modal: with Email Triage on the
  // work outlives the modal (emails are handed to the compose window one at a
  // time and only count as sent once the user actually sends them).
  const approvalSend = useLandlordApprovalSend({
    outputId,
    clientId: selectedClient?.id ?? null,
    clientName: selectedClient?.name ?? '',
    clientRef: selectedClient?.client_ref ?? null,
    clientEmail,
    triageActive,
    buildPdf: buildPdfBlob,
    summaryFor,
    onChanged: () => setApprovalsRefresh(n => n + 1),
  });

  const handleDownloadPdf = useCallback(async () => {
    setPdfBusy(true);
    try {
      const blob = await buildPdfBlob(undefined, label => setPdfProgress(label));
      const stub = (selectedClient?.client_ref || selectedClient?.name || 'computation').replace(/\s+/g, '_');
      downloadBlob(blob, `property_income_${stub}.pdf`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not generate the PDF');
    } finally {
      setPdfBusy(false);
      setPdfProgress('');
    }
  }, [buildPdfBlob, selectedClient]);

  // Undo a force-include — send the row back to the out-of-range section.
  const handleExcludeRow = useCallback((id: string, type: 'income' | 'expense') => {
    if (type === 'income') {
      const newIncome = current.income.map(r => r._id === id ? { ...r, _forceInclude: false } : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const newExpenses = current.expenses.map(r => r._id === id ? { ...r, _forceInclude: false } : r);
      pushHistory(current.income, newExpenses);
    }
  }, [current, pushHistory]);

  const handleFlagRow = useCallback((id: string, type: 'income' | 'expense', reason: string) => {
    if (type === 'income') {
      const newIncome = current.income.map(r => r._id === id ? { ...r, _flagged: true, _flagReason: reason } : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const newExpenses = current.expenses.map(r => r._id === id ? { ...r, _flagged: true, _flagReason: reason } : r);
      pushHistory(current.income, newExpenses);
    }
    setEditItem(null);
  }, [current, pushHistory]);

  const handleUnflagRow = useCallback((id: string, type: 'income' | 'expense') => {
    if (type === 'income') {
      const newIncome = current.income.map(r => r._id === id ? { ...r, _flagged: false, _flagReason: undefined } : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const newExpenses = current.expenses.map(r => r._id === id ? { ...r, _flagged: false, _flagReason: undefined } : r);
      pushHistory(current.income, newExpenses);
    }
    setEditItem(null);
  }, [current, pushHistory]);

  // ─── Bulk handlers ──────────────────────────────────────────────────────────

  const handleBulkFlag = useCallback(() => {
    if (!bulkValue.trim()) return;
    if (view === 'income') {
      const newIncome = current.income.map(r => selectedIncome.has(r._id) ? { ...r, _flagged: true, _flagReason: bulkValue } : r);
      pushHistory(newIncome, current.expenses);
    } else if (view === 'expenses') {
      const newExpenses = current.expenses.map(r => selectedExpenses.has(r._id) ? { ...r, _flagged: true, _flagReason: bulkValue } : r);
      pushHistory(current.income, newExpenses);
    } else {
      // Flagged view — unflag selected
      const newIncome = current.income.map(r => selectedIncome.has(r._id) ? { ...r, _flagged: false, _flagReason: undefined } : r);
      const newExpenses = current.expenses.map(r => selectedExpenses.has(r._id) ? { ...r, _flagged: false, _flagReason: undefined } : r);
      pushHistory(newIncome, newExpenses);
    }
  }, [bulkValue, view, current, selectedIncome, selectedExpenses, pushHistory]);

  const handleBulkEdit = useCallback(() => {
    if (!bulkValue.trim()) return;
    const cat = bulkValue.trim();

    // Bulk category from the other group → move the selected entries across.
    if (bulkMode === 'edit-category' && view === 'expenses' && LANDLORD_INCOME_CATEGORIES.includes(cat)) {
      const moving = current.expenses.filter(r => selectedExpenses.has(r._id));
      pushHistory(
        [...current.income, ...moving.map(e => expenseToIncomeRow(e, cat, dateFrom, dateTo))],
        current.expenses.filter(r => !selectedExpenses.has(r._id)),
      );
      return;
    }
    if (bulkMode === 'edit-category' && view === 'income' && LANDLORD_EXPENSE_CATEGORIES.includes(cat)) {
      const moving = current.income.filter(r => selectedIncome.has(r._id));
      pushHistory(
        current.income.filter(r => !selectedIncome.has(r._id)),
        [...current.expenses, ...moving.map(i => incomeToExpenseRow(i, cat, dateFrom, dateTo))],
      );
      return;
    }

    if (view === 'income') {
      const newIncome = current.income.map(r => {
        if (!selectedIncome.has(r._id)) return r;
        if (bulkMode === 'edit-property') return { ...r, PropertyAddress: bulkValue };
        if (bulkMode === 'edit-category') return { ...r, Category: bulkValue };
        return r;
      });
      pushHistory(newIncome, current.expenses);
    } else if (view === 'expenses') {
      const newExpenses = current.expenses.map(r => {
        if (!selectedExpenses.has(r._id)) return r;
        if (bulkMode === 'edit-property') return { ...r, PropertyAddress: bulkValue };
        if (bulkMode === 'edit-category') return { ...r, Category: bulkValue };
        return r;
      });
      pushHistory(current.income, newExpenses);
    }
  }, [bulkValue, bulkMode, view, current, selectedIncome, selectedExpenses, pushHistory, dateFrom, dateTo]);

  const handleBulkUnflag = useCallback(() => {
    const unflagIds = new Set([...selectedIncome, ...selectedExpenses]);
    const newIncome = current.income.map(r => unflagIds.has(r._id) ? { ...r, _flagged: false, _flagReason: undefined } : r);
    const newExpenses = current.expenses.map(r => unflagIds.has(r._id) ? { ...r, _flagged: false, _flagReason: undefined } : r);
    pushHistory(newIncome, newExpenses);
  }, [selectedIncome, selectedExpenses, current, pushHistory]);

  // ─── Adjustment handlers ────────────────────────────────────────────────────

  const openAddAdjustment = () => {
    setAdjEditId(null);
    setAdjForm({ description: '', amount: '', type: 'expense', category: 'Other allowable property expenses', propertyAddress: '' });
  };

  const openEditAdjustment = (adj: LandlordAdjustment) => {
    setAdjEditId(adj._id);
    setAdjForm({ description: adj.description, amount: String(adj.amount), type: adj.type, category: adj.category || '', propertyAddress: adj.propertyAddress });
  };

  const saveAdjustment = () => {
    if (!adjForm || !adjForm.description.trim() || !adjForm.amount) return;
    const amt = parseFloat(adjForm.amount);
    if (isNaN(amt) || amt <= 0) return;
    if (adjEditId) {
      setAdjustments(prev => prev.map(a => a._id === adjEditId ? { ...a, description: adjForm.description.trim(), amount: amt, type: adjForm.type, category: adjForm.category, propertyAddress: adjForm.propertyAddress } : a));
    } else {
      setAdjustments(prev => [...prev, { _id: `adj_${Date.now()}`, description: adjForm.description.trim(), amount: amt, type: adjForm.type, category: adjForm.category, propertyAddress: adjForm.propertyAddress }]);
    }
    setAdjForm(null);
    setAdjEditId(null);
  };

  const deleteAdjustment = (id: string) => {
    setAdjustments(prev => prev.filter(a => a._id !== id));
  };

  // ─── Selection helpers ──────────────────────────────────────────────────────

  const visibleIncomeRows = view === 'income' ? inRangeIncome : [];
  const visibleExpenseRows = view === 'expenses' ? inRangeExpenses : [];
  const allIncomeSelected = visibleIncomeRows.length > 0 && visibleIncomeRows.every(r => selectedIncome.has(r._id));
  const allExpensesSelected = visibleExpenseRows.length > 0 && visibleExpenseRows.every(r => selectedExpenses.has(r._id));
  const someIncomeSelected = visibleIncomeRows.some(r => selectedIncome.has(r._id));
  const someExpensesSelected = visibleExpenseRows.some(r => selectedExpenses.has(r._id));
  const anySelected = someIncomeSelected || someExpensesSelected;

  const toggleIncomeRow = (id: string) => setSelectedIncome(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const toggleExpenseRow = (id: string) => setSelectedExpenses(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleAllIncome = () => {
    if (allIncomeSelected) setSelectedIncome(new Set());
    else setSelectedIncome(new Set(visibleIncomeRows.map(r => r._id)));
  };
  const toggleAllExpenses = () => {
    if (allExpensesSelected) setSelectedExpenses(new Set());
    else setSelectedExpenses(new Set(visibleExpenseRows.map(r => r._id)));
  };

  // ─── Edit item lookup ───────────────────────────────────────────────────────

  const editIncomeRow = editItem?.type === 'income' ? current.income.find(r => r._id === editItem.id) ?? null : null;
  const editExpenseRow = editItem?.type === 'expense' ? current.expenses.find(r => r._id === editItem.id) ?? null : null;

  // ─── Render helpers ─────────────────────────────────────────────────────────

  const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ─── Category lists ─────────────────────────────────────────────────────────

  const EXPENSE_CATEGORIES = LANDLORD_EXPENSE_CATEGORIES;
  const INCOME_CATEGORIES = LANDLORD_INCOME_CATEGORIES;

  // ─── allProperties — must be BEFORE early returns ──────────────────────────

  const allProperties = useMemo(() => {
    const addresses = new Set([
      ...inRangeIncome.map(r => normalizeAddress(r.PropertyAddress)),
      ...inRangeExpenses.map(r => normalizeAddress(r.PropertyAddress)),
    ]);
    const sorted = Array.from(addresses).filter(a => a !== 'Non Allocated');
    if (addresses.has('Non Allocated')) sorted.push('Non Allocated');
    return sorted;
  }, [inRangeIncome, inRangeExpenses]);

  // ─── Early returns ──────────────────────────────────────────────────────────

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = documentFiles.map(f => {
      const result = scanResults.find(r => r.fileName === f.name);
      if (result) return { name: f.name, status: result.status === 'success' ? 'complete' : 'error' };
      if (scanProgress?.fileName === f.name) return { name: f.name, status: 'processing' };
      return { name: f.name, status: 'pending' };
    });
    return (
      <ProcessingView
        progress={progress}
        fileCount={documentFiles.length}
        scanProgress={scanProgress}
        files={processingFiles}
        steps={['Reading documents', 'Identifying income', 'Identifying expenses', 'Detecting duplicates', 'Compiling report']}
      />
    );
  }
  if (appState === 'error') return (
    <ToolLayout title="Landlord Analysis" icon={House} iconColor="#D97706" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );
  if (appState === 'scan_results') return (
    <ToolLayout title="Landlord Analysis" icon={House} iconColor="#D97706" wide>
      <BackToHistory onBack={onBack} />
      <ScanResultsView results={scanResults} fileRefs={fileRefs.current} isRescanning={isRescanning} onRescan={handleRescan} onDismissAndContinue={handleDismissAndContinue} />
    </ToolLayout>
  );

  // ── Step 5 — client approval ──
  if (appState === 'approval') return (
    <ToolLayout title="Landlord Analysis" description="Send the computation to your client to approve." icon={House} iconColor="#D97706" wide>
      <BackToHistory onBack={onBack} />
      <div className="space-y-5">
        <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
          <WizardStepper steps={wizardSteps} current={wizardSteps.length} onStep={n => { if (n < wizardSteps.length) setAppState('success'); }} />
        </div>

        {approvalSend.busy && (
          <div className="glass-solid rounded-xl px-5 py-3.5 flex items-center gap-2.5">
            <Loader2 size={15} className="animate-spin text-[var(--accent)] shrink-0" />
            <p className="text-sm text-[var(--text-secondary)]">{approvalSend.progress || 'Working…'}</p>
          </div>
        )}
        {approvalSend.error && (
          <div className="glass-solid rounded-xl px-5 py-3.5 flex items-start gap-2.5 border border-red-200">
            <p className="text-sm text-red-700 flex-1">{approvalSend.error}</p>
            <button onClick={() => approvalSend.setError('')} aria-label="Dismiss" className="text-red-400 hover:text-red-600"><X size={15} /></button>
          </div>
        )}
        {!approvalSend.busy && approvalSend.result && approvalSend.result.skipped > 0 && (
          <div className="glass-solid rounded-xl px-5 py-3.5">
            <p className="text-sm text-[var(--text-secondary)]">
              Stopped after {approvalSend.result.sent} sent — {approvalSend.result.skipped} {approvalSend.result.skipped === 1 ? 'person was' : 'people were'} not emailed because the compose window was closed. Send again when you&rsquo;re ready.
            </p>
          </div>
        )}

        <LandlordApprovalPanel
          outputId={outputId}
          clientId={selectedClient?.id ?? null}
          clientName={selectedClient?.name ?? ''}
          clientRef={selectedClient?.client_ref ?? null}
          refreshKey={approvalsRefresh}
          onSend={openSendApproval}
        />

        {approvalPeople.length > 0 && (
          <PersonSettingsPanel
            people={approvalPeople}
            settings={personSettings}
            onChange={(key, patch) => setPersonSettings(s => ({ ...s, [key]: { ...(s[key] ?? DEFAULT_PERSON_SETTINGS), ...patch } }))}
            compFor={personComp}
          />
        )}

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button onClick={() => setAppState('success')} className="btn-secondary"><ArrowLeft size={14} /> Back to results</button>
        </div>
      </div>

      {outputId && (
        <LandlordSendApprovalModal
          open={sendApprovalOpen}
          clientName={selectedClient?.name ?? ''}
          clientRef={selectedClient?.client_ref ?? null}
          clientEmail={clientEmail}
          people={approvalPeople}
          triageActive={triageActive}
          onClose={() => setSendApprovalOpen(false)}
          onStart={(targets, note) => { setSendApprovalOpen(false); approvalSend.start(targets, note); }}
        />
      )}
    </ToolLayout>
  );

  // ── Step 2b — review the suggested (or grouped) properties + ownership ──
  if (appState === 'property_review') return (
    <ToolLayout title="Landlord Analysis" description="Review the properties found in your documents before we build the computation." icon={House} iconColor="#D97706" wide>
      <BackToHistory onBack={onBack} />
      <div className="space-y-5">
        <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
          <WizardStepper steps={wizardSteps} current={3} onStep={n => { if (n <= 2) setAppState('idle'); }} />
        </div>

        <div className="glass-solid rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Properties &amp; ownership</p>
            {propsLoading && <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />}
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-snug">
            {groupAll
              ? 'All income and expenses are combined into a single property. Set who owns it and their share — the per-person split uses these figures.'
              : 'These properties were detected in your documents and saved to this client. Edit an address, set the ownership %, link owners, or remove any you don’t want — then continue.'}
          </p>
          {selectedClient && (
            <LandlordPropertiesPanel
              clientId={selectedClient.id}
              primaryName={selectedClient.name}
              // Grouped mode: every row is on the combined property, so shares set
              // on the client's other properties would do nothing — show only the
              // one that's actually in play.
              properties={groupAll ? (groupProperty ? [groupProperty] : []) : properties}
              loading={propsLoading || (groupAll && groupPropBusy)}
              onRefetch={() => void refreshProperties()}
              allowAdd={!groupAll}
              emptyLabel={groupAll ? 'Setting up the combined property…' : undefined}
            />
          )}
          {groupAll && groupProperty && groupProperty.owners.length === 0 && (
            <p className="text-xs text-amber-600 flex items-center gap-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              No owners linked yet — the whole portfolio will sit with {selectedClient?.name ?? 'the client'} at {groupProperty.ownership_pct}%.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-[var(--text-muted)]">Properties are saved to this client, so next year&apos;s analysis picks them up automatically.</p>
          <button onClick={() => applyAndProceed(scanResults, dateFrom, dateTo)} className="btn-primary">
            Continue to results <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </ToolLayout>
  );

  // ─── Property group table (shared for income / expenses) ────────────────────

  function IncomePropertyGroups() {
    return (
      <div className="space-y-4">
        {Array.from(incomeByProperty.entries()).map(([property, rows]) => (
          <div key={property} className="glass-solid rounded-xl overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{property}</span>
              <span className="text-sm font-medium text-[var(--text-secondary)]">{fmt(rows.reduce((s, r) => s + r.Amount, 0))}</span>
            </div>
            <IncomeTable rows={rows} showSelect={false} onExclude={id => handleExcludeRow(id, 'income')} />
          </div>
        ))}
      </div>
    );
  }

  function ExpensePropertyGroups() {
    return (
      <div className="space-y-4">
        {Array.from(expensesByProperty.entries()).map(([property, rows]) => (
          <div key={property} className="glass-solid rounded-xl overflow-x-auto">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{property}</span>
              <span className="text-sm font-medium text-[var(--text-secondary)]">{fmt(rows.reduce((s, r) => s + r.Amount, 0))}</span>
            </div>
            <ExpenseTable rows={rows} showSelect={false} onExclude={id => handleExcludeRow(id, 'expense')} />
          </div>
        ))}
      </div>
    );
  }

  function IncomeTable({ rows, showSelect, onInclude, onExclude }: { rows: IncomeRow[]; showSelect: boolean; onInclude?: (id: string) => void; onExclude?: (id: string) => void }) {
    if (rows.length === 0) return <p className="text-center text-[var(--text-muted)] py-10 text-sm">No income transactions.</p>;
    return (
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border)]">
          <tr>
            {showSelect && (
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={allIncomeSelected} onChange={toggleAllIncome} className="rounded" />
              </th>
            )}
            {['Date','Property','Description','Category','Amount',''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map(r => (
            <tr key={r._id} className={`transition-colors group ${selectedIncome.has(r._id) ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--bg-nav-hover)]'}`}>
              {showSelect && (
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selectedIncome.has(r._id)} onChange={() => toggleIncomeRow(r._id)} className="rounded" />
                </td>
              )}
              <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtUKDate(r.Date)}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[180px] truncate">{r.PropertyAddress}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[160px] truncate">{r.Description}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[140px] truncate">{r.Category}</td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)] whitespace-nowrap">{fmt(r.Amount)}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {onInclude && (
                    <Tooltip label="Include in computation">
                      <button
                        onClick={() => onInclude(r._id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                      >
                        <Plus size={11} /> Include
                      </button>
                    </Tooltip>
                  )}
                  {onExclude && r._forceInclude && !r._inRange && (
                    <Tooltip label="Included from outside your date range — click to exclude">
                      <button
                        onClick={() => onExclude(r._id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                      >
                        Out of range <X size={11} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="Edit">
                    <button
                      onClick={() => setEditItem({ type: 'income', id: r._id })}
                      aria-label="Edit"
                      className={`transition-opacity p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)] ${onInclude ? '' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function ExpenseTable({ rows, showSelect, onInclude, onExclude }: { rows: ExpenseRow[]; showSelect: boolean; onInclude?: (id: string) => void; onExclude?: (id: string) => void }) {
    if (rows.length === 0) return <p className="text-center text-[var(--text-muted)] py-10 text-sm">No expense transactions.</p>;
    return (
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border)]">
          <tr>
            {showSelect && (
              <th className="px-4 py-3 w-8">
                <input type="checkbox" checked={allExpensesSelected} onChange={toggleAllExpenses} className="rounded" />
              </th>
            )}
            {['Date','Supplier','Description','Category','Amount','Property',''].map(h => (
              <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map(r => (
            <tr key={r._id} className={`transition-colors group ${selectedExpenses.has(r._id) ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--bg-nav-hover)]'}`}>
              {showSelect && (
                <td className="px-4 py-2.5">
                  <input type="checkbox" checked={selectedExpenses.has(r._id)} onChange={() => toggleExpenseRow(r._id)} className="rounded" />
                </td>
              )}
              <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtUKDate(r.DueDate)}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[140px] truncate">{r.Supplier}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[160px] truncate">{r.Description}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[140px] truncate">{r.Category}</td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)] whitespace-nowrap">{fmt(r.Amount)}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[140px] truncate">{r.PropertyAddress}</td>
              <td className="px-4 py-2.5 whitespace-nowrap text-right">
                <div className="flex items-center justify-end gap-1.5">
                  {onInclude && (
                    <Tooltip label="Include in computation">
                      <button
                        onClick={() => onInclude(r._id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                      >
                        <Plus size={11} /> Include
                      </button>
                    </Tooltip>
                  )}
                  {onExclude && r._forceInclude && !r._inRange && (
                    <Tooltip label="Included from outside your date range — click to exclude">
                      <button
                        onClick={() => onExclude(r._id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-amber-700 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                      >
                        Out of range <X size={11} />
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip label="Edit">
                    <button
                      onClick={() => setEditItem({ type: 'expense', id: r._id })}
                      aria-label="Edit"
                      className={`transition-opacity p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)] ${onInclude ? '' : 'opacity-0 group-hover:opacity-100'}`}
                    >
                      <Pencil size={13} />
                    </button>
                  </Tooltip>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ─── Rent Computation helpers ───────────────────────────────────────────────

  function RentCompSection({ income, expenses, adjList, opts, showLosses = false }: { income: IncomeRow[]; expenses: ExpenseRow[]; adjList: LandlordAdjustment[]; opts: RentComputationOpts; showLosses?: boolean }) {
    const fmtL = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const c = computeRentComputation(income, expenses, adjList, opts);
    const restricted = c.restricted;
    const incAdj = adjList.filter(a => a.type === 'income');
    // Expense category lines from documents (finance excluded when restricted);
    // adjustments are shown separately below to keep them visible.
    const docByCat = new Map<string, number>();
    for (const r of expenses) { if (r.CapitalExpense) continue; docByCat.set(r.Category, (docByCat.get(r.Category) ?? 0) + r.Amount); }
    const docCats = Array.from(docByCat.entries()).filter(([cat]) => !(restricted && cat === LANDLORD_FINANCE_COST_CATEGORY));
    const expAdj = adjList.filter(a => a.type === 'expense' && !(restricted && (a.category || '') === LANDLORD_FINANCE_COST_CATEGORY));
    const net = c.netProfit;
    const showLossSection = showLosses && (c.broughtForwardLoss > 0 || net < 0);

    return (
      <div className="space-y-0 text-sm">
        {/* Income */}
        <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-900/10 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Income</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between px-5 py-2.5">
            <span className="text-[var(--text-secondary)]">Total rents and other income from property</span>
            <span className="font-medium text-[var(--text-primary)]">{fmtL(c.incomeTotal)}</span>
          </div>
          {incAdj.map(a => (
            <div key={a._id} className="flex items-center justify-between px-5 py-2 bg-[var(--bg-nav-hover)]">
              <span className="text-[var(--text-secondary)] italic pl-4">{a.description} <span className="text-xs text-emerald-600">(adjustment)</span></span>
              <span className="font-medium text-emerald-600">+{fmtL(a.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-2.5 font-semibold">
            <span className="text-[var(--text-primary)]">Total Income</span>
            <span className="text-emerald-600">{fmtL(c.totalIncome)}</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="px-5 py-2.5 bg-red-50 dark:bg-red-900/10 border-b border-[var(--border)] border-t border-t-[var(--border)] mt-2">
          <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">{c.allowanceUsed ? 'Deduction' : 'Expenses'}</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {c.allowanceUsed ? (
            <div className="flex items-center justify-between px-5 py-2.5">
              <span className="text-[var(--text-secondary)]">Property income allowance (in place of expenses)</span>
              <span className="font-medium text-[var(--text-primary)]">{fmtL(c.allowanceDeduction)}</span>
            </div>
          ) : (
            <>
              {docCats.map(([cat, amt]) => (
                <div key={cat} className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-[var(--text-secondary)]">{cat}</span>
                  <span className="font-medium text-[var(--text-primary)]">{fmtL(amt)}</span>
                </div>
              ))}
              {docCats.length === 0 && expAdj.length === 0 && (
                <div className="px-5 py-2.5 text-[var(--text-muted)] italic">No expenses</div>
              )}
              {expAdj.map(a => (
                <div key={a._id} className="flex items-center justify-between px-5 py-2 bg-[var(--bg-nav-hover)]">
                  <span className="text-[var(--text-secondary)] italic pl-4">{a.description} <span className="text-xs text-red-500">(adjustment)</span></span>
                  <span className="font-medium text-red-500">+{fmtL(a.amount)}</span>
                </div>
              ))}
            </>
          )}
          <div className="flex items-center justify-between px-5 py-2.5 font-semibold">
            <span className="text-[var(--text-primary)]">Total {c.allowanceUsed ? 'Deduction' : 'Expenses'}</span>
            <span className="text-red-500">{fmtL(c.totalExpenses)}</span>
          </div>
        </div>

        {/* Net */}
        <div className={`flex items-center justify-between px-5 py-4 mt-2 border-t-2 ${net >= 0 ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/10' : 'border-red-400 bg-red-50 dark:bg-red-900/10'}`}>
          <span className="font-bold text-base text-[var(--text-primary)]">
            Net Rental {net >= 0 ? 'Profit' : 'Loss'}
          </span>
          <span className={`font-bold text-base ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {net < 0 && '('}{fmtL(Math.abs(net))}{net < 0 && ')'}
          </span>
        </div>

        {/* Losses brought/carried forward (portfolio level) */}
        {showLossSection && (
          <div className="mt-2 border-t border-[var(--border)]">
            <div className="divide-y divide-[var(--border)]">
              {c.broughtForwardLoss > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-[var(--text-secondary)]">Losses brought forward</span>
                  <span className="font-medium text-[var(--text-primary)]">{fmtL(c.broughtForwardLoss)}</span>
                </div>
              )}
              {c.lossOffset > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-[var(--text-secondary)]">Loss set against this year&apos;s profit</span>
                  <span className="font-medium text-red-500">−{fmtL(c.lossOffset)}</span>
                </div>
              )}
              {net >= 0 && (
                <div className="flex items-center justify-between px-5 py-2.5 font-semibold">
                  <span className="text-[var(--text-primary)]">Taxable profit after losses</span>
                  <span className="text-emerald-600">{fmtL(c.taxableProfit)}</span>
                </div>
              )}
              {c.lossCarriedForward > 0 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-[var(--text-secondary)]">Losses carried forward</span>
                  <span className="font-medium text-[var(--text-muted)]">{fmtL(c.lossCarriedForward)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Finance costs & basic-rate relief (individuals only) */}
        {restricted && !c.allowanceUsed && c.financeCosts > 0 && (
          <div className="mt-2 border-t border-[var(--border)]">
            <div className="px-5 py-2.5 bg-amber-50 dark:bg-amber-900/10 border-b border-[var(--border)]">
              <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Finance costs (not deducted above)</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              <div className="flex items-center justify-between px-5 py-2.5">
                <span className="text-[var(--text-secondary)]">Residential finance costs</span>
                <span className="font-medium text-[var(--text-primary)]">{fmtL(c.financeCosts)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-2.5">
                <span className="text-[var(--text-secondary)]">Basic-rate tax reduction (20%)</span>
                <span className="font-medium text-emerald-600">{fmtL(c.financeReducer)}</span>
              </div>
              {c.unrelievedFinanceCosts > 0.001 && (
                <div className="flex items-center justify-between px-5 py-2.5">
                  <span className="text-[var(--text-secondary)]">Unrelieved finance costs carried forward</span>
                  <span className="font-medium text-[var(--text-muted)]">{fmtL(c.unrelievedFinanceCosts)}</span>
                </div>
              )}
            </div>
            <p className="px-5 py-2.5 text-[11px] text-[var(--text-muted)] leading-snug">For individuals, residential finance costs aren&apos;t deducted from profit — they give a 20% tax reducer (capped at 20% of property profits). The final figure also depends on the client&apos;s total income, so treat this as an estimate.</p>
          </div>
        )}

        {/* Capital items — excluded from the deduction, kept for CGT */}
        {c.capitalExpenses > 0 && (
          <div className="mt-2 border-t border-[var(--border)]">
            <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-900/20 border-b border-[var(--border)]">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">Capital items (not deducted)</span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              <div className="flex items-center justify-between px-5 py-2.5">
                <span className="text-[var(--text-secondary)]">Capital expenditure / improvements</span>
                <span className="font-medium text-[var(--text-primary)]">{fmtL(c.capitalExpenses)}</span>
              </div>
            </div>
            <p className="px-5 py-2.5 text-[11px] text-[var(--text-muted)] leading-snug">Capital improvements aren&apos;t deducted from rental profit — they add to the property&apos;s base cost for CGT. Replacing domestic items (furniture, appliances) in a let is an allowable expense, so mark those as <em>not</em> capital to keep them in the deduction.</p>
          </div>
        )}
      </div>
    );
  }

  function ComparisonComputation({ cur, prior, curLabel, priorLabel }: { cur: RentComputation; prior: RentComputation; curLabel: string; priorLabel: string }) {
    const rows = buildComparisonRows(cur, prior);
    const fmtC = (n: number | null) => n === null ? '' : (n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n));
    const th = 'px-5 py-2.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide';
    return (
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
          <tr>
            <th className={`${th} text-left`}></th>
            <th className={`${th} text-right`}>{curLabel || 'This year'}</th>
            <th className={`${th} text-right`}>{priorLabel || 'Last year'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((r, i) => r.heading ? (
            <tr key={i}><td colSpan={3} className="px-5 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">{r.label}</td></tr>
          ) : (
            <tr key={i} className={r.rule ? 'border-t border-[var(--border)]' : ''}>
              <td className={`px-5 py-2 ${r.bold ? 'font-semibold text-[var(--text-primary)]' : r.muted ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>{r.label}</td>
              <td className={`px-5 py-2 text-right whitespace-nowrap ${r.bold ? 'font-semibold text-[var(--text-primary)]' : r.muted ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{fmtC(r.current)}</td>
              <td className="px-5 py-2 text-right whitespace-nowrap text-[var(--text-muted)]">{fmtC(r.prior)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ─── Rent Computation: by person ────────────────────────────────────────────

  function PropertiesManageBlock() {
    if (!selectedClient) {
      return <div className="glass-solid rounded-xl p-4 text-sm text-[var(--text-muted)]">Select a client to set up properties and owners for a per-person split.</div>;
    }
    const detectedNew = allProperties.filter(a => a !== 'Non Allocated' && !matchProperty(a, properties));
    return (
      <div className="glass-solid rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-[var(--accent)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Properties &amp; ownership</p>
          </div>
          {detectedNew.length > 0 && (
            <button onClick={() => void addDetectedProperties(detectedNew)} className="btn-secondary text-xs py-1.5">
              <Plus size={12} /> Add {detectedNew.length} detected {detectedNew.length === 1 ? 'property' : 'properties'}
            </button>
          )}
        </div>
        <LandlordPropertiesPanel
          clientId={selectedClient.id}
          primaryName={selectedClient.name}
          properties={properties}
          loading={propsLoading}
          onRefetch={() => void refreshProperties()}
        />
      </div>
    );
  }

  // Full working: every property split into its owners (with %), each income and
  // expense category shared out, then totalled per person.
  function PersonComputation() {
    const m = personMatrix;
    if (properties.length === 0) {
      return (
        <div className="glass-solid rounded-xl p-8 text-center">
          <Users size={22} className="mx-auto mb-2 text-[var(--text-muted)]" />
          <p className="text-sm text-[var(--text-muted)]">No properties with owners set up for this client yet.</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Add properties and their owners (with %) above to split income &amp; expenses per person.</p>
        </div>
      );
    }

    const cols = m.properties.flatMap(p => p.owners.map(o => ({ pid: p.id, owner: o })));
    const cell = (pid: string, key: string, cat: string) => matrixCell(m, pid, key, cat);
    const sumCats = (pid: string, key: string, cats: string[]) => cats.reduce((s, c) => s + cell(pid, key, c), 0);
    const personCat = (key: string, cat: string) => m.properties.reduce((s, p) => s + cell(p.id, key, cat), 0);
    const personCats = (key: string, cats: string[]) => cats.reduce((s, c) => s + personCat(key, c), 0);
    const money = (n: number) => Math.abs(n) < 0.005 ? '—' : (n < 0 ? `(${fmt(Math.abs(n))})` : fmt(n));

    const th = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] whitespace-nowrap';
    const td = 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap';
    const stickyL = 'sticky left-0 z-10 bg-[var(--bg-card-solid)] px-3 py-1.5 text-left';
    const totalSpan = 1 + cols.length + m.people.length;
    const hasUnattributed = m.unattributed.income > 0.001 || m.unattributed.expenses > 0.001;
    const canAddUnalloc = !!selectedClient && !findUnallocatedProperty(properties);

    if (cols.length === 0) {
      return (
        <div className="glass-solid rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">
          No allocated income or expenses to split yet — set an ownership % on the properties above.
        </div>
      );
    }

    const sectionRow = (label: string, tone: string) => (
      <tr className={tone}>
        <td colSpan={totalSpan} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">{label}</td>
      </tr>
    );

    const catRows = (cats: string[], prefix: string) => cats.map(cat => (
      <tr key={`${prefix}|${cat}`}>
        <td className={`${stickyL} text-[var(--text-secondary)]`}>{cat}</td>
        {cols.map(c => <td key={`${prefix}|${cat}|${c.pid}|${c.owner.key}`} className={`${td} text-[var(--text-primary)]`}>{money(cell(c.pid, c.owner.key, cat))}</td>)}
        {m.people.map((pp, i) => (
          <td key={`${prefix}|${cat}|t|${pp.key}`} className={`${td} font-medium text-[var(--text-primary)] ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>{money(personCat(pp.key, cat))}</td>
        ))}
      </tr>
    ));

    const totalRow = (label: string, cats: string[], cls: string) => (
      <tr className={cls}>
        <td className={`${stickyL} font-semibold text-[var(--text-primary)]`}>{label}</td>
        {cols.map(c => <td key={`tot|${label}|${c.pid}|${c.owner.key}`} className={`${td} font-semibold`}>{money(sumCats(c.pid, c.owner.key, cats))}</td>)}
        {m.people.map((pp, i) => (
          <td key={`tot|${label}|t|${pp.key}`} className={`${td} font-semibold ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>{money(personCats(pp.key, cats))}</td>
        ))}
      </tr>
    );

    return (
      <div className="glass-solid rounded-xl overflow-x-auto">
        <table className="text-sm min-w-full">
          <thead>
            <tr className="bg-[var(--bg-nav-hover)] border-b border-[var(--border)]">
              <th rowSpan={2} className={`${th} text-left sticky left-0 z-20 bg-[var(--bg-nav-hover)]`}>Category</th>
              {m.properties.map(p => (
                <th key={p.id} colSpan={p.owners.length} className={`${th} text-center border-l border-[var(--border)] max-w-[220px] truncate`}>{p.address}</th>
              ))}
              {m.people.length > 0 && (
                <th colSpan={m.people.length} className={`${th} text-center border-l-2 border-[var(--accent)]/40`}>Total</th>
              )}
            </tr>
            <tr className="bg-[var(--bg-nav-hover)] border-b border-[var(--border)]">
              {cols.map((c, i) => {
                const firstOfProp = i === 0 || cols[i - 1].pid !== c.pid;
                return (
                  <th key={`h|${c.pid}|${c.owner.key}`} className={`${th} text-right ${firstOfProp ? 'border-l border-[var(--border)]' : ''}`}>
                    <div className="normal-case text-[var(--text-secondary)]">{c.owner.name}</div>
                    <div className="text-[10px] font-normal text-[var(--text-muted)]">{c.owner.pct}%</div>
                  </th>
                );
              })}
              {m.people.map((pp, i) => (
                <th key={`h|t|${pp.key}`} className={`${th} text-right ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>
                  <div className="normal-case text-[var(--text-secondary)]">{pp.name}</div>
                  <div className="text-[10px] font-normal text-[var(--text-muted)]">{pp.clientId ? 'Client' : 'Named'}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {sectionRow('Income', 'bg-emerald-50/60 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400')}
            {m.incomeCats.length === 0 && (
              <tr><td colSpan={totalSpan} className="px-3 py-2 text-xs text-[var(--text-muted)] italic">No income</td></tr>
            )}
            {catRows(m.incomeCats, 'inc')}
            {totalRow('Total income', m.incomeCats, 'bg-[var(--bg-nav-hover)]/40')}

            {sectionRow('Expenses', 'bg-red-50/60 dark:bg-red-900/10 text-red-600 dark:text-red-400')}
            {m.expenseCats.length === 0 && (
              <tr><td colSpan={totalSpan} className="px-3 py-2 text-xs text-[var(--text-muted)] italic">No expenses</td></tr>
            )}
            {catRows(m.expenseCats, 'exp')}
            {totalRow('Total expenses', m.expenseCats, 'bg-[var(--bg-nav-hover)]/40')}

            <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-nav-hover)]/70">
              <td className={`${stickyL} font-bold text-[var(--text-primary)]`}>Net profit / (loss)</td>
              {cols.map(c => {
                const n = sumCats(c.pid, c.owner.key, m.incomeCats) - sumCats(c.pid, c.owner.key, m.expenseCats);
                return <td key={`net|${c.pid}|${c.owner.key}`} className={`${td} font-bold ${n < 0 ? 'text-red-500' : 'text-emerald-600'}`}>{money(n)}</td>;
              })}
              {m.people.map((pp, i) => {
                const n = personCats(pp.key, m.incomeCats) - personCats(pp.key, m.expenseCats);
                return <td key={`net|t|${pp.key}`} className={`${td} font-bold ${n < 0 ? 'text-red-500' : 'text-emerald-600'} ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>{money(n)}</td>;
              })}
            </tr>

            {/* Residential finance costs — not deducted for individuals; shown
                separately with the 20% reducer, mirroring the main computation. */}
            {m.hasRestrictedFinance && (() => {
              const colNet = (c: { pid: string; owner: { key: string } }) => sumCats(c.pid, c.owner.key, m.incomeCats) - sumCats(c.pid, c.owner.key, m.expenseCats);
              const colFin = (c: { pid: string; owner: { key: string } }) => cell(c.pid, c.owner.key, m.financeCat);
              const personNet = (key: string) => personCats(key, m.incomeCats) - personCats(key, m.expenseCats);
              const personFin = (key: string) => personCat(key, m.financeCat);
              return (
                <>
                  {sectionRow('Finance costs (not deducted above)', 'bg-amber-50/60 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400')}
                  <tr>
                    <td className={`${stickyL} text-[var(--text-secondary)]`}>Residential finance costs</td>
                    {cols.map(c => <td key={`fin|${c.pid}|${c.owner.key}`} className={`${td} text-[var(--text-primary)]`}>{money(colFin(c))}</td>)}
                    {m.people.map((pp, i) => <td key={`fin|t|${pp.key}`} className={`${td} font-medium text-[var(--text-primary)] ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>{money(personFin(pp.key))}</td>)}
                  </tr>
                  <tr>
                    <td className={`${stickyL} text-[var(--text-secondary)]`}>Basic-rate tax reduction (20%, estimate)</td>
                    {cols.map(c => <td key={`frd|${c.pid}|${c.owner.key}`} className={`${td} text-emerald-600`}>{money(financeReducerFor(colFin(c), colNet(c)))}</td>)}
                    {m.people.map((pp, i) => <td key={`frd|t|${pp.key}`} className={`${td} font-medium text-emerald-600 ${i === 0 ? 'border-l-2 border-[var(--accent)]/40' : ''}`}>{money(financeReducerFor(personFin(pp.key), personNet(pp.key)))}</td>)}
                  </tr>
                </>
              );
            })()}
          </tbody>
        </table>

        {m.hasRestrictedFinance && (
          <p className="px-3 py-2.5 text-[11px] text-[var(--text-muted)] leading-snug border-t border-[var(--border)] bg-amber-50/40 dark:bg-amber-900/5">
            For individuals, residential finance costs aren&apos;t deducted from profit — they give a 20% basic-rate tax reducer (capped at 20% of property profits), so they&apos;re excluded from Total expenses and Net profit above. The final figure also depends on each person&apos;s total income, so treat the reduction as an estimate. Commercial (non-residential) finance costs stay in expenses.
          </p>
        )}

        {hasUnattributed && (
          <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2 bg-amber-50/70 dark:bg-amber-900/10 border-t border-[var(--border)]">
            <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle size={12} className="shrink-0" />
              {fmt(m.unattributed.income)} income and {fmt(m.unattributed.expenses)} expenses aren&apos;t matched to a property, so they&apos;re not split.
            </span>
            {canAddUnalloc && (
              <button onClick={() => void addDetectedProperties([UNALLOCATED_LABEL])} className="btn-secondary text-xs py-1">
                <Plus size={11} /> Add &ldquo;{UNALLOCATED_LABEL}&rdquo; as a property
              </button>
            )}
          </div>
        )}
        <p className="px-3 py-3 text-[11px] text-[var(--text-muted)] border-t border-[var(--border)]">Each property&apos;s income and expenses are shared out by ownership %. Client-linked owners will feed the future self-assessment tool.</p>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  const allSupported = documentFiles.length > 0 && documentFiles.every(isSupportedDoc);
  const idleStep = selectedClient ? 2 : 1;

  // Rows affected by the include-out-of-range confirmation + a friendly range label.
  const includeRows: (IncomeRow | ExpenseRow)[] = includeConfirm
    ? (includeConfirm.type === 'income'
        ? current.income.filter(r => includeConfirm.ids.includes(r._id))
        : current.expenses.filter(r => includeConfirm.ids.includes(r._id)))
    : [];
  const includeRangeLabel = dateFrom && dateTo
    ? `${fmtUKDate(dateFrom)} to ${fmtUKDate(dateTo)}`
    : dateFrom ? `on or after ${fmtUKDate(dateFrom)}`
    : dateTo ? `on or before ${fmtUKDate(dateTo)}`
    : 'the selected range';

  const PastContextPill = () => (
    selectedClient && (autoCtxLoading || (autoCtxIncome.length + autoCtxExpenses.length > 0)) ? (
      <div className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs ${
        useAutoContext
          ? 'bg-[var(--accent-light)] border-[var(--accent)]/30 text-[var(--accent)]'
          : 'bg-[var(--bg-nav-hover)] border-[var(--border)] text-[var(--text-muted)]'
      }`}>
        <Sparkles size={13} className="shrink-0" />
        <div className="flex-1 leading-snug">
          {autoCtxLoading ? (
            <span>Looking for past analyses for this client…</span>
          ) : useAutoContext ? (
            <>
              Using <span className="font-semibold">{autoCtxIncome.length}</span> past income and
              {' '}<span className="font-semibold">{autoCtxExpenses.length}</span> past expense entries from
              {' '}<span className="font-semibold">{autoCtxAnalyses}</span> previous {autoCtxAnalyses === 1 ? 'analysis' : 'analyses'} to improve category, supplier and capital-vs-revenue accuracy.
            </>
          ) : (
            <>Past-analysis learning is off — accuracy may be lower.</>
          )}
        </div>
        <Tooltip label={useAutoContext ? 'Turn off learning from past analyses' : 'Turn learning back on'}>
          <button
            onClick={() => setUseAutoContext(v => !v)}
            aria-label="Toggle past-analysis learning"
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ${useAutoContext ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${useAutoContext ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </Tooltip>
      </div>
    ) : null
  );

  return (
    <ToolLayout title="Landlord Analysis" description="Analyse income and expense documents for a rental property portfolio." icon={House} iconColor="#D97706" wide>
      <BackToHistory onBack={onBack} />

      {/* ── Idle (steps 1 & 2) ── */}
      {appState === 'idle' && (
        <div className="space-y-5">
          {/* Stepper */}
          <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper steps={wizardSteps} current={idleStep} />
          </div>

          <PastContextPill />

          {/* Top row — Client · Upload · What we'll produce */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Client */}
            <div className="lg:col-span-3 relative z-30 glass-solid rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">1. Client</p>
              {selectedClient ? (
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                      <Building2 size={20} className="text-[var(--accent)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{selectedClient.name}</p>
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 flex-wrap">
                        {selectedClient.client_ref && <span className="font-mono">{selectedClient.client_ref}</span>}
                        {selectedClient.client_ref && selectedClient.vat_number && <span>·</span>}
                        {selectedClient.vat_number
                          ? <span className="text-emerald-600 font-medium">VAT Registered</span>
                          : <span>Not VAT registered</span>}
                      </p>
                    </div>
                  </div>
                  <button type="button" onClick={() => handleClientSelect(null)} className="btn-secondary text-xs py-1.5 px-3">Change client</button>
                </div>
              ) : (
                <ClientSelector value={selectedClient} onSelect={handleClientSelect} />
              )}

              <div className="space-y-3 pt-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]"><CalendarDays size={12} /> Date range <span className="text-[var(--text-muted)] font-normal">(optional)</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base w-full text-sm" />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base w-full text-sm" />
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ukTaxYearPresets().map(p => {
                    const active = dateFrom === p.from && dateTo === p.to;
                    return (
                      <button key={p.label} type="button" onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
                        className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${active ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'}`}>
                        {p.label}
                      </button>
                    );
                  })}
                  {(dateFrom || dateTo) && (
                    <button type="button" onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[11px] px-2 py-1 rounded-md text-[var(--text-muted)] hover:underline">Clear</button>
                  )}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-snug">Transactions outside this range are shown separately in the results.</p>
              </div>
            </div>

            {/* Upload */}
            <div className="lg:col-span-6 glass-solid rounded-xl p-5 space-y-4">
              <p className="text-sm font-semibold text-[var(--text-primary)]">2. Upload Documents</p>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] bg-white/[0.5] hover:border-[var(--accent)]'}`}
              >
                <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-3">
                  <UploadCloud size={22} className="text-[var(--accent)]" />
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Drag and drop your documents here</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Upload letting agent statements, invoices &amp; receipts (PDF, PNG, JPG, CSV, Excel)</p>
                <span className="btn-primary mt-4 inline-flex pointer-events-none">Browse files</span>
              </div>
              <input ref={fileInputRef} type="file" multiple accept="application/pdf,image/*,.csv,.tsv,.xls,.xlsx" className="hidden"
                onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />

              {documentFiles.length > 0 && (
                <div className="space-y-1.5">
                  {documentFiles.map((f, i) => {
                    const ok = isSupportedDoc(f);
                    return (
                      <div key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
                        <Receipt size={15} className={ok ? 'text-[var(--accent)] shrink-0' : 'text-[var(--text-muted)] shrink-0'} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.name}</p>
                          <p className="text-[10px] text-[var(--text-muted)] uppercase">{(f.type.split('/')[1] || f.name.split('.').pop() || 'file')} · {(f.size / 1048576).toFixed(1)} MB</p>
                        </div>
                        {ok
                          ? <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><Check size={12} className="text-white" /></span>
                          : <Tooltip label="Unsupported format"><span className="text-[10px] font-semibold text-amber-600">?</span></Tooltip>}
                        <button type="button" onClick={() => setDocumentFiles(prev => prev.filter((_, j) => j !== i))} aria-label="Remove file" className="text-[var(--text-muted)] hover:text-red-500 shrink-0">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:opacity-80 pt-1">
                    <UploadCloud size={13} /> Add another file
                  </button>
                </div>
              )}
            </div>

            {/* What we'll produce */}
            <div className="lg:col-span-3 glass-solid rounded-xl p-5">
              <p className="text-sm font-semibold text-[var(--text-primary)]">What we&apos;ll produce</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 mb-4">We&apos;ll analyse your documents and build a UK property income computation.</p>
              <div className="space-y-3">
                {LANDLORD_OUTPUTS.map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0"><Check size={12} className="text-white" /></span>
                    <span className="text-xs font-medium text-[var(--text-primary)] flex items-center gap-1.5"><Icon size={13} className="text-[var(--text-muted)]" /> {label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-[var(--border)] flex items-start gap-2.5">
                <ShieldCheck size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-[11px] text-[var(--text-muted)] leading-snug">Documents are sent over an encrypted connection and are never used to train AI models.</p>
              </div>
            </div>
          </div>

          {/* Properties & ownership */}
          <div className="glass-solid rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-[var(--accent)]" />
                <p className="text-sm font-semibold text-[var(--text-primary)]">Properties &amp; ownership</p>
                <span className="text-xs text-[var(--text-muted)]">(optional)</span>
              </div>
              {!groupAll && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setPropertyMode('suggest')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${propertyMode === 'suggest' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}
                  >Suggest from documents</button>
                  <button
                    onClick={() => setPropertyMode('preset')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${propertyMode === 'preset' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}
                  >Use my property list</button>
                </div>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer flex-wrap">
              <input type="checkbox" checked={groupAll} onChange={e => void handleGroupAllChange(e.target.checked)} className="rounded" />
              Group all properties into one
              <span className="text-xs text-[var(--text-muted)]">— combine income &amp; expenses across the portfolio and allocate ownership once</span>
            </label>

            {groupAll ? (
              <>
                <p className="text-xs text-[var(--text-muted)] leading-snug">
                  Everything will be analysed as a single &ldquo;{GROUP_LABEL}&rdquo; property rather than split by address.
                  {selectedClient
                    ? ' Link the owners and set their shares below — the per-person breakdown and the individual reports use these.'
                    : ' Select a client above to set who owns it and their shares.'}
                </p>
                {selectedClient && (
                  <LandlordPropertiesPanel
                    clientId={selectedClient.id}
                    primaryName={selectedClient.name}
                    properties={groupProperty ? [groupProperty] : []}
                    loading={propsLoading || groupPropBusy}
                    onRefetch={() => void refreshProperties()}
                    allowAdd={false}
                    emptyLabel={groupPropFailed
                      ? 'Couldn’t set the combined property up just now — it’ll be created after the scan, and you can set the shares at the Review Properties step.'
                      : 'Setting up the combined property…'}
                  />
                )}
              </>
            ) : propertyMode === 'suggest' ? (
              <p className="text-xs text-[var(--text-muted)] leading-snug">We&apos;ll detect properties from your documents. After the scan you can review them, set ownership %, and save them to this client so they&apos;re ready next time.</p>
            ) : !selectedClient ? (
              <p className="text-xs text-[var(--text-muted)] leading-snug">Select a client above to set up their property list.</p>
            ) : (
              <>
                <p className="text-xs text-[var(--text-muted)] leading-snug">Define this client&apos;s properties and who owns what share. After scanning, income &amp; expenses are allocated to these properties; anything we can&apos;t match is left unallocated for you to assign.</p>
                <LandlordPropertiesPanel
                  clientId={selectedClient.id}
                  primaryName={selectedClient.name}
                  properties={properties}
                  loading={propsLoading}
                  onRefetch={() => void refreshProperties()}
                />
              </>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5"><ShieldCheck size={13} /> Sent over an encrypted connection and never used to train AI models.</p>
            <button onClick={handleProcess} disabled={documentFiles.length === 0 || !allSupported} className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              <House size={15} /> Analyse Documents <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Success (step 3) — results unchanged, with stepper on top ── */}
      {appState === 'success' && (
        <div className="space-y-4">

          {/* Stepper */}
          <div className="glass-solid rounded-xl px-5 py-3.5 overflow-x-auto scrollbar-thin">
            <WizardStepper steps={wizardSteps} current={wizardSteps.length - 1} onStep={() => setAppState('idle')} />
          </div>

          {/* Summary strip — uses the restricted computation, so residential
              finance costs are excluded from expenses (individuals). */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Total Income</p>
              <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400">{fmt(kpi.totalIncome)}</p>
            </div>
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Total Expenses</p>
              <p className="text-base font-semibold text-red-500 dark:text-red-400">{fmt(kpi.totalExpenses)}</p>
            </div>
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Net {kpi.netProfit >= 0 ? 'Profit' : 'Loss'}</p>
              <p className={`text-base font-semibold ${kpi.netProfit >= 0 ? 'text-[var(--text-primary)]' : 'text-red-500 dark:text-red-400'}`}>{fmt(Math.abs(kpi.netProfit))}</p>
            </div>
          </div>
          {kpi.restricted && kpi.financeCosts > 0 && (
            <p className="-mt-1 text-[11px] text-[var(--text-muted)] leading-snug flex items-start gap-1.5">
              <Info size={12} className="shrink-0 mt-0.5 text-[var(--accent)]" />
              <span>
                Residential finance costs of <strong>{fmt(kpi.financeCosts)}</strong> aren&apos;t in expenses above — for individuals they&apos;re not deducted from profit but give a 20% basic-rate tax reducer (capped at 20% of property profits). Commercial (non-residential) finance costs stay in expenses. See the Rent Computation for the full treatment.
              </span>
            </p>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Tabs */}
            <div className="flex gap-2 flex-wrap">
              {([
                { id: 'properties', label: 'Properties',                            icon: <Home size={13} />,       active: 'bg-[var(--accent)] text-white' },
                { id: 'income',     label: `Income (${inRangeIncome.length})`,    icon: null,                   active: 'bg-[var(--accent)] text-white' },
                { id: 'expenses',   label: `Expenses (${inRangeExpenses.length})`, icon: null,                  active: 'bg-[var(--accent)] text-white' },
                { id: 'rent_comp',  label: 'Rent Computation',                     icon: <TrendingUp size={13} />, active: 'bg-purple-600 text-white' },
                { id: 'flagged',    label: `Flagged (${allFlagged.length})`,        icon: <AlertTriangle size={13} />, active: 'bg-amber-500 text-white' },
              ] as const).map(({ id, label, icon, active }) => (
                <button
                  key={id}
                  onClick={() => { setView(id); setBulkMode(null); setSelectedIncome(new Set()); setSelectedExpenses(new Set()); if (id !== 'rent_comp') setBreakdown(b => b === 'person' ? 'all' : b); }}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5
                    ${view === id ? active : 'btn-secondary'}`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Undo/Redo */}
              <Tooltip label="Undo"><button onClick={() => setHistoryIndex(i => i - 1)} disabled={!canUndo} aria-label="Undo" className="btn-secondary px-2 disabled:opacity-40"><Undo2 size={14} /></button></Tooltip>
              <Tooltip label="Redo"><button onClick={() => setHistoryIndex(i => i + 1)} disabled={!canRedo} aria-label="Redo" className="btn-secondary px-2 disabled:opacity-40"><Redo2 size={14} /></button></Tooltip>

              {/* Breakdown toggle */}
              {(view === 'income' || view === 'expenses' || view === 'rent_comp') && (
                <>
                  <Tooltip label="All properties">
                  <button
                    onClick={() => setBreakdown('all')}
                    aria-label="All properties"
                    className={`btn-secondary px-2 ${breakdown === 'all' ? 'ring-2 ring-[var(--accent)]' : ''}`}
                  >
                    <LayoutList size={14} />
                  </button>
                  </Tooltip>
                  <Tooltip label="By property">
                  <button
                    onClick={() => setBreakdown('property')}
                    aria-label="By property"
                    className={`btn-secondary px-2 ${breakdown === 'property' ? 'ring-2 ring-[var(--accent)]' : ''}`}
                  >
                    <LayoutGrid size={14} />
                  </button>
                  </Tooltip>
                  {view === 'rent_comp' && (
                    <Tooltip label="By person">
                    <button
                      onClick={() => setBreakdown('person')}
                      aria-label="By person"
                      className={`btn-secondary px-2 ${breakdown === 'person' ? 'ring-2 ring-[var(--accent)]' : ''}`}
                    >
                      <Users size={14} />
                    </button>
                    </Tooltip>
                  )}
                </>
              )}

              <Tooltip label="Download the PDF report only — nothing is saved">
                <button onClick={() => void handleDownloadPdf()} disabled={pdfBusy} className="btn-secondary disabled:opacity-50">
                  {pdfBusy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                  {pdfBusy ? (pdfProgress || 'Building…') : 'PDF'}
                </button>
              </Tooltip>
              <Tooltip label="Download the Excel workbook only — nothing is saved">
                <button onClick={handleDownloadExcel} className="btn-secondary">
                  <FileSpreadsheet size={14} />
                  Excel
                </button>
              </Tooltip>
              <Tooltip label="Save to history (and Drive) and download the workbook + PDF report">
                <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                  <Download size={14} />
                  Save & Export
                </button>
              </Tooltip>
              <Tooltip label={selectedClient ? 'Send the computation to the client to approve' : 'Select a client to send for approval'}>
                <button onClick={() => void goToApproval()} disabled={!selectedClient || savingForApproval} className="btn-secondary disabled:opacity-50">
                  {savingForApproval ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Client Approval
                </button>
              </Tooltip>
              <button onClick={() => {
                setDocumentFiles([]); setScanResults([]); setHistory([]); setHistoryIndex(-1);
                setAdjustments([]); setSelectedIncome(new Set()); setSelectedExpenses(new Set());
                setEntityType('individual'); setUseAllowance(false); setBroughtForwardLoss(''); setNotes('');
                setShowComparison(false); setPriorComp(null); setPriorMeta(null); setPriorState('idle');
                setView('income'); setAppState('idle');
              }} className="btn-secondary">New Analysis</button>
            </div>
          </div>

          {/* Bulk action toolbar */}
          {anySelected && view !== 'flagged' && (
            <div className="flex items-center gap-3 px-4 py-2.5 glass-solid rounded-xl border border-[var(--border)] flex-wrap">
              <span className="text-sm text-[var(--text-secondary)] font-medium shrink-0">
                {(view === 'income' ? selectedIncome.size : selectedExpenses.size)} selected
              </span>
              {bulkMode === null ? (
                <>
                  <button onClick={() => setBulkMode('edit-property')} className="btn-secondary text-xs py-1"><Pencil size={11} /> Set Property</button>
                  <button onClick={() => setBulkMode('edit-category')} className="btn-secondary text-xs py-1"><Pencil size={11} /> Set Category</button>
                  <button onClick={() => setBulkMode('flag')} className="btn-secondary text-xs py-1 text-amber-600"><Flag size={11} /> Flag Selected</button>
                </>
              ) : (
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="text"
                    value={bulkValue}
                    onChange={e => setBulkValue(e.target.value)}
                    list={bulkMode === 'edit-property' ? 'll-bulk-prop-options' : bulkMode === 'edit-category' ? 'll-bulk-cat-options' : undefined}
                    placeholder={bulkMode === 'flag' ? 'Flag reason…' : bulkMode === 'edit-property' ? 'Property address…' : 'Category…'}
                    className="input-base text-sm flex-1 min-w-0"
                  />
                  <datalist id="ll-bulk-prop-options">
                    {properties.map(p => <option key={p.id} value={p.address} />)}
                  </datalist>
                  {/* Both groups — picking one from the other group moves the
                      selected entries between income and expenses. */}
                  <datalist id="ll-bulk-cat-options">
                    {INCOME_CATEGORIES.map(c => <option key={c} value={c}>Income</option>)}
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>Expense</option>)}
                  </datalist>
                  <button
                    onClick={() => bulkMode === 'flag' ? handleBulkFlag() : handleBulkEdit()}
                    disabled={!bulkValue.trim()}
                    className="btn-primary text-xs py-1 disabled:opacity-50"
                  >
                    Apply
                  </button>
                  <button onClick={() => { setBulkMode(null); setBulkValue(''); }} className="btn-secondary text-xs py-1">Cancel</button>
                </div>
              )}
            </div>
          )}

          {/* Flagged view bulk toolbar */}
          {(selectedIncome.size > 0 || selectedExpenses.size > 0) && view === 'flagged' && (
            <div className="flex items-center gap-3 px-4 py-2.5 glass-solid rounded-xl border border-[var(--border)]">
              <span className="text-sm text-[var(--text-secondary)] font-medium">
                {selectedIncome.size + selectedExpenses.size} selected
              </span>
              <button onClick={handleBulkUnflag} className="btn-secondary text-xs py-1 text-emerald-600">
                <CheckCircle size={11} /> Mark as Valid
              </button>
            </div>
          )}

          {/* ── Properties view ── */}
          {view === 'properties' && (
            <div className="space-y-4">
              <div className="glass-solid rounded-xl p-4 flex items-start gap-2.5">
                <Info size={14} className="shrink-0 mt-0.5 text-[var(--accent)]" />
                <p className="text-xs text-[var(--text-secondary)] leading-snug">
                  Set each property&apos;s <strong>type</strong> (residential or commercial) and its <strong>owners and shares</strong>.
                  The type decides how finance costs are relieved — residential finance is restricted to a 20% tax reducer for individuals,
                  while commercial finance stays fully deductible. Owners and shares drive the per-person breakdown and the individual reports.
                </p>
              </div>
              <PropertiesManageBlock />
            </div>
          )}

          {/* ── Income view ── */}
          {view === 'income' && (
            <div className="space-y-4">
              {breakdown === 'all' ? (
                <div className="glass-solid rounded-xl overflow-x-auto">
                  <IncomeTable rows={inRangeIncome} showSelect onExclude={id => handleExcludeRow(id, 'income')} />
                  {inRangeIncome.length > 0 && (
                    <div className="flex justify-end px-4 py-2.5 border-t border-[var(--border)]">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">Total: {fmt(incomeTotal)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <IncomePropertyGroups />
              )}

              {/* Out-of-range */}
              {hasDateRange && outRangeIncome.length > 0 && (
                <div className="glass-solid rounded-xl overflow-hidden">
                  <div className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10">
                    <button onClick={() => setShowOutOfRange(v => !v)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <AlertTriangle size={14} /> {outRangeIncome.length} out-of-range income transaction{outRangeIncome.length !== 1 ? 's' : ''}
                      {showOutOfRange ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                    <button
                      onClick={() => setIncludeConfirm({ type: 'income', ids: outRangeIncome.map(r => r._id) })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-emerald-700 bg-emerald-100/70 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                    >
                      <Plus size={12} /> Include all
                    </button>
                  </div>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <IncomeTable rows={outRangeIncome} showSelect={false} onInclude={id => setIncludeConfirm({ type: 'income', ids: [id] })} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Expenses view ── */}
          {view === 'expenses' && (
            <div className="space-y-4">
              {breakdown === 'all' ? (
                <div className="glass-solid rounded-xl overflow-x-auto">
                  <ExpenseTable rows={inRangeExpenses} showSelect onExclude={id => handleExcludeRow(id, 'expense')} />
                  {inRangeExpenses.length > 0 && (
                    <div className="flex justify-end px-4 py-2.5 border-t border-[var(--border)]">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">Total: {fmt(expensesTotal)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <ExpensePropertyGroups />
              )}

              {/* Out-of-range */}
              {hasDateRange && outRangeExpenses.length > 0 && (
                <div className="glass-solid rounded-xl overflow-hidden">
                  <div className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10">
                    <button onClick={() => setShowOutOfRange(v => !v)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <AlertTriangle size={14} /> {outRangeExpenses.length} out-of-range expense{outRangeExpenses.length !== 1 ? 's' : ''}
                      {showOutOfRange ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </button>
                    <button
                      onClick={() => setIncludeConfirm({ type: 'expense', ids: outRangeExpenses.map(r => r._id) })}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold text-emerald-700 bg-emerald-100/70 dark:bg-emerald-900/30 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                    >
                      <Plus size={12} /> Include all
                    </button>
                  </div>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <ExpenseTable rows={outRangeExpenses} showSelect={false} onInclude={id => setIncludeConfirm({ type: 'expense', ids: [id] })} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Rent Computation view ── */}
          {view === 'rent_comp' && (
            <div className="space-y-4">
              {/* Computation options — entity type, £1,000 allowance, losses b/f */}
              <div className="glass-solid rounded-xl px-5 py-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-2">
                    <Calculator size={14} className="text-[var(--accent)]" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Treat as</span>
                    <span className="text-xs text-[var(--text-muted)]">affects how mortgage / finance interest is relieved</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEntityType('individual')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${entityType === 'individual' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Individual landlord</button>
                    <button onClick={() => setEntityType('company')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${entityType === 'company' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Limited company</button>
                  </div>
                </div>

                {entityType === 'individual' && (
                  <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-[var(--border)]">
                    <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={useAllowance} onChange={e => setUseAllowance(e.target.checked)} className="rounded" />
                      Use £{PROPERTY_INCOME_ALLOWANCE.toLocaleString('en-GB')} property income allowance <span className="text-[var(--text-muted)]">(instead of actual expenses)</span>
                    </label>
                    {!useAllowance && rentCompAll.allowanceWouldHelp && (
                      <span className="text-xs text-emerald-600 flex items-center gap-1"><Sparkles size={11} /> The allowance may beat your {fmt(rentCompAll.totalExpenses)} of expenses</span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-[var(--border)]">
                  <label className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
                    Losses brought forward
                    <span className="text-[var(--text-muted)]">£</span>
                    <input type="number" min="0" step="0.01" value={broughtForwardLoss} onChange={e => setBroughtForwardLoss(e.target.value)} placeholder="0.00" className="input-base text-sm w-32" />
                  </label>
                  <span className="text-xs text-[var(--text-muted)]">set against this year&apos;s property profit; any excess carries forward</span>
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3 pt-3 border-t border-[var(--border)]">
                  <label className={`flex items-center gap-2 text-sm ${priorState === 'found' ? 'text-[var(--text-secondary)] cursor-pointer' : 'text-[var(--text-muted)] cursor-default'}`}>
                    <input type="checkbox" checked={showComparison && priorState === 'found'} disabled={priorState !== 'found'} onChange={e => setShowComparison(e.target.checked)} className="rounded" />
                    Compare to last year
                  </label>
                  <span className="text-xs text-[var(--text-muted)]">
                    {priorState === 'loading' ? 'Looking for last year’s analysis…'
                      : priorState === 'found' ? `Using ${priorMeta?.periodLabel}`
                      : priorState === 'none' ? 'No prior-year analysis saved for this client'
                      : ''}
                  </span>
                </div>
              </div>

              {/* Adjustments panel */}
              <div className="glass-solid rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-purple-500" />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">Manual Adjustments</span>
                    <span className="text-xs text-[var(--text-muted)]">— add items like Travel, Use of Home, etc.</span>
                  </div>
                  <button onClick={openAddAdjustment} className="btn-secondary text-xs py-1 flex items-center gap-1">
                    <Plus size={12} /> Add Adjustment
                  </button>
                </div>

                {/* Add/Edit form */}
                {adjForm && (
                  <div className="px-5 py-4 border-b border-[var(--border)] bg-purple-50 dark:bg-purple-900/10">
                    <p className="text-xs font-semibold text-[var(--text-secondary)] mb-3">{adjEditId ? 'Edit Adjustment' : 'New Adjustment'}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
                        <input
                          type="text"
                          value={adjForm.description}
                          onChange={e => setAdjForm(f => f ? { ...f, description: e.target.value } : f)}
                          placeholder="e.g. Use of home as office"
                          className="input-base w-full text-sm"
                          autoFocus
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Amount (£)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={adjForm.amount}
                          onChange={e => setAdjForm(f => f ? { ...f, amount: e.target.value } : f)}
                          placeholder="0.00"
                          className="input-base w-full text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Type</label>
                        <div className="flex gap-2 h-[38px] items-center">
                          <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] cursor-pointer">
                            <input type="radio" checked={adjForm.type === 'income'} onChange={() => setAdjForm(f => f ? { ...f, type: 'income', category: INCOME_CATEGORIES[0] } : f)} className="accent-emerald-500" />
                            Income
                          </label>
                          <label className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] cursor-pointer">
                            <input type="radio" checked={adjForm.type === 'expense'} onChange={() => setAdjForm(f => f ? { ...f, type: 'expense', category: EXPENSE_CATEGORIES[4] } : f)} className="accent-red-500" />
                            Expense
                          </label>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Category</label>
                        <select
                          value={adjForm.category}
                          onChange={e => setAdjForm(f => f ? { ...f, category: e.target.value } : f)}
                          className="input-base text-sm w-full"
                        >
                          {(adjForm.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-[var(--text-muted)] mb-1">Property (leave blank for Non Allocated)</label>
                        <select
                          value={adjForm.propertyAddress}
                          onChange={e => setAdjForm(f => f ? { ...f, propertyAddress: e.target.value } : f)}
                          className="input-base text-sm w-full"
                        >
                          <option value="">Non Allocated</option>
                          {allProperties.filter(p => p !== 'Non Allocated').map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveAdjustment} disabled={!adjForm.description.trim() || !adjForm.amount} className="btn-primary text-xs py-1.5 disabled:opacity-50">
                        {adjEditId ? 'Save Changes' : 'Add'}
                      </button>
                      <button onClick={() => { setAdjForm(null); setAdjEditId(null); }} className="btn-secondary text-xs py-1.5">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Adjustments list */}
                {adjustments.length > 0 ? (
                  <div className="divide-y divide-[var(--border)]">
                    {adjustments.map(a => (
                      <div key={a._id} className="flex items-center justify-between px-5 py-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${a.type === 'income' ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'}`}>
                            {a.type === 'income' ? 'Income' : 'Expense'}
                          </span>
                          <div className="min-w-0">
                            <span className="text-sm text-[var(--text-primary)] block truncate">{a.description}</span>
                            <span className="text-xs text-[var(--text-muted)] truncate block">{a.category || '—'} · {a.propertyAddress || 'Non Allocated'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-medium text-[var(--text-primary)]">£{a.amount.toFixed(2)}</span>
                          <button onClick={() => openEditAdjustment(a)} className="p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"><Pencil size={13} /></button>
                          <button onClick={() => deleteAdjustment(a._id)} className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400"><Trash2 size={13} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  !adjForm && <p className="px-5 py-3 text-sm text-[var(--text-muted)] italic">No adjustments added. Use this for items like travel, use of home, or other manual entries.</p>
                )}
              </div>

              {/* Computation */}
              {breakdown === 'person' ? (
                <div className="space-y-4">
                  <div className="glass-solid rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                      <MapPin size={12} className="text-[var(--accent)]" /> Property types, owners and shares are set on the Properties tab.
                    </span>
                    <button onClick={() => setView('properties')} className="btn-secondary text-xs py-1">
                      <Home size={11} /> Edit properties
                    </button>
                  </div>
                  <PersonComputation />
                </div>
              ) : breakdown === 'all' ? (
                <div className="glass-solid rounded-xl overflow-hidden">
                  {showComparison && priorComp
                    ? <ComparisonComputation cur={rentCompAll} prior={priorComp} curLabel={priorMeta?.curLabel ?? ''} priorLabel={priorMeta?.priorLabel ?? ''} />
                    : <RentCompSection income={inRangeIncome} expenses={inRangeExpenses} adjList={adjustments} opts={{ entityType, useAllowance, broughtForwardLoss: parseFloat(broughtForwardLoss) || 0 }} showLosses />}
                </div>
              ) : (
                <div className="space-y-4">
                  {allProperties.map(prop => {
                    const propIncome = inRangeIncome.filter(r => normalizeAddress(r.PropertyAddress) === prop);
                    const propExpenses = inRangeExpenses.filter(r => normalizeAddress(r.PropertyAddress) === prop);
                    const propAdj = adjustments.filter(a => (a.propertyAddress || 'Non Allocated') === prop);
                    return (
                      <div key={prop} className="glass-solid rounded-xl overflow-hidden">
                        <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)] flex items-center justify-between">
                          <span className="text-sm font-semibold text-[var(--text-primary)]">{prop}</span>
                        </div>
                        <RentCompSection income={propIncome} expenses={propExpenses} adjList={propAdj} opts={{ entityType }} />
                      </div>
                    );
                  })}
                  {allProperties.length === 0 && (
                    <div className="glass-solid rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">No property data available.</div>
                  )}
                </div>
              )}

              {/* Working-paper notes */}
              <div className="glass-solid rounded-xl p-5">
                <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-2">
                  <Pencil size={13} className="text-[var(--text-muted)]" /> Notes
                  <span className="text-xs font-normal text-[var(--text-muted)]">saved with the analysis and added to the export</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. why a cost was treated as capital, basis of an apportionment, items to review next year…"
                  className="input-base w-full text-sm resize-y"
                />
              </div>
            </div>
          )}

          {/* ── Flagged view ── */}
          {view === 'flagged' && (
            <div className="space-y-3">
              {allFlagged.length === 0 && (
                <div className="glass-solid rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">No flagged entries.</div>
              )}
              {flaggedIncome.map(r => (
                <div key={r._id} className={`glass-solid rounded-xl border border-amber-200 dark:border-amber-900/30 p-4 flex items-start justify-between gap-4 ${selectedIncome.has(r._id) ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                  <div className="flex items-start gap-3 min-w-0">
                    <input type="checkbox" checked={selectedIncome.has(r._id)} onChange={() => toggleIncomeRow(r._id)} className="rounded mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">Income</span>
                        <span className="text-xs text-[var(--text-muted)]">{r.fileName}</span>
                        <span className="text-xs text-[var(--text-muted)]">{fmtUKDate(r.Date)}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.Description || r.PropertyAddress}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{r._flagReason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{fmt(r.Amount)}</span>
                    <Tooltip label="Mark as valid"><button onClick={() => handleUnflagRow(r._id, 'income')} aria-label="Mark as valid" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"><CheckCircle size={15} /></button></Tooltip>
                    <Tooltip label="Edit"><button onClick={() => setEditItem({ type: 'income', id: r._id })} aria-label="Edit" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] transition-colors"><Pencil size={15} /></button></Tooltip>
                  </div>
                </div>
              ))}
              {flaggedExpenses.map(r => (
                <div key={r._id} className={`glass-solid rounded-xl border border-amber-200 dark:border-amber-900/30 p-4 flex items-start justify-between gap-4 ${selectedExpenses.has(r._id) ? 'ring-2 ring-[var(--accent)]' : ''}`}>
                  <div className="flex items-start gap-3 min-w-0">
                    <input type="checkbox" checked={selectedExpenses.has(r._id)} onChange={() => toggleExpenseRow(r._id)} className="rounded mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded">Expense</span>
                        <span className="text-xs text-[var(--text-muted)]">{r.fileName}</span>
                        <span className="text-xs text-[var(--text-muted)]">{fmtUKDate(r.DueDate)}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.Description || r.Supplier}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{r._flagReason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{fmt(r.Amount)}</span>
                    <Tooltip label="Mark as valid"><button onClick={() => handleUnflagRow(r._id, 'expense')} aria-label="Mark as valid" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"><CheckCircle size={15} /></button></Tooltip>
                    <Tooltip label="Edit"><button onClick={() => setEditItem({ type: 'expense', id: r._id })} aria-label="Edit" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] transition-colors"><Pencil size={15} /></button></Tooltip>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Save modal */}
          <SaveLandlordModal
            isOpen={saveModalOpen}
            income={toExportIncome(current.income.filter(r => !r._flagged))}
            expenses={toExportExpense(current.expenses.filter(r => !r._flagged))}
            adjustments={adjustments}
            flaggedIncome={flaggedIncome.map(r => ({ date: r.Date, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName }))}
            flaggedExpenses={flaggedExpenses.map(r => ({ date: r.DueDate, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName }))}
            documentFiles={documentFiles}
            properties={properties}
            entityType={entityType}
            useAllowance={useAllowance}
            broughtForwardLoss={parseFloat(broughtForwardLoss) || 0}
            notes={notes}
            comparison={(showComparison && priorComp && priorMeta) ? { current: rentCompAll, prior: priorComp, curLabel: priorMeta.curLabel, priorLabel: priorMeta.priorLabel } : null}
            onExportPdf={handleDownloadPdf}
            onSaved={id => setOutputId(id)}
            primaryClientId={selectedClient?.id ?? null}
            primaryClientName={selectedClient?.name ?? ''}
            initialClient={selectedClient}
            initialClientName={selectedClient?.name ?? ''}
            initialClientCode={selectedClient?.client_ref ?? ''}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onClose={() => setSaveModalOpen(false)}
          />

          {/* Edit modal */}
          {editItem && (editIncomeRow || editExpenseRow) && (
            <LandlordEditModal
              rowType={editItem.type}
              item={(editIncomeRow ?? editExpenseRow)!}
              documentFiles={documentFiles}
              propertyOptions={properties.map(p => p.address)}
              onSave={handleSaveRow}
              onFlag={reason => handleFlagRow(editItem.id, editItem.type, reason)}
              onUnflag={() => handleUnflagRow(editItem.id, editItem.type)}
              onClose={() => setEditItem(null)}
            />
          )}

          {/* Include out-of-range confirmation lightbox */}
          {includeConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50" onClick={() => setIncludeConfirm(null)} />
              <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 border border-[var(--border)]">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                    <AlertTriangle size={18} className="text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {includeConfirm.ids.length === 1 ? 'Include this transaction?' : `Include ${includeConfirm.ids.length} transactions?`}
                    </h2>
                    <p className="text-sm text-[var(--text-muted)] mt-0.5">
                      {includeConfirm.ids.length === 1 ? 'This item is' : 'These items are'} dated outside your desired date range
                      {' '}(<span className="font-medium text-[var(--text-secondary)]">{includeRangeLabel}</span>).
                      {' '}Including {includeConfirm.ids.length === 1 ? 'it' : 'them'} will add {includeConfirm.ids.length === 1 ? 'it' : 'them'} to the computation and totals.
                    </p>
                  </div>
                </div>

                <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)] mb-5">
                  {includeRows.slice(0, 6).map(r => {
                    const date = includeConfirm.type === 'income' ? (r as IncomeRow).Date : (r as ExpenseRow).DueDate;
                    const label = includeConfirm.type === 'income'
                      ? ((r as IncomeRow).Description || (r as IncomeRow).PropertyAddress)
                      : ((r as ExpenseRow).Description || (r as ExpenseRow).Supplier);
                    return (
                      <div key={r._id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                        <span className="text-[var(--text-muted)] shrink-0 whitespace-nowrap">{fmtUKDate(date)}</span>
                        <span className="text-[var(--text-secondary)] truncate flex-1">{label || '—'}</span>
                        <span className="font-medium text-[var(--text-primary)] shrink-0">{fmt(r.Amount)}</span>
                      </div>
                    );
                  })}
                  {includeRows.length > 6 && (
                    <div className="px-3 py-2 text-xs text-[var(--text-muted)] italic">+{includeRows.length - 6} more</div>
                  )}
                </div>

                <div className="flex gap-3 justify-end">
                  <button onClick={() => setIncludeConfirm(null)} className="btn-secondary">Cancel</button>
                  <button
                    onClick={() => { handleIncludeRows(includeConfirm.ids, includeConfirm.type); setIncludeConfirm(null); }}
                    className="btn-primary"
                  >
                    <Plus size={14} /> Include in Computation
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </ToolLayout>
  );
}
