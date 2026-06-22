import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getGmailAuthUrl } from '@/lib/gmail';

// GET — start the OAuth flow to connect a firm task-sending mailbox (admin only).
// Reuses the shared Gmail OAuth; the `task-mailbox` state routes the callback to
// store the connection in firm_sending_mailboxes.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can connect a sending mailbox' }, { status: 403 });

  return NextResponse.redirect(getGmailAuthUrl('task-mailbox'));
}
