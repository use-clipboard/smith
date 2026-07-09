import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getBaseUrl } from '@/lib/getBaseUrl';

const Schema = z.object({ clientId: z.string().uuid() });

// POST /api/billing/portal-link — mint (or reuse) a client's statement-portal link.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const supabase = createClient();
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from('billing_portal_tokens').select('token, expires_at').eq('firm_id', ctx.firmId).eq('client_id', parsed.data.clientId)
    .gt('expires_at', nowIso).order('created_at', { ascending: false }).limit(1).maybeSingle();

  let token = existing?.token as string | undefined;
  if (!token) {
    token = crypto.randomBytes(24).toString('hex');
    const { error } = await supabase.from('billing_portal_tokens').insert({ firm_id: ctx.firmId, client_id: parsed.data.clientId, token, created_by: ctx.userId });
    if (error) return NextResponse.json({ error: 'Could not create link' }, { status: 500 });
  }
  return NextResponse.json({ url: `${getBaseUrl()}/statement/${token}` });
}
