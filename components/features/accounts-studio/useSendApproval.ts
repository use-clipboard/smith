'use client';

import { useState } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { generatePdfBlob } from '@/utils/pdfFromHtml';
import { buildAccountsPackHtml } from '@/lib/accounts-studio/accountsPackHtml';
import { getFirmBranding } from './branding';
import { sendForApproval } from './persistence';
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
        const res = await sendForApproval(engagement.id, { recipientEmail: email.trim(), coverNote, summaryLines, prepareOnly: true });
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
        const pdfBase64 = await blobToBase64(blob);
        await sendForApproval(engagement.id, { recipientEmail: email.trim(), coverNote, pdfBase64, summaryLines, prepareOnly: false });
      }

      onSent({ ...engagement, approvalStatus: 'sent', sentAt: new Date().toISOString() });
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
