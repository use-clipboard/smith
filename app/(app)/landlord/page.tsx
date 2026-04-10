'use client';
import { useState, useRef, useCallback, useMemo } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import SaveLandlordModal from '@/components/features/landlord/SaveLandlordModal';
import LandlordEditModal from '@/components/features/landlord/LandlordEditModal';
import type { IncomeRow, ExpenseRow } from '@/components/features/landlord/LandlordEditModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import {
  House, Download, Undo2, Redo2, AlertTriangle, Pencil, Flag,
  CheckCircle, ChevronDown, ChevronUp, LayoutList, LayoutGrid,
  Plus, Trash2, TrendingUp,
} from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import type { LandlordIncomeTransaction, LandlordExpenseTransaction, FlaggedEntry, DocumentScanResult, LandlordAdjustment } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';
type LandlordView = 'income' | 'expenses' | 'rent_comp' | 'flagged';
type Breakdown = 'all' | 'property';
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

function buildIncomeRows(txs: LandlordIncomeTransaction[], dateFrom: string, dateTo: string): IncomeRow[] {
  return txs.map(t => ({
    ...t,
    _id: nextId(),
    _flagged: false,
    _flagReason: undefined,
    _inRange: isInRange(t.Date, dateFrom, dateTo),
  }));
}

