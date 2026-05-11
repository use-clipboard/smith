import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

const Body = z.object({
  kind: z.enum(['logo', 'header']),
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  ext: z.string().min(1),
});

// POST /api/proposals/branding/upload — admin only.
// Uploads to the existing `avatars` bucket under `proposal-branding/{firmId}-{kind}.{ext}`,
// returns the public URL. Writing to firm_proposal_settings is done separately by the
// settings PATCH so the user can revert without re-uploading.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const buffer = Buffer.from(body.base64, 'base64');
  // Cache-busting suffix so the public URL changes on each upload
  const stamp = Date.now().toString(36);
  const path = `proposal-branding/${ctx.firmId}-${body.kind}-${stamp}.${body.ext}`;

  const service = createServiceClient();
  const { error: upErr } = await service.storage
    .from('avatars')
    .upload(path, buffer, { contentType: body.mimeType || 'image/png', upsert: true });
  if (upErr) {
    console.error('[proposals/branding/upload]', upErr);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
  const { data: { publicUrl } } = service.storage.from('avatars').getPublicUrl(path);
  return NextResponse.json({ url: publicUrl });
}
