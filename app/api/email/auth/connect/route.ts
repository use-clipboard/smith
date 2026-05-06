import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { getGmailAuthUrl } from '@/lib/gmail';

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Email Triage module not active' }, { status: 403 });
  }

  const url = getGmailAuthUrl();
  return NextResponse.redirect(url);
}
