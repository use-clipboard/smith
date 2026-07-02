import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendMagicLink } from '@/lib/sendMagicLink';

const bodySchema = z.object({
  email: z.string().email(),
  // Optional post-login destination. Restricted to same-site relative paths
  // (single leading "/") to prevent an open-redirect via the email link.
  next: z.string().refine(v => v.startsWith('/') && !v.startsWith('//'), 'relative path').optional(),
});

// ── POST /api/auth/magic-link ────────────────────────────────────────────────
// Public (no session). Sends a sign-in link via Resend (NOT Supabase SMTP) if
// the address belongs to a user. Always responds { success: true } so the
// response can't be used to discover which emails are registered.
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ success: true });

  const email = parsed.data.email.toLowerCase().trim();
  try {
    await sendMagicLink(email, parsed.data.next);
  } catch (e) {
    // Swallow — never leak whether the address exists or why sending failed.
    console.error('[auth] magic-link send failed', e);
  }
  return NextResponse.json({ success: true });
}
