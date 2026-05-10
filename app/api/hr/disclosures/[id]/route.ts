import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { createNotification } from '@/lib/notifications';

const PatchSchema = z.object({
  status: z.enum(['submitted', 'acknowledged', 'in_progress', 'resolved', 'closed_no_action']).optional(),
  recipient_notes: z.string().nullable().optional(),
  resolution_summary: z.string().nullable().optional(),
});

// GET /api/hr/disclosures/[id]
//
// Records an audit row for the access (only if the caller is the recipient
// — the reporter doesn't need to be audited for viewing their own).
// Masks reporter identity for anonymous disclosures when the caller is not
// the reporter.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('hr_disclosures')
    .select(`
      id, firm_id, reporter_id, is_anonymous, recipient_id, recipient_role,
      category, urgency, body, status, recipient_notes, resolution_summary,
      resolved_at, created_at, updated_at,
      reporter:users!reporter_id ( id, full_name, email ),
      recipient:users!recipient_id ( id, full_name, email )
    `)
    .eq('id', params.id)
    .maybeSingle();

  if (error) {
    console.error('[GET /api/hr/disclosures/:id]', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.reporter_id !== ctx.userId && row.recipient_id !== ctx.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Audit log — recipient access only (reporter can read their own freely)
  if (row.recipient_id === ctx.userId) {
    const service = createServiceClient();
    void service.from('hr_disclosure_audit').insert({
      disclosure_id: row.id,
      actor_id: ctx.userId,
      action: 'viewed',
      details: { role: 'recipient' },
    });
  }

  // Strip reporter identity for the recipient when anonymous
  let masked = row as typeof row & { reporter?: unknown };
  if (row.is_anonymous && row.reporter_id !== ctx.userId) {
    masked = { ...row, reporter_id: '__anonymous__', reporter: null };
  }

  // Recipient notes are private to the recipient — strip from reporter view
  if (row.reporter_id === ctx.userId) {
    masked = { ...masked, recipient_notes: null };
  }

  return NextResponse.json({ disclosure: masked });
}

// PATCH /api/hr/disclosures/[id] — recipient updates status / notes / resolution
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let patch: z.infer<typeof PatchSchema>;
  try { patch = PatchSchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { data: row } = await supabase
    .from('hr_disclosures')
    .select('id, firm_id, reporter_id, recipient_id, status')
    .eq('id', params.id)
    .maybeSingle();
  if (!row || row.firm_id !== ctx.firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.recipient_id !== ctx.userId) return NextResponse.json({ error: 'Only the recipient can update.' }, { status: 403 });

  const update: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  let statusChanged = false;
  let newStatus = row.status;
  if (patch.status && patch.status !== row.status) {
    statusChanged = true;
    newStatus = patch.status;
    if (patch.status === 'resolved' || patch.status === 'closed_no_action') {
      update.resolved_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from('hr_disclosures').update(update).eq('id', row.id);
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

  // Audit
  const service = createServiceClient();
  void service.from('hr_disclosure_audit').insert({
    disclosure_id: row.id,
    actor_id: ctx.userId,
    action: statusChanged ? 'status_changed' : 'viewed',
    details: { status: newStatus, fields_changed: Object.keys(patch) },
  });

  // Notify reporter on status change. The reporter may be anonymous to others
  // but we still know who they are server-side and notify them.
  if (statusChanged) {
    void createNotification({
      userId: row.reporter_id,
      firmId: ctx.firmId,
      type: 'hr_disclosure_updated',
      title: 'Update on your confidential disclosure',
      body: `Status changed to "${newStatus.replace(/_/g, ' ')}".`,
      data: { disclosure_id: row.id, link: '/hr?tab=confidential' },
    });
  }

  return NextResponse.json({ ok: true });
}
