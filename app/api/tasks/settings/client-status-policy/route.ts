import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { loadFirmPolicy, normalisePolicy } from '@/lib/taskClientStatusPolicy';

// GET — return the firm's current policy (any user can read; the values
//       drive client-side display logic so non-admins need to see them).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const policy = await loadFirmPolicy(supabase, ctx.firmId);
  return NextResponse.json({ policy });
}

const PatchSchema = z.object({
  on_hold: z.object({
    pause_recurrence:     z.boolean(),
    exclude_from_overdue: z.boolean(),
    grey_out_rows:        z.boolean(),
    hide_from_default:    z.boolean(),
  }).partial().optional(),
  inactive: z.object({
    auto_cancel_open:  z.boolean(),
    break_ch_links:    z.boolean(),
    hide_from_default: z.boolean(),
  }).partial().optional(),
});

// PATCH — admin only. Merges the incoming partial with the current row so
// the caller doesn't have to send every key.
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const supabaseRead = createClient();
  const service      = createServiceClient();
  const current      = await loadFirmPolicy(supabaseRead, ctx.firmId);

  // Deep-merge the patch on top of current values
  const merged = normalisePolicy({
    on_hold:  { ...current.on_hold,  ...(parsed.data.on_hold  ?? {}) },
    inactive: { ...current.inactive, ...(parsed.data.inactive ?? {}) },
  });

  const { error } = await service
    .from('firms')
    .update({ task_client_status_policy: merged })
    .eq('id', ctx.firmId);
  if (error) {
    console.error('[PATCH /api/tasks/settings/client-status-policy]', error);
    return NextResponse.json({ error: 'Failed to save policy', detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, policy: merged });
}
