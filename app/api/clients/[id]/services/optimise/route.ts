import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { logAiUsage } from '@/lib/driveUpload';
import { FREQUENCY_LABEL, type ServiceFrequency } from '@/lib/services/serviceTypes';

export const maxDuration = 60;

// POST /api/clients/[id]/services/optimise → AI review of the client's services.
// Advisory only — never changes anything. Returns { opportunities: [{title, detail}] }.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: client } = await supabase
    .from('clients').select('id, name, business_type, vat_number').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data: services } = await supabase
    .from('client_services').select('name, frequency, price_pence, status, next_due, linked_recurring_invoice_id').eq('client_id', params.id);

  // Compact, factual summary for the model — no fabricated data.
  const lines = (services ?? []).map(s => {
    const freq = s.frequency ? (FREQUENCY_LABEL[s.frequency as ServiceFrequency] ?? s.frequency) : 'no frequency';
    const fee = s.price_pence != null ? `£${(s.price_pence / 100).toFixed(2)}` : 'no fee set';
    const billed = s.linked_recurring_invoice_id ? 'billed' : 'not linked to billing';
    return `- ${s.name} (${s.status}, ${freq}, ${fee}, ${billed})`;
  }).join('\n');

  const prompt = `You are a UK accountancy practice adviser. Review the services this firm provides to a client and suggest concrete, useful opportunities to improve the engagement — e.g. common services likely MISSING for this client type, services with no fee recorded, active services with no next due date (delivery risk), or sensible cross-sell/advisory ideas. Be specific and practical; do not invent facts about the client.

Client: ${client.name}
Business type: ${client.business_type ?? 'unknown'}
VAT registered: ${client.vat_number ? 'yes' : 'unknown/no'}

Current services (${(services ?? []).length}):
${lines || '(none yet)'}

Return ONLY valid JSON, no prose, in this exact shape:
{"opportunities":[{"title":"short title","detail":"one or two sentences"}]}
Return at most 4 opportunities, most valuable first. If everything looks well covered, return an empty array.`;

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are a concise UK accountancy practice adviser. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.find(c => c.type === 'text');
    let json = (text && text.type === 'text' ? text.text : '{"opportunities":[]}').trim();
    if (json.startsWith('```json')) json = json.slice(7).trim();
    if (json.startsWith('```')) json = json.slice(3).trim();
    if (json.endsWith('```')) json = json.slice(0, -3).trim();

    let opportunities: { title: string; detail: string }[] = [];
    try {
      const parsed = JSON.parse(json) as { opportunities?: { title?: string; detail?: string }[] };
      opportunities = (parsed.opportunities ?? [])
        .filter(o => o && o.title)
        .map(o => ({ title: String(o.title), detail: String(o.detail ?? '') }))
        .slice(0, 4);
    } catch { /* fall through with empty */ }

    void logAiUsage({ ...ctx, clientId: params.id, feature: 'services_optimise', inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens });
    return NextResponse.json({ opportunities });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[services/optimise]', err);
    return NextResponse.json({ error: 'Could not review services right now.' }, { status: 500 });
  }
}
