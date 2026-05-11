import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { createNotification } from '@/lib/notifications';

const Body = z.object({
  reason: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch { body = {}; }
  const service = createServiceClient();
  const { data: proposal } = await service
    .from('proposals')
    .select('id, firm_id, status, created_by, title')
    .eq('public_token', params.token)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status === 'accepted' || proposal.status === 'declined') {
    return NextResponse.json({ error: 'Already decided' }, { status: 400 });
  }
  await service.from('proposals').update({
    status: 'declined',
    decided_at: new Date().toISOString(),
    decline_reason: body.reason ?? null,
  }).eq('id', proposal.id);
  if (proposal.created_by) {
    void createNotification({
      userId: proposal.created_by,
      firmId: proposal.firm_id,
      type: 'proposal_declined',
      title: 'Proposal declined',
      body: `Your proposal "${proposal.title}" was declined.${body.reason ? ` Reason: ${body.reason}` : ''}`,
      data: { proposal_id: proposal.id, link: '/proposals' },
    });
  }
  return NextResponse.json({ ok: true });
}
