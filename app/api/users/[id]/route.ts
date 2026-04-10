import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

const patchSchema = z.object({
  role: z.enum(['admin', 'staff']).optional(),
  full_name: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

async function getAdminProfile() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', status: 401, profile: null, currentUserId: null };

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return { error: 'Forbidden', status: 403, profile: null, currentUserId: null };

  return { error: null, status: 200, profile, currentUserId: user.id };
}

/** Returns the count of admins in the firm, excluding a specific user ID (for pre-delete/demote checks) */
async function countAdmins(firmId: string, excludeUserId?: string): Promise<number> {
  const supabase = createClient();
  let query = supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .eq('role', 'admin');
  if (excludeUserId) query = query.neq('id', excludeUserId);
  const { count } = await query;
  return count ?? 0;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const { error, status, profile } = await getAdminProfile();
  if (error) return NextResponse.json({ error }, { status });

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  // If demoting this user to staff, ensure there will still be at least one admin
  if (parsed.data.role === 'staff') {
    const remaining = await countAdmins(profile!.firm_id, params.id);
    if (remaining < 1) {
      return NextResponse.json(
        { error: 'Cannot demote this user — there must be at least one admin in the firm.' },
        { status: 400 }
      );
    }
  }

  const supabase = createClient();
  const service = createServiceClient();

  // Update public users table fields
  const publicUpdate: Record<string, string> = {};
  if (parsed.data.role) publicUpdate.role = parsed.data.role;
  if (parsed.data.full_name) publicUpdate.full_name = parsed.data.full_name;
  if (parsed.data.email) publicUpdate.email = parsed.data.email;

  if (Object.keys(publicUpdate).length > 0) {
    const { error: updateError } = await supabase
      .from('users')
      .update(publicUpdate)
      .eq('id', params.id)
      .eq('firm_id', profile!.firm_id);
    if (updateError) {
      console.error('PATCH /api/users/[id] public', updateError);
      return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
    }
  }

  // Update auth email if provided
  if (parsed.data.email) {
    const { error: authError } = await service.auth.admin.updateUserById(params.id, {
      email: parsed.data.email,
    });
    if (authError) {
      console.error('PATCH /api/users/[id] auth email', authError);
      return NextResponse.json({ error: 'Failed to update email in auth' }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { error, status, profile, currentUserId } = await getAdminProfile();
  if (error) return NextResponse.json({ error }, { status });

  if (params.id === currentUserId) {
    return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 });
  }

  // If removing an admin, ensure there will still be at least one admin
  const supabase = createClient();
  const { data: targetUser } = await supabase
    .from('users')
    .select('role')
    .eq('id', params.id)
    .eq('firm_id', profile!.firm_id)
    .single();

  if (targetUser?.role === 'admin') {
    const remaining = await countAdmins(profile!.firm_id, params.id);
    if (remaining < 1) {
      return NextResponse.json(
        { error: 'Cannot remove this user — there must be at least one admin in the firm.' },
        { status: 400 }
      );
    }
  }

  const service = createServiceClient();

  // Remove from public.users (cascade handles related data)
  await supabase
    .from('users')
    .delete()
    .eq('id', params.id)
    .eq('firm_id', profile!.firm_id);

  // Disable auth account
  await service.auth.admin.deleteUser(params.id);

  return NextResponse.json({ success: true });
}
