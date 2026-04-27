import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/** GET /api/calendar/settings — get per-member visibility settings for the firm */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Get all team members with their visibility settings and connection status
  const { data: members } = await supabase
    .from('users')
    .select('id, full_name, email, role')
    .eq('firm_id', ctx.firmId)
    .order('full_name');

  const { data: visibility } = await supabase
    .from('calendar_visibility')
    .select('user_id, visible_to_team, editable_by_team')
    .eq('firm_id', ctx.firmId);

  const { data: tokens } = await supabase
    .from('calendar_tokens')
    .select('user_id, google_email')
    .in('user_id', (members ?? []).map(m => m.id));

  const visMap = new Map((visibility ?? []).map(v => [v.user_id, v]));
  const tokenMap = new Map((tokens ?? []).map(t => [t.user_id, t]));

  const result = (members ?? []).map(m => {
    const isStaff = m.role === 'staff';
    const vis = visMap.get(m.id);
    return {
      userId: m.id,
      name: m.full_name ?? m.email ?? 'Unknown',
      email: m.email,
      role: m.role,
      connected: !!tokenMap.get(m.id),
      googleEmail: tokenMap.get(m.id)?.google_email ?? null,
      // Staff: always visible + editable (locked). Admins: use saved setting, default both on.
      visibleToTeam: isStaff ? true : (vis?.visible_to_team ?? true),
      editableByTeam: isStaff ? true : (vis?.editable_by_team ?? true),
      locked: isStaff, // UI uses this to disable toggles
    };
  });

  return NextResponse.json({ members: result });
}

const UpdateSettingsSchema = z.object({
  userId: z.string().uuid(),
  visibleToTeam: z.boolean(),
  editableByTeam: z.boolean(),
});

/** PATCH /api/calendar/settings — admin only: update visibility for a team member */
export async function PATCH(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json();
  const parsed = UpdateSettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();

  // Verify target user belongs to this firm
  const { data: targetUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', parsed.data.userId)
    .eq('firm_id', ctx.firmId)
    .single();

  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Staff calendars are always visible+editable — settings cannot be changed
  if (targetUser.role === 'staff') {
    return NextResponse.json({ error: 'Staff member calendars are always visible to the team' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('calendar_visibility')
    .select('id')
    .eq('firm_id', ctx.firmId)
    .eq('user_id', parsed.data.userId)
    .single();

  const record = {
    firm_id: ctx.firmId,
    user_id: parsed.data.userId,
    visible_to_team: parsed.data.visibleToTeam,
    editable_by_team: parsed.data.editableByTeam,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase
      .from('calendar_visibility')
      .update(record)
      .eq('firm_id', ctx.firmId)
      .eq('user_id', parsed.data.userId);
  } else {
    await supabase.from('calendar_visibility').insert(record);
  }

  return NextResponse.json({ success: true });
}
