import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

const schema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'staff']),
  full_name: z.string().optional(),
  password: z.string().min(8).optional(), // if provided, create user directly without email invite
});

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  let { role } = parsed.data;
  const { email, full_name, password } = parsed.data;
  const service = createServiceClient();

  // If this firm has no users yet, the first user must be an admin regardless of what was requested
  const { count: existingCount } = await service
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', profile.firm_id);

  if ((existingCount ?? 0) === 0) {
    role = 'admin';
  }

  let createdUserId: string | undefined;

  if (password) {
    // Create user directly with a password — no email required
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name ?? '' },
    });
    if (createError) {
      console.error('Create user error:', createError);
      return NextResponse.json({ error: 'Failed to create user. The email may already be registered.' }, { status: 400 });
    }
    createdUserId = created.user?.id;
  } else {
    // Send invite email via Supabase Auth
    const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { full_name: full_name ?? '' },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/auth/callback`,
    });
    if (inviteError) {
      console.error('Invite error:', inviteError);
      return NextResponse.json({ error: 'Failed to send invite. The email may already be registered.' }, { status: 400 });
    }
    createdUserId = invited.user?.id;
  }

  // Set firm_id and role on the auto-created user row
  if (createdUserId) {
    await service
      .from('users')
      .update({ firm_id: profile.firm_id, role, full_name: full_name ?? '' })
      .eq('id', createdUserId);
  }

  return NextResponse.json({ success: true });
}
