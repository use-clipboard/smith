import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createStatelessClient } from '@supabase/supabase-js';
import { createClient, createServiceClient } from '@/lib/supabase-server';

const bodySchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    );
  }
  const { currentPassword, newPassword } = parsed.data;

  // Verify the current password with a stateless client so the user's active
  // session cookies (and the single-session nonce) are never touched.
  const verifier = createStatelessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyError) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });
  }

  // Apply the new password via the service role so we don't refresh the caller's session.
  const service = createServiceClient();
  const { error: updateError } = await service.auth.admin.updateUserById(user.id, {
    password: newPassword,
  });
  if (updateError) {
    console.error('POST /api/auth/change-password', updateError);
    return NextResponse.json({ error: 'Failed to update password. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
