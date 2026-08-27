import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage, firstInvalidRecipient, resolveProxyImagesToDataUris } from '@/lib/gmail';
import { wrapBodyFont, isEmailFontId } from '@/lib/emailFonts';
import { getFirmEmailFont } from '@/lib/emailFirmSettings';

// Larger attachments can't ride in the request body (the serverless function is
// capped at ~4.5 MB), so the browser stages them in this bucket first and sends
// us just their paths; we pull them back with the service-role client here.
const STAGING_BUCKET = 'email-attachments-staging';

interface StagedRef { path: string; filename: string; mimeType: string }

export const maxDuration = 120;

/** Split a "Name <email>" / "email" recipient string into name + email. */
function parseRecipientString(s: string): { name: string; email: string } {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim(), email: m[2].trim() };
  return { name: '', email: s.trim() };
}


export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token, google_email')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  // Parse as FormData to support file attachments
  let to: string[] = [];
  let cc: string[] = [];
  let bcc: string[] = [];
  let subject = '';
  let htmlBody = '';
  let bodyFont: string | undefined;
  let replyToMessageId: string | undefined;
  let threadId: string | undefined;
  let importance: 'high' | undefined;
  let attachments: Array<{ filename: string; mimeType: string; data: Buffer }> = [];
  let stagedRefs: StagedRef[] = [];

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData();
    to = JSON.parse((formData.get('to') as string) || '[]') as string[];
    cc = JSON.parse((formData.get('cc') as string) || '[]') as string[];
    bcc = JSON.parse((formData.get('bcc') as string) || '[]') as string[];
    subject = (formData.get('subject') as string) || '';
    htmlBody = (formData.get('htmlBody') as string) || '';
    bodyFont = (formData.get('bodyFont') as string) || undefined;
    replyToMessageId = (formData.get('replyToMessageId') as string) || undefined;
    threadId = (formData.get('threadId') as string) || undefined;
    importance = (formData.get('importance') as string) === 'high' ? 'high' : undefined;
    const files = formData.getAll('attachments') as File[];
    attachments = await Promise.all(
      files.map(async f => ({
        filename: f.name,
        mimeType: f.type || 'application/octet-stream',
        data: Buffer.from(await f.arrayBuffer()),
      }))
    );
    // Larger attachments arrive as staging-bucket paths instead of raw bytes.
    stagedRefs = JSON.parse((formData.get('stagedAttachments') as string) || '[]') as StagedRef[];
  } else {
    const body = await req.json() as Record<string, unknown>;
    to = (body.to as string[]) ?? [];
    cc = (body.cc as string[]) ?? [];
    bcc = (body.bcc as string[]) ?? [];
    subject = (body.subject as string) ?? '';
    htmlBody = (body.htmlBody as string) ?? '';
    bodyFont = body.bodyFont as string | undefined;
    replyToMessageId = body.replyToMessageId as string | undefined;
    threadId = body.threadId as string | undefined;
    importance = body.importance === 'high' ? 'high' : undefined;
  }

  if (!to.length) {
    return NextResponse.json({ error: 'At least one recipient required' }, { status: 400 });
  }

  // Reject malformed recipients (e.g. raw header text pasted into a field)
  // before they reach the message builder — a friendly error beats a cryptic
  // Gmail rejection or a silently broken send.
  const badRecipient = firstInvalidRecipient([...to, ...cc, ...bcc]);
  if (badRecipient) {
    return NextResponse.json(
      { error: `Invalid recipient address: "${badRecipient.slice(0, 80)}". Please check the To, Cc and Bcc fields.` },
      { status: 400 },
    );
  }

  // Pull any staged attachments back from the bucket (service-role bypasses
  // RLS). Each path must belong to the requesting user — never read someone
  // else's staged file. Bad/missing refs are skipped rather than failing the
  // whole send. Staged copies are deleted after the send attempt.
  const service = createServiceClient();
  const ownedStaged = stagedRefs.filter(r => r?.path?.startsWith(`${ctx.userId}/`));
  if (ownedStaged.length > 0) {
    const fetched = await Promise.all(
      ownedStaged.map(async ref => {
        const { data: blob, error } = await service.storage.from(STAGING_BUCKET).download(ref.path);
        if (error || !blob) { console.error('[email/send] staged download', ref.path, error); return null; }
        return {
          filename: ref.filename,
          mimeType: ref.mimeType || 'application/octet-stream',
          data: Buffer.from(await blob.arrayBuffer()),
        };
      }),
    );
    attachments = [...attachments, ...fetched.filter((a): a is NonNullable<typeof a> => a !== null)];
  }

  // Resolve the body font. The compose window names one (it knows the firm
  // default and shows it while typing), so the DB read only happens for callers
  // that don't — never letting an unnamed font mean "no font at all".
  const resolvedFont = isEmailFontId(bodyFont)
    ? bodyFont!
    : await getFirmEmailFont(supabase, ctx.firmId);

  try {
    const { gmail, accessToken } = await getRefreshedGmailClient(connection.refresh_token);

    // Forwarded inline images come through as our proxy URLs — pull their bytes
    // back in so the recipient sees them (buildRawMessage turns them into cid
    // parts). No-op when the body has none.
    const bodyWithImages = await resolveProxyImagesToDataUris(htmlBody, gmail);

    const raw = buildRawMessage({
      from: connection.google_email,
      to, cc, bcc,
      subject: subject || '(no subject)',
      // The editor emits unstyled HTML and the message is sent raw, so the font
      // has to be inlined here or the recipient sees their client's default.
      // wrapBodyFont replaces any wrapper already present rather than nesting.
      htmlBody: wrapBodyFont(bodyWithImages, resolvedFont),
      replyToMessageId,
      importance,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId },
    });

    await supabase
      .from('email_connections')
      .update({ access_token: accessToken, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId);

    // Learn the To/Cc recipients for the compose "Recent" suggestions
    // (best-effort — never let this affect the send result).
    try {
      const learned = [...to, ...cc]
        .map(parseRecipientString)
        .filter(r => r.email.includes('@'));
      await Promise.allSettled(
        learned.map(r => supabase.rpc('record_email_recipient', { p_email: r.email, p_name: r.name })),
      );
    } catch (recErr) {
      console.error('[email/send] record recipients (non-fatal)', recErr);
    }

    return NextResponse.json({
      messageId: sendRes.data.id,
      threadId: sendRes.data.threadId,
    });
  } catch (err) {
    // Extract the most useful part of the Gmail API error
    let message = 'Failed to send email';
    if (err instanceof Error) {
      // Gmail API errors often have a `message` like "Invalid Credentials" or include a code
      message = err.message.slice(0, 300);
    }
    console.error('Email send error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    // Staged attachments are one-time-use — remove them whether the send
    // succeeded or failed (a retry re-stages fresh copies; the cron mops up any
    // that slip through).
    if (ownedStaged.length > 0) {
      await service.storage.from(STAGING_BUCKET).remove(ownedStaged.map(r => r.path)).catch(() => { /* best-effort */ });
    }
  }
}
