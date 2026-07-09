import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';

export const dynamic = 'force-dynamic';

const BUCKET = 'accounts-studio-branding';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };

// GET → the current logo as a data URL (or { logo: null }).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });

  const service = createServiceClient();
  const { data: row } = await service.from('accounts_studio_firm_settings').select('brand_logo_path').eq('firm_id', ctx.firmId).maybeSingle();
  const path = (row as { brand_logo_path?: string | null } | null)?.brand_logo_path;
  if (!path) return NextResponse.json({ logo: null });
  try {
    const { data: blob } = await service.storage.from(BUCKET).download(path);
    if (!blob) return NextResponse.json({ logo: null });
    const buf = Buffer.from(await blob.arrayBuffer());
    return NextResponse.json({ logo: `data:${blob.type || 'image/png'};base64,${buf.toString('base64')}` });
  } catch { return NextResponse.json({ logo: null }); }
}

// POST (admin) → upload a new logo (FormData `file`, ≤2 MB, png/jpeg/webp).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can change the logo.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Logo must be a PNG, JPEG or WebP.' }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'Logo must be 2 MB or smaller.' }, { status: 400 });

  const service = createServiceClient();
  // Remove any stale logos for this firm (different extensions).
  try {
    const { data: existing } = await service.storage.from(BUCKET).list(ctx.firmId);
    const stale = (existing ?? []).map(f => `${ctx.firmId}/${f.name}`);
    if (stale.length) await service.storage.from(BUCKET).remove(stale);
  } catch { /* ignore */ }

  const path = `${ctx.firmId}/logo.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  await service.from('accounts_studio_firm_settings').upsert({ firm_id: ctx.firmId, brand_logo_path: path, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });

  const dataUrl = `data:${file.type};base64,${bytes.toString('base64')}`;
  return NextResponse.json({ ok: true, logo: dataUrl });
}

// DELETE (admin) → remove the logo.
export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Not available' }, { status: 403 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only firm admins can change the logo.' }, { status: 403 });

  const service = createServiceClient();
  const { data: row } = await service.from('accounts_studio_firm_settings').select('brand_logo_path').eq('firm_id', ctx.firmId).maybeSingle();
  const path = (row as { brand_logo_path?: string | null } | null)?.brand_logo_path;
  if (path) { try { await service.storage.from(BUCKET).remove([path]); } catch { /* ignore */ } }
  await service.from('accounts_studio_firm_settings').upsert({ firm_id: ctx.firmId, brand_logo_path: null, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });
  return NextResponse.json({ ok: true });
}
