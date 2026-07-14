import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildMtdItPrompt } from '@/prompts/mtd-it';
import { getQuarterDates, taxYearLabel } from '@/lib/mtdIt/quarters';
import {
  SOLE_TRADER_INCOME, SOLE_TRADER_EXPENSES, UK_RENTAL_INCOME, UK_RENTAL_EXPENSES,
} from '@/lib/mtdIt/categories';
import { isMtdItMockMode, buildMockEntries } from '@/lib/mtdIt/mockMode';
import type { MtdItStream } from '@/types';

// POST /api/mtd-it/analyse
//   Analyse a single uploaded document against one stream's prompt. Returns
//   the parsed entries and writes them to mtd_it_entries. Also creates/updates
//   the mtd_it_documents row so the dashboard knows which files have been
//   scanned. The client invokes this per-file so the progress UI can update
//   live and individual failures can be retried without rescanning every
//   document.
//
//   Auto-retries the Anthropic call ONCE on failure (per the user's choice in
//   the Stage B kick-off): transient blips shouldn't surface as user-facing
//   failures, but a second hard failure does so the user can decide.

// A file arrives as base64 (PDF/image) and/or extracted text (CSV/Excel,
// converted client-side). Spreadsheets send both: base64 preserves the source
// document for the review viewer, text is what Claude actually reads.
const FileSchema = z.object({
  name:     z.string().min(1),
  mimeType: z.string().min(1),
  base64:   z.string().optional(),
  text:     z.string().optional(),
}).refine(f => (f.base64 && f.base64.length > 0) || (f.text && f.text.length > 0), {
  message: 'File must include base64 or text',
});

const BodySchema = z.object({
  quarter_id: z.string().uuid(),
  stream:     z.enum(['sole', 'uk_rental', 'foreign_rental']),
  file:       FileSchema,
});

interface RawEntry {
  page_number?:    number | null;
  entry_date?:     string | null;
  description?:    string | null;
  supplier?:       string | null;
  invoice_number?: string | null;
  category?:       string | null;
  entry_type?:     'income' | 'expense' | null;
  gross_amount?:   number | null;
  net_amount?:     number | null;
  vat_amount?:     number | null;
  currency?:       string | null;
  trade_id?:       string | null;
  property_id?:    string | null;
  flagged_reason?: string | null;
}

function coerceCategory(stream: MtdItStream, type: 'income' | 'expense', raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  const incomeList: readonly string[] = stream === 'sole' ? SOLE_TRADER_INCOME : UK_RENTAL_INCOME;
  const expenseList: readonly string[] = stream === 'sole' ? SOLE_TRADER_EXPENSES : UK_RENTAL_EXPENSES;
  const list = type === 'income' ? incomeList : expenseList;
  const match = list.find(c => c.toLowerCase() === value.toLowerCase());
  if (match) return match;
  // Fall back to the closest "Other" bucket
  if (type === 'income')  return stream === 'sole' ? 'Other Income'  : 'Other Income';
  return stream === 'sole' ? 'Other Expense' : 'Other Expenses';
}

function parseJsonResponse(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  if (s.startsWith('```'))     s = s.slice(3).trim();
  if (s.endsWith('```'))       s = s.slice(0, -3).trim();
  return JSON.parse(s);
}

