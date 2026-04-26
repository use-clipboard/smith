import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

async function getAdminFirmId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', firmId: null };
  const { data: profile } = await supabase
    .from('users').select('role, firm_id').eq('id', user.id).single();
  if (profile?.role !== 'admin') return { error: 'Forbidden', firmId: null };
  if (!profile?.firm_id) return { error: 'No firm found', firmId: null };
  return { error: null, firmId: profile.firm_id as string };
}

/** GET: return current scheduled times and list type preference */
export async function GET() {
  const { error, firmId } = await getAdminFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { data: firm } = await service
    .from('firms').select('ch_refresh_times, ch_refresh_list_type').eq('id', firmId!).single();

  const f = firm as { ch_refresh_times?: string[] | null; ch_refresh_list_type?: string | null } | null;
  const times    = f?.ch_refresh_times    ?? [];
  const listType = f?.ch_refresh_list_type ?? 'client_list';
  return NextResponse.json({ times, listType });
}

const patchSchema = z.object({
  times:    z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(24),
  listType: z.enum(['client_list', 'custom_list']).default('client_list'),
});

/** PATCH: replace the full list of scheduled times and list type preference (admin only) */
export async function PATCH(request: NextRequest) {
  const { error, firmId } = await getAdminFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('firms')
    .update({
      ch_refresh_times:     parsed.data.times.length > 0 ? parsed.data.times : null,
      ch_refresh_list_type: parsed.data.listType,
    })
    .eq('id', firmId!);

  if (updateError) {
    console.error('PATCH /api/firms/ch-refresh-schedule', updateError);
    return NextResponse.json({ error: 'Failed to save schedule' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
