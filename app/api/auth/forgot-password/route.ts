import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendRecoveryEmail } from '@/lib/sendRecoveryEmail';

const bodySchema = z.object({ email: z.string().email() });

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Public (no session). Sends a password-reset email if the address belongs to a
// user. Always responds { success: true } regardless, so the response can't be
// used to discover which emails are registered.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: true });

  const email = parsed.data.email.toLowerCase().trim();
  try {
    await sendRecoveryEmail({ email });
  } catch (e) {
    // Swallow — never leak whether the address exists or why sending failed.
    console.error('[auth] forgot-password send failed', e);
  }
  return NextResponse.json({ success: true });
}
