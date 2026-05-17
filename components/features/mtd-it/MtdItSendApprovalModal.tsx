'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, Mail, FileText, Send, ChevronDown, ChevronRight } from 'lucide-react';
import { exportPnLPdf } from '@/lib/mtdIt/pnlExport';
import { buildPnL, fmtMoneyGbp } from '@/lib/mtdIt/pnl';
import { renderApprovalPdf, blobToBase64, type SummaryLine } from '@/lib/mtdIt/approvalPdf';
import { fetchBrandPdfBundle } from '@/lib/mtdIt/fetchBrandPdfBundle';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import type { EditorEntry } from './MtdItStreamColumn';
import type { MtdItStream, MtdItStreams, MtdItProperty, MtdItTrade } from '@/types';

interface Props {
  quarterId: string;
  entries: EditorEntry[];
  streams: MtdItStreams;
  trades: MtdItTrade[];
  properties: MtdItProperty[];
  fxRates: Record<string, number>;
  consolidated: boolean;
  clientId: string;
  taxYear: number;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  quarterLabel: string;
  taxYearLabel: string;
  rangeFrom: string;
  rangeTo:   string;
  onClose: () => void;
  /** Called when the email has gone out, or — when Email Triage is on —
   *  when the rendered email has been handed off to the compose window
   *  (`via_compose: true`). Parent can refresh dashboard / show toast. */
  onSent: (info: { approval_url: string; sender_email: string; via_compose?: boolean }) => void;
}

const STREAM_LABEL: Record<MtdItStream, string> = {
  sole:           'Sole Trader',
  uk_rental:      'UK Rental',
  foreign_rental: 'Foreign Rental',
};

