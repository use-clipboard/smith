import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { MODULES } from '@/config/modules.config';

// ── POST /api/auth/signup ────────────────────────────────────────────────────
// Public (no session). Self-serve firm signup: creates a brand-new firm and its
// first user as that firm's admin. Reachable at /signup but intentionally NOT
// linked from anywhere — share the URL with firms you choose to onboard.
//
// Account is created confirmed + with a password (no Supabase email involved);
// the client signs in straight after.
const schema = z.object({
  firmName: z.string().min(1, 'Firm name is required').max(200),
  fullName: z.string().min(1, 'Your name is required').max(200),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

// New firms get every optional module switched on (core modules are alwaysOn).
// The admin can trim these in Settings → Tools. Pricing is ignored pre-billing.
const DEFAULT_MODULES = MODULES.filter(m => !m.alwaysOn).map(m => m.id);

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const { firmName, fullName, email, password } = parsed.data;
  const service = createServiceClient();

  // 1) Create the auth user (confirmed, with password — no Supabase email).
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email: email.toLowerCase().trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    console.error('[auth] signup createUser', createError);
    return NextResponse.json(
      { error: 'An account with this email may already exist. Try signing in instead.' },
      { status: 400 },
    );
  }
  const userId = created.user.id;

  // 2) Create the firm.
  const { data: firm, error: firmError } = await service
    .from('firms')
    .insert({ name: firmName.trim(), active_modules: DEFAULT_MODULES })
    .select('id')
    .single();
  if (firmError || !firm) {
    console.error('[auth] signup create firm', firmError);
    // Roll back the orphaned auth user so the email can be reused.
    try { await service.auth.admin.deleteUser(userId); } catch { /* best effort */ }
    return NextResponse.json({ error: 'Could not create your firm. Please try again.' }, { status: 500 });
  }

  // 3) Promote the auto-created user row to this firm's admin.
  const { error: userError } = await service
    .from('users')
    .update({ firm_id: firm.id, role: 'admin', full_name: fullName })
    .eq('id', userId);
  if (userError) {
    console.error('[auth] signup link user->firm', userError);
    return NextResponse.json({ error: 'Could not finish setting up your account. Please contact support.' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
