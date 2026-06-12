'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient, peekPendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import Tooltip from '@/components/ui/Tooltip';
import { ClipboardCheck, FileText, Download, Undo2, Redo2, ArrowLeft, TrendingUp, Scale, Calculator, Check } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import { generateReportHtml } from '@/utils/finalAccountsReport';
import type { ReviewPoint, WorkingPaper } from '@/types';
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
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
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
    <FinalAccountsTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
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

function FinalAccountsTool({ seed, onBack }: { seed: FinalAccountsSeed | null; onBack: () => void }) {
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
    setPeriodStart(seed.periodStart ?? '');
    setPeriodEnd(seed.periodEnd ?? '');
    setReviewPoints(seed.reviewPoints ?? []);
    setWorkingPapersHistory([[], seed.workingPapers ?? []]);
    setWpHistoryIndex(1);
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
  const [currentYearPL, setCurrentYearPL] = useState<File | null>(null);
  const [currentYearBS, setCurrentYearBS] = useState<File | null>(null);
  const [currentYearTB, setCurrentYearTB] = useState<File | null>(null);
  const [priorYearPL, setPriorYearPL] = useState<File | null>(null);
  const [priorYearBS, setPriorYearBS] = useState<File | null>(null);
  const [priorYearTB, setPriorYearTB] = useState<File | null>(null);

  const [reviewPoints, setReviewPoints] = useState<ReviewPoint[]>([]);
  const [workingPapersHistory, setWorkingPapersHistory] = useState<WorkingPaper[][]>([[]]);
  const [wpHistoryIndex, setWpHistoryIndex] = useState(0);
  const [isGeneratingPapers, setIsGeneratingPapers] = useState(false);
  const [wpError, setWpError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'review' | 'papers'>('review');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [wpSaveModalOpen, setWpSaveModalOpen] = useState(false);

  const workingPapers = workingPapersHistory[wpHistoryIndex] || [];
  const allFiles = [currentYearPL, currentYearBS, currentYearTB, priorYearPL, priorYearBS, priorYearTB].filter((f): f is File => f !== null);
  const canProcess = !!(businessType && periodStart && periodEnd && currentYearPL && currentYearBS && currentYearTB);
  const requiredUploaded = [currentYearPL, currentYearBS, currentYearTB].filter(Boolean).length;
  const serious = reviewPoints.filter(p => p.severity === 'Serious');
  const minor = reviewPoints.filter(p => p.severity === 'Minor');

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
      // Working papers come back with the analysis — set them immediately
      if (data.workingPapers?.length > 0) {
        setWorkingPapersHistory([[], data.workingPapers]);
        setWpHistoryIndex(1);
      }
      setAppState('success');
    } catch (err) {
      if (progressRef.current) clearInterval(progressRef.current);
      setError(err instanceof Error ? err.message : 'Unknown error'); setAppState('error'); setProgress(0);
    }
  }, [canProcess, businessName, clientCode, businessType, isVatRegistered, periodStart, periodEnd, relevantContext, allFiles, selectedClient?.id]);

  // Regenerate working papers on demand (e.g. if user wants a fresh A1 after editing review points)
  const handleGenerateWorkingPapers = useCallback(async () => {
    if (reviewPoints.length === 0) return;
    setIsGeneratingPapers(true);
    setWpError(null);
    try {
      const res = await fetch('/api/final-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'working_papers', businessName, clientCode, businessType, periodStart, periodEnd, preparerName, reviewPoints }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      const newPapers = (data.workingPapers || []).filter(Boolean);
      if (newPapers.length === 0) throw new Error('No working papers returned. Please try again.');
      const newHistory = workingPapersHistory.slice(0, wpHistoryIndex + 1);
      setWorkingPapersHistory([...newHistory, newPapers]); setWpHistoryIndex(newHistory.length); setActiveTab('papers');
    } catch (err) {
      setWpError(err instanceof Error ? err.message : 'Working papers generation failed. Please try again.');
    } finally {
      setIsGeneratingPapers(false);
    }
  }, [reviewPoints, businessName, clientCode, businessType, periodStart, periodEnd, preparerName, workingPapersHistory, wpHistoryIndex]);

  const reportHtml = generateReportHtml(businessName, clientCode, businessType, periodStart, periodEnd, preparerName, relevantContext, reviewPoints, workingPapers);
  const reportFileName = `Final_Accounts_Review_${businessName.replace(/\s+/g, '_') || 'Report'}`;
  const wpReportHtml = generateReportHtml(businessName, clientCode, businessType, periodStart, periodEnd, preparerName, relevantContext, [], workingPapers);
  const wpReportFileName = `Working_Papers_${businessName.replace(/\s+/g, '_') || 'Report'}`;

  if (appState === 'loading') {
    const processingFiles: ProgressFile[] = allFiles.map(f => ({ name: f.name, status: 'processing' as const }));
    return (
      <ProcessingView
        progress={progress}
        fileCount={allFiles.length}
        files={processingFiles}
        steps={['Reading financial statements', 'Analysing performance', 'Identifying review points', 'Generating working papers', 'Compiling report']}
      />
    );
  }
  if (appState === 'error') return (
    <ToolLayout title="Accounts Review" icon={ClipboardCheck} iconColor="#7C3AED" wide>
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  // ── Persist a snapshot of the current state to outputs history.
  // Fires after the user clicks Save in either SaveReportModal.
  const persistRunToHistory = (currentClient: SelectedClient | null, currentClientCode: string) => {
    const sourceFilenames = Array.from(new Set(allFiles.map(f => f.name)));
    fetch('/api/outputs/final-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClient?.id ?? null,
        clientName: currentClient?.name ?? businessName ?? null,
        clientCode: currentClientCode || clientCode || null,
        businessName,
        businessType,
        isVatRegistered,
        periodStart,
        periodEnd,
        relevantContext,
        preparerName,
        reviewPoints,
        workingPapers,
        sourceFilenames,
      }),
    }).catch(err => console.error('[FinalAccounts] history save failed:', err));
  };

  return (
    <ToolLayout title="Accounts Review" description="Review financial statements against UK GAAP, produce review points with suggested journals, and generate working papers." icon={ClipboardCheck} iconColor="#7C3AED" wide>
      <BackToHistory onBack={onBack} />
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="relative z-30 bg-white/[0.78] backdrop-blur-md rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Client Details</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">Link to client record</span>
                <ClientSelector value={selectedClient} onSelect={setSelectedClient} align="right" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-2.5">
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business Name" className="input-base py-1.5 text-sm" />
              <select value={businessType} onChange={e => setBusinessType(e.target.value)} className="input-base py-1.5 text-sm">
                <option value="">-- Select Business Type *</option>
                <option value="sole_trader">Sole Trader</option>
                <option value="partnership">Partnership</option>
                <option value="limited_company">Limited Company</option>
                <option value="rent">Rent</option>
                <option value="trust">Trust</option>
                <option value="charity">Charity</option>
                <option value="other">Other</option>
              </select>
              <input value={preparerName} onChange={e => setPreparerName(e.target.value)} placeholder="Preparer Name (Optional)" className="input-base py-1.5 text-sm" />
              <div>
                <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Accounts Start Date <span className="text-red-500">*</span></label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="input-base py-1.5 text-sm w-full" />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Accounts End Date <span className="text-red-500">*</span></label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="input-base py-1.5 text-sm w-full" />
              </div>
              <div className="flex items-center justify-center gap-3">
                <span className="text-sm font-medium text-[var(--text-secondary)]">VAT Registered?</span>
                <button type="button" onClick={() => setIsVatRegistered(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 ${isVatRegistered ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ml-0.5 ${isVatRegistered ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <textarea value={relevantContext} onChange={e => setRelevantContext(e.target.value)} placeholder="Any other relevant context? (Optional)" rows={1} className="input-base py-1.5 text-sm resize-none self-center sm:col-span-2 lg:col-span-2" />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white drop-shadow-sm mb-2 flex items-center gap-2">
              Current Year <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Required</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FileUpload title="Profit &amp; Loss" required icon={<TrendingUp size={14} />} onFileChange={setCurrentYearPL} accept="application/pdf" existingFiles={currentYearPL ? [currentYearPL] : []} />
              <FileUpload title="Balance Sheet" required icon={<Scale size={14} />} onFileChange={setCurrentYearBS} accept="application/pdf" existingFiles={currentYearBS ? [currentYearBS] : []} />
              <FileUpload title="Trial Balance" required icon={<Calculator size={14} />} onFileChange={setCurrentYearTB} accept="application/pdf" existingFiles={currentYearTB ? [currentYearTB] : []} />
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white drop-shadow-sm mb-2 flex items-center gap-2">
              Prior Year <span className="text-[10px] font-semibold uppercase tracking-wider text-white/70">Optional</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <FileUpload title="Profit &amp; Loss" icon={<TrendingUp size={14} />} onFileChange={setPriorYearPL} accept="application/pdf" optional existingFiles={priorYearPL ? [priorYearPL] : []} />
              <FileUpload title="Balance Sheet" icon={<Scale size={14} />} onFileChange={setPriorYearBS} accept="application/pdf" optional existingFiles={priorYearBS ? [priorYearBS] : []} />
              <FileUpload title="Trial Balance" icon={<Calculator size={14} />} onFileChange={setPriorYearTB} accept="application/pdf" optional existingFiles={priorYearTB ? [priorYearTB] : []} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              requiredUploaded === 3
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-white text-[var(--text-secondary)] border-[var(--border)]'
            }`}>
              {requiredUploaded === 3 && <Check size={12} />}
              {requiredUploaded} of 3 required uploaded
            </span>
            <button onClick={handleProcess} disabled={!canProcess} className="btn-primary"><ClipboardCheck size={15} />Analyse Documents</button>
          </div>
        </div>
      )}
      {appState === 'success' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setActiveTab('review')} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${activeTab === 'review' ? 'bg-[#2e3062] text-white border-[#2e3062]' : 'bg-[#dde4f3] text-[#2e3062] border-[#c7d2ea] hover:bg-[#cfd9ee]'}`}>Review Points ({reviewPoints.length})</button>
              <button onClick={() => setActiveTab('papers')} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${activeTab === 'papers' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>Working Papers ({workingPapers.length})</button>
              <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.78] backdrop-blur-md border border-white/40">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400">{serious.length} Serious</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{minor.length} Minor</span>
                </div>
                <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{reviewPoints.length} total</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {activeTab === 'review' && (
                <button onClick={() => setSaveModalOpen(true)} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
                  <Download size={14} />Save Report
                </button>
              )}
              {activeTab === 'papers' && workingPapers.length > 0 && (
                <button onClick={() => setWpSaveModalOpen(true)} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
                  <Download size={14} />Save Working Papers
                </button>
              )}
              <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers || reviewPoints.length === 0} className="btn-secondary bg-white text-[var(--text-primary)] border-white hover:bg-white/90 hover:text-[var(--text-primary)] hover:border-white shadow-sm">
                <FileText size={14} />{isGeneratingPapers ? 'Regenerating…' : 'Regenerate Working Papers'}
              </button>
              <button onClick={() => setAppState('idle')} className="btn-primary">New Review</button>
            </div>
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
            onAfterSave={ctx => persistRunToHistory(ctx.client, ctx.clientCode)}
            onClose={() => setSaveModalOpen(false)}
          />

          <SaveReportModal
            isOpen={wpSaveModalOpen}
            reportHtml={wpReportHtml}
            reportFileName={wpReportFileName}
            feature="final_accounts_review"
            documentType="working_papers"
            initialClient={selectedClient}
            onAfterSave={ctx => persistRunToHistory(ctx.client, ctx.clientCode)}
            onClose={() => setWpSaveModalOpen(false)}
          />

          {activeTab === 'review' && (
            <div className="space-y-3">

              {[...reviewPoints].sort((a, b) => (a.severity === 'Serious' ? -1 : 1) - (b.severity === 'Serious' ? -1 : 1)).map((p, i) => {
                const hasJournal = p.suggestedJournal &&
                  p.suggestedJournal.debitAccount &&
                  p.suggestedJournal.debitAccount !== 'None' &&
                  (p.suggestedJournal.amount ?? 0) > 0;
                return (
                  <div key={i} className={`bg-white/[0.78] backdrop-blur-md rounded-xl border overflow-hidden ${p.severity === 'Serious' ? 'border-red-200 dark:border-red-900/40' : 'border-[var(--border)]'}`}>
                    {/* Card header — left accent bar + area + title + badge */}
                    <div className={`flex items-start gap-4 p-5 border-l-4 ${p.severity === 'Serious' ? 'border-l-red-500' : 'border-l-amber-400'}`}>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">{p.area}</span>
                        <h4 className="font-bold text-[var(--text-primary)] text-[15px] leading-snug mt-1">{p.issue}</h4>
                      </div>
                      <span className={`text-xs font-semibold px-3 py-1.5 rounded-full shrink-0 mt-0.5 ${
                        p.severity === 'Serious'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400'
                          : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] border border-[var(--border)]'
                      }`}>{p.severity}</span>
                    </div>

                    {/* Card body */}
                    <div className="px-5 pb-5 space-y-3 border-t border-[var(--border)]">
                      {/* Explanation callout */}
                      <div className={`mt-4 rounded-lg px-4 py-3.5 text-sm leading-relaxed space-y-2.5 ${
                        p.severity === 'Serious'
                          ? 'bg-red-50 dark:bg-red-900/10 text-red-900 dark:text-red-200'
                          : 'bg-[var(--accent-light)] text-[var(--text-secondary)]'
                      }`}>
                        {toParagraphs(p.explanation).map((para, idx) => <p key={idx}>{para}</p>)}
                      </div>

                      {/* Suggested journal */}
                      {hasJournal && (
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] mb-2 mt-1">Suggested Journal</div>
                          <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                            {p.suggestedJournal!.description && (
                              <div className="px-3 py-2 bg-[var(--bg-nav-hover)] border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                                <span className="font-semibold text-[var(--text-secondary)]">Note: </span>{p.suggestedJournal!.description}
                              </div>
                            )}
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-[var(--border)] bg-[var(--bg-nav-hover)]">
                                  <th className="text-left px-3 py-2 font-semibold text-[var(--text-muted)]">Account</th>
                                  <th className="text-right px-3 py-2 font-semibold text-[var(--text-muted)]">Debit (£)</th>
                                  <th className="text-right px-3 py-2 font-semibold text-[var(--text-muted)]">Credit (£)</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-b border-[var(--border)]">
                                  <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{p.suggestedJournal!.debitAccount}</td>
                                  <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{p.suggestedJournal!.amount?.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right text-[var(--text-muted)]"></td>
                                </tr>
                                <tr>
                                  <td className="px-3 py-2 italic text-[var(--text-secondary)] pl-7">{p.suggestedJournal!.creditAccount}</td>
                                  <td className="px-3 py-2 text-right text-[var(--text-muted)]"></td>
                                  <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">{p.suggestedJournal!.amount?.toFixed(2)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {activeTab === 'papers' && workingPapers.length > 0 && (
            <div className="flex items-center gap-2">
              <Tooltip label="Undo">
                <button
                  onClick={() => setWpHistoryIndex(i => i - 1)}
                  disabled={wpHistoryIndex <= 1}
                  aria-label="Undo"
                  className="btn-secondary py-1.5 px-3 text-white border-white/40 hover:text-white hover:bg-white/15 disabled:opacity-40"
                ><Undo2 size={14} /></button>
              </Tooltip>
              <Tooltip label="Redo">
                <button
                  onClick={() => setWpHistoryIndex(i => i + 1)}
                  disabled={wpHistoryIndex >= workingPapersHistory.length - 1}
                  aria-label="Redo"
                  className="btn-secondary py-1.5 px-3 text-white border-white/40 hover:text-white hover:bg-white/15 disabled:opacity-40"
                ><Redo2 size={14} /></button>
              </Tooltip>
              <span className="text-xs font-semibold text-white/90 drop-shadow-sm">
                {wpHistoryIndex <= 1 ? 'No edits yet' : `Edit ${wpHistoryIndex - 1}`}
              </span>
            </div>
          )}
          {activeTab === 'papers' && (
            <div className="flex flex-col gap-3">
              {workingPapers.length === 0 && (
                <div className="bg-white/[0.78] backdrop-blur-md rounded-xl p-12 text-center lg:col-span-2">
                  <p className="text-sm text-[var(--text-muted)] mb-3">Working papers were not included in this analysis result. Click Regenerate to produce them.</p>
                  <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers} className="btn-primary mx-auto">
                    <FileText size={14} />{isGeneratingPapers ? 'Generating…' : 'Regenerate Working Papers'}
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
