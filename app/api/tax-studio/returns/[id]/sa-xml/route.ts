import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import type { TaxReturn } from '@/components/features/tax-studio/types';
import { buildSa100Return } from '@/lib/hmrc-sa/sa100Return';
import { markIrEnvelope } from '@/lib/hmrc-sa/irmark';

export const dynamic = 'force-dynamic';

// GET /api/tax-studio/returns/[id]/sa-xml
// Preview the SA100 return XML (the IRmarked <IRenvelope>) that would be filed —
// generation only, nothing is sent to HMRC. We deliberately do NOT return the
// GovTalk envelope, which carries the Gateway password in SenderDetails.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  const service = createServiceClient();
  const { data: row } = await service
    .from('tax_studio_returns').select('id, data').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!row) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });

  const ret = (row.data ?? {}) as unknown as TaxReturn;
  try {
    const built = buildSa100Return(ret);
    const { base64, body } = markIrEnvelope(built.irEnvelope);
    // Show just the <IRenvelope> (drop the calc-only <Body> wrapper).
    const irEnvelope = body.replace(/^<Body>/, '').replace(/<\/Body>$/, '');
    return NextResponse.json({
      xml: formatXml(irEnvelope),
      irmark: base64,
      utr: built.utr,
      periodEnd: built.periodEnd,
      note: 'Preview only — provisional element names pending the 2025/26 XSD; nothing has been sent to HMRC.',
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not build the return XML.' }, { status: 500 });
  }
}

/** Lightweight XML pretty-printer for readability (indent by element depth). */
function formatXml(xml: string): string {
  const lines = xml.replace(/>\s*</g, '><').replace(/></g, '>\n<').split('\n');
  let depth = 0;
  return lines.map((line) => {
    const isClose = /^<\//.test(line);
    const isSelfContained = /^<[^>]+>[^<]*<\/[^>]+>$/.test(line) || /\/>$/.test(line) || /^<\?/.test(line);
    if (isClose) depth = Math.max(0, depth - 1);
    const out = '  '.repeat(depth) + line;
    if (!isClose && !isSelfContained && /^<[^/!?]/.test(line)) depth++;
    return out;
  }).join('\n');
}
