import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { ensureMtdItFirmSettings } from '@/lib/mtdIt/firmSettings';

// Firm logo upload / fetch / delete. Backs the "Branding" section of the
// MTD IT settings tab and is also fetched at PDF-render time so the PDF
// can embed the logo as a data URL.
//
// Storage layout: bucket "mtd-it-branding", path "{firm_id}/logo.{ext}".

const BUCKET = 'mtd-it-branding';
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

function extFromMime(mime: string): string {
  if (mime === 'image/png')  return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

/** Returns the firm's current logo as a data URL (or null if none).
 *  Used by the PDF builders — they can't read storage directly from
 *  the browser, so we proxy via this endpoint. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const settings = await ensureMtdItFirmSettings(ctx.firmId);
  if (!settings.brand_logo_path) {
    return NextResponse.json({ logo: null });
  }

  const service = createServiceClient();
  const { data, error } = await service.storage.from(BUCKET).download(settings.brand_logo_path);
  if (error || !data) {
    console.warn('GET /api/mtd-it/firm-settings/logo download', error);
    return NextResponse.json({ logo: null });
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const mime = data.type || 'image/png';
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  return NextResponse.json({ logo: dataUrl, mime });
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can change branding' }, { status: 403 });
  }

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid form' }, { status: 400 }); }
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Logo must be 2MB or smaller' }, { status: 413 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'PNG, JPEG or WebP only' }, { status: 415 });

  const ext = extFromMime(file.type);
  const path = `${ctx.firmId}/logo.${ext}`;
  const service = createServiceClient();

  await ensureMtdItFirmSettings(ctx.firmId);

  // Clean up any prior logo (different extension) so we don't leave orphans.
  try {
    const { data: listed } = await service.storage.from(BUCKET).list(ctx.firmId, { limit: 10 });
    if (listed) {
      const stale = listed
        .filter(f => f.name !== `logo.${ext}`)
        .map(f => `${ctx.firmId}/${f.name}`);
      if (stale.length > 0) await service.storage.from(BUCKET).remove(stale);
    }
  } catch { /* non-fatal */ }

  const bytes = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (upErr) {
    console.error('POST /api/mtd-it/firm-settings/logo upload', upErr);
    return NextResponse.json({ error: 'Failed to upload logo' }, { status: 500 });
  }

  const { error: updErr } = await service
    .from('mtd_it_firm_settings')
    .update({ brand_logo_path: path, updated_at: new Date().toISOString() })
    .eq('firm_id', ctx.firmId);
  if (updErr) {
    console.error('POST /api/mtd-it/firm-settings/logo persist', updErr);
    return NextResponse.json({ error: 'Failed to save logo path' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, path });
}

export async function DELETE() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Only firm admins can change branding' }, { status: 403 });
  }
  const service = createServiceClient();
  const settings = await ensureMtdItFirmSettings(ctx.firmId);
  if (settings.brand_logo_path) {
    await service.storage.from(BUCKET).remove([settings.brand_logo_path]).catch(() => {});
  }
  await service
    .from('mtd_it_firm_settings')
    .update({ brand_logo_path: null, updated_at: new Date().toISOString() })
    .eq('firm_id', ctx.firmId);
  return NextResponse.json({ ok: true });
}
