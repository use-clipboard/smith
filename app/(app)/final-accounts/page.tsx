'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient, peekPendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { ClipboardCheck, FileText, Download, Undo2, Redo2, ArrowLeft, TrendingUp, Scale, Calculator, Check, Loader2, UploadCloud, CheckCircle2, Circle, ShieldCheck, Sparkles, BookCopy, AlertCircle, Save, X } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import { generateReportHtml } from '@/utils/finalAccountsReport';
import type { ReviewPoint, WorkingPaper, ReviewStatusEvent } from '@/types';
import WorkingPaperSection from '@/components/features/final-accounts/WorkingPaperSection';
import FinalAccountsHistory, { type FinalAccountsSeed } from '@/components/features/final-accounts/FinalAccountsHistory';

type AppState = 'idle' | 'loading' | 'success' | 'error';

// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function FinalAccountsPage() {
  // Skip the history view when arriving via a Quick Launch pill (pending client present).
  const [view, setView] = useState<'history' | 'tool'>(
    () => peekPendingClient('/final-accounts') ? 'tool' : 'history',
  );
  const [seed, setSeed] = useState<FinalAccountsSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff'; fullName: string }>({ userId: '', userRole: 'staff', fullName: '' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff', fullName: d.full_name ?? '' }); })
      .catch(() => {/* ignore */});
  }, []);

  // Subsequent pill clicks while the tab is already open
  useEffect(() => {
    function onPending(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/final-accounts') return;
      setSeed(null);
      setView('tool');
    }
    window.addEventListener('smith:pending-client', onPending);
    return () => window.removeEventListener('smith:pending-client', onPending);
  }, []);

  return view === 'history' ? (
    <FinalAccountsHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <FinalAccountsTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} meName={me.fullName} />
  );
}

function BackToHistory({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 mb-3 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      <ArrowLeft size={13} />
      Back to history
    </button>
  );
}

/**
 * Break a dense explanation block into a few readable paragraphs.
 * Honours explicit line breaks if the model returned them; otherwise splits on
 * sentence boundaries — but never where the full stop sits inside a number
 * (e.g. £1,772.27 or 33.75%), so financial figures are never mangled. Splits
 * are grouped ~2 sentences per paragraph so the text breathes without becoming
 * a choppy list.
 */
