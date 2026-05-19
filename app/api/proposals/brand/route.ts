import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

/**
 * GET /api/proposals/brand
 *
 * Returns the firm's resolved proposal brand (logo, colours, font, footer)
 * in the same shape the public `/api/p/[token]` endpoint embeds it. Used by
 * the in-app proposal preview modal so the live preview matches the public
 * view exactly without round-tripping through a public token.
 */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const [{ data: firm }, { data: branding }] = await Promise.all([
    supabase.from('firms').select('name, logo_url').eq('id', ctx.firmId).maybeSingle(),
    supabase.from('firm_proposal_settings')
      .select('brand_use_firm_logo, brand_logo_url, brand_header_image_url, brand_primary_color, brand_accent_color, brand_font_family, brand_footer_text, brand_show_firm_name')
      .eq('firm_id', ctx.firmId)
      .maybeSingle(),
  ]);

  const resolvedLogo = branding?.brand_use_firm_logo === false
    ? (branding?.brand_logo_url ?? null)
    : ((firm as { logo_url?: string } | null)?.logo_url ?? branding?.brand_logo_url ?? null);

  return NextResponse.json({
    firm_name: firm?.name ?? null,
    brand: {
      logo_url:         resolvedLogo,
      header_image_url: branding?.brand_header_image_url ?? null,
      primary_color:    branding?.brand_primary_color ?? '#0EA5E9',
      accent_color:     branding?.brand_accent_color ?? '#0284C7',
      font_family:      branding?.brand_font_family ?? 'system',
      footer_text:      branding?.brand_footer_text ?? null,
      show_firm_name:   branding?.brand_show_firm_name ?? true,
    },
  });
}
