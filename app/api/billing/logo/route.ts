import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

const BUCKET = 'billing-branding';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// GET /api/billing/logo → the firm's invoice logo as a data URL (or null).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const service = createServiceClient();
  const { data: s } = await service.from('billing_settings').select('logo_path').eq('firm_id', ctx.firmId).maybeSingle();
  const path = s?.logo_path as string | null;
  if (!path) return NextResponse.json({ dataUrl: null });

  const { data: file } = await service.storage.from(BUCKET).download(path);
  if (!file) return NextResponse.json({ dataUrl: null });
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = file.type || 'image/png';
  return NextResponse.json({ dataUrl: `data:${mime};base64,${buf.toString('base64')}` });
}

// POST /api/billing/logo — upload a logo (admin only). FormData { file }.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can change the logo' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  const ext = EXT[file.type];
  if (!ext) return NextResponse.json({ error: 'Use a PNG, JPEG or WebP image.' }, { status: 400 });
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'Logo must be under 2 MB.' }, { status: 400 });

  const service = createServiceClient();
  // Clear any previous logo files for this firm.
  const { data: existing } = await service.storage.from(BUCKET).list(ctx.firmId);
  if (existing?.length) await service.storage.from(BUCKET).remove(existing.map(f => `${ctx.firmId}/${f.name}`));

  const path = `${ctx.firmId}/logo.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: 'Upload failed' }, { status: 500 });

  await service.from('billing_settings').upsert({ firm_id: ctx.firmId, logo_path: path, updated_at: new Date().toISOString() }, { onConflict: 'firm_id' });
  return NextResponse.json({ dataUrl: `data:${file.type};base64,${bytes.toString('base64')}` });
}

// DELETE /api/billing/logo — remove the logo (admin only).
export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Only admins can change the logo' }, { status: 403 });

  const service = createServiceClient();
  const { data: s } = await service.from('billing_settings').select('logo_path').eq('firm_id', ctx.firmId).maybeSingle();
  const path = s?.logo_path as string | null;
  if (path) await service.storage.from(BUCKET).remove([path]);
  await service.from('billing_settings').update({ logo_path: null, updated_at: new Date().toISOString() }).eq('firm_id', ctx.firmId);
  return NextResponse.json({ ok: true });
}
