import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Per-user email triage settings, stored as JSONB on users.email_triage_settings
// so the preference follows the user across browsers/machines.
//   GET  → { settings } — stored settings merged over defaults.
//   POST → upsert the caller's own settings object.
// Gracefully falls back to defaults if the migration hasn't run yet.

const DEFAULTS = {
  markReadOnAutoTriage: false,
  autoFileEnabled: false,
  autoFileDays: 90,
  // 'triage' = the full triage experience (categories, Auto Triage, untriaged
  // counter). 'traditional' = a plain Gmail-style inbox (no triage surfaces,
  // unread counter). Per-user; defaults to triage so nothing changes on rollout.
  mode: 'triage' as 'triage' | 'traditional',
};

// All optional so a caller can PATCH-style update just one field (e.g. mode)
// without having to resend the rest; the POST merges over the stored settings.
const Schema = z.object({
  markReadOnAutoTriage: z.boolean(),
  autoFileEnabled: z.boolean(),
  autoFileDays: z.number().int().min(1).max(3650),
  mode: z.enum(['triage', 'traditional']),
}).partial();

export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  let settings = DEFAULTS;
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from('users')
      .select('email_triage_settings')
      .eq('id', ctx.userId)
      .single();
    const stored = data?.email_triage_settings as Partial<typeof DEFAULTS> | null;
    if (stored) settings = { ...DEFAULTS, ...stored };
  } catch { /* column missing pre-migration — serve defaults */ }

  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) {
    return NextResponse.json({ error: 'Module not active' }, { status: 403 });
  }

  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const svc = createServiceClient();
  // Merge over the caller's existing settings so a partial update keeps the rest.
  const { data: cur } = await svc.from('users').select('email_triage_settings').eq('id', ctx.userId).single();
  const merged = { ...DEFAULTS, ...(cur?.email_triage_settings as Partial<typeof DEFAULTS> | null ?? {}), ...parsed.data };
  const { error } = await svc
    .from('users')
    .update({ email_triage_settings: merged })
    .eq('id', ctx.userId);
  if (error) {
    console.error('triage-settings update', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
