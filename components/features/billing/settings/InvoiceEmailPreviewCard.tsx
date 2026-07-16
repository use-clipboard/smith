'use client';

// Settings → Billing → Emails: what the client actually receives.
//
// The preview is built by buildInvoiceEmailHtml — the same function the real
// send and the test send use — with merge tags resolved against the sample
// invoice, so the figures here match the specimen PDF that rides along.

import { useMemo, useState } from 'react';
import { Loader2, Send, CheckCircle2, Paperclip, Info } from 'lucide-react';
import { GlassCard, SectionHeader } from '@/components/features/timesheets/shared/ui';
import { buildInvoiceEmailHtml } from '@/lib/billing/invoiceEmailHtml';
import { resolveInvoiceMergeTags } from '@/lib/billing/invoiceMergeTags';
import { buildSampleInvoice, sampleMergeContext } from '@/lib/billing/sampleInvoice';
import { renderInvoicePdfBase64 } from '@/lib/billing/invoicePdfBlob';
import type { InvoiceLetterhead } from '@/lib/billing/invoicePdf';

interface Props {
  subject: string;
  body: string;
  letterhead: InvoiceLetterhead;
  invoiceNumber: string;
  vatRate: number;
  /** Blank until a mailbox is chosen — the test can't send without one. */
  mailboxId: string | null;
  disabled: boolean;
}

export default function InvoiceEmailPreviewCard({ subject, body, letterhead, invoiceNumber, vatRate, mailboxId, disabled }: Props) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const firmName = letterhead.businessName.trim() || 'Your firm';
  const attachmentName = `${invoiceNumber}.pdf`;

  const { subjectLine, html } = useMemo(() => {
    const ctx = sampleMergeContext({ number: invoiceNumber, vatRate, firmName, portalLink: '#' });
    return {
      subjectLine: resolveInvoiceMergeTags(subject, ctx),
      html: buildInvoiceEmailHtml({
        bodyText: resolveInvoiceMergeTags(body, ctx),
        portalLink: '#',
        firmName,
        accent: letterhead.accent,
        hasAttachment: true,
        attachmentName,
      }),
    };
  }, [subject, body, firmName, letterhead.accent, invoiceNumber, vatRate, attachmentName]);

  // Wrap the email body the way a mail client would — white sheet, some padding.
  const srcDoc = useMemo(
    () => `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0;padding:16px;background:#fff">${html}</body></html>`,
    [html],
  );

  async function sendTest() {
    setSending(true); setResult(null);
    try {
      // Attach the same specimen invoice the Branding tab previews.
      let pdf_base64: string | undefined;
      try {
        pdf_base64 = await renderInvoicePdfBase64(buildSampleInvoice({ number: invoiceNumber, vatRate }), letterhead);
      } catch (e) {
        console.error('sample invoice pdf', e); // still send — the email is the point
      }
      const r = await fetch('/api/billing/settings/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, pdf_base64 }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok) setResult({ ok: true, msg: `Sent to ${d?.sentTo ?? 'you'} — check your inbox.` });
      else setResult({ ok: false, msg: d?.error ?? 'Could not send the test.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <GlassCard>
      <SectionHeader title="Preview" subtitle="The email your client receives, with your template filled in" />

      <div className="mb-2 rounded-lg bg-black/[0.02] px-3 py-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Subject</div>
        <div className="mt-0.5 break-words text-[13px] font-semibold text-[var(--text-primary)]">{subjectLine || <span className="font-normal italic text-[var(--text-muted)]">No subject</span>}</div>
      </div>

      <div className="overflow-hidden rounded-lg border border-black/10 bg-white">
        <iframe srcDoc={srcDoc} title="Invoice email preview" sandbox="" tabIndex={-1} aria-hidden className="h-[300px] w-full border-0" />
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <Paperclip size={11} className="shrink-0" />
        <span>{attachmentName} is attached, using the template on the Branding tab.</span>
      </div>

      {/* Send test */}
      <div className="mt-3 border-t border-black/5 pt-3">
        {!mailboxId ? (
          <p className="text-[12px] text-amber-600">Choose a sending mailbox to send yourself a test.</p>
        ) : (
          <>
            <button onClick={sendTest} disabled={sending || disabled} className="btn-secondary w-full justify-center disabled:opacity-50">
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {sending ? 'Sending test…' : 'Send test to yourself'}
            </button>
            <p className="mt-1.5 flex items-start gap-1 text-[11px] text-[var(--text-muted)]">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>
                Goes to your own address from the mailbox above — the real thing, sample invoice attached.
                It tests what you&rsquo;ve typed, even before you save. The pay button has no client behind it, so it opens SMITH instead of a statement.
              </span>
            </p>
          </>
        )}
        {result && (
          <p className={`mt-2 flex items-center gap-1.5 text-[12px] font-medium ${result.ok ? 'text-emerald-600' : 'text-[var(--danger)]'}`}>
            {result.ok && <CheckCircle2 size={13} />}{result.msg}
          </p>
        )}
      </div>
    </GlassCard>
  );
}
