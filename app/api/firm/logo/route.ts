import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createServiceClient } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { base64, mimeType, ext } = (await req.json()) as {
      base64: string;
      mimeType: string;
      ext: string;
    };
    if (!base64 || !ext) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });

    const buffer = Buffer.from(base64, 'base64');
    const path = `logos/${userCtx.firmId}.${ext}`;

    const supabase = createServiceClient();
    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, buffer, { contentType: mimeType || 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    await supabase.from('firms').update({ logo_url: publicUrl }).eq('id', userCtx.firmId);

    return NextResponse.json({ logoUrl: publicUrl });
  } catch (err) {
    console.error('Firm logo upload error:', err);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