async function callAnthropic(opts: {
  firmId: string;
  stream: MtdItStream;
  file: z.infer<typeof FileSchema>;
  prompt: string;
}): Promise<RawEntry[]> {
  const anthropic = await getAnthropicForFirm(opts.firmId);

  const fileBlock = opts.file.text != null
    ? { type: 'text' as const, text: `Spreadsheet / CSV file "${opts.file.name}":\n\n${opts.file.text}` }
    : opts.file.mimeType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: opts.file.base64 ?? '' } }
      : { type: 'image'    as const, source: { type: 'base64' as const, media_type: opts.file.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: opts.file.base64 ?? '' } };

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: 'You are an expert UK accountant. Always respond with valid JSON only — no prose, no fences.',
    messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: opts.prompt }] }],
  });

  const textPart = response.content.find(c => c.type === 'text');
  if (!textPart || textPart.type !== 'text') throw new Error('No text response from AI');

  const parsed = parseJsonResponse(textPart.text);
  const entries = (parsed as { entries?: RawEntry[] })?.entries;
  if (!Array.isArray(entries)) throw new Error('Response missing entries array');
  return entries;
}

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { isModuleActive } = buildModuleChecker(ctx.activeModules);
  if (!isModuleActive('mtd-it')) return moduleNotActive('mtd-it');

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  const { quarter_id, stream, file } = parsed.data;

  const supabase = createClient();

  // Load the quarter + its client (firm scope check + tax_year for prompt context)
  const { data: q } = await supabase
    .from('mtd_it_quarters')
    .select('id, client_id, tax_year, quarter, clients!inner(firm_id, mtd_it_quarter_type)')
    .eq('id', quarter_id)
    .maybeSingle();
  const client = (q as unknown as { clients?: { firm_id?: string; mtd_it_quarter_type?: 'calendar' | 'standard' } } | null)?.clients;
  if (!q || client?.firm_id !== ctx.firmId) {
    return NextResponse.json({ error: 'Quarter not found' }, { status: 404 });
  }
  const taxYear = (q as { tax_year: number }).tax_year;
  const quarter = (q as { quarter: 1 | 2 | 3 | 4 }).quarter;
  const range = getQuarterDates(taxYear, quarter, client.mtd_it_quarter_type ?? 'calendar');

  // Fetch property + trade lists so the prompt can offer them as IDs
  const clientId = (q as { client_id: string }).client_id;
  const [{ data: props }, { data: trades }] = await Promise.all([
    supabase.from('mtd_it_properties').select('id, address, currency, property_type, active').eq('client_id', clientId),
    supabase.from('mtd_it_trades').select('id, name, active').eq('client_id', clientId),
  ]);
  const propsForStream = (props ?? [])
    .filter(p => p.active !== false && (stream === 'uk_rental' ? p.property_type === 'uk' : stream === 'foreign_rental' ? p.property_type === 'foreign' : false))
    .map(p => ({ id: p.id, address: p.address, currency: p.currency }));
  const tradesForStream = stream === 'sole'
    ? (trades ?? []).filter(t => t.active !== false).map(t => ({ id: t.id, name: t.name }))
    : [];

  // Create the mtd_it_documents row for this file
  const { data: doc, error: docErr } = await supabase
    .from('mtd_it_documents')
    .insert({ quarter_id, stream, file_name: file.name, status: 'scanning' })
    .select('id')
    .single();
  if (docErr) {
    console.error('POST /api/mtd-it/analyse insert doc', docErr);
    return NextResponse.json({ error: 'Failed to record document' }, { status: 500 });
  }

  // ── Upload the raw file to private storage so the review editor can show
  //    the user the source document later. Failure here is non-fatal — we
  //    still want the analyse to run; the doc row's file_url just stays null
  //    and the "View source" button hides. ───────────────────────────────
  try {
    const service = createServiceClient();
    // Sanitise the filename so the storage path doesn't contain anything
    // that breaks the URL or collides across uploads.
    const safeName = file.name.replace(/[^\w\-.]+/g, '_').slice(0, 120);
    const path = `${quarter_id}/${doc.id}_${safeName}`;
    const buffer = file.base64 ? Buffer.from(file.base64, 'base64') : Buffer.from(file.text ?? '', 'utf-8');
    const { error: upErr } = await service.storage
      .from('mtd-it-source-docs')
      .upload(path, buffer, { contentType: file.mimeType, upsert: true });
    if (upErr) {
      console.warn('[mtd-it/analyse] storage upload failed (non-fatal):', upErr.message);
    } else {
      await supabase.from('mtd_it_documents').update({ file_url: path }).eq('id', doc.id);
    }
  } catch (storageErr) {
    console.warn('[mtd-it/analyse] storage upload threw (non-fatal):', storageErr);
  }

  const promptCtx = {
    taxYearLabel: taxYearLabel(taxYear),
    quarterLabel: `Q${quarter} (${range.from} – ${range.to})`,
    fromIso: range.from,
    toIso:   range.to,
    properties: propsForStream,
    trades:     tradesForStream,
  };
  const prompt = buildMtdItPrompt(stream as MtdItStream, promptCtx);

  // ── Actually analyse (or mock) ─────────────────────────────────────────
  let rawEntries: RawEntry[];
  try {
    if (isMtdItMockMode()) {
      rawEntries = buildMockEntries(stream as MtdItStream, file.name, range.from, range.to);
    } else {
      try {
        rawEntries = await callAnthropic({ firmId: ctx.firmId, stream: stream as MtdItStream, file, prompt });
      } catch (firstErr) {
        console.warn('[mtd-it/analyse] first attempt failed, retrying once', firstErr);
        rawEntries = await callAnthropic({ firmId: ctx.firmId, stream: stream as MtdItStream, file, prompt });
      }
    }
  } catch (err) {
    const message = err instanceof ApiKeyNotConfiguredError
      ? err.message
      : err instanceof Error ? err.message : 'AI analysis failed';
    await supabase.from('mtd_it_documents').update({ status: 'failed', error_message: message }).eq('id', doc.id);
    return NextResponse.json({ error: message, document_id: doc.id }, { status: 502 });
  }

  // Normalise + sanitise entries before writing
  const validPropertyIds = new Set(propsForStream.map(p => p.id));
  const validTradeIds    = new Set(tradesForStream.map(t => t.id));
  const rows = rawEntries.map(e => {
    const type: 'income' | 'expense' = e.entry_type === 'income' ? 'income' : 'expense';
    const category = coerceCategory(stream as MtdItStream, type, e.category);
    const grossAmount = typeof e.gross_amount === 'number' ? e.gross_amount : 0;
    const currency = (e.currency ?? (stream === 'foreign_rental' ? 'EUR' : 'GBP')).toUpperCase().slice(0, 3);
    return {
      quarter_id,
      stream,
      trade_id:        stream === 'sole'           && e.trade_id    && validTradeIds.has(e.trade_id)       ? e.trade_id    : null,
      property_id:     stream !== 'sole'           && e.property_id && validPropertyIds.has(e.property_id) ? e.property_id : null,
      source_file_name: file.name,
      page_number:    typeof e.page_number === 'number' ? e.page_number : null,
      entry_date:     typeof e.entry_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.entry_date) ? e.entry_date : null,
      description:    e.description ?? null,
      supplier:       e.supplier    ?? null,
      invoice_number: e.invoice_number ?? null,
      category,
      entry_type:     type,
      gross_amount:   grossAmount,
      net_amount:     typeof e.net_amount === 'number' ? e.net_amount : null,
      vat_amount:     typeof e.vat_amount === 'number' ? e.vat_amount : null,
      currency,
      manual:         false,
      flagged_reason: e.flagged_reason ?? null,
    };
  });

  if (rows.length > 0) {
    const { error: entryErr } = await supabase.from('mtd_it_entries').insert(rows);
    if (entryErr) {
      console.error('POST /api/mtd-it/analyse insert entries', entryErr);
      await supabase.from('mtd_it_documents').update({ status: 'failed', error_message: 'Failed to save entries' }).eq('id', doc.id);
      return NextResponse.json({ error: 'Failed to save entries', document_id: doc.id }, { status: 500 });
    }
    // Promote the quarter out of 'not_started' once real entries land. Only
    // bumps the not-started case — leaves draft/complete/sent/approved alone.
    await supabase
      .from('mtd_it_quarters')
      .update({ status: 'draft' })
      .eq('id', quarter_id)
      .eq('status', 'not_started');
  }

  await supabase.from('mtd_it_documents').update({ status: 'scanned' }).eq('id', doc.id);

  return NextResponse.json({
    document_id: doc.id,
    entry_count: rows.length,
    mock: isMtdItMockMode(),
  });
}
