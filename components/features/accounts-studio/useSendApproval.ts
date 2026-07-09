'use client';

import { useState, useEffect, useRef } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { generatePdfBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { getFirmBranding } from './branding';
import { sendForApproval, markApprovalSent } from './persistence';
import type { Engagement } from './types';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

/**
 * Send the accounts to the client for approval. When Email Triage is active the
 * accounts pack is attached to the in-app compose window (recipient pre-filled,
 * client allocated) — mirroring the MTD IT flow — so the user reviews and sends
 * it themselves. Otherwise it sends directly via the preparer's Gmail.
 * Either way it records the tokened approval row + sets status -> 'sent'.
 */
export function useSendApproval(engagement: Engagement, onSent: (e: Engagement) => void) {
  const { isModuleActive } = useModules();
  const compose = useComposeWindow();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // When the accounts are handed to the compose window, we only flip the status
  // to 'sent' once the email is ACTUALLY sent (the compose window dispatches
  // 'smith:compose-sent'). Cancelling the draft leaves the status untouched.
  const pending = useRef<{ engagementId: string; clientId: string | null } | null>(null);
  useEffect(() => {
    function handler(ev: Event) {
      const p = pending.current;
      if (!p) return;
      const ids = ((ev as CustomEvent).detail?.clientIds ?? []) as string[];
      if (p.clientId && ids.length && !ids.includes(p.clientId)) return; // a different email
      pending.current = null;
      markApprovalSent(p.engagementId)
        .then(updated => onSent(updated))
        .catch(() => onSent({ ...engagement, approvalStatus: 'sent', sentAt: new Date().toISOString() }));
    }
    window.addEventListener('smith:compose-sent', handler);
    return () => window.removeEventListener('smith:compose-sent', handler);
  }, [engagement, onSent]);

  async function send(email: string, coverNote?: string | null): Promise<boolean> {
    if (!email.trim()) { setError('Enter the client’s email address.'); return false; }
    setSending(true); setError('');
    try {
      const branding = await getFirmBranding();
      const html = buildAccountsPackHtml(engagement, {
        firmName: branding.firmName, firmLogoUrl: branding.logoUrl,
        accountantDetails: branding.accountantDetails, accountantsReport: branding.accountantsReport,
        comparatives: engagement.showComparatives ?? true, amended: engagement.amended ?? false,
      });
      const blob = await generatePdfBlob(html, undefined, { hardPageBreaks: true, pageNumbers: true });
      const s = engagement.statements;
      const summaryLines = s ? [
        { label: 'Turnover', value: gbp(s.profitLoss.turnoverTotal) },
        { label: 'Profit for the year', value: gbp(s.profitLoss.netProfit) },
        { label: 'Net assets', value: gbp(s.balanceSheet.netAssets) },
      ] : null;
      const filename = `Client_Approval_Pack_${engagement.companyName.replace(/\s+/g, '_')}_${engagement.periodEnd}.pdf`;

      if (isModuleActive('email-triage')) {
        // Record + render the email, but hand off to the in-app compose window.
        // Status is flipped to 'sent' only when the compose window actually sends
        // (handled by the 'smith:compose-sent' listener above) — NOT here.
        const res = await sendForApproval(engagement.id, { recipientEmail: email.trim(), coverNote, summaryLines, prepareOnly: true });
        pending.current = { engagementId: engagement.id, clientId: engagement.clientId };
        compose.open({
          defaultTo: [{ name: engagement.companyName, email: email.trim() }],
          defaultClients: engagement.clientId
            ? [{ id: engagement.clientId, name: engagement.companyName, client_ref: engagement.clientRef ?? '', contact_email: email.trim(), risk_rating: null }]
            : null,
          defaultSubject: res.subject ?? null,
          defaultHtmlBody: res.htmlBody ?? null,
          defaultAttachments: [new File([blob], filename, { type: 'application/pdf' })],
        });
      } else {
        // Direct Gmail send — the route flips status to 'sent' after it sends.
        const pdfBase64 = await blobToBase64(blob);
        await sendForApproval(engagement.id, { recipientEmail: email.trim(), coverNote, pdfBase64, summaryLines, prepareOnly: false });
        onSent({ ...engagement, approvalStatus: 'sent', sentAt: new Date().toISOString() });
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send for approval.');
      return false;
    } finally {
      setSending(false);
    }
  }

  return { send, sending, error, setError, triageActive: isModuleActive('email-triage') };
}
