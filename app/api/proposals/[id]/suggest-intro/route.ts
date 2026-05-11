import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// POST /api/proposals/[id]/suggest-intro — uses the firm's Anthropic key to
// draft a short (2–3 sentence) intro paragraph for the proposal based on the
// prospect's details and the services in the proposal.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data: proposal } = await supabase
    .from('proposals')
    .select(`
      id, title, prospect:proposal_prospects(contact_name, company_name, client_type, source, notes),
      line_items:proposal_line_items(service_name, frequency)
    `)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: firm } = await supabase.from('firms').select('name').eq('id', ctx.firmId).maybeSingle();
  const services = ((proposal.line_items as Array<{ service_name: string; frequency: string }>) ?? [])
    .map(li => li.service_name)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  const p = proposal.prospect as { contact_name: string; company_name: string | null; client_type: string | null; source: string | null; notes: string | null };

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const prompt = `You are an accountancy firm's senior partner writing a short, warm intro paragraph for a proposal.

Firm: ${firm?.name ?? 'our firm'}
Prospect contact: ${p.contact_name}${p.company_name ? ` (${p.company_name})` : ''}
Client type: ${p.client_type ?? 'unknown'}
${p.source ? `How we met: ${p.source}` : ''}
${p.notes ? `Notes from earlier chats: ${p.notes}` : ''}
Services we are proposing: ${services.length > 0 ? services.join(', ') : '(none listed yet)'}
Proposal title: ${proposal.title}

Write a single paragraph (2–3 sentences, max 60 words). Warm but professional UK English. Thank them for the conversation, summarise what's in the proposal, and invite them to review and ask any questions. Do not invent specific dates or amounts. Do not use exclamation marks. Do not use headings or bullets. Plain prose only. Output the paragraph and nothing else.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('').trim();
    return NextResponse.json({ intro: text });
  } catch (e) {
    if (e instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 402 });
    console.error('[suggest-intro]', e);
    return NextResponse.json({ error: 'Failed to generate intro' }, { status: 500 });
  }
}
