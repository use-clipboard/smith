import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, buildRawMessage, parseGmailMessage, firstInvalidRecipient } from '@/lib/gmail';

// ─── Draft handling ───────────────────────────────────────────────────────
// GET /api/email/draft?threadId=…   — load the latest draft on that thread
// POST /api/email/draft              — create or update a draft; pass `draftId`
//                                       in the body to update an existing one.
// DELETE /api/email/draft?draftId=… — discard a draft (used after a successful
//                                       send so the draft doesn't linger).

const DraftSchema = z.object({
  /** When set, update the existing Gmail draft. Otherwise create a new one. */
  draftId: z.string().optional(),
  // Drafts can be saved before a recipient is chosen — Gmail itself allows
  // recipient-less drafts, so don't require `to` here (unlike sending).
  to:      z.array(z.string()).default([]),
  cc:      z.array(z.string()).default([]),
  bcc:     z.array(z.string()).default([]),
  subject: z.string(),
  htmlBody: z.string(),
  replyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
  fromEmail: z.string().optional(),
  fromName: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json();
  const parsed = DraftSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 });

  // Drafts may have no recipient yet, but any recipient that IS present must be
  // a valid address — never let raw header text into the message builder.
  const badRecipient = firstInvalidRecipient([
    ...parsed.data.to, ...parsed.data.cc, ...parsed.data.bcc,
  ]);
  if (badRecipient) {
    return NextResponse.json(
      { error: `Invalid recipient address: "${badRecipient.slice(0, 80)}".` },
      { status: 400 },
    );
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

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const fromEmail = parsed.data.fromEmail || connection.google_email || '';
    const fromName  = parsed.data.fromName;
    const from      = fromName ? `${fromName} <${fromEmail}>` : fromEmail;

    const raw = buildRawMessage({
      from,
      to:  parsed.data.to,
      cc:  parsed.data.cc.length  > 0 ? parsed.data.cc  : undefined,
      bcc: parsed.data.bcc.length > 0 ? parsed.data.bcc : undefined,
      subject:          parsed.data.subject,
      htmlBody:         parsed.data.htmlBody,
      replyToMessageId: parsed.data.replyToMessageId,
    });

    const requestBody = {
      message: {
        raw,
        ...(parsed.data.threadId ? { threadId: parsed.data.threadId } : {}),
      },
    };

    // Update path — preserves the same draftId so the user keeps editing the
    // same Gmail draft across save → resume → save cycles.
    const res = parsed.data.draftId
      ? await gmail.users.drafts.update({
          userId: 'me',
          id:     parsed.data.draftId,
          requestBody,
        })
      : await gmail.users.drafts.create({
          userId: 'me',
          requestBody,
        });

    return NextResponse.json({ draftId: res.data.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Draft save error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET — fetch the latest draft for a thread so the compose modal can resume
// editing. Returns the To/CC/BCC/Subject/Body + attachment metadata; the
// client fetches each attachment via /api/email/attachment so the body of
// this response stays small.
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url       = new URL(req.url);
  const threadId  = url.searchParams.get('threadId');
  const draftIdQ  = url.searchParams.get('draftId');
  if (!threadId && !draftIdQ) {
    return NextResponse.json({ error: 'threadId or draftId required' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

    // Resolve a draftId. Gmail's drafts.list query doesn't accept a threadId
    // filter directly, so we list the user's drafts and walk them.
    let resolvedDraftId = draftIdQ ?? null;
    if (!resolvedDraftId && threadId) {
      // Cap the lookup to a reasonable working set — most users have a
      // handful of drafts at any one time.
      const list = await gmail.users.drafts.list({ userId: 'me', maxResults: 100 });
      for (const d of list.data.drafts ?? []) {
        const id = d.id;
        if (!id) continue;
        try {
          const got = await gmail.users.drafts.get({ userId: 'me', id, format: 'metadata' });
          const tid = got.data.message?.threadId;
          if (tid === threadId) { resolvedDraftId = id; break; }
        } catch { /* skip */ }
      }
    }
    if (!resolvedDraftId) {
      return NextResponse.json({ draft: null });
    }

    const got = await gmail.users.drafts.get({ userId: 'me', id: resolvedDraftId, format: 'full' });
    const rawMsg = got.data.message;
    if (!rawMsg) return NextResponse.json({ draft: null });

    const parsed = parseGmailMessage(rawMsg as Parameters<typeof parseGmailMessage>[0]);
    // BCC isn't returned by parseGmailMessage — pull it manually from headers.
    const bccHeader = rawMsg.payload?.headers?.find(h => h.name?.toLowerCase() === 'bcc')?.value ?? '';

    return NextResponse.json({
      draft: {
        draftId:  resolvedDraftId,
        threadId: parsed.threadId,
        subject:  parsed.subject,
        to:       parsed.to,
        cc:       parsed.cc,
        bcc:      parseAddressList(bccHeader),
        htmlBody: parsed.body,
        attachments: parsed.attachments
          .filter(a => !!a.attachmentId)
          .map(a => ({
            messageId:    a.messageId,
            attachmentId: a.attachmentId,
            filename:     a.filename,
            mimeType:     a.mimeType,
            size:         a.size,
          })),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Draft GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE — discard a draft. Called from the compose modal after a successful
// send so the message doesn't sit in the user's Drafts folder forever.
export async function DELETE(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url     = new URL(req.url);
  const draftId = url.searchParams.get('draftId');
  if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) {
    return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });
  }

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    await gmail.users.drafts.delete({ userId: 'me', id: draftId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Draft DELETE error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Parse a comma-separated address-list header into the same { name, email }
// shape parseGmailMessage uses for To/CC, so the client can render BCC tags
// uniformly with the others.
function parseAddressList(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(/,\s*/).map(part => {
    const m = part.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    return { name: '', email: part.trim() };
  }).filter(a => a.email);
}
