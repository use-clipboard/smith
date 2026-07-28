import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { isChGatewayConfigured, CH_XMLGW_ENV } from '@/lib/companiesHouse/config';

export const dynamic = 'force-dynamic';

// GET /api/accounts-studio/ch-config
// Exposes ONLY whether Companies House filing is configured and which
// environment it's in (test vs live) — never the credentials themselves — so the
// Publish screen can show a truthful Live/Test badge and hide the filing action
// when the gateway isn't set up.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ configured: false, isTest: true });
  return NextResponse.json({
    configured: isChGatewayConfigured(),
    isTest: CH_XMLGW_ENV !== 'live',
  });
}
