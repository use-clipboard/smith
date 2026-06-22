'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Loader2, AlertTriangle, Undo2, Redo2, Save, CheckCircle2, Layers,
  Sparkles, ArrowLeft, BarChart3, Mail, Archive, FastForward, Landmark,
  Lock, PenLine,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import MtdItStreamColumn, { type EditorEntry } from './MtdItStreamColumn';
import MtdItSourceViewerModal from './MtdItSourceViewerModal';
import MtdItPnLModal from './MtdItPnLModal';
import MtdItSendApprovalModal from './MtdItSendApprovalModal';
import MtdItSaveToRecordsModal from './MtdItSaveToRecordsModal';
import MtdItSubmitModal from './MtdItSubmitModal';
import { applyAutoFlags } from '@/lib/mtdIt/flags';
import { formatDateUk } from '@/lib/mtdIt/dateFormat';
import { CONSOLIDATED_REPORTING_LIMIT } from '@/lib/mtdIt/categories';
import { buildPnL, fmtMoneyGbp } from '@/lib/mtdIt/pnl';
import { renderApprovalPdf, blobToBase64 } from '@/lib/mtdIt/approvalPdf';
import { fetchBrandPdfBundle } from '@/lib/mtdIt/fetchBrandPdfBundle';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import type { MtdItStream, MtdItProperty, MtdItTrade, MtdItStreams } from '@/types';

interface Props {
  quarterId: string;
  clientId: string;
  /** Inclusive ISO range used for out-of-range flagging. */
  rangeFrom: string;
  rangeTo: string;
  streams: MtdItStreams;
  fxRates: Record<string, number>;
  /** Whether the consolidated-reporting toggle was already on for the
   *  quarter (loaded from the DB row). The toggle UI lives in this phase. */
  initialConsolidated: boolean;
  /** Client + quarter context used by the P&L modal heading + downloads. */
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  quarterLabel: string;       // e.g. "Q1"
  taxYearLabel: string;       // e.g. "2026/27"
  /** Numeric quarter + tax year — used for the comparison fetch + PDF
   *  generation. The label/numeric pair stay in sync via the parent. */
  quarter:  1 | 2 | 3 | 4;
  taxYear:  number;
  /** Current quarter status — drives whether Send-for-approval is enabled. */
  quarterStatus: 'not_started' | 'draft' | 'complete' | 'sent' | 'approved' | 'submitted';
  /** When true (deep-link from the approval notification), open the Submit-to-
   *  HMRC modal automatically once entries have loaded. */
  autoOpenSubmit?: boolean;
  /** Which sub-stage of the post-analysis workflow we're rendering. The
   *  component owns all three because the entries / properties / trades data
   *  is heavy and we don't want to re-fetch on every wizard hop. */
  view: 'edit' | 'send' | 'save';
  /** Stage transitions, all driven by the parent's wizard state. */
  onProceedToSend: () => void;
  onProceedToSave: () => void;
  onBackToReview: () => void;
  onBackToSend:   () => void;
  onBackToSetup:  () => void;
  /** Called when the user successfully saves & finishes. Parent navigates
   *  back to the dashboard. */
  onFinished: (status: 'draft' | 'complete') => void;
}

interface ServerEntry {
  id: string;
  stream: MtdItStream;
  trade_id: string | null;
  property_id: string | null;
  source_file_name: string | null;
  page_number: number | null;
  entry_date: string | null;
  description: string | null;
  supplier: string | null;
  category: string;
  entry_type: 'income' | 'expense';
  gross_amount: number;
  net_amount: number | null;
  vat_amount: number | null;
  currency: string;
  fx_rate: number | null;
  gbp_amount: number | null;
  share_pct: number;
  manual: boolean;
  flagged_reason: string | null;
  flag_dismissed: boolean | null;
  drive_link: string | null;
}

const ACTIVE_STREAMS = ['sole', 'uk_rental', 'foreign_rental'] as const;

// Convert server rows → editor rows. Stamps a stable _localId so the table
// can key on it for the whole edit session (the DB id stays in `id`).
function serverToEditor(e: ServerEntry): EditorEntry {
  return {
    _localId: `srv_${e.id}`,
    _isNew: false,
    _dirty: false,
    flag_dismissed: !!e.flag_dismissed,
    id: e.id,
    stream: e.stream,
    trade_id: e.trade_id,
    property_id: e.property_id,
    source_file_name: e.source_file_name,
    page_number: e.page_number,
    entry_date: e.entry_date,
    description: e.description,
    supplier: e.supplier,
    category: e.category,
    entry_type: e.entry_type,
    gross_amount: Number(e.gross_amount ?? 0),
    net_amount: e.net_amount === null ? null : Number(e.net_amount),
    vat_amount: e.vat_amount === null ? null : Number(e.vat_amount),
    currency: e.currency,
    fx_rate: e.fx_rate === null ? null : Number(e.fx_rate),
    gbp_amount: e.gbp_amount === null ? null : Number(e.gbp_amount),
    share_pct: Number(e.share_pct ?? 100),
    manual: e.manual,
    flagged_reason: e.flagged_reason,
    drive_link: e.drive_link,
  };
}