function toParagraphs(text: string): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  if (/\n/.test(t)) return t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const sentences = t.split(/(?<=[^\d][.!?])\s+(?=[A-Z£"(])/);
  const paras: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    paras.push(sentences.slice(i, i + 2).join(' ').trim());
  }
  return paras.filter(Boolean);
}

// ── "Accounts package" uploader — documents + their detected category ─────────
type DocCat = 'trial_balance' | 'balance_sheet' | 'profit_loss' | 'prior_year' | 'working_papers' | 'notes' | 'other';
type Doc = { id: string; file: File; cat: DocCat };

const REQUIRED_CATS: { key: DocCat; label: string }[] = [
  { key: 'trial_balance', label: 'Trial Balance' },
  { key: 'balance_sheet', label: 'Balance Sheet' },
  { key: 'profit_loss', label: 'Profit & Loss' },
];
const OPTIONAL_CATS: { key: DocCat; label: string }[] = [
  { key: 'prior_year', label: 'Prior Year Accounts' },
  { key: 'working_papers', label: 'Working Papers' },
  { key: 'notes', label: 'Notes to the Accounts' },
];

// Guess a document's category from its filename. The user can re-tag anything we
// get wrong via the dropdown on each uploaded file (filename heuristics only —
// no extra AI call). Order matters: qualifiers (prior/notes) before the core 3.
function detectCat(name: string): DocCat {
  const n = name.toLowerCase();
  if (/prior|previous|comparativ|last\s*year/.test(n)) return 'prior_year';
  if (/working\s*paper|\bwp\b/.test(n)) return 'working_papers';
  if (/\bnotes?\b/.test(n)) return 'notes';
  if (/trial\s*balance|\btb\b/.test(n)) return 'trial_balance';
  if (/balance\s*sheet|financial\s*position|\bbs\b/.test(n)) return 'balance_sheet';
  if (/profit|loss|\bp\s*&?\s*l\b|income\s*statement|\bpl\b/.test(n)) return 'profit_loss';
  return 'other';
}

// Year End → derive the 12-month accounting period start (year end − 1yr + 1 day)
// so the prompt still receives both a start and end date.
function deriveStart(end: string): string {
  if (!end) return '';
  const d = new Date(end + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() - 1);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Review depth — only "Full" is wired up today; the others are stubbed.
const REVIEW_TYPES: { key: string; title: string; desc: string; enabled: boolean }[] = [
  { key: 'full', title: 'Full Review', desc: 'Comprehensive review with all checks', enabled: true },
  { key: 'director', title: 'Director Review', desc: 'Focus on key risks and disclosures', enabled: false },
  { key: 'final', title: 'Final Accounts', desc: 'Preparing final statutory accounts', enabled: false },
];

const STEPS = ['Select Client', 'Upload Accounts', 'Review Findings', 'Working Papers', 'Final Pack'];
function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : 'todo';
        return (
          <div key={s} className="flex items-center shrink-0">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              state === 'active' ? 'bg-[var(--accent)] text-white'
                : state === 'done' ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'
            }`}>{state === 'done' ? <Check size={14} /> : n}</div>
            <span className={`ml-2 text-sm font-medium whitespace-nowrap ${
              state === 'active' ? 'text-[var(--accent)]'
                : state === 'done' ? 'text-[var(--text-secondary)]'
                : 'text-[var(--text-muted)]'
            }`}>{s}</span>
            {i < STEPS.length - 1 && <div className="w-8 sm:w-14 h-0.5 rounded bg-slate-300 mx-2 sm:mx-3" />}
          </div>
        );
      })}
    </div>
  );
}

// A single AI-Readiness row — ticks green when a matching document is present.
function ReadyRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {done
        ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
        : <Circle size={18} className="text-[var(--text-muted)] shrink-0" />}
      <span className={`text-sm ${done ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{label}</span>
    </div>
  );
}

// ── Results view (findings) helpers ───────────────────────────────────────────
const SEV: Record<string, { dot: string; badge: string; bar: string; softBg: string; softText: string; rank: number }> = {
  Serious: { dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700',     bar: 'border-l-red-500',   softBg: 'bg-red-50',   softText: 'text-red-900',   rank: 0 },
  Medium:  { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', bar: 'border-l-amber-400', softBg: 'bg-amber-50', softText: 'text-amber-900', rank: 1 },
  Minor:   { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', bar: 'border-l-slate-300', softBg: 'bg-slate-50', softText: 'text-slate-700', rank: 2 },
};
const sevOf = (s: string) => SEV[s] ?? SEV.Minor;
const FINDINGS_PAGE_SIZE = 6;

// Format an ISO date (YYYY-MM-DD) as dd-mm-yyyy for display.
const fmtUK = (iso: string) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return d && m && y ? `${d}-${m}-${y}` : iso; };

const DETAIL_TABS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'explanation', label: 'AI Explanation' },
  { key: 'sources', label: 'Source Documents' },
  { key: 'action', label: 'Suggested Action' },
  { key: 'history', label: 'History' },
];

// A summary stat card for the results header row. Clickable when `onClick` is
// provided (used to filter the findings list by severity).
function StatCard({ n, label, sub, tone, active, onClick }: { n: number | string; label: string; sub?: string; tone?: 'red' | 'amber' | 'slate'; active?: boolean; onClick?: () => void }) {
  const dot = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'slate' ? 'bg-slate-400' : '';
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
      className={`bg-white/[0.78] backdrop-blur-md rounded-2xl border p-4 transition-all ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:border-[var(--accent)]/50' : ''} ${active ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30' : 'border-[var(--border)]'}`}
    >
      <div className="flex items-center gap-2">
        {dot && <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />}
        <span className="text-2xl font-extrabold text-[var(--text-primary)] tabular-nums">{n}</span>
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{label}</div>
      {sub && <div className="text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function FinalAccountsTool({ seed, onBack, meName }: { seed: FinalAccountsSeed | null; onBack: () => void; meName: string }) {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/final-accounts', appState);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [isVatRegistered, setIsVatRegistered] = useState(false);
  const [relevantContext, setRelevantContext] = useState('');
  const [preparerName, setPreparerName] = useState('');
  const [reviewerName, setReviewerName] = useState('');

  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const clientCode = selectedClient?.client_ref ?? '';

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
        business_type: seed.client.business_type ?? null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
    }
    setBusinessName(seed.businessName ?? '');
    setBusinessType(seed.businessType ?? '');
    setIsVatRegistered(!!seed.isVatRegistered);
    setRelevantContext(seed.relevantContext ?? '');
    setPreparerName(seed.preparerName ?? '');
    setReviewerName(seed.reviewerName ?? '');
    setPeriodStart(seed.periodStart ?? '');
    setPeriodEnd(seed.periodEnd ?? '');
    setReviewPoints(seed.reviewPoints ?? []);
    setWorkingPapersHistory([[], seed.workingPapers ?? []]);
    setWpHistoryIndex(1);
    setSavedOutputId(seed.id);
    setPointStatus(seed.pointStatuses ?? {});
    setStatusHistory(seed.statusHistory ?? []);
    setAppState('success');
  }, [seed]);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/final-accounts');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/final-accounts') return;
      const p = consumePendingClient('/final-accounts');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);

  // Pre-populate fields when a client is selected
  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setBusinessName(selectedClient.name);
    if (selectedClient.business_type) setBusinessType(selectedClient.business_type);
    if (selectedClient.vat_number) setIsVatRegistered(true);
  }, [selectedClient]);
  // Uploaded documents (the "accounts package") + their detected category.
  const [docs, setDocs] = useState<Doc[]>([]);
  const [reviewType, setReviewType] = useState('full');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const addFiles = (files: FileList | File[]) => {
    const incoming = Array.from(files).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (incoming.length === 0) return;
    setDocs(prev => [...prev, ...incoming.map(f => ({ id: crypto.randomUUID(), file: f, cat: detectCat(f.name) }))]);
  };
  const removeDoc = (id: string) => setDocs(prev => prev.filter(d => d.id !== id));
  const retagDoc = (id: string, cat: DocCat) => setDocs(prev => prev.map(d => d.id === id ? { ...d, cat } : d));

  const [reviewPoints, setReviewPoints] = useState<ReviewPoint[]>([]);
  const [workingPapersHistory, setWorkingPapersHistory] = useState<WorkingPaper[][]>([[]]);
  const [wpHistoryIndex, setWpHistoryIndex] = useState(0);
  const [isGeneratingPapers, setIsGeneratingPapers] = useState(false);
  const [wpProgress, setWpProgress] = useState(0);
  const wpProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [wpError, setWpError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'review' | 'papers' | 'finalpack'>('review');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [wpSaveModalOpen, setWpSaveModalOpen] = useState(false);
  const [finalPackModalOpen, setFinalPackModalOpen] = useState(false);
  // Save & continue — track the saved run's id so re-saves update it (no dupes),
  // plus a transient success/error toast.
  const [savedOutputId, setSavedOutputId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<{ ok: boolean; msg: string } | null>(null);
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(null), 4000);
    return () => clearTimeout(t);
  }, [saveToast]);
  // Results-view (findings master-detail) state
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [pointStatus, setPointStatus] = useState<Record<number, 'reviewed' | 'ignored'>>({});
  const [statusHistory, setStatusHistory] = useState<ReviewStatusEvent[]>([]);
  const [findingsPage, setFindingsPage] = useState(1);
  const [detailTab, setDetailTab] = useState<string>('overview');
  const [sevFilter, setSevFilter] = useState<'Serious' | 'Medium' | 'Minor' | null>(null);

  // Auto-select the most-severe finding whenever a new review loads.
  useEffect(() => {
    if (!reviewPoints.length) return;
    const top = reviewPoints
      .map((p, i) => ({ p, i }))
      .sort((a, b) => sevOf(a.p.severity).rank - sevOf(b.p.severity).rank)[0];
    setSelectedIdx(top.i);
    setFindingsPage(1);
    setSevFilter(null);
  }, [reviewPoints]);

  const workingPapers = workingPapersHistory[wpHistoryIndex] || [];
  const allFiles = docs.map(d => d.file);
  const hasCat = (c: DocCat) => docs.some(d => d.cat === c);
  const requiredUploaded = REQUIRED_CATS.filter(c => hasCat(c.key)).length;
  // Gate on the essentials only — business type, year end and at least one
  // document. The AI receives every uploaded file regardless of its tag, so a
  // combined "accounts package" PDF (or a mis-detected filename) shouldn't block
  // the user; the AI Readiness checklist is live guidance, not a hard barrier.
  const canProcess = !!(businessType && periodEnd && docs.length > 0);
  // The single most relevant thing still blocking "Analyse" — surfaced next to
  // the button so a disabled state is never a mystery (e.g. a forgotten year end
  // even when all the files are detected).
  const missingMsg = docs.length === 0 ? 'Upload your accounts to continue'
    : !businessType ? 'Select a business type'
    : !periodEnd ? 'Add a year end to continue'
    : '';
  const serious = reviewPoints.filter(p => p.severity === 'Serious');
  const medium = reviewPoints.filter(p => p.severity === 'Medium');
  const minor = reviewPoints.filter(p => p.severity === 'Minor');
  // Findings ordered by severity (keeping original index for selection/status),
  // then filtered by the active severity chip (if any).
  const sortedFindings = reviewPoints.map((p, i) => ({ p, i })).sort((a, b) => sevOf(a.p.severity).rank - sevOf(b.p.severity).rank);
  const filteredFindings = sevFilter ? sortedFindings.filter(f => f.p.severity === sevFilter) : sortedFindings;
  const findingsTotalPages = Math.max(1, Math.ceil(filteredFindings.length / FINDINGS_PAGE_SIZE));
  const findingsPageSafe = Math.min(findingsPage, findingsTotalPages);
  const findingsOnPage = filteredFindings.slice((findingsPageSafe - 1) * FINDINGS_PAGE_SIZE, findingsPageSafe * FINDINGS_PAGE_SIZE);
  const selectedPoint: ReviewPoint | undefined = reviewPoints[selectedIdx] ?? reviewPoints[0];
  const selectedStatus = pointStatus[selectedIdx];
  const togglePointStatus = (status: 'reviewed' | 'ignored') => {
    const action: ReviewStatusEvent['action'] = pointStatus[selectedIdx] === status ? 'reopened' : status;
    setPointStatus(s => {
      const next = { ...s };
      if (next[selectedIdx] === status) delete next[selectedIdx]; else next[selectedIdx] = status;
      return next;
    });
    setStatusHistory(h => [...h, { pointIndex: selectedIdx, issue: selectedPoint?.issue, action, byName: meName || undefined, at: new Date().toISOString() }]);
  };

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setAppState('loading'); setError(null); setProgress(0);
    const est = (5 + allFiles.length * 2) * 1000; let elapsed = 0;
    progressRef.current = setInterval(() => { elapsed += 100; setProgress(Math.min(99, (elapsed / est) * 100)); }, 100);
    try {
      const fileData = await Promise.all(allFiles.map(async f => ({ name: f.name, mimeType: f.type || 'application/pdf', base64: await fileToBase64(f) })));
      const res = await fetch('/api/final-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessName, clientCode, businessType, isVatRegistered, periodStart, periodEnd, relevantContext, files: fileData, clientId: selectedClient?.id ?? null }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      if (progressRef.current) clearInterval(progressRef.current);
      setProgress(100);
      setReviewPoints((data.reviewPoints || []).filter(Boolean));
      // Working papers are produced separately, on demand, via "Produce Working
      // Papers" — so the review response stays small and never truncates. Start
      // with an empty working-papers history and land on the Review tab.
      setWorkingPapersHistory([[]]);
      setWpHistoryIndex(0);
      setActiveTab('review');
      setSelectedIdx(0); setPointStatus({}); setStatusHistory([]); setFindingsPage(1); setDetailTab('overview');
      setSavedOutputId(null); // a fresh analysis is a new run until first saved
      setAppState('success');
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      setError(err instanceof Error ? err.message : 'Unknown error'); setAppState('error'); setProgress(0);
    }
  }, [canProcess, businessName, clientCode, businessType, isVatRegistered, periodStart, periodEnd, relevantContext, allFiles, selectedClient?.id]);

  // Produce (or regenerate) the working papers on demand — step 2 of the job.
  // The documents are re-sent so the AI can extract the figures that populate
  // the schedules; the A1 narrative is written from the review points.
  const handleGenerateWorkingPapers = useCallback(async () => {
    if (reviewPoints.length === 0) return;
    setIsGeneratingPapers(true);
    setWpError(null);
    // Fake-but-reassuring progress: climbs toward ~96% over an estimate based on
    // the document count (working papers re-read the accounts, ~a minute), then
    // jumps to 100% on completion. Same pattern as the analysis step.
    setWpProgress(0);
    const est = (10 + allFiles.length * 3) * 1000; let elapsed = 0;
    wpProgressRef.current = setInterval(() => { elapsed += 100; setWpProgress(Math.min(96, (elapsed / est) * 100)); }, 100);
    try {
      const fileData = await Promise.all(allFiles.map(async f => ({ name: f.name, mimeType: f.type || 'application/pdf', base64: await fileToBase64(f) })));
      const res = await fetch('/api/final-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'working_papers', businessName, clientCode, businessType, isVatRegistered, periodStart, periodEnd, relevantContext, preparerName, reviewPoints, files: fileData, clientId: selectedClient?.id ?? null }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      const newPapers = (data.workingPapers || []).filter(Boolean);
      if (newPapers.length === 0) throw new Error('No working papers returned. Please try again.');
      if (wpProgressRef.current) clearInterval(wpProgressRef.current);
      setWpProgress(100);
      const newHistory = workingPapersHistory.slice(0, wpHistoryIndex + 1);
      setWorkingPapersHistory([...newHistory, newPapers]); setWpHistoryIndex(newHistory.length); setActiveTab('papers');
    } catch (err) {
      setWpError(err instanceof Error ? err.message : 'Working papers generation failed. Please try again.');
    } finally {
      if (wpProgressRef.current) clearInterval(wpProgressRef.current);
      setIsGeneratingPapers(false);
    }
  }, [reviewPoints, allFiles, businessName, clientCode, businessType, isVatRegistered, periodStart, periodEnd, relevantContext, preparerName, selectedClient?.id, workingPapersHistory, wpHistoryIndex]);

  const reportHtml = generateReportHtml(businessName, clientCode, businessType, periodStart, periodEnd, preparerName, relevantContext, reviewPoints, workingPapers);
  const reportFileName = `Final_Accounts_Review_${businessName.replace(/\s+/g, '_') || 'Report'}`;
  const wpReportHtml = generateReportHtml(businessName, clientCode, businessType, periodStart, periodEnd, preparerName, relevantContext, [], workingPapers);
  const wpReportFileName = `Working_Papers_${businessName.replace(/\s+/g, '_') || 'Report'}`;
  // Final Pack — the consolidated review report + working papers, with current
  // reviewed/ignored statuses and a sign-off section.
  const finalPackHtml = generateReportHtml(businessName, clientCode, businessType, periodStart, periodEnd, preparerName, relevantContext, reviewPoints, workingPapers, { statuses: pointStatus, finalPack: true, reviewerName });
  const finalPackFileName = `Final_Pack_${businessName.replace(/\s+/g, '_') || 'Report'}`;

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = allFiles.map(f => ({ name: f.name, status: 'processing' as const }));
    return (
      <ProcessingView
        progress={progress}
        fileCount={allFiles.length}
        files={processingFiles}
        steps={['Reading financial statements', 'Analysing performance', 'Identifying review points', 'Compiling review']}
      />
    );
  }
  if (appState === 'error') return (
    <ToolLayout title="Accounts Review" icon={ClipboardCheck} iconColor="#7C3AED" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  // ── Save the full run to outputs history (Save & continue).
  // Updates the same record when we already have an id (no duplicates), persists
  // the reviewed/ignored statuses, and shows a toast unless `silent`. Used by the
  // green Save button AND as a side-effect of the SaveReportModal exports.
  const persistRun = async (
    currentClient: SelectedClient | null,
    currentClientCode: string,
    opts: { silent?: boolean } = {},
  ): Promise<string | null> => {
    setSaving(true);
    try {
      const sourceFilenames = Array.from(new Set(allFiles.map(f => f.name)));
      const res = await fetch('/api/outputs/final-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputId: savedOutputId,
          clientId: currentClient?.id ?? null,
          clientName: currentClient?.name ?? businessName ?? null,
          clientCode: currentClientCode || clientCode || null,
          businessName, businessType, isVatRegistered, periodStart, periodEnd,
          relevantContext, preparerName, reviewerName, reviewPoints, workingPapers, sourceFilenames,
          pointStatuses: pointStatus,
          statusHistory,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Save failed');
      const data = await res.json();
      if (data?.id) setSavedOutputId(data.id);
      if (!opts.silent) setSaveToast({ ok: true, msg: 'Saved — reopen any time from history.' });
      return data?.id ?? null;
    } catch (err) {
      if (!opts.silent) setSaveToast({ ok: false, msg: err instanceof Error ? err.message : 'Save failed. Please try again.' });
      else console.error('[FinalAccounts] history save failed:', err);
      return null;
    } finally {
      setSaving(false);
    }
  };

  return (
    <ToolLayout title="Accounts Review" description="Review financial statements against UK GAAP, produce review points with suggested journals, and generate working papers." icon={ClipboardCheck} iconColor="#7C3AED" wide>
      <BackToHistory onBack={onBack} />

      {/* Save toast — success/error feedback, auto-dismisses */}
      {saveToast && (
        <div className={`fixed bottom-6 right-6 z-[60] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-semibold animate-slide-up ${saveToast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {saveToast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {saveToast.msg}
        </div>
      )}

      {appState === 'idle' && (
        <div className="space-y-5">
          <Stepper current={selectedClient ? 2 : 1} />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.5fr)_minmax(0,0.95fr)] gap-5 items-start">

            {/* ── Left: Review Setup ───────────────────────────────────────── */}
            <div className="space-y-4">
              <div className="relative z-30 bg-white/[0.78] backdrop-blur-md rounded-2xl p-5 space-y-4">
                <div>
                  <h3 className="text-base font-bold text-[var(--text-primary)]">Review Setup</h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">Tell us a few details to get started.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Client</label>
                  <ClientSelector value={selectedClient} onSelect={setSelectedClient} align="left" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Business Name</label>
                  <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business name" className="input-base py-1.5 text-sm" />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Business Type <span className="text-red-500">*</span></label>
                  <select value={businessType} onChange={e => setBusinessType(e.target.value)} className="input-base py-1.5 text-sm">
                    <option value="">Select…</option>
                    <option value="sole_trader">Sole Trader</option>
                    <option value="partnership">Partnership</option>
                    <option value="limited_company">Limited Company</option>
                    <option value="rent">Rent</option>
                    <option value="trust">Trust</option>
                    <option value="charity">Charity</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Year End <span className="text-red-500">*</span></label>
                  <input type="date" value={periodEnd} onChange={e => { const v = e.target.value; setPeriodEnd(v); setPeriodStart(deriveStart(v)); }}
                    className={`input-base py-1.5 text-sm w-full ${!periodEnd && docs.length > 0 ? 'border-amber-400 ring-2 ring-amber-400/40' : ''}`} />
                  {!periodEnd && docs.length > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-amber-600 flex items-center gap-1"><AlertCircle size={12} /> Set your year end to run the review.</p>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">VAT Registered?</span>
                  <button type="button" onClick={() => setIsVatRegistered(v => !v)}
                    className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 ${isVatRegistered ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ml-0.5 ${isVatRegistered ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">Review Type</label>
                  <div className="space-y-2">
                    {REVIEW_TYPES.map(rt => {
                      const active = reviewType === rt.key;
                      return (
                        <button key={rt.key} type="button" disabled={!rt.enabled}
                          onClick={() => rt.enabled && setReviewType(rt.key)}
                          className={`w-full flex items-start gap-3 text-left rounded-xl border p-3 transition-colors ${
                            active ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                              : rt.enabled ? 'border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
                              : 'border-[var(--border)] opacity-60 cursor-not-allowed'
                          }`}>
                          <span className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 shrink-0 ${active ? 'border-[var(--accent)]' : 'border-[var(--border-input)]'}`}>
                            {active && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                              {rt.title}
                              {!rt.enabled && <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-1.5 py-0.5 rounded-full">Soon</span>}
                            </span>
                            <span className="block text-xs text-[var(--text-muted)] mt-0.5">{rt.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <details className="group">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--accent)] list-none">More details</summary>
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Preparer Name</label>
                      <input value={preparerName} onChange={e => setPreparerName(e.target.value)} placeholder="Optional" className="input-base py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Relevant Context</label>
                      <textarea value={relevantContext} onChange={e => setRelevantContext(e.target.value)} placeholder="Anything else we should know? (optional)" rows={2} className="input-base py-1.5 text-sm resize-none" />
                    </div>
                  </div>
                </details>
              </div>
            </div>

            {/* ── Center: Upload accounts package ──────────────────────────── */}
            <div className="space-y-4">
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                className="rounded-2xl border-2 border-dashed border-[var(--border-input)] bg-white/[0.45] backdrop-blur-md p-8 text-center"
              >
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-light)]">
                  <UploadCloud size={28} className="text-[var(--accent)]" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-[var(--text-primary)]">Upload your <span className="text-[var(--accent)]">accounts package</span></h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">We&apos;ll automatically detect and extract what we need.</p>

                <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-primary mx-auto mt-5">
                  <UploadCloud size={15} /> Drag and drop files here
                </button>

                <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <div className="flex-1 h-px bg-[var(--border)]" /> or <div className="flex-1 h-px bg-[var(--border)]" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary justify-center bg-white">
                    <UploadCloud size={14} /> Upload from device
                  </button>
                  <Tooltip label="Connecting to SMITH Bookkeeping is coming soon">
                    <button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">
                      <BookCopy size={14} /> Connect to SMITH Bookkeeping
                    </button>
                  </Tooltip>
                </div>

                <div className="my-5 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                  <div className="flex-1 h-px bg-[var(--border)]" /> <span className="whitespace-nowrap">or connect from your accounting software</span> <div className="flex-1 h-px bg-[var(--border)]" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Tooltip label="Xero integration is coming soon">
                    <button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">Connect Xero</button>
                  </Tooltip>
                  <Tooltip label="QuickBooks integration is coming soon">
                    <button type="button" disabled className="btn-secondary justify-center w-full opacity-60 cursor-not-allowed">Connect QuickBooks</button>
                  </Tooltip>
                </div>

                <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden"
                  onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
              </div>

              {/* Uploaded files — detected category shown, re-taggable */}
              {docs.length > 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">{docs.length} file{docs.length > 1 ? 's' : ''} uploaded</p>
                  {docs.map(d => (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-white/60 px-3 py-2">
                      <FileText size={16} className="text-[var(--text-muted)] shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">{d.file.name}</span>
                      <select value={d.cat} onChange={e => retagDoc(d.id, e.target.value as DocCat)}
                        className="input-base py-1 px-2 text-xs w-auto shrink-0">
                        {[...REQUIRED_CATS, ...OPTIONAL_CATS].map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        <option value="other">Other / Unsorted</option>
                      </select>
                      <button type="button" onClick={() => removeDoc(d.id)} aria-label="Remove file" className="text-[var(--text-muted)] hover:text-red-500 shrink-0">
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* What we'll extract automatically */}
              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]"><Sparkles size={14} className="text-[var(--accent)]" /> What we&apos;ll extract automatically</span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><Calculator size={13} /> Trial Balance</span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><TrendingUp size={13} /> Profit &amp; Loss</span>
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]"><Scale size={13} /> Balance Sheet</span>
                <span className="text-xs text-[var(--text-muted)]">and more…</span>
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <ShieldCheck size={15} className="text-[var(--accent)] shrink-0" />
                  <span><span className="font-semibold text-[var(--text-secondary)]">Bank-grade encryption.</span> Your files are never used to train AI models.</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    requiredUploaded === REQUIRED_CATS.length ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-[var(--text-secondary)] border-[var(--border)]'
                  }`}>
                    {requiredUploaded === REQUIRED_CATS.length && <Check size={12} />}
                    {requiredUploaded} of {REQUIRED_CATS.length} required detected
                  </span>
                  {missingMsg && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                      <AlertCircle size={13} /> {missingMsg}
                    </span>
                  )}
                  <button onClick={handleProcess} disabled={!canProcess} className="btn-primary"><ClipboardCheck size={15} /> Analyse Documents</button>
                </div>
              </div>
            </div>

            {/* ── Right: AI Readiness + What happens next ──────────────────── */}
            <div className="space-y-4">
              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
                <h3 className="text-base font-bold text-[var(--text-primary)]">AI Readiness</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">We&apos;ll let you know when your files are ready to review.</p>
                <p className="mt-4 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Required</p>
                <div className="mt-1">
                  {REQUIRED_CATS.map(c => <ReadyRow key={c.key} label={c.label} done={hasCat(c.key)} />)}
                </div>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Optional</p>
                <div className="mt-1">
                  {OPTIONAL_CATS.map(c => <ReadyRow key={c.key} label={c.label} done={hasCat(c.key)} />)}
                </div>
              </div>

              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl p-5">
                <h3 className="text-base font-bold text-[var(--text-primary)]">What happens next?</h3>
                <div className="mt-4 space-y-4">
                  {[
                    { icon: Sparkles, title: 'Smith analyses your accounts', desc: 'Our AI reviews your data and identifies key risks and anomalies.' },
                    { icon: ClipboardCheck, title: 'Review findings', desc: "You'll review our points and mark what needs attention." },
                    { icon: FileText, title: 'Generate working papers', desc: 'Smith creates your documents and supporting schedules.' },
                  ].map((s, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[var(--accent)]"><s.icon size={15} /></div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--text-primary)]"><span className="text-[var(--text-muted)]">{i + 1}</span> {s.title}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{s.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

        </div>
      )}
      {appState === 'success' && (
        <div className="space-y-4">
          <Stepper current={activeTab === 'finalpack' ? 5 : activeTab === 'papers' ? 4 : 3} />
          {/* Working-papers generation progress — sticky so it stays visible
              while the user keeps reading the review below. */}
          {isGeneratingPapers && (
            <div className="sticky top-0 z-20 overflow-hidden rounded-xl border border-[var(--border)] bg-white/90 backdrop-blur-md shadow-sm">
              <div className="flex items-center gap-3 px-4 py-3">
                <Loader2 size={18} className="animate-spin text-[var(--accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {workingPapers.length > 0 ? 'Regenerating working papers…' : 'Producing working papers…'}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Extracting figures from the accounts and building your schedules. This can take up to a minute — feel free to keep reading the review.
                  </p>
                </div>
                <span className="text-xs font-semibold text-[var(--accent)] tabular-nums shrink-0">{Math.round(wpProgress)}%</span>
              </div>
              <div className="h-1 bg-[var(--bg-nav-hover)]">
                <div className="h-full bg-[var(--accent)] transition-[width] duration-200 ease-out" style={{ width: `${wpProgress}%` }} />
              </div>
            </div>
          )}
          {/* Actions */}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <Tooltip label="Save your progress — reopen and continue any time from history">
              <button onClick={() => void persistRun(selectedClient, clientCode)} disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 shadow-[0_4px_12px_rgba(16,185,129,0.3)] transition-all">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? 'Saving…' : 'Save'}
              </button>
            </Tooltip>
            {activeTab === 'review' && (
              <button onClick={() => setSaveModalOpen(true)} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
                <Download size={14} />Export Report
              </button>
            )}
            {activeTab === 'papers' && workingPapers.length > 0 && (
              <button onClick={() => setWpSaveModalOpen(true)} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
                <Download size={14} />Export Working Papers
              </button>
            )}
            <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers || reviewPoints.length === 0} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
              <FileText size={14} />{isGeneratingPapers
                ? (workingPapers.length > 0 ? 'Regenerating…' : 'Producing…')
                : (workingPapers.length > 0 ? 'Regenerate Working Papers' : 'Produce Working Papers')}
            </button>
            <button onClick={() => setAppState('idle')} className="btn-primary">New Review</button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-gradient-to-br from-[var(--accent-light)] to-white/40 backdrop-blur-md rounded-2xl border border-[var(--border)] p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent)] text-white"><Sparkles size={16} /></div>
              <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">Review Complete</p>
              <p className="text-xs text-[var(--text-muted)]">Smith analysed your accounts and found the following.</p>
            </div>
            <StatCard n={reviewPoints.length} label="Review Points" active={sevFilter === null} onClick={() => { setSevFilter(null); setFindingsPage(1); }} />
            <StatCard n={serious.length} label="Serious" sub="Requires attention" tone="red" active={sevFilter === 'Serious'} onClick={() => { setSevFilter(f => f === 'Serious' ? null : 'Serious'); setFindingsPage(1); }} />
            <StatCard n={medium.length} label="Medium" sub="Review recommended" tone="amber" active={sevFilter === 'Medium'} onClick={() => { setSevFilter(f => f === 'Medium' ? null : 'Medium'); setFindingsPage(1); }} />
            <StatCard n={minor.length} label="Minor" sub="Low priority" tone="slate" active={sevFilter === 'Minor'} onClick={() => { setSevFilter(f => f === 'Minor' ? null : 'Minor'); setFindingsPage(1); }} />
          </div>

          {/* Context bar */}
          <div className="flex items-center justify-between flex-wrap gap-2 rounded-xl bg-white/[0.6] backdrop-blur-md border border-[var(--border)] px-4 py-2.5">
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-sm text-[var(--text-secondary)]">
              {periodEnd && <span>Review period: <span className="font-semibold text-[var(--text-primary)]">Year ending {fmtUK(periodEnd)}</span></span>}
              {(businessName || selectedClient?.name) && <><span className="text-[var(--text-muted)]">·</span><span>Client: <span className="font-semibold text-[var(--text-primary)]">{businessName || selectedClient?.name}</span></span></>}
              {preparerName && <><span className="text-[var(--text-muted)]">·</span><span>Prepared by: <span className="font-semibold text-[var(--text-primary)]">{preparerName}</span></span></>}
            </div>
            {selectedClient && (
              <a href={`/clients/${selectedClient.id}`} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-[var(--accent)] hover:underline whitespace-nowrap">View client record →</a>
            )}
          </div>

          {/* Main tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { key: 'review', label: 'Findings', count: reviewPoints.length },
              { key: 'papers', label: 'Working Papers', count: workingPapers.length },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                  activeTab === t.key ? 'bg-[#2e3062] text-white border-[#2e3062]' : 'bg-white text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
                }`}>
                {t.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === t.key ? 'bg-white/20' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>{t.count}</span>
              </button>
            ))}
            <button onClick={() => setActiveTab('finalpack')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-all ${
                activeTab === 'finalpack' ? 'bg-[#2e3062] text-white border-[#2e3062]' : 'bg-white text-[var(--text-secondary)] border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
              }`}>
              Final Pack
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-1.5 py-0.5 rounded-full">Not generated</span>
            </button>
          </div>

          {wpError && (
            <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
              <span className="shrink-0 font-semibold">Error:</span> {wpError}
            </div>
          )}

          <SaveReportModal
            isOpen={saveModalOpen}
            reportHtml={reportHtml}
            reportFileName={reportFileName}
            feature="final_accounts_review"
            documentType="report"
            initialClient={selectedClient}
            onAfterSave={ctx => { void persistRun(ctx.client, ctx.clientCode, { silent: true }); }}
            onClose={() => setSaveModalOpen(false)}
          />

          <SaveReportModal
            isOpen={wpSaveModalOpen}
            reportHtml={wpReportHtml}
            reportFileName={wpReportFileName}
            feature="final_accounts_review"
            documentType="working_papers"
            initialClient={selectedClient}
            onAfterSave={ctx => { void persistRun(ctx.client, ctx.clientCode, { silent: true }); }}
            onClose={() => setWpSaveModalOpen(false)}
          />

          <SaveReportModal
            isOpen={finalPackModalOpen}
            reportHtml={finalPackHtml}
            reportFileName={finalPackFileName}
            feature="final_accounts_review"
            documentType="final_pack"
            initialClient={selectedClient}
            onAfterSave={ctx => { void persistRun(ctx.client, ctx.clientCode, { silent: true }); }}
            onClose={() => setFinalPackModalOpen(false)}
          />

          {activeTab === 'review' && (
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] gap-4 items-start">
              {/* Findings list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-sm font-bold text-[var(--text-primary)]">
                    {sevFilter ? `${sevFilter} points` : 'All Review Points'} <span className="font-medium text-[var(--text-muted)]">({filteredFindings.length})</span>
                  </p>
                  {sevFilter && (
                    <button onClick={() => { setSevFilter(null); setFindingsPage(1); }} className="text-xs font-semibold text-[var(--accent)] hover:underline">Clear filter</button>
                  )}
                </div>
                {findingsOnPage.map(({ p, i }) => {
                  const sv = sevOf(p.severity);
                  const st = pointStatus[i];
                  const isSel = selectedIdx === i;
                  return (
                    <button key={i} onClick={() => { setSelectedIdx(i); setDetailTab('overview'); }}
                      className={`w-full text-left rounded-xl border bg-white/[0.78] backdrop-blur-md p-4 border-l-4 ${sv.bar} transition-all ${isSel ? 'ring-2 ring-[var(--accent)]/40' : 'hover:bg-white'} ${st === 'ignored' ? 'opacity-50' : ''}`}>
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sv.badge}`}>{p.severity}</span>
                            {st === 'reviewed' && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><CheckCircle2 size={12} /> Reviewed</span>}
                            {st === 'ignored' && <span className="text-[11px] font-semibold text-[var(--text-muted)]">Ignored</span>}
                          </div>
                          <h4 className="mt-1.5 font-bold text-[var(--text-primary)] text-[15px] leading-snug truncate">{p.issue}</h4>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{p.area}{p.subArea ? ` · ${p.subArea}` : ''}</p>
                        </div>
                        {p.metric?.value && (
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-[var(--text-primary)] tabular-nums">{p.metric.value}</div>
                            {p.metric.label && <div className="text-[11px] text-[var(--text-muted)]">{p.metric.label}</div>}
                          </div>
                        )}
                      </div>
                      {p.tag && <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{p.tag}</p>}
                    </button>
                  );
                })}

                {findingsTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-[var(--text-muted)]">Showing {(findingsPageSafe - 1) * FINDINGS_PAGE_SIZE + 1}–{Math.min(findingsPageSafe * FINDINGS_PAGE_SIZE, filteredFindings.length)} of {filteredFindings.length}</span>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: findingsTotalPages }, (_, k) => k + 1).map(pg => (
                        <button key={pg} onClick={() => setFindingsPage(pg)}
                          className={`h-7 w-7 rounded-lg text-xs font-semibold ${pg === findingsPageSafe ? 'bg-[var(--accent)] text-white' : 'bg-white text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>{pg}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Detail panel */}
              <div className="lg:sticky lg:top-4">
                {selectedPoint ? (
                  <div className="bg-white rounded-2xl border border-[var(--border)] shadow-[var(--shadow-card)] overflow-hidden">
                    <div className="p-5 border-b border-[var(--border)]">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sevOf(selectedPoint.severity).badge}`}>{selectedPoint.severity}</span>
                      <h3 className="mt-2 text-lg font-bold text-[var(--text-primary)] leading-snug">{selectedPoint.issue}</h3>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{selectedPoint.area}{selectedPoint.subArea ? ` · ${selectedPoint.subArea}` : ''}</p>
                    </div>

                    {/* Detail tabs */}
                    <div className="flex items-center gap-4 px-5 border-b border-[var(--border)] overflow-x-auto overflow-y-hidden scrollbar-thin">
                      {DETAIL_TABS.map(dt => (
                        <button key={dt.key} onClick={() => setDetailTab(dt.key)}
                          className={`py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${detailTab === dt.key ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>{dt.label}</button>
                      ))}
                    </div>

                    <div className="p-5 space-y-4">
                      {detailTab === 'overview' && (<>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">Issue</p>
                          <div className="text-sm leading-relaxed text-[var(--text-secondary)] space-y-2">{toParagraphs(selectedPoint.explanation).map((para, k) => <p key={k}>{para}</p>)}</div>
                        </div>
                        {selectedPoint.risk && (
                          <div className={`rounded-lg px-4 py-3 ${sevOf(selectedPoint.severity).softBg}`}>
                            <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${sevOf(selectedPoint.severity).softText}`}>Risk</p>
                            <p className={`text-sm leading-relaxed ${sevOf(selectedPoint.severity).softText}`}>{selectedPoint.risk}</p>
                          </div>
                        )}
                        {(selectedPoint.metric?.value || selectedPoint.metric?.delta) && (
                          <div className="grid grid-cols-2 gap-3">
                            {selectedPoint.metric?.value && (<div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Impact</p><p className="text-base font-bold text-[var(--text-primary)] tabular-nums">{selectedPoint.metric.value}</p>{selectedPoint.metric.label && <p className="text-xs text-[var(--text-muted)]">{selectedPoint.metric.label}</p>}</div>)}
                            {selectedPoint.metric?.delta && (<div><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Trend</p><p className="text-base font-bold text-[var(--text-primary)] tabular-nums">{selectedPoint.metric.delta}</p><p className="text-xs text-[var(--text-muted)]">vs prior year</p></div>)}
                          </div>
                        )}
                        {selectedPoint.suggestedJournal && selectedPoint.suggestedJournal.debitAccount && selectedPoint.suggestedJournal.debitAccount !== 'None' && (
                          <button onClick={() => setDetailTab('action')} className="w-full text-left rounded-lg bg-[var(--bg-nav-hover)] px-4 py-3">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-1">Suggested journal</p>
                            {selectedPoint.suggestedJournal.description && <p className="text-sm text-[var(--text-secondary)]">{selectedPoint.suggestedJournal.description}</p>}
                            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)]">View suggested journal →</span>
                          </button>
                        )}
                      </>)}

                      {detailTab === 'explanation' && (
                        <div className="text-sm leading-relaxed text-[var(--text-secondary)] space-y-2">{toParagraphs(selectedPoint.explanation).map((para, k) => <p key={k}>{para}</p>)}</div>
                      )}

                      {detailTab === 'sources' && (
                        <p className="text-sm text-[var(--text-muted)]">Source-document linking is coming soon — we&apos;ll point each finding to the exact document and page it came from.</p>
                      )}

                      {detailTab === 'action' && (
                        selectedPoint.suggestedJournal && selectedPoint.suggestedJournal.debitAccount && selectedPoint.suggestedJournal.debitAccount !== 'None' ? (
                          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                            {selectedPoint.suggestedJournal.description && <div className="px-3 py-2 bg-[var(--bg-nav-hover)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]"><span className="font-semibold text-[var(--text-secondary)]">Note: </span>{selectedPoint.suggestedJournal.description}</div>}
                            <table className="w-full text-xs">
                              <thead><tr className="border-b border-[var(--border)] bg-[var(--bg-nav-hover)]"><th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Account</th><th className="text-right px-3 py-2 font-semibold text-[var(--text-muted)]">Debit (£)</th><th className="text-right px-3 py-2 font-semibold text-[var(--text-muted)]">Credit (£)</th></tr></thead>
                              <tbody>
                                <tr className="border-b border-[var(--border)]"><td className="px-3 py-2 font-medium text-[var(--text-primary)]">{selectedPoint.suggestedJournal.debitAccount}</td><td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{selectedPoint.suggestedJournal.amount?.toFixed(2)}</td><td className="px-3 py-2"></td></tr>
                                <tr><td className="px-3 py-2 italic text-[var(--text-secondary)] pl-7">{selectedPoint.suggestedJournal.creditAccount}</td><td className="px-3 py-2"></td><td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{selectedPoint.suggestedJournal.amount?.toFixed(2)}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        ) : <p className="text-sm text-[var(--text-muted)]">No suggested journal for this point.</p>
                      )}

                      {detailTab === 'history' && (() => {
                        const events = statusHistory.filter(e => e.pointIndex === selectedIdx).slice().reverse();
                        return events.length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)]">No changes yet. When you mark this point reviewed or ignored, it&apos;ll be logged here.</p>
                        ) : (
                          <ul className="space-y-3">
                            {events.map((e, k) => (
                              <li key={k} className="flex gap-3">
                                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${e.action === 'reviewed' ? 'bg-emerald-500' : e.action === 'ignored' ? 'bg-slate-400' : 'bg-amber-500'}`} />
                                <div>
                                  <p className="text-sm text-[var(--text-primary)]"><span className="font-semibold">{e.byName || 'Someone'}</span> {e.action === 'reopened' ? 'reopened this point' : `marked as ${e.action}`}</p>
                                  <p className="text-xs text-[var(--text-muted)]">{new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        );
                      })()}
                    </div>

                    {/* Detail actions */}
                    <div className="flex items-center gap-2 flex-wrap p-5 border-t border-[var(--border)]">
                      <button onClick={() => togglePointStatus('reviewed')} className="btn-primary">
                        <CheckCircle2 size={15} /> {selectedStatus === 'reviewed' ? 'Reviewed ✓' : 'Mark as reviewed'}
                      </button>
                      <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers} className="btn-secondary bg-white">
                        <FileText size={14} /> Generate working papers
                      </button>
                      <button onClick={() => togglePointStatus('ignored')} className="btn-ghost">
                        <X size={14} /> {selectedStatus === 'ignored' ? 'Un-ignore' : 'Ignore'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/[0.78] rounded-2xl border border-[var(--border)] p-10 text-center text-sm text-[var(--text-muted)]">Select a finding to see the detail.</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'finalpack' && (
            workingPapers.length === 0 ? (
              <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl border border-[var(--border)] p-10 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-light)] text-[var(--accent)]"><FileText size={22} /></div>
                <p className="mt-3 text-base font-bold text-[var(--text-primary)]">Assemble the Final Pack</p>
                <p className="mt-1 text-sm text-[var(--text-muted)] max-w-md mx-auto">The Final Pack combines your review, the suggested journals and the working papers into one client-ready document. Produce the working papers to assemble it.</p>
                <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers} className="btn-primary mx-auto mt-4">
                  <FileText size={14} />{isGeneratingPapers ? 'Producing…' : 'Produce Working Papers'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
                {/* Pack summary */}
                <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl border border-[var(--border)] p-6 space-y-5">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Final Accounts Review — Final Pack</p>
                    <h3 className="text-xl font-extrabold text-[var(--text-primary)] mt-1">{businessName || selectedClient?.name || 'Client'}</h3>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { l: 'Period', v: periodEnd ? `Year ending ${fmtUK(periodEnd)}` : '—' },
                        { l: 'Client code', v: clientCode || '—' },
                        { l: 'Prepared by', v: preparerName || '—' },
                        { l: 'Points', v: `${reviewPoints.length}` },
                      ].map(m => (
                        <div key={m.l}><p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{m.l}</p><p className="text-sm font-semibold text-[var(--text-primary)]">{m.v}</p></div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700"><span className="h-2 w-2 rounded-full bg-red-500" />{serious.length} Serious</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" />{medium.length} Medium</span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-400" />{minor.length} Minor</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2">Findings &amp; resolution</p>
                    <div className="space-y-1.5">
                      {sortedFindings.map(({ p, i }) => {
                        const st = pointStatus[i];
                        return (
                          <div key={i} className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sevOf(p.severity).badge}`}>{p.severity}</span>
                            <span className="flex-1 min-w-0 truncate text-sm text-[var(--text-primary)]">{p.issue}</span>
                            <span className={`text-xs font-semibold ${st === 'reviewed' ? 'text-emerald-600' : st === 'ignored' ? 'text-[var(--text-muted)]' : 'text-amber-600'}`}>{st === 'reviewed' ? 'Reviewed' : st === 'ignored' ? 'Ignored' : 'Open'}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Pack contents + export */}
                <div className="bg-white/[0.78] backdrop-blur-md rounded-2xl border border-[var(--border)] p-5 space-y-3 lg:sticky lg:top-4">
                  <h3 className="text-base font-bold text-[var(--text-primary)]">What&apos;s in the pack</h3>
                  <div className="space-y-2">
                    {['Cover page & period', 'Review summary', `${reviewPoints.length} findings + suggested journals`, `${workingPapers.length} working-paper schedules`, 'Sign-off section'].map(item => (
                      <div key={item} className="flex items-center gap-2.5 text-sm text-[var(--text-secondary)]"><CheckCircle2 size={16} className="text-emerald-500 shrink-0" />{item}</div>
                    ))}
                  </div>
                  <div className="space-y-2.5 pt-1 border-t border-[var(--border)]">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] pt-2">Sign-off</p>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Prepared by</label>
                      <input value={preparerName} onChange={e => setPreparerName(e.target.value)} placeholder="Preparer name" className="input-base py-1.5 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Reviewed by</label>
                      <input value={reviewerName} onChange={e => setReviewerName(e.target.value)} placeholder="Reviewer name" className="input-base py-1.5 text-sm" />
                    </div>
                  </div>
                  <button onClick={() => setFinalPackModalOpen(true)} className="btn-primary w-full justify-center mt-1"><Download size={15} /> Export Final Pack</button>
                  <p className="text-xs text-[var(--text-muted)]">Reviewed/Ignored statuses reflect your current session. Persisting them (and a reviewer sign-off field) is coming next.</p>
                </div>
              </div>
            )
          )}
          {activeTab === 'papers' && workingPapers.length > 0 && (
            <div className="flex items-center gap-2">
              <Tooltip label="Undo">
                <button
                  onClick={() => setWpHistoryIndex(i => i - 1)}
                  disabled={wpHistoryIndex <= 1}
                  aria-label="Undo"
                  className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                ><Undo2 size={14} /></button>
              </Tooltip>
              <Tooltip label="Redo">
                <button
                  onClick={() => setWpHistoryIndex(i => i + 1)}
                  disabled={wpHistoryIndex >= workingPapersHistory.length - 1}
                  aria-label="Redo"
                  className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                ><Redo2 size={14} /></button>
              </Tooltip>
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                {wpHistoryIndex <= 1 ? 'No edits yet' : `Edit ${wpHistoryIndex - 1}`}
              </span>
            </div>
          )}
          {activeTab === 'papers' && (
            <div className="flex flex-col gap-3">
              {workingPapers.length === 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-12 text-center lg:col-span-2">
                  <p className="text-sm text-[var(--text-muted)] mb-3">Review the points first, then produce the working papers — they&apos;re generated from your review and the uploaded accounts.</p>
                  <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers} className="btn-primary mx-auto">
                    <FileText size={14} />{isGeneratingPapers ? 'Producing…' : 'Produce Working Papers'}
                  </button>
                </div>
              )}
              {workingPapers.map((p, i) => (
                <WorkingPaperSection
                  key={i}
                  paper={p}
                  onChange={updated => {
                    const updatedPapers = [...workingPapers];
                    updatedPapers[i] = updated;
                    const newHistory = workingPapersHistory.slice(0, wpHistoryIndex + 1);
                    setWorkingPapersHistory([...newHistory, updatedPapers]);
                    setWpHistoryIndex(newHistory.length);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </ToolLayout>
  );
}
