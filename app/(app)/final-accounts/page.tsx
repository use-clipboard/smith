'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import FileUpload from '@/components/ui/FileUpload';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ProcessingView, { type ProgressFile } from '@/components/ui/ProcessingView';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import ToolLayout from '@/components/ui/ToolLayout';
import { ClipboardCheck, FileText, Download, Undo2, Redo2 } from 'lucide-react';
import { fileToBase64 } from '@/utils/fileUtils';
import type { ReviewPoint, WorkingPaper } from '@/types';
import WorkingPaperSection from '@/components/features/final-accounts/WorkingPaperSection';

type AppState = 'idle' | 'loading' | 'success' | 'error';

function generateReportHtml(
  businessName: string,
  clientCode: string,
  businessType: string,
  periodStart: string,
  periodEnd: string,
  preparerName: string,
  relevantContext: string,
  reviewPoints: ReviewPoint[],
  workingPapers: WorkingPaper[],
): string {
  const isWorkingPapersOnly = reviewPoints.length === 0;
  const serious = reviewPoints.filter(p => p.severity === 'Serious');
  const minor = reviewPoints.filter(p => p.severity === 'Minor');
  const dateGenerated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  function fmtDate(d: string) {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; }
  }
  function fmtBiz(t: string) {
    return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
  }

  const SECTION_LABELS: Record<string, string> = {
    A: 'Review and Journals', B: 'Fixed Assets', C: 'Debtors',
    D: 'Bank and Cash', E: 'Suppliers', F: 'Creditors',
    G: 'Expenses', H: 'Other Notes',
  };

  // Group working papers by first letter
  const wpGroups: Record<string, WorkingPaper[]> = {};
  workingPapers.forEach(p => {
    const m = p.title.match(/^([A-Z])\d/);
    const letter = m ? m[1] : 'Z';
    if (!wpGroups[letter]) wpGroups[letter] = [];
    wpGroups[letter].push(p);
  });

  function parseTitle(title: string) {
    const m = title.match(/^([A-Z]\d+)\s*-\s*(.+)/);
    return m ? { code: m[1], name: m[2] } : { code: '', name: title };
  }

  function renderPaper(p: WorkingPaper): string {
    const { code, name } = parseTitle(p.title);
    const hasTable = p.table && p.table.rows.length > 0;
    let bodyHtml: string;
    if (hasTable) {
      bodyHtml = `<table class="wp-table">
          <thead><tr>${p.table!.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${p.table!.rows.map(r => `<tr>${p.table!.columns.map(c => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>${p.notes ? `<div class="wp-notes"><strong>Notes:</strong> ${p.notes}</div>` : ''}`;
    } else if (p.content?.trim()) {
      // Monospace table fallback (contains ─ separator): use <pre>
      // Free-flowing text: split into individual <p> tags so each paragraph can be
      // pushed to the next page rather than sliced mid-line.
      if (p.content.includes('─')) {
        bodyHtml = `<pre>${p.content}</pre>`;
      } else {
        const paras = p.content.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        bodyHtml = paras.map(para =>
          `<p class="wp-para">${para.replace(/\n/g, '<br>')}</p>`
        ).join('');
      }
    } else {
      bodyHtml = '<p style="color:#9ca3af;font-style:italic;font-size:12px">(No content entered)</p>';
    }
    return `<div class="paper">
      <div class="paper-title-row">${code ? `<span class="paper-code">${code}</span>` : ''}<span class="paper-name">${name}</span></div>
      ${bodyHtml}
    </div>`;
  }

  // ── Title page ──
  const titlePageHtml = `
    <div class="title-page">
      <div class="title-header"><span class="title-header-text">SMITH — Accountancy Working Papers</span></div>
      <div class="title-body">
        <div class="title-doc-type">${isWorkingPapersOnly ? 'Working Papers' : 'Final Accounts Review'}</div>
        <div class="title-client-name">${businessName || 'Client Name'}</div>
        ${clientCode ? `<div class="title-client-code">${clientCode}</div>` : ''}
        <div class="title-meta">
          <div class="title-meta-item"><label>Business Type</label><span>${fmtBiz(businessType)}</span></div>
          <div class="title-meta-item"><label>Period</label><span>${fmtDate(periodStart)} to ${fmtDate(periodEnd)}</span></div>
          <div class="title-meta-item"><label>Prepared by</label><span>${preparerName || '—'}</span></div>
          <div class="title-meta-item"><label>Date</label><span>${dateGenerated}</span></div>
        </div>
        ${relevantContext ? `<div class="title-context"><div class="title-context-label">Business Description</div><div>${relevantContext}</div></div>` : ''}
      </div>
      <div class="title-footer">Confidential — Prepared for Internal Use Only</div>
    </div>`;

  // ── Table of contents ──
  const tocGroupsHtml = Object.entries(wpGroups).map(([letter, papers]) => `
    <div class="toc-group">
      <div class="toc-group-header">${letter} &mdash; ${SECTION_LABELS[letter] ?? `Section ${letter}`}</div>
      ${papers.map(p => {
        const { code, name } = parseTitle(p.title);
        return `<div class="toc-entry"><span class="toc-code">${code}</span><span class="toc-entry-name">${name}</span></div>`;
      }).join('')}
    </div>`).join('');

  const tocHtml = `
    <div class="force-page-start toc-section">
      <h2 class="toc-heading">Contents</h2>
      ${reviewPoints.length > 0 ? `
        <div class="toc-group">
          <div class="toc-group-header">Review Points</div>
          <div class="toc-entry"><span class="toc-code">—</span><span class="toc-entry-name">${reviewPoints.length} point${reviewPoints.length !== 1 ? 's' : ''} identified (${serious.length} serious, ${minor.length} minor)</span></div>
        </div>` : ''}
      ${tocGroupsHtml}
    </div>`;

  // ── Review points section ──
  const reviewSectionHtml = reviewPoints.length > 0 ? `
    <div class="force-page-start section-divider">
      <div class="sd-letter">R</div>
      <div class="sd-content">
        <div class="sd-name">Review Points</div>
        <div class="sd-sub">${reviewPoints.length} point${reviewPoints.length !== 1 ? 's' : ''} identified &mdash; ${serious.length} serious, ${minor.length} minor</div>
      </div>
    </div>
    <div class="review-summary">
      <div class="rsbox serious-box"><div class="rsnum">${serious.length}</div><div class="rslbl">Serious</div></div>
      <div class="rsbox minor-box"><div class="rsnum">${minor.length}</div><div class="rslbl">Minor</div></div>
    </div>
    ${reviewPoints.map(p => {
      const hasJournal = p.suggestedJournal && p.suggestedJournal.debitAccount && p.suggestedJournal.debitAccount !== 'None' && (p.suggestedJournal.amount ?? 0) > 0;
      const journalHtml = hasJournal ? `
        <div class="journal-section">
          <div class="journal-label">Suggested Journal</div>
          <table class="journal-table">
            <thead><tr><th>Account</th><th>Debit (£)</th><th>Credit (£)</th></tr></thead>
            <tbody>
              <tr><td>${p.suggestedJournal!.debitAccount ?? ''}</td><td style="text-align:right">${p.suggestedJournal!.amount?.toFixed(2) ?? ''}</td><td></td></tr>
              <tr style="font-style:italic"><td style="padding-left:20px">${p.suggestedJournal!.creditAccount ?? ''}</td><td></td><td style="text-align:right">${p.suggestedJournal!.amount?.toFixed(2) ?? ''}</td></tr>
            </tbody>
          </table>
          ${p.suggestedJournal!.description ? `<div class="journal-desc">${p.suggestedJournal!.description}</div>` : ''}
        </div>` : '';
      return `
        <div class="review-point ${p.severity === 'Serious' ? 'serious' : 'minor'}">
          <div class="rp-header">
            <div><span class="rp-area">${p.area ?? ''}</span><div class="rp-issue">${p.issue ?? ''}</div></div>
            <span class="badge ${p.severity === 'Serious' ? 'badge-serious' : 'badge-minor'}">${p.severity}</span>
          </div>
          <p class="rp-expl">${p.explanation ?? ''}</p>
          ${journalHtml}
        </div>`;
    }).join('')}
  ` : '';

  // ── Working paper sections grouped by letter ──
  const wpSectionsHtml = Object.entries(wpGroups).map(([letter, papers]) => {
    const groupName = SECTION_LABELS[letter] ?? `Section ${letter}`;
    const codes = papers.map(p => parseTitle(p.title).code).filter(Boolean).join(', ');
    return `
      <div class="force-page-start section-divider">
        <div class="sd-letter">${letter}</div>
        <div class="sd-content">
          <div class="sd-name">${groupName}</div>
          <div class="sd-sub">${codes}</div>
        </div>
      </div>
      ${papers.map(renderPaper).join('')}`;
  }).join('');

  const css = `
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; padding: 40px; font-size: 13px; line-height: 1.6; max-width: 860px; background: #fff; }
    /* ── Title page ── */
    .title-page { min-height: 960px; display: flex; flex-direction: column; }
    .title-header { background: #1a3558; color: #fff; padding: 16px 56px; margin: -56px -56px 0; }
    .title-header-text { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.7; }
    .title-body { flex: 1; padding: 64px 0 40px; }
    .title-doc-type { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: #6b7280; margin-bottom: 14px; }
    .title-client-name { font-size: 38px; font-weight: 900; color: #111827; line-height: 1.2; }
    .title-client-code { font-size: 15px; color: #9ca3af; font-weight: 500; margin-top: 6px; }
    .title-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 48px; margin-top: 52px; padding-top: 28px; border-top: 2px solid #e5e7eb; }
    .title-meta-item label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; display: block; margin-bottom: 3px; }
    .title-meta-item span { font-size: 14px; color: #374151; font-weight: 500; }
    .title-context { margin-top: 32px; padding: 14px 18px; background: #f9fafb; border-left: 4px solid #3b82f6; font-size: 12px; color: #374151; }
    .title-context-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; margin-bottom: 6px; }
    .title-footer { text-align: center; font-size: 11px; color: #d1d5db; letter-spacing: 0.5px; padding-top: 20px; border-top: 1px solid #f3f4f6; margin-top: auto; }
    /* ── TOC ── */
    .toc-section { padding-bottom: 40px; }
    .toc-heading { font-size: 22px; font-weight: 900; color: #111827; border-bottom: 2px solid #1a3558; padding-bottom: 12px; margin-bottom: 24px; margin-top: 0; }
    .toc-group { margin-bottom: 18px; }
    .toc-group-header { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 6px; }
    .toc-entry { display: flex; align-items: baseline; gap: 10px; padding: 3px 0; border-bottom: 1px dotted #e5e7eb; }
    .toc-code { font-size: 12px; font-weight: 700; color: #1a3558; width: 32px; flex-shrink: 0; }
    .toc-entry-name { font-size: 12px; color: #4b5563; }
    /* ── Section dividers ── */
    .section-divider { padding-top: 32px; padding-bottom: 28px; }
    .sd-letter { font-size: 96px; font-weight: 900; color: #f3f4f6; line-height: 1; margin-bottom: -8px; }
    .sd-content { border-top: 3px solid #1a3558; padding-top: 14px; }
    .sd-name { font-size: 26px; font-weight: 800; color: #111827; }
    .sd-sub { font-size: 12px; color: #9ca3af; margin-top: 4px; font-weight: 500; }
    /* ── Review ── */
    .review-summary { display: flex; gap: 14px; margin-bottom: 20px; margin-top: 16px; }
    .rsbox { padding: 14px 22px; border-radius: 8px; text-align: center; border: 1px solid; min-width: 90px; }
    .rsnum { font-size: 28px; font-weight: 900; }
    .rslbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .serious-box { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
    .minor-box { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .review-point { border-left: 4px solid #e5e7eb; padding: 14px 16px; margin-bottom: 12px; background: #fafafa; page-break-inside: avoid; break-inside: avoid; }
    .review-point.serious { border-left-color: #ef4444; background: #fef9f9; }
    .review-point.minor { border-left-color: #f59e0b; background: #fffdf5; }
    .rp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .rp-area { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; display: block; margin-bottom: 2px; }
    .rp-issue { font-size: 14px; font-weight: 700; color: #111827; }
    .rp-expl { font-size: 12px; color: #4b5563; margin: 0; }
    .badge { font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 999px; white-space: nowrap; margin-left: 12px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0; }
    .badge-serious { background: #fee2e2; color: #b91c1c; }
    .badge-minor { background: #fef3c7; color: #92400e; }
    .journal-section { margin-top: 10px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .journal-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7280; padding: 5px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    .journal-desc { font-size: 11px; color: #6b7280; padding: 5px 12px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .journal-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .journal-table th { text-align: left; padding: 5px 12px; background: #f3f4f6; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; }
    .journal-table td { padding: 5px 12px; border-bottom: 1px solid #f3f4f6; }
    /* ── Working papers ── */
    .paper { margin-bottom: 24px; page-break-inside: avoid; break-inside: avoid; }
    .paper-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; }
    .paper-code { font-size: 10px; font-weight: 700; color: #fff; background: #1a3558; padding: 3px 8px; border-radius: 3px; flex-shrink: 0; }
    .paper-name { font-size: 13px; font-weight: 700; color: #374151; }
    .wp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .wp-table th { text-align: left; padding: 6px 10px; background: #1a3558; color: #fff; font-weight: 600; border: 1px solid #1a3558; }
    .wp-table td { padding: 5px 10px; border: 1px solid #e5e7eb; }
    .wp-table tr:nth-child(even) td { background: #f9fafb; }
    .wp-notes { margin-top: 10px; font-size: 12px; color: #4b5563; padding: 8px 12px; background: #f9fafb; border-left: 3px solid #d1d5db; }
    pre { background: #f8f9fa; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 14px; font-size: 11px; line-height: 1.7; white-space: pre-wrap; word-wrap: break-word; font-family: 'Courier New', Courier, monospace; }
    .wp-para { font-size: 12px; color: #374151; margin: 0 0 10px; line-height: 1.75; page-break-inside: avoid; break-inside: avoid; }
    .wp-para:last-child { margin-bottom: 0; }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${isWorkingPapersOnly ? 'Working Papers' : 'Final Accounts Review'} — ${businessName}</title>
  <style>${css}</style>
</head>
<body>
  ${titlePageHtml}
  ${tocHtml}
  ${reviewSectionHtml}
  ${wpSectionsHtml}
</body>
</html>`;
}

export default function FinalAccountsPage() {
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
  if (appState === 'error') return <ToolLayout title="Accounts Review" icon={ClipboardCheck} iconColor="#7C3AED"><ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} /></ToolLayout>;

  return (
    <ToolLayout title="Accounts Review" description="Review financial statements against UK GAAP, produce review points with suggested journals, and generate working papers." icon={ClipboardCheck} iconColor="#7C3AED">
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="glass-solid rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Client Details</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Link to client record</span>
              <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business Name" className="input-base" />
              <select value={businessType} onChange={e => setBusinessType(e.target.value)} className="input-base">
                <option value="">-- Select Business Type *</option>
                <option value="sole_trader">Sole Trader</option>
                <option value="partnership">Partnership</option>
                <option value="limited_company">Limited Company</option>
                <option value="rent">Rent</option>
                <option value="trust">Trust</option>
                <option value="charity">Charity</option>
                <option value="other">Other</option>
              </select>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Accounts Start Date *</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="input-base w-full" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Accounts End Date *</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="input-base w-full" />
              </div>
              <input value={preparerName} onChange={e => setPreparerName(e.target.value)} placeholder="Preparer Name (Optional)" className="input-base" />
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-[var(--text-secondary)]">VAT Registered?</span>
                <button type="button" onClick={() => setIsVatRegistered(v => !v)}
                  className={`relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 ${isVatRegistered ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5 ml-0.5 ${isVatRegistered ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
            <textarea value={relevantContext} onChange={e => setRelevantContext(e.target.value)} placeholder="Any other relevant context? (Optional)" rows={2} className="input-base resize-none" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <FileUpload title="Current Year P&L *" onFileChange={setCurrentYearPL} accept="application/pdf" existingFiles={currentYearPL ? [currentYearPL] : []} />
              <FileUpload title="Current Year Balance Sheet *" onFileChange={setCurrentYearBS} accept="application/pdf" existingFiles={currentYearBS ? [currentYearBS] : []} />
              <FileUpload title="Current Year Trial Balance *" onFileChange={setCurrentYearTB} accept="application/pdf" existingFiles={currentYearTB ? [currentYearTB] : []} />
            </div>
            <div className="space-y-4">
              <FileUpload title="Prior Year P&L" onFileChange={setPriorYearPL} accept="application/pdf" optional existingFiles={priorYearPL ? [priorYearPL] : []} />
              <FileUpload title="Prior Year Balance Sheet" onFileChange={setPriorYearBS} accept="application/pdf" optional existingFiles={priorYearBS ? [priorYearBS] : []} />
              <FileUpload title="Prior Year Trial Balance" onFileChange={setPriorYearTB} accept="application/pdf" optional existingFiles={priorYearTB ? [priorYearTB] : []} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={!canProcess} className="btn-primary"><ClipboardCheck size={15} />Analyse Documents</button>
          </div>
        </div>
      )}
      {appState === 'success' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-2">
              <button onClick={() => setActiveTab('review')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'review' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Review Points ({reviewPoints.length})</button>
              <button onClick={() => setActiveTab('papers')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'papers' ? 'bg-[var(--accent)] text-white' : 'btn-secondary'}`}>Working Papers ({workingPapers.length})</button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {activeTab === 'review' && (
                <button onClick={() => setSaveModalOpen(true)} className="btn-secondary">
                  <Download size={14} />Save Report
                </button>
              )}
              {activeTab === 'papers' && workingPapers.length > 0 && (
                <button onClick={() => setWpSaveModalOpen(true)} className="btn-secondary">
                  <Download size={14} />Save Working Papers
                </button>
              )}
              <button onClick={handleGenerateWorkingPapers} disabled={isGeneratingPapers || reviewPoints.length === 0} className="btn-secondary">
                <FileText size={14} />{isGeneratingPapers ? 'Regenerating…' : 'Regenerate Working Papers'}
              </button>
              <button onClick={() => setAppState('idle')} className="btn-secondary">New Review</button>
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
            onClose={() => setSaveModalOpen(false)}
          />

          <SaveReportModal
            isOpen={wpSaveModalOpen}
            reportHtml={wpReportHtml}
            reportFileName={wpReportFileName}
            feature="final_accounts_review"
            documentType="working_papers"
            initialClient={selectedClient}
            onClose={() => setWpSaveModalOpen(false)}
          />

          {activeTab === 'review' && (
            <div className="space-y-3">
              {/* Summary row */}
              <div className="flex items-center gap-3 pb-1">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800">
                  <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                  <span className="text-xs font-semibold text-red-700 dark:text-red-400">{serious.length} Serious</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                  <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{minor.length} Minor</span>
                </div>
                <span className="text-xs text-[var(--text-muted)]">{reviewPoints.length} points total</span>
              </div>

              {[...reviewPoints].sort((a, b) => (a.severity === 'Serious' ? -1 : 1) - (b.severity === 'Serious' ? -1 : 1)).map((p, i) => {
                const hasJournal = p.suggestedJournal &&
                  p.suggestedJournal.debitAccount &&
                  p.suggestedJournal.debitAccount !== 'None' &&
                  (p.suggestedJournal.amount ?? 0) > 0;
                return (
                  <div key={i} className={`glass-solid rounded-xl border overflow-hidden ${p.severity === 'Serious' ? 'border-red-200 dark:border-red-900/40' : 'border-[var(--border)]'}`}>
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
                      <div className={`mt-4 rounded-lg px-4 py-3 text-sm leading-relaxed ${
                        p.severity === 'Serious'
                          ? 'bg-red-50 dark:bg-red-900/10 text-red-900 dark:text-red-200'
                          : 'bg-[var(--accent-light)] text-[var(--text-secondary)]'
                      }`}>
                        {p.explanation}
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
              <button
                onClick={() => setWpHistoryIndex(i => i - 1)}
                disabled={wpHistoryIndex <= 1}
                className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                title="Undo"
              ><Undo2 size={14} /></button>
              <button
                onClick={() => setWpHistoryIndex(i => i + 1)}
                disabled={wpHistoryIndex >= workingPapersHistory.length - 1}
                className="btn-secondary py-1.5 px-3 disabled:opacity-40"
                title="Redo"
              ><Redo2 size={14} /></button>
              <span className="text-xs text-[var(--text-muted)]">
                {wpHistoryIndex <= 1 ? 'No edits yet' : `Edit ${wpHistoryIndex - 1}`}
              </span>
            </div>
          )}
          {activeTab === 'papers' && (
            <div className="flex flex-col gap-3">
              {workingPapers.length === 0 && (
                <div className="glass-solid rounded-xl p-12 text-center lg:col-span-2">
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
