'use client';
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { consumePendingClient } from '@/lib/pendingClient';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import ScanResultsView from '@/components/ui/ScanResultsView';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import TransactionEditModal from '@/components/features/full-analysis/TransactionEditModal';
import SaveAnalysisModal from '@/components/features/full-analysis/SaveAnalysisModal';
import { FileSearch, Download, Undo2, Redo2, AlertTriangle, Pencil, ChevronUp, ChevronDown, ChevronsUpDown, CheckCheck, ChevronRight } from 'lucide-react';
import type { Transaction, FlaggedEntry, TargetSoftware, LedgerAccount, VTTransaction, CapiumTransaction, XeroTransaction, QuickBooksTransaction, FreeAgentTransaction, SageTransaction, GeneralTransaction, DocumentScanResult } from '@/types';
import { fileToBase64, readFileAsText, parseLedgerCsv, findBestMatch } from '@/utils/fileUtils';

type AppState = 'idle' | 'loading' | 'scan_results' | 'success' | 'error';
type View = 'valid' | 'flagged';
type EditTarget = { type: 'valid'; index: number } | { type: 'flagged'; index: number };
type SortState = { key: string; dir: 'asc' | 'desc' };

const TOLERANCE = 0.01;

function buildMinimalTx(entry: FlaggedEntry, software: TargetSoftware): Transaction {
  if (entry.transactionData) return entry.transactionData;
  const base = { fileName: entry.fileName, pageNumber: entry.pageNumber ?? 1 };
  if (software === 'vt') return { ...base, type: 'PIN', refNo: '', date: entry.date ?? '', primaryAccount: '', details: entry.description ?? '', total: entry.amount ?? 0, vat: 0, analysis: entry.amount ?? 0, analysisAccount: '', entryDetails: '', transactionNotes: '' } as VTTransaction;
  if (software === 'capium') return { ...base, contactname: entry.supplier ?? '', contacttype: 'Supplier', reference: '', description: entry.description ?? '', accountname: '', accountcode: '', invoicedate: entry.date ?? '', vatname: 'No VAT', vatamount: 0, isvatincluded: 'false', amount: entry.amount ?? 0, netAmount: entry.amount ?? 0 } as CapiumTransaction;
  if (software === 'xero') return { ...base, contactName: entry.supplier ?? '', invoiceNumber: '', invoiceDate: entry.date ?? '', dueDate: entry.date ?? '', description: entry.description ?? '', quantity: 1, unitAmount: entry.amount ?? 0, grossAmount: entry.amount ?? 0, accountCode: '', accountName: '', taxType: 'No VAT' } as XeroTransaction;
  if (software === 'quickbooks') return { ...base, invoiceNo: '', supplier: entry.supplier ?? '', invoiceDate: entry.date ?? '', dueDate: entry.date ?? '', description: entry.description ?? '', quantity: 1, unitAmount: entry.amount ?? 0, vatAmount: 0, grossAmount: entry.amount ?? 0, taxCode: 'No VAT', accountCode: '', accountName: '' } as QuickBooksTransaction;
  if (software === 'freeagent') return { ...base, date: entry.date ?? '', amount: entry.amount ?? 0, description: entry.description ?? '' } as FreeAgentTransaction;
  if (software === 'sage') return { ...base, TYPE: 'PI', ACCOUNT_REF: entry.supplier ?? '', NOMINAL_CODE: '', DATE: entry.date ?? '', REFERENCE: '', DETAILS: entry.description ?? '', NET_AMOUNT: entry.amount ?? 0, TAX_CODE: 'T9', TAX_AMOUNT: 0, EXCHANGE_RATE: 1 } as SageTransaction;
  return { ...base, date: entry.date ?? '', supplier: entry.supplier ?? '', invoiceNumber: '', description: entry.description ?? '', netAmount: entry.amount ?? 0, vatAmount: 0, grossAmount: entry.amount ?? 0, currency: 'GBP', documentType: 'Purchase', category: '', notes: '' } as GeneralTransaction;
}

