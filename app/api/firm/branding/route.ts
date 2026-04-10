import { NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ logoUrl: null });

    const supabase = createClient();
    const { data } = await supabase
      .from('firms')
      .select('logo_url')
      .eq('id', userCtx.firmId)
      .single();

    const logoUrl = (data as { logo_url?: string | null } | null)?.logo_url ?? null;
    return NextResponse.json({ logoUrl });
  } catch {
    return NextResponse.json({ logoUrl: null });
  }
}
