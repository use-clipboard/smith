import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { DEFAULT_EMAIL_FONT, isEmailFontId } from '@/lib/emailFonts';

export const dynamic = 'force-dynamic';

const Body = z.object({
  defaultFont: z.string().refine(isEmailFontId, 'Unknown font'),
}).strict();

/**
 * Read the firm's outgoing-email defaults. Any signed-in user can read: every
 * compose window needs the default font. Falls back to the default rather than
 * erroring when the row (or the whole table) isn't there yet — an unset firm is
 * the normal starting state, and compose must not break on it.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('firm_email_settings')
    .select('default_font')
    .eq('firm_id', ctx.firmId)
    .maybeSingle();

  // 42P01 = table absent, i.e. the migration hasn't been applied on this
  // environment yet. Degrade to the default instead of failing the compose
  // window's identity fetch.
  if (error && error.code !== '42P01') {
    console.error('[email/firm-settings] read', error.message);
  }

  const defaultFont = isEmailFontId(data?.default_font) ? data!.default_font : DEFAULT_EMAIL_FONT;
  return NextResponse.json({ settings: { defaultFont } });
}

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can change the firm email font.' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();
  const { error } = await supabase.from('firm_email_settings').upsert({
    firm_id:      ctx.firmId,
    default_font: body.defaultFont,
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'firm_id' });

  if (error) {
    console.error('[email/firm-settings] write', error.message);
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'Email settings aren’t set up on this environment yet.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Couldn’t save the firm email font. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
