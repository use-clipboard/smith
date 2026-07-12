import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { createClient } from '@/lib/supabase-server';
import { getAnthropicForFirm } from '@/lib/getAnthropicForFirm';
import {
  parseWorkbook, detectPreset, buildMapping, mappingFromNames, mappingIsUsable,
  normalizeRows, matchClient, presetLabel, type ColumnMapping, type ImportField, type ClientLite,
} from '@/lib/billing/import';

const Schema = z.object({
  filename: z.string().max(260),
  base64: z.string().min(1),
  mimeType: z.string().max(120).optional(),
});

const FIELDS: ImportField[] = ['number', 'clientName', 'issueDate', 'dueDate', 'total', 'amountPaid', 'balance', 'status', 'description'];

async function loadClients(supabase: ReturnType<typeof createClient>, firmId: string): Promise<ClientLite[]> {
  const all: ClientLite[] = [];
  for (let page = 0; page < 6; page++) {
    const { data } = await supabase.from('clients').select('id, name').eq('firm_id', firmId).range(page * 1000, page * 1000 + 999);
    const batch = (data ?? []) as ClientLite[];
    all.push(...batch);
    if (batch.length < 1000) break;
  }
  return all;
}

// Ask Claude to map columns when presets + generic guessing fall short.
async function aiMapping(firmId: string, headers: string[], sample: string[][]): Promise<ColumnMapping | null> {
  try {
    const anthropic = await getAnthropicForFirm(firmId);
    const prompt = `You are mapping columns of an accounting-system invoice export to a standard schema.
Headers: ${JSON.stringify(headers)}
Sample rows: ${JSON.stringify(sample.slice(0, 3))}
Return ONLY JSON mapping each field to the EXACT matching header string (or null if absent):
{"number":?,"clientName":?,"issueDate":?,"dueDate":?,"total":?,"amountPaid":?,"balance":?,"status":?,"description":?}
"total" = full invoice amount; "balance" = amount still owed; "clientName" = the customer/contact.`;
    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1024,
      system: 'Respond with valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    });
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Partial<Record<ImportField, string>>;
    return mappingFromNames(headers, json);
  } catch {
    return null;
  }
}

// POST /api/billing/import/analyze — parse an export + propose invoice rows.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('billing')) return moduleNotActive('billing');

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  let sheet;
  try { sheet = parseWorkbook(parsed.data.base64); }
  catch { return NextResponse.json({ error: 'Could not read that file. Export as CSV or Excel and try again.' }, { status: 400 }); }
  if (!sheet.headers.length || !sheet.rows.length) return NextResponse.json({ error: 'No data rows found in that file.' }, { status: 400 });

  const preset = detectPreset(sheet.headers);
  let mapping = buildMapping(sheet.headers, preset);
  let source = preset?.id ?? 'generic';

  if (!mappingIsUsable(mapping)) {
    const ai = await aiMapping(ctx.firmId, sheet.headers, sheet.rows);
    if (ai && mappingIsUsable(ai)) { mapping = ai; source = 'ai'; }
  }
  if (!mappingIsUsable(mapping)) {
    return NextResponse.json({ error: 'Could not identify the client and amount columns. Check the file has an invoice list with a customer and total column.' }, { status: 422 });
  }

  const rows = normalizeRows(sheet.headers, sheet.rows, mapping);
  const clients = await loadClients(createClient(), ctx.firmId);
  const analyzed = rows.map((r, index) => ({ index, ...r, match: matchClient(r.clientName, clients) }));

  const usable = analyzed.filter(r => r.status !== 'skip');
  const outstanding = usable.filter(r => r.status !== 'paid');
  const outstandingPence = outstanding.reduce((s, r) => s + (r.totalPence - r.amountPaidPence), 0);
  const mappingByName: Partial<Record<ImportField, string>> = {};
  for (const f of FIELDS) if (mapping[f] != null) mappingByName[f] = sheet.headers[mapping[f]!];

  return NextResponse.json({
    source, sourceLabel: source === 'ai' ? 'AI-mapped' : source === 'generic' ? 'Generic export' : presetLabel(source),
    headers: sheet.headers,
    mapping: mappingByName,
    rows: analyzed,
    summary: {
      total: analyzed.length,
      importable: usable.length,
      skipped: analyzed.length - usable.length,
      outstandingCount: outstanding.length,
      outstandingPence,
      paidCount: usable.filter(r => r.status === 'paid').length,
      matched: usable.filter(r => r.match.clientId).length,
      unmatched: usable.filter(r => !r.match.clientId).length,
    },
  });
}
