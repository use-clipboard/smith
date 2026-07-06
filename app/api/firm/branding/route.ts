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
      .select('name, logo_url')
      .eq('id', userCtx.firmId)
      .single();

    const firm = data as { name?: string | null; logo_url?: string | null } | null;
    return NextResponse.json({ logoUrl: firm?.logo_url ?? null, firmName: firm?.name ?? null });
  } catch {
    return NextResponse.json({ logoUrl: null, firmName: null });
  }
}
