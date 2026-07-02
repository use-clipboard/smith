import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { sendWaitlistConfirmationEmail, sendWaitlistNotificationEmail } from '@/lib/email';

// Public, unauthenticated endpoint backing the pre-launch "Join the waitlist"
// lightbox. Stores the email in the `waitlist` table (service role) and fires
// a confirmation to the subscriber + a notification to the team. Email failures
// never fail the signup — the address is captured regardless.
//
// NOTE (pre-public hardening): this is an open endpoint. Add rate limiting
// before heavy public traffic (see Phase 2 checklist), same as /signup.

const schema = z.object({
  email: z.string().trim().email().max(320),
  firmName: z.string().trim().max(200).optional(),
  source: z.string().trim().max(60).optional(),
  // Honeypot — real users never fill this hidden field. Bots often do.
  website: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const { email, firmName, source, website } = parsed.data;

  // Honeypot tripped — pretend success, store nothing.
  if (website && website.trim() !== '') {
    return NextResponse.json({ ok: true });
  }

  const service = createServiceClient();

  // Store a normalised (lowercased) email so the case-insensitive unique index
  // dedupes reliably. Plain insert — a duplicate raises a unique violation
  // (23505) which we treat as "already on the list" (success, no email). This
  // works with the `lower(email)` expression index without an ON CONFLICT
  // target (which would require a unique index on the bare `email` column).
  const normalizedEmail = email.toLowerCase();

  const { error } = await service.from('waitlist').insert({
    email: normalizedEmail,
    firm_name: firmName || null,
    source: source || null,
    user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
  });

  let isNew = true;
  if (error) {
    if (error.code === '23505') {
      // Already subscribed — silent no-op, no duplicate email.
      isNew = false;
    } else {
      console.error('[waitlist] insert failed:', error.message);
      return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  }

  if (isNew) {
    try {
      await Promise.allSettled([
        sendWaitlistConfirmationEmail({ to: normalizedEmail }),
        sendWaitlistNotificationEmail({ email: normalizedEmail, firmName, source }),
      ]);
    } catch (e) {
      // Never fail the signup because an email didn't send.
      console.error('[waitlist] email dispatch error:', e);
    }
  }

  return NextResponse.json({ ok: true });
}
