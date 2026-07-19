import { NextResponse } from 'next/server';
import { getCampaignsContext } from '@/lib/campaigns/guard';
import { getGmailAuthUrl } from '@/lib/gmail';

// GET /api/campaigns/connect — start the Gmail OAuth flow for Campaigns.
// Campaigns sends exclusively over a connected Gmail, so linking one is
// required to use the module. The default OAuth state stores the tokens in
// `email_connections` (the same place Campaigns + Email Triage read), so the
// callback needs no special handling.
export async function GET() {
  const ctx = await getCampaignsContext();
  if (!ctx) return NextResponse.json({ error: 'No access' }, { status: 403 });
  return NextResponse.redirect(getGmailAuthUrl());
}
