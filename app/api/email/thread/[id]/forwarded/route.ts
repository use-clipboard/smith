import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getRefreshedGmailClient, parseGmailMessage } from '@/lib/gmail';

// Deferred forward-detection for a thread.
//
// Threading is fragile — Outlook/Gmail can break a thread when the user
// forwards (different recipient, modified subject). The SENT forward then
// lives in a *separate* thread, leaving the original thread with no Fwd:/FW:
// SENT message — so the UI can't show a "Forwarded · <date>" chip from the
// thread's own messages.
//
// As a fallback we do a cheap Sent-folder search for the same subject with a
// forward prefix and return the latest match's date. This used to run inline
// in GET /api/email/thread/[id], adding up to ~6 Gmail round-trips (one list +
// up to five metadata gets) to the *critical* open path. It's now its own
// endpoint the client calls AFTER the messages are on screen, so it never
// delays opening an email. The client persists the result to localStorage, so
// the search runs at most once per thread.
//
// `id` is the thread id (kept for a clean RESTful path / future use); the
// search itself is a global Sent-folder query keyed off `?subject=`.
export async function GET(req: NextRequest, _ctx: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();

  if (!connection?.refresh_token) {
    return NextResponse.json({ externalForwardedAt: null });
  }

  // Strip Re:/Fwd:/FW: prefixes from the supplied subject so we search for the
  // bare topic + a forward prefix.
  const baseSubject = (req.nextUrl.searchParams.get('subject') ?? '')
    .replace(/^(re|fwd|fw):\s*/i, '')
    .replace(/^(re|fwd|fw):\s*/i, '') // strip a second prefix if present
    .trim();
  if (baseSubject.length <= 1) return NextResponse.json({ externalForwardedAt: null });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);

    // Escape inner quotes so Gmail parses the search correctly.
    const safe = baseSubject.replace(/"/g, '\\"');
    const query = `in:sent (subject:"Fwd: ${safe}" OR subject:"FW: ${safe}")`;
    const searchRes = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 5 });
    const ids = (searchRes.data.messages ?? []).map(m => m.id).filter((id): id is string => !!id);
    if (ids.length === 0) return NextResponse.json({ externalForwardedAt: null });

    // Fetch the matched messages' headers so we can pick the latest by date.
    const headRes = await Promise.all(
      ids.map(id =>
        gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['Date', 'Subject', 'To'],
        }).catch(() => null),
      ),
    );
    const dated = headRes
      .map(r => (r ? parseGmailMessage(r.data as Parameters<typeof parseGmailMessage>[0]) : null))
      .filter((m): m is NonNullable<typeof m> => !!m && !!m.date);
    if (dated.length === 0) return NextResponse.json({ externalForwardedAt: null });

    const latest = dated.reduce((acc, m) =>
      (new Date(m.date).getTime() || 0) > (new Date(acc.date).getTime() || 0) ? m : acc,
    );
    return NextResponse.json({
      externalForwardedAt: latest.date,
      to: latest.to.map(a => ({ name: a.name ?? '', email: a.email ?? '' })),
    });
  } catch (err) {
    console.error('Email forward-detection error:', err);
    // Non-fatal — the chip just won't show.
    return NextResponse.json({ externalForwardedAt: null });
  }
}
