import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

// GET — list the firm's connected task sending mailboxes (metadata only; never
// tokens) + the firm's default task-email sender. Any firm user can read (the
// template builder + settings need it). Tokens live in a service-role-only table.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const service = createServiceClient();
  const [{ data: mailboxes }, { data: firm }] = await Promise.all([
    service.from('firm_sending_mailboxes').select('id, google_email, label, created_at').eq('firm_id', ctx.firmId).order('created_at', { ascending: true }),
    service.from('firms').select('task_email_sender_mode, task_email_sender_mailbox_id').eq('id', ctx.firmId).maybeSingle(),
  ]);

  return NextResponse.json({
    mailboxes: mailboxes ?? [],
    default: {
      mode: (firm?.task_email_sender_mode as string) ?? 'owner',
      mailbox_id: (firm?.task_email_sender_mailbox_id as string | null) ?? null,
    },
  });
}

// PATCH — set the firm-wide default task-email sender (admin only).
const PatchSchema = z.object({
  mode: z.enum(['owner', 'specific']),
  mailbox_id: z.string().uuid().nullable().optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can change the default sender' }, { status: 403 });

  const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  let mailboxId: string | null = null;
  if (parsed.data.mode === 'specific') {
    mailboxId = parsed.data.mailbox_id ?? null;
    if (!mailboxId) return NextResponse.json({ error: 'Choose a sending mailbox' }, { status: 400 });
    const { data: ok } = await service.from('firm_sending_mailboxes').select('id').eq('id', mailboxId).eq('firm_id', ctx.firmId).maybeSingle();
    if (!ok) return NextResponse.json({ error: 'That mailbox is not connected to this firm' }, { status: 400 });
  }

  const { error } = await service.from('firms')
    .update({ task_email_sender_mode: parsed.data.mode, task_email_sender_mailbox_id: mailboxId })
    .eq('id', ctx.firmId);
  if (error) {
    console.error('[PATCH /api/tasks/sending-mailboxes]', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
