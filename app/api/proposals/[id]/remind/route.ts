import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { sendProposalReminderEmail } from '@/lib/email';

const Body = z.object({
  message: z.string().nullable().optional(),
});

// POST /api/proposals/[id]/remind — sends a "just a nudge" email to the prospect.
// Only valid for sent / viewed proposals (i.e. ones the prospect hasn't yet acted on).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json().catch(() => ({}))); }
  catch { body = {}; }

  const supabase = createClient();
  const { data: proposal } = await supabase
    .from('proposals')
    .select('id, status, title, public_token, prospect:proposal_prospects(contact_name, email)')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status !== 'sent' && proposal.status !== 'viewed') {
    return NextResponse.json({ error: `Cannot send a reminder on a ${proposal.status} proposal.` }, { status: 400 });
  }
  if (!proposal.public_token) {
    return NextResponse.json({ error: 'No public link on this proposal.' }, { status: 400 });
  }

  const [{ data: firm }, { data: sender }] = await Promise.all([
    supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle(),
    supabase.from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle(),
  ]);
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const link = `${baseUrl}/p/${proposal.public_token}`;

  try {
    await sendProposalReminderEmail({
      firmId: ctx.firmId,
      to: proposal.prospect.email,
      proposalTitle: proposal.title,
      prospectName: proposal.prospect.contact_name,
      firmName: firm?.name ?? 'your accountancy firm',
      senderName: sender?.full_name ?? sender?.email ?? null,
      acceptUrl: link,
      customMessage: body.message ?? null,
    });
  } catch (e) {
    console.error('[proposals/remind] email failed', e);
    return NextResponse.json({ error: 'Reminder could not be sent. Check Resend configuration.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
