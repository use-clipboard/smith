import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage, parseGmailMessage, resolveProxyImagesToDataUris } from '@/lib/gmail';

// POST /api/email/bulk-forward
//
// Forwards multiple email threads in one go: for each thread we fetch the
// most recent message (with attachments) and ship it as its own forwarded
// email to the chosen recipient(s). Each forward is a SEPARATE email — the
// recipient sees N distinct messages, one per selected thread — preserving
// each thread's subject + attachments rather than bundling them together.
//
// Partial failures don't abort the run; the response reports per-thread
// success/failure so the caller can surface "12 forwarded, 1 failed" UI.

const Schema = z.object({
  threadIds:  z.array(z.string().min(1)).min(1).max(50),
  toEmails:   z.array(z.string().email()).min(1),
  ccEmails:   z.array(z.string().email()).optional().default([]),
  /** Optional note prepended to each forwarded body. */
  note:       z.string().optional().default(''),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { threadIds, toEmails, ccEmails, note } = parsed.data;

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

  const results: Array<{ threadId: string; ok: boolean; messageId?: string; error?: string }> = [];

  for (const threadId of threadIds) {
    try {
      const threadRes = await gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' });
      const messages = (threadRes.data.messages ?? []).map(m =>
        parseGmailMessage(m as Parameters<typeof parseGmailMessage>[0])
      );
      const original = messages[messages.length - 1];
      if (!original) {
        results.push({ threadId, ok: false, error: 'Thread has no messages' });
        continue;
      }

      // Pull every attachment down from Gmail and shovel it straight onto
      // the outgoing message. Individual attachment failures don't abort
      // the per-thread forward — a partial forward beats a dropped one.
      const attachments: Array<{ filename: string; mimeType: string; data: Buffer }> = [];
      for (const att of original.attachments) {
        if (!att.attachmentId) continue;
        try {
          const attRes = await gmail.users.messages.attachments.get({
            userId:    'me',
            messageId: att.messageId,
            id:        att.attachmentId,
          });
          const dataB64 = attRes.data.data;
          if (!dataB64) continue;
          attachments.push({
            filename: att.filename,
            mimeType: att.mimeType,
            data:     Buffer.from(dataB64, 'base64url'),
          });
        } catch (err) {
          console.error('bulk-forward attachment failed', att.filename, err);
        }
      }

      const fwdHeader = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #6b7280; margin-bottom: 12px;">
          <p style="margin: 0 0 4px 0;"><strong>---------- Forwarded message ----------</strong></p>
          <p style="margin: 0;">From: ${escapeHtml(original.from.name ? `${original.from.name} <${original.from.email}>` : original.from.email)}</p>
          <p style="margin: 0;">Date: ${escapeHtml(original.date)}</p>
          <p style="margin: 0;">Subject: ${escapeHtml(original.subject)}</p>
          ${original.to.length ? `<p style="margin: 0;">To: ${escapeHtml(original.to.map(t => t.email).join(', '))}</p>` : ''}
          ${original.cc.length ? `<p style="margin: 0;">CC: ${escapeHtml(original.cc.map(t => t.email).join(', '))}</p>` : ''}
        </div>
      `;
      const noteBlock = note.trim()
        ? `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #1f2937; margin-bottom: 16px; white-space: pre-wrap;">${escapeHtml(note.trim())}</div><hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />`
        : '';
      // Inline images in the forwarded body are our proxy URLs — pull the bytes
      // back so the recipient sees them (buildRawMessage re-attaches as cid).
      const forwardedBody = await resolveProxyImagesToDataUris(original.body || '', gmail);
      const htmlBody = `${noteBlock}${fwdHeader}<div>${forwardedBody}</div>`;

      const subject = original.subject.toLowerCase().startsWith('fwd:')
        ? original.subject
        : `Fwd: ${original.subject || '(no subject)'}`;

      const raw = buildRawMessage({
        from:        connection.google_email,
        to:          toEmails,
        cc:          ccEmails,
        subject,
        htmlBody,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      const sendRes = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      results.push({ threadId, ok: true, messageId: sendRes.data.id ?? undefined });
    } catch (err) {
      console.error('bulk-forward thread failed', threadId, err);
      results.push({
        threadId,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : 'Forward failed',
      });
    }
  }

  await supabase
    .from('email_connections')
    .update({ access_token: accessToken, updated_at: new Date().toISOString() })
    .eq('user_id', ctx.userId);

  const successCount = results.filter(r => r.ok).length;
  const failedCount  = results.length - successCount;
  return NextResponse.json({
    success: successCount,
    failed:  failedCount,
    results,
  });
}
