import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';

const PostSchema = z.object({ body: z.string().min(1).max(5000) });

interface MessageRow {
  id: string;
  disclosure_id: string;
  author_id: string;
  author_role: 'reporter' | 'recipient';
  body: string;
  created_at: string;
  author?: { id: string; full_name: string | null; email: string } | null;
}

// GET /api/hr/disclosures/[id]/messages
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Fetch parent + verify the caller is a party to it in their own firm before
  // returning the confidential thread (mirrors the POST guard below — do not
  // rely on RLS alone for whistleblowing content).
  const { data: parent } = await supabase
    .from('hr_disclosures')
    .select('id, firm_id, reporter_id, recipient_id, is_anonymous')
    .eq('id', params.id)
    .maybeSingle();
  if (!parent || parent.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (parent.reporter_id !== ctx.userId && parent.recipient_id !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('hr_disclosure_messages')
    .select('id, disclosure_id, author_id, author_role, body, created_at, author:users!author_id ( id, full_name, email )')
    .eq('disclosure_id', params.id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[GET /api/hr/disclosures/:id/messages]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  // Mask reporter author identity for the recipient when the disclosure is anonymous
  const masked = (data ?? []).map((m: unknown) => {
    const msg = m as MessageRow;
    if (parent.is_anonymous && msg.author_role === 'reporter' && msg.author_id !== ctx.userId) {
      return { ...msg, author_id: '__anonymous__', author: null };
    }
    return msg;
  });

  return NextResponse.json({ messages: masked });
}

// POST /api/hr/disclosures/[id]/messages — append to thread
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof PostSchema>;
  try { body = PostSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Verify caller is a party to the parent disclosure and figure out their role
  const { data: parent } = await supabase
    .from('hr_disclosures')
    .select('id, firm_id, reporter_id, recipient_id')
    .eq('id', params.id)
    .maybeSingle();
  if (!parent || parent.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const isReporter = parent.reporter_id === ctx.userId;
  const isRecipient = parent.recipient_id === ctx.userId;
  if (!isReporter && !isRecipient) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: created, error } = await supabase
    .from('hr_disclosure_messages')
    .insert({
      disclosure_id: params.id,
      author_id: ctx.userId,
      author_role: isReporter ? 'reporter' : 'recipient',
      body: body.body,
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: 'Send failed' }, { status: 500 });

  // Audit
  const service = createServiceClient();
  void service.from('hr_disclosure_audit').insert({
    disclosure_id: params.id,
    actor_id: ctx.userId,
    action: 'message_sent',
    details: { author_role: isReporter ? 'reporter' : 'recipient' },
  });

  // Notify the other party
  const otherUserId = isReporter ? parent.recipient_id : parent.reporter_id;
  void createNotification({
    userId: otherUserId,
    firmId: ctx.firmId,
    type: 'hr_disclosure_message',
    title: 'New message on confidential disclosure',
    body: 'There\'s a new reply on a confidential disclosure thread.',
    data: { disclosure_id: params.id, link: '/hr?tab=confidential' },
  });

  return NextResponse.json({ id: created.id });
}
