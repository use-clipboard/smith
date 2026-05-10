import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';

const RecipientRole = z.enum(['manager', 'other_manager', 'confidential_recipient']);
const Category = z.enum([
  'harassment', 'bullying', 'discrimination', 'safety',
  'financial_wrongdoing', 'whistleblowing', 'other',
]);
const Urgency = z.enum(['low', 'medium', 'high']);

const CreateSchema = z.object({
  recipient_role: RecipientRole,
  // For 'other_manager' and 'confidential_recipient' the client passes a user id.
  // For 'manager' we look the manager up server-side from the reporter's record.
  recipient_id: z.string().uuid().optional(),
  category: Category,
  urgency: Urgency.default('medium'),
  body: z.string().min(20, 'Please give a bit more detail (min 20 characters).'),
  is_anonymous: z.boolean().default(false),
});

interface DisclosureRow {
  id: string;
  firm_id: string;
  reporter_id: string;
  is_anonymous: boolean;
  recipient_id: string;
  recipient_role: string;
  category: string;
  urgency: string;
  body: string;
  status: string;
  recipient_notes: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  reporter?: { id: string; full_name: string | null; email: string } | null;
  recipient?: { id: string; full_name: string | null; email: string } | null;
}

// Mask reporter identity when the disclosure is anonymous and the caller is
// NOT the reporter themselves. This is enforced server-side so the client
// never sees the identity even if it tampered with its own queries.
function maskAnonymity(rows: DisclosureRow[], callerUserId: string): DisclosureRow[] {
  return rows.map(r => {
    if (r.is_anonymous && r.reporter_id !== callerUserId) {
      return { ...r, reporter_id: '__anonymous__', reporter: null };
    }
    return r;
  });
}

// GET /api/hr/disclosures?scope=mine|inbox
//   mine  = disclosures I've raised
//   inbox = disclosures sent to me as recipient
export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const scope = (url.searchParams.get('scope') ?? 'mine') as 'mine' | 'inbox';

  const supabase = createClient();
  let query = supabase
    .from('hr_disclosures')
    .select(`
      id, firm_id, reporter_id, is_anonymous, recipient_id, recipient_role,
      category, urgency, body, status, recipient_notes, resolution_summary,
      resolved_at, created_at, updated_at,
      reporter:users!reporter_id ( id, full_name, email ),
      recipient:users!recipient_id ( id, full_name, email )
    `)
    .eq('firm_id', ctx.firmId);

  if (scope === 'mine')   query = query.eq('reporter_id', ctx.userId);
  if (scope === 'inbox')  query = query.eq('recipient_id', ctx.userId);

  query = query.order('created_at', { ascending: false });
  const { data, error } = await query;

  if (error) {
    console.error('[GET /api/hr/disclosures]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as DisclosureRow[];
  return NextResponse.json({ disclosures: maskAnonymity(rows, ctx.userId) });
}

// POST /api/hr/disclosures — file a new confidential disclosure.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateSchema>;
  try { body = CreateSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Resolve the recipient_id depending on the chosen role.
  let recipientId: string | null = null;

  if (body.recipient_role === 'manager') {
    const { data: me } = await supabase.from('users').select('manager_id').eq('id', ctx.userId).maybeSingle();
    if (!me?.manager_id) {
      return NextResponse.json({ error: 'You don\'t have a manager assigned. Choose a different recipient.' }, { status: 400 });
    }
    recipientId = me.manager_id;
  } else if (body.recipient_role === 'confidential_recipient') {
    const { data: settings } = await supabase
      .from('firm_hr_settings')
      .select('confidential_recipient_user_id')
      .eq('firm_id', ctx.firmId)
      .maybeSingle();
    recipientId = settings?.confidential_recipient_user_id ?? null;
    if (!recipientId) {
      return NextResponse.json({ error: 'Your firm has not designated a Confidential HR Recipient yet. Ask an admin to set one in Settings → HR.' }, { status: 400 });
    }
  } else if (body.recipient_role === 'other_manager') {
    if (!body.recipient_id) {
      return NextResponse.json({ error: 'Please pick a manager.' }, { status: 400 });
    }
    // Verify the chosen recipient is actually a manager of someone (i.e. has direct reports) in the same firm.
    const { data: target } = await supabase.from('users').select('id, firm_id').eq('id', body.recipient_id).maybeSingle();
    if (!target || target.firm_id !== ctx.firmId) {
      return NextResponse.json({ error: 'Recipient not found in your firm.' }, { status: 404 });
    }
    const { count } = await supabase
      .from('users')
      .select('id', { head: true, count: 'exact' })
      .eq('manager_id', body.recipient_id);
    if ((count ?? 0) < 1) {
      return NextResponse.json({ error: 'Selected user is not a manager.' }, { status: 400 });
    }
    recipientId = body.recipient_id;
  }

  if (!recipientId) {
    return NextResponse.json({ error: 'Could not resolve recipient.' }, { status: 400 });
  }

  // Block self-routing — you can't send a disclosure to yourself.
  if (recipientId === ctx.userId) {
    return NextResponse.json({ error: 'You cannot send a disclosure to yourself. Pick a different recipient.' }, { status: 400 });
  }

  const { data: created, error } = await supabase
    .from('hr_disclosures')
    .insert({
      firm_id: ctx.firmId,
      reporter_id: ctx.userId,
      is_anonymous: body.is_anonymous,
      recipient_id: recipientId,
      recipient_role: body.recipient_role,
      category: body.category,
      urgency: body.urgency,
      body: body.body,
    })
    .select('id, recipient_id, urgency, category, is_anonymous')
    .single();

  if (error) {
    console.error('[POST /api/hr/disclosures]', error);
    return NextResponse.json({ error: 'Failed to file disclosure.' }, { status: 500 });
  }

  // Notify the recipient. Body is intentionally generic — they need to open
  // the disclosure to see contents.
  void createNotification({
    userId: created.recipient_id,
    firmId: ctx.firmId,
    type: 'hr_disclosure_filed',
    title: created.urgency === 'high' ? '⚠ Urgent confidential disclosure' : 'New confidential disclosure',
    body: 'A team member has raised a confidential disclosure. Open in HR → Confidential to view.',
    data: { disclosure_id: created.id, link: '/hr?tab=confidential' },
  });

  return NextResponse.json({ id: created.id });
}