export default function FullAnalysisPage() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/full-analysis', appState);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState(0);

  // Batch scan state
  const [scanResults, setScanResults] = useState<DocumentScanResult[]>([]);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [fileRefs, setFileRefs] = useState<Map<string, File>>(new Map());
  const [isRescanning, setIsRescanning] = useState(false);
  // Shared inputs cached between scan and re-scan
  const sharedInputsRef = useRef<{ pastTransactionsContent: string | null; ledgersContent: string | null; parsedLedgerAccounts: LedgerAccount[] } | null>(null);

  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [clientName, setClientName] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [targetSoftware, setTargetSoftware] = useState<TargetSoftware>('general');

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/full-analysis');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/full-analysis') return;
      const p = consumePendingClient('/full-analysis');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  // Pre-populate fields when a client is selected
  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setClientName(selectedClient.name);
    if (selectedClient.vat_number) setIsVatRegistered(true);
  }, [selectedClient]);
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const [pastTransactionsFile, setPastTransactionsFile] = useState<File | null>(null);
  const [ledgersFile, setLedgersFile] = useState<File | null>(null);

  const [transactionHistory, setTransactionHistory] = useState<Transaction[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [flaggedEntries, setFlaggedEntries] = useState<FlaggedEntry[]>([]);
  const [ledgerAccounts, setLedgerAccounts] = useState<LedgerAccount[]>([]);
  const [currentView, setCurrentView] = useState<View>('valid');
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  // ─── Date range ──────────────────────────────────────────────────────────────
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showOutOfRange, setShowOutOfRange] = useState(false);

  // ─── Sort & selection state ───────────────────────────────────────────────
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedValid, setSelectedValid] = useState<Set<number>>(new Set());
  const [selectedFlagged, setSelectedFlagged] = useState<Set<number>>(new Set());
  const [bulkMode, setBulkMode] = useState<'account' | 'flag' | null>(null);
  const [bulkValue, setBulkValue] = useState('');

  const processedTransactions = transactionHistory[historyIndex] || [];
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < transactionHistory.length - 1;

  // Sorted views — sort is display-only; origIndex always refers to processedTransactions[]
  const sortedWithIndices = useMemo(() => {
    const indexed = processedTransactions.map((tx, i) => ({ tx, origIndex: i }));
    if (!sort) return indexed;
    return [...indexed].sort((a, b) => {
      const av = (a.tx as unknown as Record<string, unknown>)[sort.key];
      const bv = (b.tx as unknown as Record<string, unknown>)[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      return sort.dir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [processedTransactions, sort]);

  const sortedFlaggedWithIndices = useMemo(() => {
    const indexed = flaggedEntries.map((entry, i) => ({ entry, origIndex: i }));
    if (!sort) return indexed;
    return [...indexed].sort((a, b) => {
      const av = (a.entry as unknown as Record<string, unknown>)[sort.key];
      const bv = (b.entry as unknown as Record<string, unknown>)[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      return sort.dir === 'asc'
        ? String(av ?? '').localeCompare(String(bv ?? ''))
        : String(bv ?? '').localeCompare(String(av ?? ''));
    });
  }, [flaggedEntries, sort]);

  // ─── Date range filtering ─────────────────────────────────────────────────
  const hasDateRange = !!(dateFrom || dateTo);

  function getTxDate(tx: Transaction): string {
    const t = tx as unknown as Record<string, unknown>;
    const raw =
      targetSoftware === 'capium' ? t.invoicedate :
      targetSoftware === 'xero'   ? t.invoiceDate :
      targetSoftware === 'quickbooks' ? t.invoiceDate :
      targetSoftware === 'sage'   ? t.DATE :
      t.date;
    return typeof raw === 'string' ? raw : '';
  }

  function txInRange(tx: Transaction): boolean {
    if (!hasDateRange) return true;
    const d = getTxDate(tx);
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo   && d > dateTo)   return false;
    return true;
  }

  const inRangeWithIndices   = useMemo(() => sortedWithIndices.filter(({ tx }) => txInRange(tx)),  [sortedWithIndices, dateFrom, dateTo]);
  const outRangeWithIndices  = useMemo(() => sortedWithIndices.filter(({ tx }) => !txInRange(tx)), [sortedWithIndices, dateFrom, dateTo]);

  const allValidSelected = inRangeWithIndices.length > 0 && inRangeWithIndices.every(({ origIndex }) => selectedValid.has(origIndex));
  const someValidSelected = inRangeWithIndices.some(({ origIndex }) => selectedValid.has(origIndex));
  const allFlaggedSelected = sortedFlaggedWithIndices.length > 0 && sortedFlaggedWithIndices.every(({ origIndex }) => selectedFlagged.has(origIndex));
  const someFlaggedSelected = sortedFlaggedWithIndices.some(({ origIndex }) => selectedFlagged.has(origIndex));

  const accountLabel =
    targetSoftware === 'vt' ? 'Analysis Account' :
    targetSoftware === 'sage' ? 'Nominal Code' :
    targetSoftware === 'general' ? 'Category' : 'Account Name';
  const hasAccountField = targetSoftware !== 'freeagent';

  const pushHistory = useCallback((newList: Transaction[]) => {
    setTransactionHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      return [...trimmed, newList];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // ─── Edit handlers ───────────────────────────────────────────────────────────

  const handleSaveTransaction = useCallback((updated: Transaction) => {
    if (!editTarget || editTarget.type !== 'valid') return;
    const newList = processedTransactions.map((tx, i) => i === editTarget.index ? updated : tx);
    pushHistory(newList);
  }, [editTarget, processedTransactions, pushHistory]);

  const handleSaveFlagged = useCallback((updated: FlaggedEntry) => {
    if (!editTarget || editTarget.type !== 'flagged') return;
    setFlaggedEntries(prev => prev.map((e, i) => i === editTarget.index ? updated : e));
  }, [editTarget]);

  const handleFlagTransaction = useCallback((tx: Transaction, reason: string) => {
    if (!editTarget || editTarget.type !== 'valid') return;
    const flagged: FlaggedEntry = { fileName: tx.fileName, reason, pageNumber: tx.pageNumber, transactionData: tx };
    setFlaggedEntries(prev => [...prev, flagged]);
    const newList = processedTransactions.filter((_, i) => i !== editTarget.index);
    pushHistory(newList);
  }, [editTarget, processedTransactions, pushHistory]);

  const handleUnflag = useCallback((entry: FlaggedEntry, tx: Transaction) => {
    if (!editTarget || editTarget.type !== 'flagged') return;
    setFlaggedEntries(prev => prev.filter((_, i) => i !== editTarget.index));
    pushHistory([...processedTransactions, tx]);
  }, [editTarget, processedTransactions, pushHistory]);

  // ─── Bulk handlers ───────────────────────────────────────────────────────────

  const handleBulkAccountChange = useCallback(() => {
    if (!bulkValue.trim()) return;
    const newList = processedTransactions.map((tx, i) => {
      if (!selectedValid.has(i)) return tx;
      const u = { ...tx } as Record<string, unknown>;
      if (targetSoftware === 'vt')         u.analysisAccount = bulkValue;
      else if (targetSoftware === 'capium') { u.accountname = bulkValue; u.accountcode = ''; }
      else if (targetSoftware === 'xero')   { u.accountName = bulkValue; u.accountCode = ''; }
      else if (targetSoftware === 'quickbooks') { u.accountName = bulkValue; u.accountCode = ''; }
      else if (targetSoftware === 'sage')   u.NOMINAL_CODE = bulkValue;
      else if (targetSoftware === 'general') u.category = bulkValue;
      return u as unknown as Transaction;
    });
    pushHistory(newList);
    setSelectedValid(new Set());
    setBulkMode(null); setBulkValue('');
  }, [bulkValue, processedTransactions, selectedValid, targetSoftware, pushHistory]);

  const handleBulkFlag = useCallback(() => {
    if (!bulkValue.trim()) return;
    const newFlagged: FlaggedEntry[] = [];
    const remaining: Transaction[] = [];
    processedTransactions.forEach((tx, i) => {
      if (selectedValid.has(i)) newFlagged.push({ fileName: tx.fileName, reason: bulkValue, pageNumber: tx.pageNumber, transactionData: tx });
      else remaining.push(tx);
    });
    setFlaggedEntries(prev => [...prev, ...newFlagged]);
    pushHistory(remaining);
    setSelectedValid(new Set());
    setBulkMode(null); setBulkValue('');
  }, [bulkValue, processedTransactions, selectedValid, pushHistory]);

  const handleBulkUnflag = useCallback(() => {
    const toPromote: Transaction[] = [];
    const remaining = flaggedEntries.filter((entry, i) => {
      if (!selectedFlagged.has(i)) return true;
      toPromote.push(buildMinimalTx(entry, targetSoftware));
      return false;
    });
    setFlaggedEntries(remaining);
    pushHistory([...processedTransactions, ...toPromote]);
    setSelectedFlagged(new Set());
  }, [flaggedEntries, selectedFlagged, processedTransactions, targetSoftware, pushHistory]);

  // ─── Validation & ledger matching (applied after all scans complete) ─────────

  const applyValidationAndProceed = useCallback((results: DocumentScanResult[]) => {
    const successful = results.filter(r => r.status === 'success');
    const parsedLedgerAccounts = sharedInputsRef.current?.parsedLedgerAccounts ?? [];

    const rawTransactions: Transaction[] = successful.flatMap(r => (r.validTransactions ?? []) as Transaction[]).filter(Boolean);
    const rawFlagged: FlaggedEntry[] = successful.flatMap(r => (r.flaggedEntries ?? []) as FlaggedEntry[]).filter(Boolean);
    const calcFlagged: FlaggedEntry[] = [];
    const validTxs: Transaction[] = [];

    rawTransactions.forEach((tx) => {
      let isValid = true; let reason = ''; let net = 0, vat = 0, gross = 0;
      try {
        if (targetSoftware === 'vt') {
          const v = tx as VTTransaction; net = v.analysis || 0; vat = v.vat || 0; gross = v.total || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'capium') {
          const c = tx as CapiumTransaction; net = c.netAmount || 0; vat = c.vatamount || 0; gross = c.amount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'xero') {
          const x = tx as XeroTransaction; net = x.unitAmount || 0; gross = x.grossAmount || 0;
          const rate = x.taxType?.includes('20%') ? 0.20 : x.taxType?.includes('5%') ? 0.05 : 0;
          if (!isVatRegistered) { if (Math.abs(net - gross) > TOLERANCE) { isValid = false; reason = `Non-VAT calc error: unitAmount (${net.toFixed(2)}) ≠ grossAmount (${gross.toFixed(2)})`; } }
          else { if (Math.abs((net + net * rate) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT ≠ Gross (${gross.toFixed(2)})`; } }
        } else if (targetSoftware === 'quickbooks') {
          const q = tx as QuickBooksTransaction; net = q.unitAmount || 0; vat = q.vatAmount || 0; gross = q.grossAmount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        } else if (targetSoftware === 'sage') {
          const s = tx as SageTransaction; net = s.NET_AMOUNT || 0; vat = s.TAX_AMOUNT || 0;
          const expectedRate = s.TAX_CODE === 'T1' ? 0.20 : s.TAX_CODE === 'T5' ? 0.05 : 0;
          if (expectedRate > 0 && Math.abs(vat - net * expectedRate) > TOLERANCE) { isValid = false; reason = `Sage VAT error: NET (${net.toFixed(2)}) × ${expectedRate * 100}% ≠ TAX_AMOUNT (${vat.toFixed(2)})`; }
        } else if (targetSoftware === 'general') {
          const g = tx as GeneralTransaction; net = g.netAmount || 0; vat = g.vatAmount || 0; gross = g.grossAmount || 0;
          if (Math.abs((net + vat) - gross) > TOLERANCE) { isValid = false; reason = `Calc error: Net (${net.toFixed(2)}) + VAT (${vat.toFixed(2)}) ≠ Gross (${gross.toFixed(2)})`; }
        }
      } catch { isValid = false; reason = 'Missing data for calculation check.'; }
      if (isValid) validTxs.push(tx); else calcFlagged.push({ fileName: tx.fileName, reason, pageNumber: tx.pageNumber, transactionData: tx });
    });

    const validated = parsedLedgerAccounts.length > 0 ? validTxs.map(tx => {
      const aiName =
        targetSoftware === 'vt'         ? (tx as VTTransaction).analysisAccount :
        targetSoftware === 'capium'     ? (tx as CapiumTransaction).accountname :
        targetSoftware === 'xero'       ? (tx as XeroTransaction).accountName :
        targetSoftware === 'quickbooks' ? (tx as QuickBooksTransaction).accountName :
        targetSoftware === 'sage'       ? (tx as SageTransaction).NOMINAL_CODE : undefined;
      if (!aiName) return tx;
      const perfect = parsedLedgerAccounts.find(a => a.name.toLowerCase() === aiName?.toLowerCase() || a.code === aiName);
      if (perfect) return { ...tx, ledgerValidation: { status: 'perfect' as const, originalAiSuggestion: { name: aiName } } };
      const { bestMatch, score } = findBestMatch(aiName || '', parsedLedgerAccounts);
      if (bestMatch && score > 0.7) {
        const updated = { ...tx } as Record<string, unknown>;
        if (targetSoftware === 'vt') updated.analysisAccount = bestMatch.name;
        if (targetSoftware === 'capium') { updated.accountname = bestMatch.name; updated.accountcode = bestMatch.code || ''; }
        if (targetSoftware === 'xero') { updated.accountName = bestMatch.name; updated.accountCode = bestMatch.code || ''; }
        if (targetSoftware === 'quickbooks') { updated.accountName = bestMatch.name; updated.accountCode = bestMatch.code || ''; }
        if (targetSoftware === 'sage') updated.NOMINAL_CODE = bestMatch.code || bestMatch.name;
        return { ...updated, ledgerValidation: { status: 'suggestion' as const, originalAiSuggestion: { name: aiName }, suggestedLedger: bestMatch } } as Transaction;
      }
      return { ...tx, ledgerValidation: { status: 'no-match' as const, originalAiSuggestion: { name: aiName } } };
    }) : validTxs;

    setTransactionHistory([validated]);
    setHistoryIndex(0);
    setFlaggedEntries([...rawFlagged, ...calcFlagged]);
    setSort(null); setSelectedValid(new Set()); setSelectedFlagged(new Set());
    setAppState('success');
  }, [targetSoftware, isVatRegistered]);

  // ─── Scan a list of files one at a time, returning per-file results ──────────

  const scanFiles = useCallback(async (
    filesToScan: File[],
    pastTransactionsContent: string | null,
    ledgersContent: string | null,
  ): Promise<DocumentScanResult[]> => {
    const results: DocumentScanResult[] = [];

    for (let i = 0; i < filesToScan.length; i++) {
      const file = filesToScan[i];
      setScanProgress({ current: i + 1, total: filesToScan.length, fileName: file.name });

      try {
        const base64 = await fileToBase64(file);
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName, clientAddress, isVatRegistered, targetSoftware,
            files: [{ name: file.name, mimeType: file.type || 'application/pdf', base64 }],
            pastTransactionsContent, ledgersContent,
            clientId: selectedClient?.id ?? null,
            clientCode: selectedClient?.client_ref ?? null,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          results.push({ fileName: file.name, status: 'failed', validTransactions: [], flaggedEntries: [], errorMessage: err.error || 'Analysis failed', errorCode: err.code });
        } else {
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let accumulated = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
          }
          accumulated += decoder.decode();
          const data = JSON.parse(accumulated);
          results.push({ fileName: file.name, status: 'success', validTransactions: data.validTransactions || [], flaggedEntries: data.flaggedEntries || [] });
        }
      } catch (err) {
        results.push({ fileName: file.name, status: 'failed', validTransactions: [], flaggedEntries: [], errorMessage: err instanceof Error ? err.message : 'Unexpected error during scanning' });
      }

      // Update state after each file so the UI reflects real-time progress
      setScanResults(prev => {
        const map = new Map(prev.map(r => [r.fileName, r]));
        map.set(results[results.length - 1].fileName, results[results.length - 1]);
        return Array.from(map.values());
      });
    }

    return results;
  }, [clientName, clientAddress, isVatRegistered, targetSoftware, selectedClient?.id, selectedClient?.client_ref]);

  // ─── Analysis ────────────────────────────────────────────────────────────────

  const handleProcess = useCallback(async () => {
    if (documentFiles.length === 0) return;
    setAppState('loading'); setError(null); setErrorCode(undefined); setProgress(0);
    setScanResults([]);

    // Build a stable file reference map for the rescan handler
    const fileMap = new Map(documentFiles.map(f => [f.name, f]));
    setFileRefs(fileMap);

    // Read shared inputs once — reused across all per-file calls and any re-scans
    const pastTransactionsContent = pastTransactionsFile ? await readFileAsText(pastTransactionsFile) : null;
    const ledgersContent = ledgersFile ? await readFileAsText(ledgersFile) : null;
    let parsedLedgerAccounts: LedgerAccount[] = [];
    if (ledgersContent) { parsedLedgerAccounts = parseLedgerCsv(ledgersContent); setLedgerAccounts(parsedLedgerAccounts); }
    sharedInputsRef.current = { pastTransactionsContent, ledgersContent, parsedLedgerAccounts };

    // Single file: skip the results page and go straight to success or error
    if (documentFiles.length === 1) {
      try {
        const results = await scanFiles(documentFiles, pastTransactionsContent, ledgersContent);
        setScanProgress(null);
        if (results[0].status === 'failed') {
          setError(results[0].errorMessage ?? 'Scan failed'); setErrorCode(results[0].errorCode); setAppState('error');
        } else {
          applyValidationAndProceed(results);
        }
      } catch {
        setAppState('error'); setError('An unexpected error occurred');
      }
      return;
    }

    // Multiple files: scan each individually, then show the scan results page
    const results = await scanFiles(documentFiles, pastTransactionsContent, ledgersContent);
    setScanProgress(null);
    setScanResults(results);
    setAppState('scan_results');
  }, [documentFiles, pastTransactionsFile, ledgersFile, scanFiles, applyValidationAndProceed]);

  // ─── Re-scan failed documents ─────────────────────────────────────────────

  const handleRescan = useCallback(async () => {
    const failedResults = scanResults.filter(r => r.status === 'failed');
    if (failedResults.length === 0) return;
    const failedFiles = failedResults.map(r => fileRefs.get(r.fileName)).filter(Boolean) as File[];
    if (failedFiles.length === 0) return;

    setIsRescanning(true);
    setAppState('loading');
    setScanProgress(null);

    const { pastTransactionsContent, ledgersContent } = sharedInputsRef.current ?? { pastTransactionsContent: null, ledgersContent: null };
    const newResults = await scanFiles(failedFiles, pastTransactionsContent ?? null, ledgersContent ?? null);

    // Merge: replace each failed entry with its new result (success or still failed)
    setScanResults(prev => {
      const newMap = new Map(newResults.map(r => [r.fileName, r]));
      return prev.map(r => newMap.get(r.fileName) ?? r);
    });

    setScanProgress(null);
    setIsRescanning(false);
    setAppState('scan_results');
  }, [scanResults, fileRefs, scanFiles]);

  // ─── Dismiss failed and proceed with successful results ───────────────────

  const handleDismissAndContinue = useCallback(() => {
    applyValidationAndProceed(scanResults);
  }, [scanResults, applyValidationAndProceed]);

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
        steps={['Preparing documents', 'Extracting transactions', 'Matching account codes', 'Validating entries', 'Compiling results']}
      />
    );
  }
  if (appState === 'scan_results') return (
    <ToolLayout title="Full Transaction Analysis" icon={FileSearch}>
      <ScanResultsView
        results={scanResults}
        fileRefs={fileRefs}
        isRescanning={isRescanning}
        onRescan={handleRescan}
        onDismissAndContinue={handleDismissAndContinue}
      />
    </ToolLayout>
  );
  if (appState === 'error') return (
    <ToolLayout title="Full Transaction Analysis" icon={FileSearch}>
      <ErrorDisplay error={error || 'Unknown error'} code={errorCode} onRetry={() => { setAppState('idle'); setErrorCode(undefined); }} />
    </ToolLayout>
  );

  // ─── Table helpers (scoped to success view) ───────────────────────────────

  const handleSort = (key: string) =>
    setSort(prev => prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });

  const SortTH = ({ children, sortKey, right }: { children?: React.ReactNode; sortKey: string; right?: boolean }) => {
    const active = sort?.key === sortKey;
    const Icon = active ? (sort!.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown;
    return (
      <th onClick={() => handleSort(sortKey)}
        className={`px-3 py-3 text-xs font-semibold uppercase tracking-wide cursor-pointer select-none transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'} ${right ? 'text-right' : 'text-left'}`}>
        <div className={`flex items-center gap-1 ${right ? 'justify-end' : ''}`}>
          {children}<Icon size={11} className={active ? 'text-[var(--accent)]' : 'opacity-40'} />
        </div>
      </th>
    );
  };

  const CheckTH = ({ allSel, someSel, onToggle }: { allSel: boolean; someSel: boolean; onToggle: () => void }) => (
    <th className="px-3 py-3 w-10">
      <input type="checkbox" checked={allSel}
        ref={el => { if (el) el.indeterminate = someSel && !allSel; }}
        onChange={onToggle}
        className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
    </th>
  );

  const TH = ({ children }: { children?: React.ReactNode }) => (
    <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{children}</th>
  );

  const EditBtn = ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick} className="p-1 rounded hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors" title="View / Edit">
      <Pencil size={13} />
    </button>
  );

  // Bulk action bar for valid transactions
  const BulkBarValid = () => {
    if (selectedValid.size === 0) return null;
    return (
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-[var(--accent-light)] border border-[var(--accent)]/25 rounded-xl flex-wrap">
        <span className="text-sm font-semibold text-[var(--accent)]">{selectedValid.size} selected</span>
        <div className="w-px h-4 bg-[var(--accent)]/30 shrink-0" />
        {bulkMode === 'account' ? (<>
          <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
            placeholder={`New ${accountLabel}…`} className="input-base py-1 text-sm w-56" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleBulkAccountChange(); if (e.key === 'Escape') { setBulkMode(null); setBulkValue(''); } }} />
          <button onClick={handleBulkAccountChange} disabled={!bulkValue.trim()} className="btn-primary py-1 px-3 text-xs">Apply to all</button>
          <button onClick={() => { setBulkMode(null); setBulkValue(''); }} className="btn-secondary py-1 px-3 text-xs">Cancel</button>
        </>) : bulkMode === 'flag' ? (<>
          <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)}
            placeholder="Reason for flagging…" className="input-base py-1 text-sm w-56" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') handleBulkFlag(); if (e.key === 'Escape') { setBulkMode(null); setBulkValue(''); } }} />
          <button onClick={handleBulkFlag} disabled={!bulkValue.trim()}
            className="py-1 px-3 text-xs font-medium rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors">Flag all</button>
          <button onClick={() => { setBulkMode(null); setBulkValue(''); }} className="btn-secondary py-1 px-3 text-xs">Cancel</button>
        </>) : (<>
          {hasAccountField && (
            <button onClick={() => setBulkMode('account')} className="btn-secondary py-1 px-3 text-xs">
              Change {accountLabel}
            </button>
          )}
          <button onClick={() => setBulkMode('flag')}
            className="py-1 px-3 text-xs font-medium rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
            <span className="flex items-center gap-1"><AlertTriangle size={11} /> Flag selected</span>
          </button>
          <button onClick={() => setSelectedValid(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-auto transition-colors">
            Deselect all
          </button>
        </>)}
      </div>
    );
  };

  // Bulk action bar for flagged entries
  const BulkBarFlagged = () => {
    if (selectedFlagged.size === 0) return null;
    return (
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex-wrap dark:bg-emerald-900/10 dark:border-emerald-800">
        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{selectedFlagged.size} selected</span>
        <div className="w-px h-4 bg-emerald-300/50 shrink-0" />
        <button onClick={handleBulkUnflag}
          className="flex items-center gap-1.5 py-1 px-3 text-xs font-medium rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors">
          <CheckCheck size={13} /> Mark all as valid
        </button>
        <button onClick={() => setSelectedFlagged(new Set())} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-auto transition-colors">
          Deselect all
        </button>
      </div>
    );
  };

  return (
    <ToolLayout title="Full Transaction Analysis" description="Analyse invoices and receipts and produce bookkeeping entries for VT, Capium, Xero, QuickBooks, FreeAgent, or Sage." icon={FileSearch}>
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="glass-solid rounded-xl p-5">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Client</span>
              <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="glass-solid rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">1. Client Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <input type="text" value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client Name" className="input-base" />
                <input type="text" value={clientAddress} onChange={e => setClientAddress(e.target.value)} placeholder="Client Address" className="input-base" />
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">VAT Registered?</span>
                  <button type="button" onClick={() => setIsVatRegistered(!isVatRegistered)}
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 ${isVatRegistered ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ml-0.5 ${isVatRegistered ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[var(--border)]">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Date Range <span className="normal-case font-normal">(optional)</span></p>
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

            <div className="glass-solid rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">2. Target Software</h3>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'vt', label: 'VT Transaction+' }, { id: 'capium', label: 'Capium Bookkeeping' },
                  { id: 'xero', label: 'Xero' }, { id: 'quickbooks', label: 'QuickBooks' },
                  { id: 'freeagent', label: 'FreeAgent' }, { id: 'sage', label: 'Sage 50' }, { id: 'general', label: 'General' },
                ] as { id: TargetSoftware; label: string }[]).map(({ id, label }) => (
                  <button key={id} onClick={() => setTargetSoftware(id)}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${targetSoftware === id ? 'bg-[var(--accent)] text-white shadow-accent-glow' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <FileUpload title="3. Documents to Analyse" onFilesChange={setDocumentFiles} multiple accept="application/pdf,image/*" helpText="Upload invoices, receipts, and bank statements." existingFiles={documentFiles} />
            <div className="space-y-4">
              <FileUpload title="4. Past Transactions (CSV)" onFileChange={setPastTransactionsFile} accept=".csv" optional helpText="Helps identify duplicate transactions." existingFiles={pastTransactionsFile ? [pastTransactionsFile] : []} />
              <FileUpload title="5. Chart of Accounts (CSV)" onFileChange={setLedgersFile} accept=".csv" optional helpText="Improves accuracy of ledger allocation." existingFiles={ledgersFile ? [ledgersFile] : []} />
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={documentFiles.length === 0} className="btn-primary">
              <FileSearch size={15} />Analyse Documents
            </button>
          </div>
        </div>
      )}

      {appState === 'success' && (
        <div className="space-y-4">
          {/* Top action bar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              <button onClick={() => { setCurrentView('valid'); setBulkMode(null); setBulkValue(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${currentView === 'valid' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>
                Valid ({processedTransactions.length})
              </button>
              <button onClick={() => { setCurrentView('flagged'); setBulkMode(null); setBulkValue(''); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${currentView === 'flagged' ? 'bg-amber-500 text-white' : 'btn-secondary'}`}>
                <AlertTriangle size={13} />Flagged ({flaggedEntries.length})
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => { setHistoryIndex(h => h - 1); setSelectedValid(new Set()); }} disabled={!canUndo} className="btn-secondary px-2.5 py-2"><Undo2 size={14} /></button>
              <button onClick={() => { setHistoryIndex(h => h + 1); setSelectedValid(new Set()); }} disabled={!canRedo} className="btn-secondary px-2.5 py-2"><Redo2 size={14} /></button>
              <button onClick={() => setSaveModalOpen(true)} className="btn-primary"><Download size={14} />Save Analysis</button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Analysis</button>
            </div>
          </div>

          {/* Valid transactions */}
          {currentView === 'valid' && (
            <div className="space-y-2">
              <BulkBarValid />
              <div className="glass-solid rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[var(--border)]">
                    <tr>
                      <CheckTH allSel={allValidSelected} someSel={someValidSelected}
                        onToggle={() => {
                          if (allValidSelected) setSelectedValid(new Set());
                          else setSelectedValid(new Set(inRangeWithIndices.map(x => x.origIndex)));
                        }} />
                      {targetSoftware === 'vt' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="type">Type</SortTH><SortTH sortKey="primaryAccount">Account</SortTH><TH>Details</TH><SortTH sortKey="total" right>Total</SortTH><SortTH sortKey="vat" right>VAT</SortTH><SortTH sortKey="analysis" right>Net</SortTH><SortTH sortKey="analysisAccount">Analysis Account</SortTH><TH></TH></>}
                      {targetSoftware === 'capium' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoicedate">Date</SortTH><SortTH sortKey="contactname">Contact</SortTH><TH>Description</TH><SortTH sortKey="accountname">Account</SortTH><SortTH sortKey="amount" right>Gross</SortTH><SortTH sortKey="vatamount" right>VAT</SortTH><SortTH sortKey="netAmount" right>Net</SortTH><TH></TH></>}
                      {targetSoftware === 'xero' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoiceDate">Date</SortTH><SortTH sortKey="contactName">Contact</SortTH><SortTH sortKey="invoiceNumber">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="unitAmount" right>Net</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="accountName">Account</SortTH><SortTH sortKey="taxType">Tax</SortTH><TH></TH></>}
                      {targetSoftware === 'quickbooks' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="invoiceDate">Date</SortTH><SortTH sortKey="supplier">Supplier</SortTH><SortTH sortKey="invoiceNo">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="unitAmount" right>Net</SortTH><SortTH sortKey="vatAmount" right>VAT</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="accountName">Account</SortTH><TH></TH></>}
                      {targetSoftware === 'freeagent' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="amount" right>Amount</SortTH><TH>Description</TH><TH></TH></>}
                      {targetSoftware === 'sage' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="DATE">Date</SortTH><SortTH sortKey="TYPE">Type</SortTH><SortTH sortKey="ACCOUNT_REF">Acct Ref</SortTH><SortTH sortKey="NOMINAL_CODE">Nominal</SortTH><TH>Details</TH><SortTH sortKey="NET_AMOUNT" right>Net</SortTH><SortTH sortKey="TAX_CODE">Tax</SortTH><SortTH sortKey="TAX_AMOUNT" right>Tax Amt</SortTH><TH></TH></>}
                      {targetSoftware === 'general' && <><SortTH sortKey="fileName">File</SortTH><SortTH sortKey="date">Date</SortTH><SortTH sortKey="supplier">Supplier</SortTH><SortTH sortKey="invoiceNumber">Invoice No</SortTH><TH>Description</TH><SortTH sortKey="netAmount" right>Net</SortTH><SortTH sortKey="vatAmount" right>VAT</SortTH><SortTH sortKey="grossAmount" right>Gross</SortTH><SortTH sortKey="category">Category</SortTH><TH></TH></>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {inRangeWithIndices.map(({ tx, origIndex }) => {
                      const isSelected = selectedValid.has(origIndex);
                      const rowCls = `transition-colors ${isSelected ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--bg-nav-hover)]'}`;
                      const toggleRow = () => setSelectedValid(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; });
                      const checkTd = (
                        <td className="px-3 py-2.5">
                          <input type="checkbox" checked={isSelected} onChange={toggleRow} className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
                        </td>
                      );
                      const editTd = <td className="px-2 py-2" onClick={e => e.stopPropagation()}><EditBtn onClick={() => setEditTarget({ type: 'valid', index: origIndex })} /></td>;

                      if (targetSoftware === 'vt') {
                        const v = tx as VTTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{v.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.date}</td>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{v.type}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.primaryAccount}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{v.details}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{v.total?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{v.vat?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{v.analysis?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{v.analysisAccount}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'capium') {
                        const c = tx as CapiumTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{c.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.invoicedate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.contactname}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{c.description}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{c.accountname}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{c.amount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{c.vatamount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{c.netAmount?.toFixed(2)}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'xero') {
                        const x = tx as XeroTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{x.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.invoiceDate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.contactName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.invoiceNumber}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{x.description}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{x.unitAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{x.grossAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.accountName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{x.taxType}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'quickbooks') {
                        const q = tx as QuickBooksTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{q.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.invoiceDate}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.supplier}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.invoiceNo}</td>
                          <td className="px-3 py-2.5 truncate max-w-[160px] text-[var(--text-secondary)]">{q.description}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{q.unitAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{q.vatAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{q.grossAmount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{q.accountName}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'freeagent') {
                        const f = tx as FreeAgentTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[120px]">{f.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{f.date}</td>
                          <td className={`px-3 py-2.5 text-right font-medium ${f.amount < 0 ? 'text-red-500' : 'text-emerald-600'}`}>£{f.amount?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 truncate max-w-[200px] text-[var(--text-secondary)]">{f.description}</td>
                          {editTd}
                        </tr>;
                      }
                      if (targetSoftware === 'sage') {
                        const s = tx as SageTransaction;
                        return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                          {checkTd}
                          <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[100px]">{s.fileName}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.DATE}</td>
                          <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{s.TYPE}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.ACCOUNT_REF}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.NOMINAL_CODE}</td>
                          <td className="px-3 py-2.5 truncate max-w-[140px] text-[var(--text-secondary)]">{s.DETAILS}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{s.NET_AMOUNT?.toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-[var(--text-secondary)]">{s.TAX_CODE}</td>
                          <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{s.TAX_AMOUNT?.toFixed(2)}</td>
                          {editTd}
                        </tr>;
                      }
                      // general
                      const g = tx as GeneralTransaction;
                      return <tr key={origIndex} className={rowCls} onClick={toggleRow}>
                        {checkTd}
                        <td className="px-3 py-2.5 text-[var(--text-muted)] truncate max-w-[100px]">{g.fileName}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.date}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.supplier}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)]">{g.invoiceNumber}</td>
                        <td className="px-3 py-2.5 truncate max-w-[140px] text-[var(--text-secondary)]">{g.description}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{g.netAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">£{g.vatAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-right font-medium text-[var(--text-primary)]">£{g.grossAmount?.toFixed(2)}</td>
                        <td className="px-3 py-2.5 text-[var(--text-secondary)] truncate max-w-[100px]">{g.category}</td>
                        {editTd}
                      </tr>;
                    })}
                  </tbody>
                </table>
                {inRangeWithIndices.length === 0 && (
                  <p className="text-center text-[var(--text-muted)] py-10 text-sm">
                    {hasDateRange && processedTransactions.length > 0 ? 'No transactions within the selected date range.' : 'No valid transactions found.'}
                  </p>
                )}
              </div>

              {/* Out-of-range section */}
              {hasDateRange && outRangeWithIndices.length > 0 && (
                <div className="glass-solid rounded-xl overflow-hidden">
                  <button
                    onClick={() => setShowOutOfRange(v => !v)}
                    className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 hover:bg-amber-100 dark:hover:bg-amber-900/20 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <AlertTriangle size={14} />
                      {outRangeWithIndices.length} out-of-range transaction{outRangeWithIndices.length !== 1 ? 's' : ''} (excluded from export)
                    </span>
                    {showOutOfRange ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  {showOutOfRange && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm opacity-70">
                        <thead className="border-b border-[var(--border)]">
                          <tr>
                            <th className="px-3 py-3 w-10" />
                            {targetSoftware === 'vt' && <><TH>File</TH><TH>Date</TH><TH>Type</TH><TH>Account</TH><TH>Details</TH><TH>Total</TH><TH>VAT</TH><TH>Net</TH><TH>Analysis Account</TH><TH /></>}
                            {targetSoftware === 'capium' && <><TH>File</TH><TH>Date</TH><TH>Contact</TH><TH>Description</TH><TH>Account</TH><TH>Gross</TH><TH>VAT</TH><TH>Net</TH><TH /></>}
                            {targetSoftware === 'xero' && <><TH>File</TH><TH>Date</TH><TH>Contact</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>Gross</TH><TH>Account</TH><TH>Tax</TH><TH /></>}
                            {targetSoftware === 'quickbooks' && <><TH>File</TH><TH>Date</TH><TH>Supplier</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>VAT</TH><TH>Gross</TH><TH>Account</TH><TH /></>}
                            {targetSoftware === 'freeagent' && <><TH>File</TH><TH>Date</TH><TH>Amount</TH><TH>Description</TH><TH /></>}
                            {targetSoftware === 'sage' && <><TH>File</TH><TH>Date</TH><TH>Type</TH><TH>Acct Ref</TH><TH>Nominal</TH><TH>Details</TH><TH>Net</TH><TH>Tax</TH><TH>Tax Amt</TH><TH /></>}
                            {targetSoftware === 'general' && <><TH>File</TH><TH>Date</TH><TH>Supplier</TH><TH>Invoice No</TH><TH>Description</TH><TH>Net</TH><TH>VAT</TH><TH>Gross</TH><TH>Category</TH><TH /></>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {outRangeWithIndices.map(({ tx, origIndex }) => {
                            const rowCls = 'hover:bg-[var(--bg-nav-hover)] transition-colors';
                            const editTd = <td className="px-2 py-2" onClick={e => e.stopPropagation()}><EditBtn onClick={() => setEditTarget({ type: 'valid', index: origIndex })} /></td>;
                            if (targetSoftware === 'vt') { const v = tx as VTTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 text-[var(--text-muted)] truncate max-w-[120px]">{v.fileName}</td><td className="px-3 py-2">{v.date}</td><td className="px-3 py-2">{v.type}</td><td className="px-3 py-2">{v.primaryAccount}</td><td className="px-3 py-2 truncate max-w-[160px]">{v.details}</td><td className="px-3 py-2 text-right">£{v.total?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{v.vat?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{v.analysis?.toFixed(2)}</td><td className="px-3 py-2">{v.analysisAccount}</td>{editTd}</tr>; }
                            if (targetSoftware === 'capium') { const c = tx as CapiumTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{c.fileName}</td><td className="px-3 py-2">{c.invoicedate}</td><td className="px-3 py-2">{c.contactname}</td><td className="px-3 py-2 truncate max-w-[160px]">{c.description}</td><td className="px-3 py-2">{c.accountname}</td><td className="px-3 py-2 text-right">£{c.amount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{c.vatamount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{c.netAmount?.toFixed(2)}</td>{editTd}</tr>; }
                            if (targetSoftware === 'xero') { const x = tx as XeroTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{x.fileName}</td><td className="px-3 py-2">{x.invoiceDate}</td><td className="px-3 py-2">{x.contactName}</td><td className="px-3 py-2">{x.invoiceNumber}</td><td className="px-3 py-2 truncate max-w-[160px]">{x.description}</td><td className="px-3 py-2 text-right">£{x.unitAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{x.grossAmount?.toFixed(2)}</td><td className="px-3 py-2">{x.accountName}</td><td className="px-3 py-2">{x.taxType}</td>{editTd}</tr>; }
                            if (targetSoftware === 'quickbooks') { const q = tx as QuickBooksTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{q.fileName}</td><td className="px-3 py-2">{q.invoiceDate}</td><td className="px-3 py-2">{q.supplier}</td><td className="px-3 py-2">{q.invoiceNo}</td><td className="px-3 py-2 truncate max-w-[160px]">{q.description}</td><td className="px-3 py-2 text-right">£{q.unitAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{q.vatAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{q.grossAmount?.toFixed(2)}</td><td className="px-3 py-2">{q.accountName}</td>{editTd}</tr>; }
                            if (targetSoftware === 'freeagent') { const f = tx as FreeAgentTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[120px]">{f.fileName}</td><td className="px-3 py-2">{f.date}</td><td className="px-3 py-2 text-right">£{f.amount?.toFixed(2)}</td><td className="px-3 py-2 truncate max-w-[200px]">{f.description}</td>{editTd}</tr>; }
                            if (targetSoftware === 'sage') { const s = tx as SageTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[100px]">{s.fileName}</td><td className="px-3 py-2">{s.DATE}</td><td className="px-3 py-2">{s.TYPE}</td><td className="px-3 py-2">{s.ACCOUNT_REF}</td><td className="px-3 py-2">{s.NOMINAL_CODE}</td><td className="px-3 py-2 truncate max-w-[140px]">{s.DETAILS}</td><td className="px-3 py-2 text-right">£{s.NET_AMOUNT?.toFixed(2)}</td><td className="px-3 py-2">{s.TAX_CODE}</td><td className="px-3 py-2 text-right">£{s.TAX_AMOUNT?.toFixed(2)}</td>{editTd}</tr>; }
                            const g = tx as GeneralTransaction; return <tr key={origIndex} className={rowCls}><td className="px-3 py-2 w-10" /><td className="px-3 py-2 truncate max-w-[100px]">{g.fileName}</td><td className="px-3 py-2">{g.date}</td><td className="px-3 py-2">{g.supplier}</td><td className="px-3 py-2">{g.invoiceNumber}</td><td className="px-3 py-2 truncate max-w-[140px]">{g.description}</td><td className="px-3 py-2 text-right">£{g.netAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{g.vatAmount?.toFixed(2)}</td><td className="px-3 py-2 text-right">£{g.grossAmount?.toFixed(2)}</td><td className="px-3 py-2 truncate max-w-[100px]">{g.category}</td>{editTd}</tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Flagged entries */}
          {currentView === 'flagged' && (
            <div className="space-y-2">
              <BulkBarFlagged />
              {flaggedEntries.length === 0 && (
                <div className="glass-solid rounded-xl p-10 text-center text-sm text-[var(--text-muted)]">No flagged entries.</div>
              )}
              {flaggedEntries.length > 0 && (
                <div className="glass-solid rounded-xl overflow-hidden">
                  {/* Select-all header row */}
                  <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
                    <input type="checkbox" checked={allFlaggedSelected}
                      ref={el => { if (el) el.indeterminate = someFlaggedSelected && !allFlaggedSelected; }}
                      onChange={() => {
                        if (allFlaggedSelected) setSelectedFlagged(new Set());
                        else setSelectedFlagged(new Set(sortedFlaggedWithIndices.map(x => x.origIndex)));
                      }}
                      className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded" />
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                      {flaggedEntries.length} flagged {flaggedEntries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {sortedFlaggedWithIndices.map(({ entry, origIndex }) => {
                      const isSelected = selectedFlagged.has(origIndex);
                      return (
                        <div key={origIndex}
                          className={`flex items-start gap-3 p-4 transition-colors cursor-pointer ${isSelected ? 'bg-amber-50/60 dark:bg-amber-900/10' : 'hover:bg-[var(--bg-nav-hover)]'}`}
                          onClick={() => setSelectedFlagged(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; })}>
                          <input type="checkbox" checked={isSelected}
                            onChange={() => setSelectedFlagged(prev => { const n = new Set(prev); isSelected ? n.delete(origIndex) : n.add(origIndex); return n; })}
                            onClick={e => e.stopPropagation()}
                            className="w-4 h-4 cursor-pointer accent-[var(--accent)] rounded mt-0.5 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[var(--text-primary)]">{entry.fileName}</p>
                            <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">{entry.reason}</p>
                            {entry.date && <p className="text-xs text-[var(--text-muted)] mt-1">Date: {entry.date} · Amount: £{entry.amount?.toFixed(2)}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-lg">
                              p.{entry.pageNumber || '?'}
                            </span>
                            <button
                              onClick={e => { e.stopPropagation(); setEditTarget({ type: 'flagged', index: origIndex }); }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium btn-secondary"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SaveAnalysisModal
        isOpen={saveModalOpen}
        transactions={processedTransactions}
        documentFiles={documentFiles}
        targetSoftware={targetSoftware}
        initialClient={selectedClient}
        onClose={() => setSaveModalOpen(false)}
      />

      {editTarget && appState === 'success' && (
        <TransactionEditModal
          item={editTarget.type === 'valid' ? processedTransactions[editTarget.index] : flaggedEntries[editTarget.index]}
          isFlagged={editTarget.type === 'flagged'}
          targetSoftware={targetSoftware}
          documentFiles={documentFiles}
          onSaveTransaction={handleSaveTransaction}
          onSaveFlagged={handleSaveFlagged}
          onFlagTransaction={handleFlagTransaction}
          onUnflag={handleUnflag}
          onClose={() => setEditTarget(null)}
        />
      )}
    </ToolLayout>
  );
}
