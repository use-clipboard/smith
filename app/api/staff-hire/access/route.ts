import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';

/** GET — list all firm users with their access status */
export async function GET() {
  try {
    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const supabase = createClient();

    const [usersRes, accessRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, full_name, email, role')
        .eq('firm_id', ctx.firmId)
        .order('full_name'),
      supabase
        .from('staff_hire_access')
        .select('user_id')
        .eq('firm_id', ctx.firmId),
    ]);

    const accessSet = new Set((accessRes.data ?? []).map(r => r.user_id));

    const users = (usersRes.data ?? []).map(u => ({
      user_id: u.id,
      full_name: u.full_name ?? u.email,
      email: u.email,
      role: u.role,
      // Admins always have access; staff need explicit grant
      has_access: u.role === 'admin' || accessSet.has(u.id),
    }));

    return NextResponse.json({ users });
  } catch (err) {
    console.error('[GET /api/staff-hire/access]', err);
    return NextResponse.json({ error: 'Failed to load access list' }, { status: 500 });
  }
}

/** POST — check current user's own access */
export async function HEAD() {
  try {
    const ctx = await getUserContext();
    if (!ctx) return new NextResponse(null, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return new NextResponse(null, { status: 403 });

    if (ctx.userRole === 'admin') return new NextResponse(null, { status: 200 });

    const supabase = createClient();
    const { data } = await supabase
      .from('staff_hire_access')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .eq('user_id', ctx.userId)
      .maybeSingle();

    return new NextResponse(null, { status: data ? 200 : 403 });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

const UpdateAccessSchema = z.object({
  userId: z.string().uuid(),
  grant: z.boolean(),
});

/** PATCH — grant or revoke access for a specific user */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = UpdateAccessSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('staff-hire')) return moduleNotActive('staff-hire');
    if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const supabase = createClient();
    const { userId, grant } = parsed.data;

    if (grant) {
      await supabase
        .from('staff_hire_access')
        .upsert({ firm_id: ctx.firmId, user_id: userId, granted_by: ctx.userId }, { onConflict: 'firm_id,user_id' });
    } else {
      await supabase
        .from('staff_hire_access')
        .delete()
        .eq('firm_id', ctx.firmId)
        .eq('user_id', userId);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[PATCH /api/staff-hire/access]', err);
    return NextResponse.json({ error: 'Failed to update access' }, { status: 500 });
  }
}
