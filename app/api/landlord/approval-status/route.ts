import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// GET /api/landlord/approval-status?ids=<uuid>,<uuid>,…
//
// Approval state for a batch of saved analyses, for the history dashboard's
// Status column. Kept out of the shared /api/outputs list endpoint so that stays
// feature-agnostic.
//
// Per analysis, over its live (non-voided) approval rows:
//   preparing         — nothing sent yet (no rows, or only unsent drafts)
//   sent              — at least one request is out, awaiting a response
//   changes_requested — someone asked for changes (takes priority: it needs action)
//   approved          — every request sent has been approved
//
// A per-individual send has one row per owner, so "approved" means ALL of them.

export type LandlordApprovalStatus = 'preparing' | 'sent' | 'approved' | 'changes_requested';

const MAX_IDS = 200;

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get('ids') ?? '').trim();
  if (!raw) return NextResponse.json({ statuses: {} });
  const ids = Array.from(new Set(raw.split(',').map(s => s.trim()).filter(Boolean))).slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ statuses: {} });

  const supabase = createClient();

  // RLS on landlord_approvals keys off outputs.firm_id, so this can't leak
  // another firm's rows even if an id from elsewhere is passed in.
  const { data, error } = await supabase
    .from('landlord_approvals')
    .select('output_id, sent_at, approved_at, changes_requested_at')
    .in('output_id', ids)
    .is('voided_at', null);
  if (error) {
    console.error('GET /api/landlord/approval-status', error);
    return NextResponse.json({ error: 'Failed to load approval status' }, { status: 500 });
  }

  const statuses: Record<string, LandlordApprovalStatus> = {};
  for (const id of ids) statuses[id] = 'preparing';

  const byOutput = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = byOutput.get(row.output_id) ?? [];
    list.push(row);
    byOutput.set(row.output_id, list);
  }

  for (const [outputId, rows] of byOutput) {
    // Drafts that were prepared but never actually sent don't count as asked for.
    const requested = rows.filter(r => r.sent_at);
    if (requested.length === 0) { statuses[outputId] = 'preparing'; continue; }
    if (requested.some(r => r.changes_requested_at)) { statuses[outputId] = 'changes_requested'; continue; }
    statuses[outputId] = requested.every(r => r.approved_at) ? 'approved' : 'sent';
  }

  return NextResponse.json({ statuses });
}