export default function MtdItReviewPhase({
  quarterId, clientId, rangeFrom, rangeTo, streams, fxRates,
  initialConsolidated, clientName, clientRef, clientEmail, quarterLabel, taxYearLabel,
  quarter, taxYear,
  quarterStatus, autoOpenSubmit, view, onProceedToSend, onProceedToSave,
  onBackToReview, onBackToSend, onBackToSetup, onFinished,
}: Props) {
  // ── Loading entries / properties / trades ───────────────────────────
  const [entries, setEntries] = useState<EditorEntry[]>([]);
  const [properties, setProperties] = useState<MtdItProperty[]>([]);
  const [trades, setTrades] = useState<MtdItTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch trigger. Bumped after Save to records succeeds so the editor
  // picks up the freshly-written drive_link on each entry without a hard
  // reload. The user keeps any unsaved edits because applyAutoFlags is
  // idempotent — only existing rows get their drive_link refreshed.
  const [refreshTick, setRefreshTick] = useState(0);

  // Latest active approval (non-voided) — drives the "Sent by … on …" /
  // "Approved on …" status banner. Refetched whenever the quarter status
  // flips (e.g. after a Send-for-approval click) or refreshTick bumps.
  interface LatestApproval {
    id: string;
    sent_at: string;
    sent_by: string | null;
    recipient_email: string | null;
    approved_at: string | null;
    changes_requested_at: string | null;
    expires_at: string | null;
    edited_since_approved_at: string | null;
    sender: { full_name: string | null; email: string } | null;
  }
  const [approvalInfo, setApprovalInfo] = useState<LatestApproval | null>(null);

  // Whether to attach the approval-pack PDF when handing off to compose. The
  // toggle lives on the Send-to-client stage but the state owns it here so
  // sendViaCompose can read it without prop drilling. Default true — the PDF
  // is the whole point of the approval email in the normal flow.
  const [attachPdf, setAttachPdf] = useState(true);

  // A filed (submitted) or client-approved quarter opens READ-ONLY so it can be
  // reviewed without accidentally editing figures that have gone to HMRC / been
  // signed off. "Amend" flips this on to make changes (which will require
  // re-submission / re-approval). Resets whenever the quarter status changes.
  const [amending, setAmending] = useState(false);
  useEffect(() => { setAmending(false); }, [quarterStatus]);

  // Firm-level reminder settings (reminder_enabled + reminder_days). Drives the
  // "Reminder scheduled for …" hint on the send screen. The cron worker that
  // sends the reminder emails is wired (app/api/cron/mtd-it-reminders, daily);
  // this UI just surfaces what the firm has configured. Fetched once.
  const [reminderSettings, setReminderSettings] = useState<{ enabled: boolean; days: number } | null>(null);
  useEffect(() => {
    if (view !== 'send') return;
    let aborted = false;
    void fetch('/api/mtd-it/firm-settings')
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (aborted || !j?.settings) return;
        setReminderSettings({
          enabled: !!j.settings.reminder_enabled,
          days:     Number(j.settings.reminder_days ?? 7),
        });
      })
      .catch(() => { /* non-fatal */ });
    return () => { aborted = true; };
  }, [view]);
  useEffect(() => {
    if (quarterStatus !== 'sent' && quarterStatus !== 'approved' && quarterStatus !== 'submitted') {
      setApprovalInfo(null);
      return;
    }
    let aborted = false;
    void fetch(`/api/mtd-it/quarters/${quarterId}/approvals/latest`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (!aborted) setApprovalInfo((j?.approval ?? null) as LatestApproval | null); })
      .catch(() => { /* non-fatal — banner just hides */ });
    return () => { aborted = true; };
  }, [quarterId, quarterStatus, refreshTick]);

  useEffect(() => {
    (async () => {
      setLoading(true); setError(null);
      try {
        const [eRes, pRes, tRes] = await Promise.all([
          fetch(`/api/mtd-it/entries?quarter_id=${quarterId}`),
          fetch(`/api/mtd-it/properties?client_id=${clientId}`),
          fetch(`/api/mtd-it/trades?client_id=${clientId}`),
        ]);
        if (!eRes.ok) throw new Error('Failed to load entries');
        if (!pRes.ok) throw new Error('Failed to load properties');
        if (!tRes.ok) throw new Error('Failed to load trades');
        const eJson = await eRes.json();
        const pJson = await pRes.json();
        const tJson = await tRes.json();
        const editor = (eJson.entries ?? []).map((e: ServerEntry) => serverToEditor(e));
        setEntries(applyAutoFlags(editor, rangeFrom, rangeTo));
        setProperties((pJson.properties ?? []) as MtdItProperty[]);
        setTrades((tJson.trades ?? []) as MtdItTrade[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [quarterId, clientId, rangeFrom, rangeTo, refreshTick]);

  // ── Undo / redo (session-scoped, in-memory) ─────────────────────────
  // history holds snapshots of `entries` *before* each mutation. Redo holds
  // snapshots that were popped off history by an undo. Both clear when the
  // user does a new edit (standard editor pattern).
  const historyRef = useRef<EditorEntry[][]>([]);
  const redoRef    = useRef<EditorEntry[][]>([]);
  const HISTORY_LIMIT = 50;
  const pushHistory = useCallback(() => {
    historyRef.current.push(entries);
    if (historyRef.current.length > HISTORY_LIMIT) historyRef.current.shift();
    redoRef.current = [];
  }, [entries]);
  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    redoRef.current.push(entries);
    setEntries(applyAutoFlags(prev, rangeFrom, rangeTo));
  }, [entries, rangeFrom, rangeTo]);
  const redo = useCallback(() => {
    if (redoRef.current.length === 0) return;
    const next = redoRef.current.pop()!;
    historyRef.current.push(entries);
    setEntries(applyAutoFlags(next, rangeFrom, rangeTo));
  }, [entries, rangeFrom, rangeTo]);
  // Keyboard shortcuts — only fire when not focused inside a form control
  // that already handles undo (text inputs do their own undo on z).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (inField) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // ── Source-document viewer state ─────────────────────────────────────
  const [viewing, setViewing] = useState<{ fileName: string; pageNumber: number | null } | null>(null);

  // ── P&L lightbox state ───────────────────────────────────────────────
  const [pnlOpen, setPnlOpen] = useState(false);

  // ── Save-to-records modal ────────────────────────────────────────────
  // Opens manually via the toolbar button, and is auto-opened after a
  // successful "Save & complete" so the user gets a one-click prompt to
  // file the deliverables. Skipping is fine — they can re-open later.
  const [saveRecordsOpen, setSaveRecordsOpen] = useState(false);
  // When the modal is opened via Save & complete, we owe the parent a
  // navigation back to the dashboard once it closes (whether the user
  // saved or skipped). When opened manually, the navigation is null.
  const [pendingFinishedStatus, setPendingFinishedStatus] = useState<'draft' | 'complete' | null>(null);
  // Count of source documents currently attached to the quarter — fetched
  // lazily on mount so the modal can show "Source documents (12)" without
  // a slow loader. Refreshed when the modal opens so re-saves see the
  // latest count.
  const [sourceDocCount, setSourceDocCount] = useState(0);
  useEffect(() => {
    // Re-use the deletion-preview counts endpoint — already firm-scoped and
    // returns document_count alongside the other blast-radius numbers.
    void fetch(`/api/mtd-it/quarters/${quarterId}/deletion-preview`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && typeof j.document_count === 'number') setSourceDocCount(j.document_count); })
      .catch(() => {});
  }, [quarterId, saveRecordsOpen]);

  // ── Send-for-approval modal ──────────────────────────────────────────
  const [submitOpen, setSubmitOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sentToast, setSentToast] = useState<{ recipient: string; viaCompose?: boolean } | null>(null);

  // Deep-link auto-open: when arriving from the approval notification
  // (?submit=1) open the Submit-to-HMRC modal once, after entries have loaded.
  const autoSubmitFired = useRef(false);
  useEffect(() => {
    if (autoOpenSubmit && !loading && !autoSubmitFired.current) {
      autoSubmitFired.current = true;
      setSubmitOpen(true);
    }
  }, [autoOpenSubmit, loading]);
  const [preparingSend, setPreparingSend] = useState(false);
  // Consolidated state declared early so the triage hand-off callback below
  // can reference it without a TDZ violation.
  const [consolidated, setConsolidated] = useState(initialConsolidated);
  // Auto-clear the toast after 6s so it doesn't linger forever
  useEffect(() => {
    if (!sentToast) return;
    const t = setTimeout(() => setSentToast(null), 6000);
    return () => clearTimeout(t);
  }, [sentToast]);

  // ── Email Triage hand-off ────────────────────────────────────────────
  // When Email Triage is active we skip the bespoke approval modal entirely
  // and drop the rendered email straight into the global compose window —
  // the compose window already lets the user edit recipient, body and
  // attachments. The intermediate modal would just be friction.
  const { isModuleActive } = useModules();
  const compose            = useComposeWindow();
  const triageActive       = isModuleActive('email-triage');
  const driveActiveForSave = isModuleActive('google-drive');
  const vaultActiveForSave = isModuleActive('document-vault');

  /** Build the PDF + create the approval row + open compose. Runs on
   *  "Send for approval" click when triage is active. */
  const sendViaCompose = useCallback(async () => {
    if (preparingSend) return;
    setPreparingSend(true);
    try {
      const activeStreams: MtdItStream[] = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);
      const pnls = activeStreams.map(s => buildPnL({
        stream:     s,
        entries:    entries.filter(e => e.stream === s),
        trades,
        properties,
        fxRates,
      }));
      if (pnls.length === 0) {
        setSentToast({ recipient: '', viaCompose: false });
        throw new Error('No income streams are active — nothing to approve.');
      }

      // Summary lines for the email body table
      const summaryLines: Array<{ label: string; value: string }> = [];
      let grossIncome = 0, grossExpense = 0;
      const STREAM_LABEL: Record<MtdItStream, string> = { sole: 'Sole Trader', uk_rental: 'UK Rental', foreign_rental: 'Foreign Rental' };
      for (const p of pnls) {
        summaryLines.push({ label: `${STREAM_LABEL[p.stream]} — Income`,  value: fmtMoneyGbp(p.income.total)  });
        summaryLines.push({ label: `${STREAM_LABEL[p.stream]} — Expense`, value: fmtMoneyGbp(p.expense.total) });
        grossIncome  += p.income.total;
        grossExpense += p.expense.total;
      }
      summaryLines.push({ label: 'Total income',  value: fmtMoneyGbp(grossIncome) });
      summaryLines.push({ label: 'Total expense', value: fmtMoneyGbp(grossExpense) });
      summaryLines.push({ label: 'Net',           value: fmtMoneyGbp(grossIncome - grossExpense) });

      const bundle = await fetchBrandPdfBundle({ clientId, taxYear });
      const pdfBlob = await renderApprovalPdf({
        pnls, clientName, clientRef, quarterLabel, taxYearLabel,
        rangeFrom, rangeTo, consolidated, entries,
        brandPrimaryColor: bundle.brandPrimaryColor,
        logoDataUrl:       bundle.logoDataUrl,
        pdfInclude:        bundle.pdfInclude,
        comparison:        bundle.comparison,
      });
      const pdfBase64 = await blobToBase64(pdfBlob);

      const res = await fetch(`/api/mtd-it/quarters/${quarterId}/send-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_email: clientEmail ?? '',
          cover_note:      null,
          pdf_base64:      pdfBase64,
          summary_lines:   summaryLines,
          prepare_only:    true,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to prepare email');

      const pdfFile = new File(
        [pdfBlob],
        (j.attachment_filename as string) || 'mtd-it-approval.pdf',
        { type: 'application/pdf' },
      );
      compose.open({
        defaultTo:          [{ name: clientName, email: clientEmail ?? '' }],
        defaultSubject:     (j.subject as string) ?? '',
        prefilledBody:      (j.html_body as string) ?? '',
        // Respect the user's "attach PDF" toggle on the Send-to-client stage.
        // Off → drop the attachment entirely; the email is sent without it.
        defaultAttachments: attachPdf ? [pdfFile] : [],
        defaultClients:     [{
          id:            clientId,
          name:          clientName,
          client_ref:    clientRef ?? '',
          contact_email: clientEmail ?? null,
          risk_rating:   null,
        }],
      });
      setSentToast({ recipient: (j.sender_email as string) ?? '', viaCompose: true });
    } catch (e) {
      console.error('sendViaCompose', e);
      const msg = e instanceof Error ? e.message : 'Failed to prepare email';
      // Surface the failure via the existing toast slot (recipient empty +
      // viaCompose false → message field used as the recipient text). Simple
      // re-use rather than a fresh banner component.
      setSentToast({ recipient: msg, viaCompose: false });
    } finally {
      setPreparingSend(false);
    }
  }, [preparingSend, streams, entries, trades, properties, fxRates, clientName, clientRef, clientEmail, clientId, quarterId, quarterLabel, taxYearLabel, rangeFrom, rangeTo, consolidated, compose, attachPdf]);

  // ── View PDF (read-only preview) ────────────────────────────────────────
  // Builds the same approval-pack PDF that would be attached to the email
  // and opens it in a new browser tab. Used by the "View PDF" button on the
  // Send-to-client stage so the preparer can sanity-check the document
  // without having to fire the compose flow.
  const [viewingPdf, setViewingPdf] = useState(false);
  const viewPdf = useCallback(async () => {
    if (viewingPdf) return;
    setViewingPdf(true);
    try {
      const activeStreams: MtdItStream[] = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);
      const pnls = activeStreams.map(s => buildPnL({
        stream:  s,
        entries: entries.filter(e => e.stream === s),
        trades, properties, fxRates,
      }));
      if (pnls.length === 0) {
        setSentToast({ recipient: 'No income streams are active — nothing to preview.', viaCompose: false });
        return;
      }
      const bundle = await fetchBrandPdfBundle({ clientId, taxYear });
      const pdfBlob = await renderApprovalPdf({
        pnls, clientName, clientRef, quarterLabel, taxYearLabel,
        rangeFrom, rangeTo, consolidated, entries,
        brandPrimaryColor: bundle.brandPrimaryColor,
        logoDataUrl:       bundle.logoDataUrl,
        pdfInclude:        bundle.pdfInclude,
        comparison:        bundle.comparison,
      });
      const url = URL.createObjectURL(pdfBlob);
      // Open in a new tab. The blob URL is revoked after a short delay so
      // the new tab has finished navigating to it before we drop the ref.
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error('viewPdf', e);
      setSentToast({ recipient: e instanceof Error ? e.message : 'Failed to render PDF', viaCompose: false });
    } finally {
      setViewingPdf(false);
    }
  }, [viewingPdf, streams, entries, trades, properties, fxRates, clientName, clientRef, clientId, quarterLabel, taxYearLabel, rangeFrom, rangeTo, consolidated, taxYear]);

  // ── Consolidated reporting ───────────────────────────────────────────
  const totalIncomeAllStreams = entries
    .filter(e => !e._deleted && e.entry_type === 'income')
    .reduce((a, e) => a + (e.gross_amount || 0), 0);
  const overThreshold = totalIncomeAllStreams >= CONSOLIDATED_REPORTING_LIMIT;

  async function toggleConsolidated() {
    if (!consolidated && overThreshold) {
      const ok = confirm(
        `Combined gross income is £${totalIncomeAllStreams.toLocaleString('en-GB', { maximumFractionDigits: 2 })}, ` +
        `which is at or above the £${CONSOLIDATED_REPORTING_LIMIT.toLocaleString()} consolidated-reporting limit.\n\n` +
        `HMRC's simplified consolidated reporting isn't permitted at this income level. ` +
        `Are you sure you want to enable it anyway?`,
      );
      if (!ok) return;
    }
    const next = !consolidated;
    setConsolidated(next);
    void fetch(`/api/mtd-it/quarters/${quarterId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consolidated: next }),
    });
  }

  // ── Dirty / unsaved-changes guard ────────────────────────────────────
  const dirty = useMemo(
    () => entries.some(e => e._dirty || e._isNew || e._deleted),
    [entries],
  );
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── Save (bulk creates / updates / deletes) ──────────────────────────
  const [saving, setSaving] = useState<null | 'draft' | 'complete'>(null);
  async function save(target: 'draft' | 'complete', opts?: { skipNav?: boolean; skipStatus?: boolean }) {
    setSaving(target); setError(null);
    try {
      // Split the editor state into a bulk-save payload. Manual rules:
      //   _deleted true + has id    → goes in `deletes`
      //   _isNew  true              → goes in `creates`
      //   else _dirty true          → goes in `updates`
      // Strip editor-only bookkeeping fields. `flag_dismissed` is the one
      // editor field that DOES persist (it has its own DB column) — keep it.
      const creates = entries
        .filter(e => e._isNew && !e._deleted)
        .map(({ _localId, _isNew, _dirty, _deleted, id, ...rest }) => rest);
      const updates = entries
        .filter(e => !e._isNew && !e._deleted && e._dirty && e.id)
        .map(({ _localId, _isNew, _dirty, _deleted, ...rest }) => rest);
      const deletes = entries
        .filter(e => e._deleted && !!e.id)
        .map(e => e.id!);

      const res = await fetch('/api/mtd-it/entries', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quarter_id: quarterId, creates, updates, deletes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Save failed');
      }
      // skipStatus: persist entries only, leaving the quarter status untouched
      // (used by "Save & Submit", which must not advance the quarter just to
      // open the submit modal). Otherwise bump status + consolidated flag.
      if (opts?.skipStatus) {
        // Keep the consolidated flag in sync without touching status.
        await fetch(`/api/mtd-it/quarters/${quarterId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ consolidated }),
        });
      } else {
        await fetch(`/api/mtd-it/quarters/${quarterId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: target, consolidated }),
        });
        // After a successful "complete" save, prompt the user to file the
        // deliverables to Drive / Vault. They can dismiss to navigate away
        // and trigger it later via the toolbar button. Drafts skip the
        // prompt since nothing is final yet.
        if (target === 'complete' && (driveActiveForSave || vaultActiveForSave)) {
          setSaveRecordsOpen(true);
          setPendingFinishedStatus(target);
        } else if (!opts?.skipNav) {
          onFinished(target);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-2" /> Loading entries…</div>;
  }
  if (error && entries.length === 0) {
    return <div className="py-16 text-center text-sm text-red-600 flex items-center justify-center gap-2"><AlertTriangle size={16} /> {error}</div>;
  }

  const activeStreams = ACTIVE_STREAMS.filter(s => streams[s]);
  const colsClass =
    activeStreams.length === 3 ? 'lg:grid-cols-3' :
    activeStreams.length === 2 ? 'lg:grid-cols-2' :
    /* 1 */                       'lg:grid-cols-1';

  // A filed or approved quarter is read-only until the user explicitly amends.
  const isFiled    = quarterStatus === 'submitted';
  const isApproved = quarterStatus === 'approved';
  const lockable   = isFiled || isApproved;
  const locked     = lockable && !amending;

  return (
    <div className="space-y-4">
      {/* Read-only / amend banner — a filed or approved quarter opens locked so
          its figures can't be changed by accident. The user must explicitly
          choose to amend. Only shown on the edit view (send/save are already
          read-only previews). */}
      {view === 'edit' && lockable && (
        locked ? (
          <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${isFiled ? 'border-emerald-200 bg-emerald-50' : 'border-indigo-200 bg-indigo-50'}`}>
            <Lock size={16} className={isFiled ? 'text-emerald-600' : 'text-indigo-600'} />
            <div className="text-sm">
              <p className={`font-semibold ${isFiled ? 'text-emerald-800' : 'text-indigo-800'}`}>
                {isFiled ? 'Filed with HMRC — view only' : 'Approved by the client — view only'}
              </p>
              <p className={isFiled ? 'text-emerald-700' : 'text-indigo-700'}>
                {isFiled
                  ? 'These figures have been submitted to HMRC. Amend to change them — you’ll need to re-submit the cumulative update.'
                  : 'The client has approved these figures. Amend to change them — you’ll need to send the quarter for approval again.'}
              </p>
            </div>
            <Tooltip label={isFiled ? 'Unlock the entries to make changes. Saving and re-submitting will amend the figures already filed with HMRC.' : 'Unlock the entries to make changes. The quarter will need to be sent for approval again.'}>
              <button
                onClick={() => setAmending(true)}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
              >
                <PenLine size={14} /> Amend figures
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <PenLine size={16} className="text-amber-600" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">Amending a {isFiled ? 'filed' : 'approved'} quarter.</span>{' '}
              {isFiled
                ? 'Re-submit to HMRC after saving to update the cumulative figures.'
                : 'This quarter will need to be sent to the client for approval again.'}
            </p>
            <button
              onClick={() => setAmending(false)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-sm font-medium text-amber-800 hover:bg-amber-50 shadow-sm"
            >
              <Lock size={14} /> Stop amending
            </button>
          </div>
        )
      )}

      {/* Toolbar — only rendered on the edit view. Send and save views are
          read-only previews of what's already been entered, so the editor
          controls (consolidated toggle, P&L view, undo/redo, save-to-records)
          aren't useful there. */}
      {view === 'edit' && (
      <div className="flex flex-wrap items-center gap-2">
        {/* Consolidated reporting — pill button with explainer tooltip.
            Fills with accent when on. */}
        <Tooltip
          label={
            "Consolidated reporting collapses Income and Expenses into a single total per stream, rather than itemising every HMRC category. Allowed when the client's combined gross income across all property + trade streams stays below £" +
            CONSOLIDATED_REPORTING_LIMIT.toLocaleString() +
            ". Use it for low-income clients to simplify the quarterly return."
          }
        >
          <button
            onClick={toggleConsolidated}
            aria-pressed={consolidated}
            disabled={locked}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${
              consolidated
                ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Layers size={12} />
            Consolidated reporting
            {/* Tiny pill-switch on the right that shows on/off at a glance */}
            <span
              className={`relative inline-block w-7 h-4 rounded-full transition-colors ${
                consolidated ? 'bg-white/30' : 'bg-gray-200'
              }`}
              aria-hidden
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                  consolidated ? 'left-[14px]' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </Tooltip>

        {/* P&L View — opens a lightbox showing per-stream P&Ls with
            breakdown by trade/property and PDF/Excel download. */}
        <Tooltip label="Open a P&L summary for the quarter, with per-trade or per-property breakdowns and PDF / Excel download">
          <button
            onClick={() => setPnlOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <BarChart3 size={12} /> P&amp;L View
          </button>
        </Tooltip>

        {/* Save to records — manual escape hatch. Only shown if at least
            one destination module (Drive or Vault) is active for the firm. */}
        {(driveActiveForSave || vaultActiveForSave) && (
          <Tooltip label="Save the P&L PDF, approval pack and source documents to Google Drive and/or the Document Vault.">
            <button
              onClick={() => { setPendingFinishedStatus(null); setSaveRecordsOpen(true); }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
            >
              <Archive size={12} /> Save to records
            </button>
          </Tooltip>
        )}

        {/* Submit to HMRC — available once the quarter has entries (any status
            beyond not_started). Status only advances to 'submitted' on a fully
            successful filing. */}
        {quarterStatus !== 'not_started' && (
          <Tooltip label={quarterStatus === 'submitted' ? 'Filed with HMRC. Open to review or amend the cumulative figures.' : 'File this quarter’s cumulative update with HMRC (Making Tax Digital for Income Tax).'}>
            <button
              onClick={() => setSubmitOpen(true)}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium shadow-sm ${quarterStatus === 'submitted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700'}`}
            >
              <Landmark size={12} /> {quarterStatus === 'submitted' ? 'Filed with HMRC' : 'Submit to HMRC'}
            </button>
          </Tooltip>
        )}

        {overThreshold && (
          <span className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] bg-amber-50 text-amber-800 border border-amber-200 rounded-full shadow-sm">
            <AlertTriangle size={11} />
            Combined income ≥ £{CONSOLIDATED_REPORTING_LIMIT.toLocaleString()} — consolidated reporting not normally permitted
          </span>
        )}

        {/* Undo / Redo pill — separate panel on the right */}
        <div className="ml-auto inline-flex items-center gap-1 bg-white border border-gray-200 rounded-full px-1.5 py-1 shadow-sm">
          <Tooltip label="Undo (Ctrl+Z)">
            <button
              onClick={undo}
              disabled={historyRef.current.length === 0}
              aria-label="Undo"
              className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            ><Undo2 size={13} /></button>
          </Tooltip>
          <span aria-hidden className="w-px h-4 bg-gray-200" />
          <Tooltip label="Redo (Ctrl+Shift+Z)">
            <button
              onClick={redo}
              disabled={redoRef.current.length === 0}
              aria-label="Redo"
              className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            ><Redo2 size={13} /></button>
          </Tooltip>
        </div>
      </div>
      )}

      {/* Approval status banner — moved out of the edit view. It only makes
          sense once we're in the Send-to-client / Save-quarter stages where
          the user has actually pushed (or is about to push) the approval. */}
      {(view === 'send' || view === 'save') && approvalInfo && (
        <ApprovalStatusBanner info={approvalInfo} status={quarterStatus} />
      )}

      {/* Send view — read-only preview of the approval email + status panel.
          The Compose Email button in the sticky bar opens the in-app compose
          window with subject/body/recipient/PDF pre-filled. */}
      {view === 'send' && (
        <MtdItSendPreview
          quarterId={quarterId}
          clientId={clientId}
          clientName={clientName}
          clientRef={clientRef}
          clientEmail={clientEmail}
          taxYear={taxYear}
          quarter={quarter}
          taxYearLabel={taxYearLabel}
          quarterLabel={quarterLabel}
          quarterStatus={quarterStatus}
          attachPdf={attachPdf}
          onAttachPdfChange={setAttachPdf}
          onViewPdf={viewPdf}
          viewingPdf={viewingPdf}
          reminderSettings={reminderSettings}
          approvalSentAt={approvalInfo?.sent_at ?? null}
        />
      )}

      {/* Save view — read-only summary of what's about to be saved as the
          final quarter. The actual save action lives in the sticky bar. */}
      {view === 'save' && (
        <MtdItSaveSummary
          quarterStatus={quarterStatus}
          consolidated={consolidated}
          entries={entries.filter(e => !e._deleted)}
          streams={streams}
          trades={trades}
          properties={properties}
          fxRates={fxRates}
          dirty={dirty}
        />
      )}

      {/* Columns — only rendered in the edit view. Send/Save use read-only
          summaries above so the figures can't drift after the user has been
          shown them. */}
      {view === 'edit' && (
      <div className={`grid grid-cols-1 ${colsClass} gap-4`}>
        {activeStreams.map(s => (
          <MtdItStreamColumn
            key={s}
            stream={s}
            entries={entries.filter(e => e.stream === s)}
            properties={properties}
            trades={trades}
            fxRates={fxRates}
            consolidated={consolidated}
            pushHistory={pushHistory}
            // Filed/approved quarters render read-only: rows can be opened and
            // viewed (incl. the Expenses / Flagged tabs and source documents)
            // but no field is editable until the user hits "Amend figures".
            readOnly={locked}
            onChange={(nextForStream) => {
              // Splice this stream's slice back into the full array, keeping
              // the relative order of other streams stable.
              setEntries(prev => {
                const others = prev.filter(e => e.stream !== s);
                return applyAutoFlags([...others, ...nextForStream], rangeFrom, rangeTo);
              });
            }}
            onViewSource={(fileName, pageNumber) => setViewing({ fileName, pageNumber })}
          />
        ))}
      </div>
      )}

      {/* Inline error from save */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
        </div>
      )}

      {/* Sticky action bar — content varies by stage. Edit owns Save as draft
          and Proceed to send; Send owns Compose email + step nav; Save owns
          Save as draft / Save & complete. The save logic is shared across
          stages so a status PATCH from any of them keeps things consistent. */}
      <div className="sticky bottom-0 z-10 -mx-6 px-6 py-3 mt-6 pointer-events-none">
        <div className="flex items-center gap-3 bg-white/85 backdrop-blur-md border border-gray-200 rounded-xl p-3 shadow-lg pointer-events-auto w-fit max-w-[min(820px,calc(100%-9rem))] mr-auto">
          <button
            onClick={view === 'edit' ? onBackToSetup : view === 'send' ? onBackToReview : onBackToSend}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft size={14} />
            {view === 'edit' ? 'Back to setup' : view === 'send' ? 'Back to review' : 'Back to send'}
          </button>
          <div className="text-xs text-gray-500 hidden sm:block">
            {dirty
              ? <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Unsaved changes</span>
              : <span className="text-green-700">All saved</span>}
          </div>

          {view === 'edit' && (
            locked ? (
              // Read-only: the only forward action is to unlock for amendment.
              <Tooltip label={isFiled ? 'Unlock the entries to amend. Saving and re-submitting will amend the figures filed with HMRC.' : 'Unlock the entries to amend. The quarter will need to be sent for approval again.'}>
                <button
                  onClick={() => setAmending(true)}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 rounded-lg"
                >
                  <PenLine size={14} /> Amend figures
                </button>
              </Tooltip>
            ) : (
            <>
              <button
                onClick={() => save('draft')}
                disabled={saving !== null}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:opacity-90 rounded-lg disabled:opacity-50"
              >
                {saving === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save as draft
              </button>
              <Tooltip label="Save the current entries as a draft and continue to the Send to client stage. You'll preview the email there before anything goes out.">
                <button
                  onClick={async () => { if (dirty) await save('draft', { skipNav: true }); onProceedToSend(); }}
                  disabled={saving !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 rounded-lg disabled:opacity-50"
                >
                  {saving === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  Continue to Send to Client
                </button>
              </Tooltip>
            </>
            )
          )}

          {view === 'send' && (
            <>
              <Tooltip label="Open the in-app compose window with the approval email template pre-filled, the client added as the recipient, and the approval-pack PDF attached.">
                <button
                  onClick={() => void sendViaCompose()}
                  disabled={preparingSend}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 rounded-lg disabled:opacity-50"
                >
                  {preparingSend ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                  {quarterStatus === 'sent' || quarterStatus === 'approved' ? 'Compose new email' : 'Compose email'}
                </button>
              </Tooltip>
              {/* Skip — matches the setup-phase fast-forward affordance:
                  icon sits in a near-circle at rest, label slides out from
                  the right on hover/focus. */}
              <button
                onClick={onProceedToSave}
                aria-label="Skip to Save quarter"
                title="Skip to Save quarter"
                className="group inline-flex items-center h-9 pl-2.5 pr-2.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-gray-50 hover:border-gray-300 transition-all duration-200 shrink-0 overflow-hidden whitespace-nowrap"
              >
                <FastForward size={14} className="shrink-0" />
                <span className="max-w-0 group-hover:max-w-[10rem] group-focus-visible:max-w-[10rem] overflow-hidden transition-[max-width] duration-200 ease-out">
                  <span className="pl-2 pr-1">Skip to Save quarter</span>
                </span>
              </button>
            </>
          )}

          {view === 'save' && (
            <>
              <button
                onClick={() => save('draft')}
                disabled={saving !== null}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:opacity-90 rounded-lg disabled:opacity-50"
              >
                {saving === 'draft' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save as draft
              </button>
              <button
                onClick={async () => { if (dirty) await save('draft', { skipNav: true, skipStatus: true }); setSubmitOpen(true); }}
                disabled={saving !== null}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 rounded-lg disabled:opacity-50"
              >
                {saving !== null ? <Loader2 size={14} className="animate-spin" /> : <Landmark size={14} />}
                Submit to HMRC
              </button>
            </>
          )}
        </div>
      </div>

      {/* Source-document viewer modal — singleton, opened from any row */}
      {viewing && (
        <MtdItSourceViewerModal
          quarterId={quarterId}
          fileName={viewing.fileName}
          pageNumber={viewing.pageNumber}
          onClose={() => setViewing(null)}
        />
      )}

      {/* P&L lightbox */}
      {pnlOpen && (
        <MtdItPnLModal
          entries={entries}
          streams={streams}
          trades={trades}
          properties={properties}
          fxRates={fxRates}
          consolidated={consolidated}
          clientId={clientId}
          clientName={clientName}
          clientRef={clientRef}
          taxYear={taxYear}
          quarter={quarter}
          quarterLabel={quarterLabel}
          taxYearLabel={taxYearLabel}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onClose={() => setPnlOpen(false)}
        />
      )}

      {/* Save-to-records modal — manual + post-complete */}
      {saveRecordsOpen && (
        <MtdItSaveToRecordsModal
          quarterId={quarterId}
          clientId={clientId}
          clientName={clientName}
          clientRef={clientRef}
          taxYear={taxYear}
          taxYearLabel={taxYearLabel}
          quarter={quarter}
          quarterLabel={quarterLabel}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          entries={entries}
          streams={streams}
          trades={trades}
          properties={properties}
          fxRates={fxRates}
          consolidated={consolidated}
          sourceDocCount={sourceDocCount}
          hasSentApproval={quarterStatus === 'sent' || quarterStatus === 'approved' || quarterStatus === 'submitted'}
          triggeredByComplete={pendingFinishedStatus === 'complete'}
          onSaved={() => setRefreshTick(t => t + 1)}
          onClose={() => {
            setSaveRecordsOpen(false);
            // If the modal was opened by Save & complete, complete the
            // navigation back to the dashboard once the user finishes
            // (saved or skipped). Manual opens stay on the same page.
            if (pendingFinishedStatus) {
              const s = pendingFinishedStatus;
              setPendingFinishedStatus(null);
              onFinished(s);
            }
          }}
        />
      )}

      {/* Submit-to-HMRC modal */}
      {submitOpen && (
        <MtdItSubmitModal
          quarterId={quarterId}
          clientId={clientId}
          quarterStatus={quarterStatus}
          onClose={() => setSubmitOpen(false)}
          onSubmitted={() => setRefreshTick(t => t + 1)}
        />
      )}

      {/* Send-for-approval modal */}
      {sendOpen && (
        <MtdItSendApprovalModal
          quarterId={quarterId}
          entries={entries}
          streams={streams}
          trades={trades}
          properties={properties}
          fxRates={fxRates}
          consolidated={consolidated}
          clientId={clientId}
          taxYear={taxYear}
          clientName={clientName}
          clientRef={clientRef}
          clientEmail={clientEmail}
          quarterLabel={quarterLabel}
          taxYearLabel={taxYearLabel}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          onClose={() => setSendOpen(false)}
          onSent={(info) => {
            setSendOpen(false);
            setSentToast({ recipient: info.sender_email, viaCompose: info.via_compose });
          }}
        />
      )}

      {/* Sent confirmation toast (auto-dismisses).
          Anchored top-centre so it doesn't hide behind the bottom-right
          compose window when triage hand-off is in play. */}
      {sentToast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[60] bg-white border border-green-200 rounded-xl shadow-lg px-4 py-3 flex items-start gap-2 max-w-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 size={18} className="text-green-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <div className="font-medium text-gray-900">
              {sentToast.viaCompose ? 'Ready in your compose window' : 'Approval email sent'}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">
              {sentToast.viaCompose
                ? <>The approval email has been drafted with the PDF attached. Review and hit <strong>Send</strong> when you&apos;re ready.</>
                : <>Sent from {sentToast.recipient}. You&apos;ll be notified when the client responds.</>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Approval status banner ────────────────────────────────────────────────
// Small info card that appears on the review screen once an approval has
// been sent. Surfaces who in the firm sent the email, when, the recipient,
// and the client's response (approved / changes requested / outstanding).
function ApprovalStatusBanner({
  info, status,
}: {
  info: {
    sent_at: string;
    recipient_email: string | null;
    approved_at: string | null;
    changes_requested_at: string | null;
    edited_since_approved_at: string | null;
    sender: { full_name: string | null; email: string } | null;
  };
  status: 'not_started' | 'draft' | 'complete' | 'sent' | 'approved' | 'submitted';
}) {
  const sentBy   = info.sender?.full_name?.trim() || info.sender?.email || 'a team member';
  const sentDate = formatDateTimeUk(info.sent_at);

  // Tone shifts depending on where the approval is in its lifecycle.
  // Tone palette intentionally mirrors the dashboard donut/status swatches so
  // sky=Sent, violet=Approved, amber=needs-attention. Keep these in sync if
  // those swatches ever shift.
  const tone =
    info.changes_requested_at      ? 'amber'  :
    info.edited_since_approved_at  ? 'amber'  :
    info.approved_at               ? 'violet' :
                                     'sky';
  const toneClass = {
    sky:    'bg-sky-50 border-sky-200 text-sky-800',
    violet: 'bg-violet-50 border-violet-200 text-violet-800',
    amber:  'bg-amber-50 border-amber-200 text-amber-800',
  }[tone];
  const IconEl =
    info.changes_requested_at     ? AlertTriangle :
    info.edited_since_approved_at ? AlertTriangle :
    info.approved_at              ? CheckCircle2  :
                                    Mail;

  let headline: React.ReactNode;
  if (info.changes_requested_at) {
    headline = <>Client requested changes on <strong>{formatDateTimeUk(info.changes_requested_at)}</strong></>;
  } else if (info.approved_at) {
    headline = <>Client approved on <strong>{formatDateTimeUk(info.approved_at)}</strong></>;
  } else {
    headline = <>Sent for approval on <strong>{sentDate}</strong></>;
  }

  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${toneClass}`}>
      <IconEl size={14} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div>{headline}</div>
        <div className="opacity-80 mt-0.5">
          Sent by <strong>{sentBy}</strong>
          {info.recipient_email && <> to <strong>{info.recipient_email}</strong></>}
          {/* If this banner is showing the "approved" state, still show
              the original send timestamp for full audit context. */}
          {info.approved_at && info.sent_at !== info.approved_at && (
            <> · originally sent {sentDate}</>
          )}
          {info.edited_since_approved_at && status === 'approved' && (
            <> · <strong>edited since approval</strong> — consider re-sending</>
          )}
        </div>
      </div>
    </div>
  );
}

// dd-mm-yyyy HH:mm — used by the approval banner. Wraps the existing date
// helper but tacks on the time portion since "sent at 14:32" is genuinely
// more useful than just the calendar day for approval audit.
function formatDateTimeUk(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDateUk(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr  = d.getFullYear();
  const hh  = String(d.getHours()).padStart(2, '0');
  const mm  = String(d.getMinutes()).padStart(2, '0');
  return `${day}-${mon}-${yr} ${hh}:${mm}`;
}

// ── Stage 4: Send-to-client preview ─────────────────────────────────────
// Static landing card for the Send stage. The actual email contents are
// previewable + editable in the compose window that opens when the user
// hits the "Compose email" sticky-bar button — replicating exactly the
// pre-existing send flow, just gated to its own wizard stage.
function MtdItSendPreview({
  clientEmail, clientName, clientRef, quarterStatus, quarterLabel, taxYearLabel,
  attachPdf, onAttachPdfChange, onViewPdf, viewingPdf,
  reminderSettings, approvalSentAt,
}: {
  quarterId: string;
  clientId: string;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  taxYear: number;
  quarter: 1 | 2 | 3 | 4;
  taxYearLabel: string;
  quarterLabel: string;
  quarterStatus: 'not_started' | 'draft' | 'complete' | 'sent' | 'approved' | 'submitted';
  attachPdf: boolean;
  onAttachPdfChange: (next: boolean) => void;
  onViewPdf: () => void;
  viewingPdf: boolean;
  reminderSettings: { enabled: boolean; days: number } | null;
  approvalSentAt: string | null;
}) {
  const alreadySent = quarterStatus === 'sent' || quarterStatus === 'approved' || quarterStatus === 'submitted';

  // When did / will the reminder be sent? sent_at + reminder_days. Only
  // meaningful while the quarter is still awaiting client response — once
  // approved or changes have been requested the reminder cycle is over.
  let reminderDateIso: string | null = null;
  if (reminderSettings?.enabled && approvalSentAt && quarterStatus === 'sent') {
    const sent = new Date(approvalSentAt);
    if (!Number.isNaN(sent.getTime())) {
      sent.setDate(sent.getDate() + reminderSettings.days);
      reminderDateIso = sent.toISOString();
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white/85 backdrop-blur-md p-4">
        <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2 flex items-center gap-1.5">
          <Mail size={11} /> Approval email
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          <div>
            <dt className="text-[11px] text-gray-500 uppercase tracking-wide">Recipient</dt>
            <dd className="text-gray-900 mt-0.5">
              {clientEmail
                ? <>{clientName} &lt;<span className="font-mono">{clientEmail}</span>&gt;</>
                : <span className="text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> No email on file — add one on the client record first.</span>}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-gray-500 uppercase tracking-wide">Reference</dt>
            <dd className="text-gray-900 mt-0.5">
              {clientRef && <span className="font-mono mr-2">{clientRef}</span>}
              {taxYearLabel} · {quarterLabel}
            </dd>
          </div>
        </dl>

        {/* Attachment controls — preview + toggle. The toggle defaults to on
            so the typical case (send with PDF attached) is one click; flip
            off if the firm doesn't want the PDF in this particular email. */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onViewPdf}
              disabled={viewingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--accent)] bg-[var(--accent-light)] hover:opacity-90 rounded-lg disabled:opacity-50"
            >
              {viewingPdf ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {viewingPdf ? 'Rendering…' : 'View PDF'}
            </button>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={attachPdf}
                onChange={e => onAttachPdfChange(e.target.checked)}
                className="w-4 h-4 rounded accent-[var(--accent)]"
              />
              Attach approval-pack PDF to the email
            </label>
          </div>
        </div>

        <p className="mt-3 text-xs text-gray-600 leading-relaxed">
          Clicking <strong>{alreadySent ? 'Compose new email' : 'Compose email'}</strong> opens the in-app
          compose window with the firm&apos;s approval template pre-filled, the client
          added as the recipient and to the email timeline
          {attachPdf ? ', and the approval-pack PDF attached' : ' (no PDF will be attached)'}
          . You can edit the subject and body before hitting <strong>Send</strong>.
        </p>
      </div>

      {/* Reminder schedule — surfaced once the approval is out and the firm
          has reminders enabled in settings. Honest: the cron worker that
          actually sends the reminder isn't wired up yet, so this shows the
          intended schedule rather than a confirmed delivery. */}
      {reminderDateIso && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 flex items-start gap-2">
          <Mail size={14} className="shrink-0 mt-0.5" />
          <div>
            <div>
              Reminder scheduled for <strong>{formatDateTimeUk(reminderDateIso)}</strong>
              {reminderSettings && <> ({reminderSettings.days} day{reminderSettings.days === 1 ? '' : 's'} after the initial email)</>}
              .
            </div>
            <div className="text-[11px] opacity-80 mt-0.5">
              If the client approves or requests changes before then, the reminder is cancelled automatically.
            </div>
          </div>
        </div>
      )}
      {reminderSettings && !reminderSettings.enabled && quarterStatus === 'sent' && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
          Automatic reminders are disabled in firm settings — no follow-up email will go out.
        </div>
      )}
    </div>
  );
}

// ── Stage 5: Save quarter summary ───────────────────────────────────────
// Read-only headline figures the user can sanity-check before committing
// the quarter as a draft or marking it complete. Mirrors the totals shown
// inside the per-stream column headers so the numbers match.
function MtdItSaveSummary({
  entries, streams, trades: _trades, properties: _properties, fxRates, consolidated, quarterStatus, dirty,
}: {
  quarterStatus: 'not_started' | 'draft' | 'complete' | 'sent' | 'approved' | 'submitted';
  consolidated: boolean;
  entries: EditorEntry[];
  streams: MtdItStreams;
  trades: MtdItTrade[];
  properties: MtdItProperty[];
  fxRates: Record<string, number>;
  dirty: boolean;
}) {
  // GBP-equivalent total for an entry, mirroring the logic in MtdItQuarterPage
  // / lib/mtdIt/pnl (we re-implement to avoid the heavier buildPnL dep here).
  function toGbp(e: EditorEntry): number {
    const gross = e.gross_amount || 0;
    if (e.currency === 'GBP') return gross;
    if (typeof e.gbp_amount === 'number') return e.gbp_amount;
    const rate = e.fx_rate ?? fxRates[e.currency];
    return rate ? gross * rate : 0;
  }
  const active = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);
  const STREAM_LABEL: Record<MtdItStream, string> = { sole: 'Sole Trader', uk_rental: 'UK Rental', foreign_rental: 'Foreign Rental' };
  const totals = active.map(s => {
    const slice = entries.filter(e => e.stream === s);
    const income  = slice.filter(e => e.entry_type === 'income').reduce((a, e) => a + toGbp(e), 0);
    const expense = slice.filter(e => e.entry_type === 'expense').reduce((a, e) => a + toGbp(e), 0);
    return { stream: s, income, expense, net: income - expense, count: slice.length };
  });
  const grossIncome  = totals.reduce((a, t) => a + t.income, 0);
  const grossExpense = totals.reduce((a, t) => a + t.expense, 0);

  return (
    <div className="space-y-3">
      {dirty && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-xs">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          You have unsaved edits in Review. Save as draft to lock those changes in before completing the quarter.
        </div>
      )}
      <div className="rounded-xl border border-gray-200 bg-white/85 backdrop-blur-md p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Quarter summary</div>
          <div className="text-[11px] text-gray-500">
            Status: <span className="font-semibold text-gray-700">{quarterStatus.replace('_', ' ')}</span>
            {consolidated && <span className="ml-3">· Consolidated reporting</span>}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
              <th className="py-2 font-medium">Stream</th>
              <th className="py-2 font-medium text-right">Entries</th>
              <th className="py-2 font-medium text-right">Income</th>
              <th className="py-2 font-medium text-right">Expense</th>
              <th className="py-2 font-medium text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {totals.map(t => (
              <tr key={t.stream} className="border-b border-gray-50">
                <td className="py-2 text-gray-900">{STREAM_LABEL[t.stream]}</td>
                <td className="py-2 text-right text-gray-600">{t.count}</td>
                <td className="py-2 text-right text-gray-900">{fmtMoneyGbp(t.income)}</td>
                <td className="py-2 text-right text-gray-900">{fmtMoneyGbp(t.expense)}</td>
                <td className="py-2 text-right font-medium text-gray-900">{fmtMoneyGbp(t.net)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 font-semibold text-gray-900">Total</td>
              <td className="py-2 text-right text-gray-600">{entries.length}</td>
              <td className="py-2 text-right font-semibold text-gray-900">{fmtMoneyGbp(grossIncome)}</td>
              <td className="py-2 text-right font-semibold text-gray-900">{fmtMoneyGbp(grossExpense)}</td>
              <td className="py-2 text-right font-semibold text-gray-900">{fmtMoneyGbp(grossIncome - grossExpense)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
