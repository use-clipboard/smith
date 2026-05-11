import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getGmailAuthUrl } from '@/lib/gmail';

// GET /api/proposals/gmail/connect — kicks off Gmail OAuth for the current
// user, scoped to the proposals tool. Reuses the same OAuth flow + email_connections
// table as Email Triage, but the callback redirects back to the Proposals settings
// tab instead of the Email Triage one.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('proposals')) {
    return NextResponse.json({ error: 'Proposals module not active' }, { status: 403 });
  }
  const url = getGmailAuthUrl('proposals');
  return NextResponse.redirect(url);
}
