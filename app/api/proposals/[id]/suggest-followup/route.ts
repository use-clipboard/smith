import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// POST /api/proposals/[id]/suggest-followup — when a prospect declined a
// proposal with a reason, Claude drafts a polite follow-up email addressing
// the objection. The user can copy / edit it and send manually.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data: proposal } = await supabase
    .from('proposals')
    .select(`
      title, status, decline_reason, total_monthly, total_one_off, total_annual,
      prospect:proposal_prospects(contact_name, company_name, client_type),
      line_items:proposal_line_items(service_name, frequency, unit_price)
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status !== 'declined') {
    return NextResponse.json({ error: 'This action is only available on declined proposals.' }, { status: 400 });
  }

  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const p = proposal.prospect as { contact_name: string; company_name: string | null; client_type: string | null };
  const services = ((proposal.line_items as Array<{ service_name: string }>) ?? []).map(li => li.service_name).filter((v, i, arr) => arr.indexOf(v) === i);

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const prompt = `You are a senior partner at a UK accountancy firm. A prospect declined our proposal. Draft a short, gracious follow-up email that acknowledges their decision, gently addresses the objection, and leaves the door open for the future. Do NOT push hard or sound salesy.

Firm: ${firm?.name ?? 'our firm'}
Prospect: ${p.contact_name}${p.company_name ? ` at ${p.company_name}` : ''}
Client type: ${p.client_type ?? 'unknown'}
Proposal: ${proposal.title}
Services offered: ${services.join(', ') || '(unknown)'}
Pricing offered: £${Number(proposal.total_monthly ?? 0).toFixed(0)}/month, £${Number(proposal.total_one_off ?? 0).toFixed(0)} one-off, £${Number(proposal.total_annual ?? 0).toFixed(0)}/year
Their decline reason: ${proposal.decline_reason ?? '(none provided)'}

Output JSON with two keys, nothing else:
{
  "subject": "Email subject line (under 60 chars)",
  "body": "Email body, plain text, 4–7 short paragraphs, signed off with [Your name]. UK English. No exclamation marks. No bullet points."
}`;
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: 'You respond with valid JSON only. No markdown fences, no preamble.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('').trim();
    let cleaned = text;
    if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return NextResponse.json({ subject: parsed.subject, body: parsed.body });
  } catch (e) {
    if (e instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 402 });
    console.error('[suggest-followup]', e);
    return NextResponse.json({ error: 'Failed to generate follow-up' }, { status: 500 });
  }
}
