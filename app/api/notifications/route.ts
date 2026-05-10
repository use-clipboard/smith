import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/** GET /api/notifications — fetch recent notifications for current user */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false })
    .limit(30);

  const unreadCount = (notifications ?? []).filter(n => !n.read).length;
  return NextResponse.json({ notifications: notifications ?? [], unreadCount });
}

/** PATCH /api/notifications — mark notifications as read.
 *  Optional ?types=hr_holiday_decided,hr_briefing_published narrows to those types.
 *  With no query param, marks ALL of this user's notifications as read.
 */
export async function PATCH(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const typesParam = new URL(request.url).searchParams.get('types');
  const types = typesParam ? typesParam.split(',').map(s => s.trim()).filter(Boolean) : null;

  const supabase = createClient();
  let query = supabase
    .from('notifications')
    .update({ read: true })
    .eq('user_id', ctx.userId)
    .eq('read', false);
  if (types && types.length > 0) query = query.in('type', types);
  await query;

  return NextResponse.json({ success: true });
}

/** DELETE /api/notifications?id=<uuid> — dismiss a single notification */
export async function DELETE(request: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const supabase = createClient();
  await supabase.from('notifications').delete().eq('id', id).eq('user_id', ctx.userId);
  return NextResponse.json({ success: true });
}