function buildExpenseRows(txs: LandlordExpenseTransaction[], dateFrom: string, dateTo: string): ExpenseRow[] {
  return txs.map(t => ({
    ...t,
    _id: nextId(),
    _flagged: false,
    _flagReason: undefined,
    _inRange: isInRange(t.DueDate, dateFrom, dateTo),
  }));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandlordPage() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/landlord', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Pre-populate name/code when a client is selected from the selector
  const handleClientSelect = useCallback((c: SelectedClient | null) => {
    setSelectedClient(c);
    if (c) {
      if (c.name) setClientName(c.name);
      if (c.client_ref) setClientCode(c.client_ref);
    }
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

  // Selection state (by _id)
  const [selectedIncome, setSelectedIncome] = useState<Set<string>>(new Set());
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<'flag' | 'edit-category' | 'edit-property' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  // Edit modal
  const [editItem, setEditItem] = useState<{ type: 'income' | 'expense'; id: string } | null>(null);

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

  const inRangeIncome   = useMemo(() => current.income.filter(r => !r._flagged && r._inRange),   [current.income]);
  const outRangeIncome  = useMemo(() => current.income.filter(r => !r._flagged && !r._inRange),  [current.income]);
  const inRangeExpenses = useMemo(() => current.expenses.filter(r => !r._flagged && r._inRange), [current.expenses]);
  const outRangeExpenses= useMemo(() => current.expenses.filter(r => !r._flagged && !r._inRange),[current.expenses]);
  const flaggedIncome   = useMemo(() => current.income.filter(r => r._flagged),   [current.income]);
  const flaggedExpenses = useMemo(() => current.expenses.filter(r => r._flagged), [current.expenses]);
  const allFlagged      = useMemo(() => [...flaggedIncome, ...flaggedExpenses],    [flaggedIncome, flaggedExpenses]);

  const incomeTotal    = useMemo(() => inRangeIncome.reduce((s, r) => s + (r.Amount || 0), 0),   [inRangeIncome]);
  const expensesTotal  = useMemo(() => inRangeExpenses.reduce((s, r) => s + (r.Amount || 0), 0), [inRangeExpenses]);
  const netProfit      = incomeTotal - expensesTotal;

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

  // ─── Scan logic ─────────────────────────────────────────────────────────────

  const scanFiles = useCallback(async (
    filesToScan: File[],
    clientId: string | null,
    clientCode: string | null,
  ): Promise<DocumentScanResult[]> => {
    const docResults: DocumentScanResult[] = [];
    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });
      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/landlord', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ name: file.name, mimeType: file.type || 'application/pdf', base64 }], clientId, clientCode }),
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
  }, []);

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

    detectDuplicates(incomeRows, expenseRows);

    setScanProgress(null);
    setHistory([{ income: incomeRows, expenses: expenseRows }]);
    setHistoryIndex(0);
    setAppState('success');
  }, []);

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

    const resolvedClientCode = clientCode.trim() || selectedClient?.client_ref || null;
    const allResults = await scanFiles(documentFiles, selectedClient?.id ?? null, resolvedClientCode);
    if (progressRef.current) clearInterval(progressRef.current);
    setProgress(100);
    setScanProgress(null);

    if (documentFiles.length === 1) {
      if (allResults[0].status === 'failed') {
        setError(allResults[0].errorMessage || 'Processing failed. Please try again.');
        setAppState('error');
      } else {
        applyAndProceed(allResults, dateFrom, dateTo);
      }
      return;
    }
    setAppState('scan_results');
  }, [documentFiles, selectedClient, scanFiles, applyAndProceed, dateFrom, dateTo]);

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
    applyAndProceed(scanResults, dateFrom, dateTo);
  }, [scanResults, applyAndProceed, dateFrom, dateTo]);

  // ─── Row edit handlers ──────────────────────────────────────────────────────

  const handleSaveRow = useCallback((updated: IncomeRow | ExpenseRow) => {
    if (!editItem) return;
    if (editItem.type === 'income') {
      const newIncome = current.income.map(r => r._id === editItem.id ? updated as IncomeRow : r);
      pushHistory(newIncome, current.expenses);
    } else {
      const newExpenses = current.expenses.map(r => r._id === editItem.id ? updated as ExpenseRow : r);
      pushHistory(current.income, newExpenses);
    }
    setEditItem(null);
  }, [editItem, current, pushHistory]);

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
  }, [bulkValue, bulkMode, view, current, selectedIncome, selectedExpenses, pushHistory]);

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

  const EXPENSE_CATEGORIES = [
    'Allowable loan interest and other financial costs',
    'Car, van and other travel expenses',
    'Costs of services provided, including wages',
    'Legal, management and other professional fees',
    'Other allowable property expenses',
    'Property repairs and maintenance',
    'Rent, rates, insurance, ground rents',
  ];
  const INCOME_CATEGORIES = ['Total rents and other income from property'];

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
    <ToolLayout title="Landlord Analysis" icon={House} iconColor="#D97706">
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );
  if (appState === 'scan_results') return (
    <ToolLayout title="Landlord Analysis" icon={House} iconColor="#D97706">
      <ScanResultsView results={scanResults} fileRefs={fileRefs.current} isRescanning={isRescanning} onRescan={handleRescan} onDismissAndContinue={handleDismissAndContinue} />
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
            <IncomeTable rows={rows} showSelect={false} />
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
            <ExpenseTable rows={rows} showSelect={false} />
          </div>
        ))}
      </div>
    );
  }

  function IncomeTable({ rows, showSelect }: { rows: IncomeRow[]; showSelect: boolean }) {
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
              <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.Date}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[180px] truncate">{r.PropertyAddress}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[160px] truncate">{r.Description}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[140px] truncate">{r.Category}</td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)] whitespace-nowrap">{fmt(r.Amount)}</td>
              <td className="px-4 py-2.5 w-8">
                <button
                  onClick={() => setEditItem({ type: 'income', id: r._id })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)]"
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function ExpenseTable({ rows, showSelect }: { rows: ExpenseRow[]; showSelect: boolean }) {
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
              <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.DueDate}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[140px] truncate">{r.Supplier}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[160px] truncate">{r.Description}</td>
              <td className="px-4 py-2.5 text-[var(--text-muted)] max-w-[140px] truncate">{r.Category}</td>
              <td className="px-4 py-2.5 text-right font-medium text-[var(--text-primary)] whitespace-nowrap">{fmt(r.Amount)}</td>
              <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[140px] truncate">{r.PropertyAddress}</td>
              <td className="px-4 py-2.5 w-8">
                <button
                  onClick={() => setEditItem({ type: 'expense', id: r._id })}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--border)] text-[var(--text-muted)]"
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // ─── Rent Computation helpers ───────────────────────────────────────────────

  function RentCompSection({ income, expenses, adjList }: { income: IncomeRow[]; expenses: ExpenseRow[]; adjList: LandlordAdjustment[] }) {
    const fmtL = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const incomeTotal = income.reduce((s, r) => s + r.Amount, 0);
    const incAdj = adjList.filter(a => a.type === 'income');
    const expAdj = adjList.filter(a => a.type === 'expense');
    const totalIncome = incomeTotal + incAdj.reduce((s, a) => s + a.amount, 0);
    const byCat = new Map<string, number>();
    for (const r of expenses) byCat.set(r.Category, (byCat.get(r.Category) ?? 0) + r.Amount);
    const totalExpenses = expenses.reduce((s, r) => s + r.Amount, 0) + expAdj.reduce((s, a) => s + a.amount, 0);
    const net = totalIncome - totalExpenses;

    return (
      <div className="space-y-0 text-sm">
        {/* Income */}
        <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-900/10 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Income</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          <div className="flex items-center justify-between px-5 py-2.5">
            <span className="text-[var(--text-secondary)]">Total rents and other income from property</span>
            <span className="font-medium text-[var(--text-primary)]">{fmtL(incomeTotal)}</span>
          </div>
          {incAdj.map(a => (
            <div key={a._id} className="flex items-center justify-between px-5 py-2 bg-[var(--bg-nav-hover)]">
              <span className="text-[var(--text-secondary)] italic pl-4">{a.description} <span className="text-xs text-emerald-600">(adjustment)</span></span>
              <span className="font-medium text-emerald-600">+{fmtL(a.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-2.5 font-semibold">
            <span className="text-[var(--text-primary)]">Total Income</span>
            <span className="text-emerald-600">{fmtL(totalIncome)}</span>
          </div>
        </div>

        {/* Expenses */}
        <div className="px-5 py-2.5 bg-red-50 dark:bg-red-900/10 border-b border-[var(--border)] border-t border-t-[var(--border)] mt-2">
          <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">Expenses</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {Array.from(byCat.entries()).map(([cat, amt]) => (
            <div key={cat} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-[var(--text-secondary)]">{cat}</span>
              <span className="font-medium text-[var(--text-primary)]">{fmtL(amt)}</span>
            </div>
          ))}
          {expenses.length === 0 && (
            <div className="px-5 py-2.5 text-[var(--text-muted)] italic">No expenses</div>
          )}
          {expAdj.map(a => (
            <div key={a._id} className="flex items-center justify-between px-5 py-2 bg-[var(--bg-nav-hover)]">
              <span className="text-[var(--text-secondary)] italic pl-4">{a.description} <span className="text-xs text-red-500">(adjustment)</span></span>
              <span className="font-medium text-red-500">+{fmtL(a.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-2.5 font-semibold">
            <span className="text-[var(--text-primary)]">Total Expenses</span>
            <span className="text-red-500">{fmtL(totalExpenses)}</span>
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
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────────

  return (
    <ToolLayout title="Landlord Analysis" description="Analyse income and expense documents for a rental property portfolio." icon={House} iconColor="#D97706">

      {/* ── Idle ── */}
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-solid rounded-xl p-5 space-y-4">
              {/* Client */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Client</p>
                <div className="flex items-center gap-2 mb-3">
                  <ClientSelector value={selectedClient} onSelect={handleClientSelect} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Name</label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={e => setClientName(e.target.value)}
                      placeholder="e.g. John Smith"
                      className="input-base w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">Client Code</label>
                    <input
                      type="text"
                      value={clientCode}
                      onChange={e => setClientCode(e.target.value.toUpperCase())}
                      placeholder="e.g. JS001"
                      className="input-base w-full text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
              {/* Date range */}
              <div>
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Date Range (optional)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-base w-full" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-secondary)] mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input-base w-full" />
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] mt-1.5">Transactions outside this range will be shown separately.</p>
              </div>
            </div>
            <FileUpload title="Landlord Documents" onFilesChange={setDocumentFiles} multiple accept="application/pdf,image/*" helpText="Upload letting agent statements, invoices, and receipts." existingFiles={documentFiles} />
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={documentFiles.length === 0} className="btn-primary">
              <House size={15} />
              Analyse Documents
            </button>
          </div>
        </div>
      )}

      {/* ── Success ── */}
      {appState === 'success' && (
        <div className="space-y-4">

          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-3">
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Total Income</p>
              <p className="text-base font-semibold text-emerald-600 dark:text-emerald-400">{fmt(incomeTotal)}</p>
            </div>
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Total Expenses</p>
              <p className="text-base font-semibold text-red-500 dark:text-red-400">{fmt(expensesTotal)}</p>
            </div>
            <div className="glass-solid rounded-xl px-4 py-3">
              <p className="text-xs text-[var(--text-muted)] mb-0.5">Net {netProfit >= 0 ? 'Profit' : 'Loss'}</p>
              <p className={`text-base font-semibold ${netProfit >= 0 ? 'text-[var(--text-primary)]' : 'text-red-500 dark:text-red-400'}`}>{fmt(Math.abs(netProfit))}</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* Tabs */}
            <div className="flex gap-2 flex-wrap">
              {([
                { id: 'income',     label: `Income (${inRangeIncome.length})`,    icon: null,                   active: 'bg-[var(--accent)] text-white' },
                { id: 'expenses',   label: `Expenses (${inRangeExpenses.length})`, icon: null,                  active: 'bg-[var(--accent)] text-white' },
                { id: 'rent_comp',  label: 'Rent Computation',                     icon: <TrendingUp size={13} />, active: 'bg-purple-600 text-white' },
                { id: 'flagged',    label: `Flagged (${allFlagged.length})`,        icon: <AlertTriangle size={13} />, active: 'bg-amber-500 text-white' },
              ] as const).map(({ id, label, icon, active }) => (
                <button
                  key={id}
                  onClick={() => { setView(id); setBulkMode(null); setSelectedIncome(new Set()); setSelectedExpenses(new Set()); }}
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
              <button onClick={() => setHistoryIndex(i => i - 1)} disabled={!canUndo} title="Undo" className="btn-secondary px-2 disabled:opacity-40"><Undo2 size={14} /></button>
              <button onClick={() => setHistoryIndex(i => i + 1)} disabled={!canRedo} title="Redo" className="btn-secondary px-2 disabled:opacity-40"><Redo2 size={14} /></button>

              {/* Breakdown toggle */}
              {(view === 'income' || view === 'expenses' || view === 'rent_comp') && (
                <>
                  <button
                    onClick={() => setBreakdown('all')}
                    title="All properties"
                    className={`btn-secondary px-2 ${breakdown === 'all' ? 'ring-2 ring-[var(--accent)]' : ''}`}
                  >
                    <LayoutList size={14} />
                  </button>
                  <button
                    onClick={() => setBreakdown('property')}
                    title="By property"
                    className={`btn-secondary px-2 ${breakdown === 'property' ? 'ring-2 ring-[var(--accent)]' : ''}`}
                  >
                    <LayoutGrid size={14} />
                  </button>
                </>
              )}

              <button onClick={() => setSaveModalOpen(true)} className="btn-primary">
                <Download size={14} />
                Save & Export
              </button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Analysis</button>
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
                    placeholder={bulkMode === 'flag' ? 'Flag reason…' : bulkMode === 'edit-property' ? 'Property address…' : 'Category…'}
                    className="input-base text-sm flex-1 min-w-0"
                  />
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

          {/* ── Income view ── */}
          {view === 'income' && (
            <div className="space-y-4">
              {breakdown === 'all' ? (
                <div className="glass-solid rounded-xl overflow-x-auto">
                  <IncomeTable rows={inRangeIncome} showSelect />
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
                  <button
                    onClick={() => setShowOutOfRange(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-2"><AlertTriangle size={14} /> {outRangeIncome.length} out-of-range income transaction{outRangeIncome.length !== 1 ? 's' : ''}</span>
                    {showOutOfRange ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <IncomeTable rows={outRangeIncome} showSelect={false} />
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
                  <ExpenseTable rows={inRangeExpenses} showSelect />
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
                  <button
                    onClick={() => setShowOutOfRange(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-2"><AlertTriangle size={14} /> {outRangeExpenses.length} out-of-range expense{outRangeExpenses.length !== 1 ? 's' : ''}</span>
                    {showOutOfRange ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <ExpenseTable rows={outRangeExpenses} showSelect={false} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Rent Computation view ── */}
          {view === 'rent_comp' && (
            <div className="space-y-4">
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
              {breakdown === 'all' ? (
                <div className="glass-solid rounded-xl overflow-hidden">
                  <RentCompSection income={inRangeIncome} expenses={inRangeExpenses} adjList={adjustments} />
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
                        <RentCompSection income={propIncome} expenses={propExpenses} adjList={propAdj} />
                      </div>
                    );
                  })}
                  {allProperties.length === 0 && (
                    <div className="glass-solid rounded-xl p-8 text-center text-sm text-[var(--text-muted)]">No property data available.</div>
                  )}
                </div>
              )}
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
                        <span className="text-xs text-[var(--text-muted)]">{r.Date}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.Description || r.PropertyAddress}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{r._flagReason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{fmt(r.Amount)}</span>
                    <button onClick={() => handleUnflagRow(r._id, 'income')} title="Mark as valid" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"><CheckCircle size={15} /></button>
                    <button onClick={() => setEditItem({ type: 'income', id: r._id })} title="Edit" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] transition-colors"><Pencil size={15} /></button>
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
                        <span className="text-xs text-[var(--text-muted)]">{r.DueDate}</span>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">{r.Description || r.Supplier}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{r._flagReason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-[var(--text-primary)]">{fmt(r.Amount)}</span>
                    <button onClick={() => handleUnflagRow(r._id, 'expense')} title="Mark as valid" className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"><CheckCircle size={15} /></button>
                    <button onClick={() => setEditItem({ type: 'expense', id: r._id })} title="Edit" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] transition-colors"><Pencil size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Save modal */}
          <SaveLandlordModal
            isOpen={saveModalOpen}
            income={current.income.filter(r => !r._flagged).map(({ _id: _, _flagged: _f, _flagReason: _fr, _inRange: _ir, ...rest }) => rest)}
            expenses={current.expenses.filter(r => !r._flagged).map(({ _id: _, _flagged: _f, _flagReason: _fr, _inRange: _ir, ...rest }) => rest)}
            adjustments={adjustments}
            flaggedIncome={flaggedIncome.map(r => ({ date: r.Date, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName }))}
            flaggedExpenses={flaggedExpenses.map(r => ({ date: r.DueDate, description: r.Description, amount: r.Amount, reason: r._flagReason ?? '', fileName: r.fileName }))}
            documentFiles={documentFiles}
            initialClient={selectedClient}
            initialClientName={clientName}
            initialClientCode={clientCode}
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
              onSave={handleSaveRow}
              onFlag={reason => handleFlagRow(editItem.id, editItem.type, reason)}
              onUnflag={() => handleUnflagRow(editItem.id, editItem.type)}
              onClose={() => setEditItem(null)}
            />
          )}
        </div>
      )}
    </ToolLayout>
  );
}