export default function MtdItSendApprovalModal(props: Props) {
  const {
    quarterId, entries, streams, trades, properties, fxRates, consolidated,
    clientId, taxYear, clientName, clientRef, clientEmail, quarterLabel, taxYearLabel, rangeFrom, rangeTo,
    onClose, onSent,
  } = props;

  const { isModuleActive } = useModules();
  const compose            = useComposeWindow();
  const triageActive       = isModuleActive('email-triage');

  const [recipient, setRecipient] = useState(clientEmail ?? '');
  const [coverNote, setCoverNote] = useState('');
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  // Build the per-stream P&L data once + the inline summary table used in
  // both the email body and the in-modal preview.
  const pnls = useMemo(() => {
    const active: MtdItStream[] = (['sole','uk_rental','foreign_rental'] as const).filter(s => streams[s]);
    return active.map(s => buildPnL({
      stream: s,
      entries: entries.filter(e => e.stream === s),
      trades,
      properties,
      fxRates,
    }));
  }, [streams, entries, trades, properties, fxRates]);

  const summaryLines: SummaryLine[] = useMemo(() => {
    const lines: SummaryLine[] = [];
    let grossIncome = 0, grossExpense = 0;
    for (const p of pnls) {
      lines.push({ label: `${STREAM_LABEL[p.stream]} — Income`,  value: fmtMoneyGbp(p.income.total) });
      lines.push({ label: `${STREAM_LABEL[p.stream]} — Expense`, value: fmtMoneyGbp(p.expense.total) });
      grossIncome  += p.income.total;
      grossExpense += p.expense.total;
    }
    lines.push({ label: 'Total income',  value: fmtMoneyGbp(grossIncome)  });
    lines.push({ label: 'Total expense', value: fmtMoneyGbp(grossExpense) });
    lines.push({ label: 'Net',           value: fmtMoneyGbp(grossIncome - grossExpense) });
    return lines;
  }, [pnls]);

  async function send() {
    if (!recipient.trim()) { setError('Please enter a recipient email.'); return; }
    if (pnls.length === 0) { setError('No income streams are active — nothing to approve.'); return; }
    setSending(true); setError(null);
    try {
      // Generate the approval-pack PDF client-side via jsPDF. We re-use the
      // P&L exporter — same data, different cover. Then base64-encode it for
      // upload as a Gmail attachment.
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
          recipient_email: recipient.trim(),
          cover_note:      coverNote.trim() || null,
          pdf_base64:      pdfBase64,
          summary_lines:   summaryLines,
          // When Email Triage is on we hand the rendered email off to the
          // in-app compose window so the user can review / edit it before
          // sending from their own Gmail. The endpoint skips Gmail in this
          // mode but still creates the approval row + flips the quarter
          // status, so the audit trail is identical.
          prepare_only:    triageActive,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Failed to send');

      if (triageActive) {
        // Turn the PDF blob into a File so it appears as an attachment chip
        // in compose. Note: we already have the blob locally, no need to
        // round-trip through base64.
        const pdfFile = new File(
          [pdfBlob],
          (j.attachment_filename as string) || 'mtd-it-approval.pdf',
          { type: 'application/pdf' },
        );
        compose.open({
          defaultTo:         [{ name: clientName, email: recipient.trim() }],
          defaultSubject:    (j.subject as string) ?? '',
          prefilledBody:     (j.html_body as string) ?? '',
          defaultAttachments: [pdfFile],
          defaultClients:    [{
            id:            clientId,
            name:          clientName,
            client_ref:    clientRef ?? '',
            contact_email: clientEmail,
            risk_rating:   null,
          }],
        });
      }

      onSent({
        approval_url: j.approval_url as string,
        sender_email: j.sender_email as string,
        via_compose:  triageActive,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  async function downloadPreviewPdf() {
    // Same exporter the real send uses — gives the preparer a way to eyeball
    // exactly what the client will get attached.
    const ctx = {
      clientName, clientRef, taxYearLabel, quarterLabel,
      rangeFrom, rangeTo, consolidated,
    };
    exportPnLPdf(pnls, ctx);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={!sending ? onClose : undefined}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
          <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center">
            <Mail size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Send for approval</h3>
            <p className="text-xs text-gray-500 truncate">
              {clientName}{clientRef ? `  ·  ${clientRef}` : ''}  ·  {quarterLabel} {taxYearLabel}
            </p>
          </div>
          <button onClick={onClose} disabled={sending} aria-label="Close" className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-50">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Recipient */}
          <Field label="Send to" hint="Defaults to the client's email on file. Edit if needed.">
            <input
              type="email"
              value={recipient}
              onChange={e => setRecipient(e.target.value)}
              placeholder="client@example.com"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </Field>

          {/* Cover note (above the firm-wide template) */}
          <Field label="Cover note (optional)" hint="A personal line that appears above the firm's standard email body.">
            <textarea
              value={coverNote}
              onChange={e => setCoverNote(e.target.value)}
              rows={3}
              placeholder="e.g. Hi James — figures came together fine this quarter, please review and approve when you have a moment."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
            />
          </Field>

          {/* Inline summary table — exactly the same lines that get embedded in
              the email body. Preparer can sanity-check the figures here. */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              Summary the client will see in the email
            </div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {summaryLines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-gray-700">{l.label}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">{l.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PDF preview accordion */}
          <div>
            <button
              type="button"
              onClick={() => setShowPdfPreview(o => !o)}
              className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-[var(--accent)]"
            >
              {showPdfPreview ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <FileText size={14} /> PDF attachment
            </button>
            {showPdfPreview && (
              <div className="mt-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-2">
                <p>The email attaches the full P&amp;L PDF — same content the user downloaded earlier, framed as a client approval pack. Click below to download a preview copy locally.</p>
                <button
                  onClick={downloadPreviewPdf}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  <FileText size={12} /> Download preview PDF
                </button>
              </div>
            )}
          </div>

          {/* Inline error */}
          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
            </div>
          )}

          {/* Misc hints */}
          <div className="text-[11px] text-gray-500 leading-relaxed">
            The email is sent from your connected Gmail. The client clicks <strong>Review and approve</strong> in the email, lands on a secure page, and clicks Approve or Request changes. You&apos;ll get an email + an in-app notification the moment they respond.
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
          >Cancel</button>
          <button
            onClick={send}
            disabled={sending || !recipient.trim()}
            className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send to client
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700">{label}</span>
      {hint && <span className="block text-[11px] text-gray-500 mb-1.5">{hint}</span>}
      <span className="block mt-1">{children}</span>
    </label>
  );
}

// Helpers moved to lib/mtdIt/approvalPdf.ts
