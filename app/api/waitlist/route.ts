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

  // Upsert on the lower(email) unique index — repeat signups are silent no-ops.
  const { error, data } = await service
    .from('waitlist')
    .upsert(
      {
        email,
        firm_name: firmName || null,
        source: source || null,
        user_agent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
      },
      { onConflict: 'email', ignoreDuplicates: true },
    )
    .select('id');

  if (error) {
    console.error('[waitlist] insert failed:', error.message);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }

  // data is empty when the row already existed (ignoreDuplicates). Only send
  // emails for genuinely new signups.
  const isNew = Array.isArray(data) && data.length > 0;
  if (isNew) {
    try {
      await Promise.allSettled([
        sendWaitlistConfirmationEmail({ to: email }),
        sendWaitlistNotificationEmail({ email, firmName, source }),
      ]);
    } catch (e) {
      // Never fail the signup because an email didn't send.
      console.error('[waitlist] email dispatch error:', e);
    }
  }

  return NextResponse.json({ ok: true });
}
