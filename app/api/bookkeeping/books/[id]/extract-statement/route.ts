import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/bookkeeping/books/[id]/extract-statement ───────────────────────
// PDF / image bank-statement import for the reconciliation workspace. The user
// uploads a scanned or PDF bank statement; Claude reads every transaction line
// and returns them as { date, description, amount } with a SIGNED amount
// (money-in positive, money-out negative) — the exact shape the CSV path
// produces via parseBankCsv. Nothing is posted here: the lines flow back into
// the same review → allocate → post pipeline the "Import CSV" chip already uses
// (seeds the Manual entry sheet). This route only does extraction.
//
// Mirrors /api/analyse + /api/bank-to-csv for document handling (base64 content
// blocks, streaming to tolerate long statements) and the bookkeeping AI routes
// for gating + ai_logs logging.

const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});
const Body = z.object({
  files: z.array(FileSchema).min(1).max(10),
});

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const r2 = (n: number) => +Number(n).toFixed(2);

interface StatementLine {
  date: string;        // ISO YYYY-MM-DD
  description: string;
  amount: number;      // signed: + money in, − money out
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // ── Firm gate — the book must belong to the caller's firm ───────────────────
  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  // ── Build document / image content blocks (mirrors /api/analyse). ───────────
  const contentBlocks: Anthropic.ContentBlockParam[] = [];
  for (const f of body.files) {
    if (f.mimeType === 'application/pdf') {
      contentBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.base64 } });
    } else if (IMAGE_TYPES.has(f.mimeType)) {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } });
    }
  }
  if (contentBlocks.length === 0) {
    return NextResponse.json({ error: 'No readable statement found — supported formats: PDF, JPG, PNG, WEBP.' }, { status: 400 });
  }

  const systemPrompt = `You are an expert UK bookkeeper transcribing a bank statement so it can be reconciled.

Read EVERY transaction line on the statement(s) and output them as JSON. Do not summarise, group, or skip any — one object per transaction, in the order they appear.

Output JSON only, exactly this shape:
{"lines":[{"date":"YYYY-MM-DD","description":"...","amount":-12.34}]}

Rules:
- date: ISO YYYY-MM-DD. Infer the year from the statement period/header if the row only shows day + month.
- description: the payee / narrative as printed. Join a transaction that wraps across two printed lines into one description.
- amount: a SIGNED number. Money IN (paid in / credit / receipts) is POSITIVE. Money OUT (paid out / debit / payments) is NEGATIVE. Use the statement's own in/out or debit/credit columns to decide the sign — never guess from the description.
- Do NOT output the opening balance, closing balance, "balance brought forward / carried forward", running-balance figures, subtotals, or page totals as transactions. Only real movements.
- If a value is unclear, transcribe your best reading rather than dropping the line.
- Output the JSON object only — no prose, no markdown fences.`;

  let anthropic: Anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    console.error('[bookkeeping] extract-statement anthropic init failed', err);
    return NextResponse.json({ error: 'The AI service is unavailable right now. Please try again shortly.' }, { status: 500 });
  }

  let response: Anthropic.Message;
  try {
    // Streaming (like /api/bank-to-csv) so long statements don't hit the SDK's
    // non-streaming timeout. We still await the final message and parse once.
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: [...contentBlocks, { type: 'text', text: 'Transcribe every transaction now.' }] }],
    });
    response = await stream.finalMessage();
  } catch (err) {
    console.error('[bookkeeping] extract-statement failed', err);
    return NextResponse.json({ error: 'The AI hit a problem reading that statement. Please try again.' }, { status: 500 });
  }

  void supabase.from('ai_logs').insert({
    user_id: ctx.userId, client_id: null, feature: 'bank_pdf_import',
    input_tokens: response.usage?.input_tokens ?? null, output_tokens: response.usage?.output_tokens ?? null,
  });

  const textBlock = response.content.find(c => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return NextResponse.json({ error: 'The AI could not read any transactions from that file. Try a clearer scan.' }, { status: 422 });
  }

  // ── Strip code fences + salvage a truncated array (mirrors bank-to-csv). ────
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7).trim();
  if (jsonText.startsWith('```')) jsonText = jsonText.slice(3).trim();
  if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3).trim();

  const truncated = response.stop_reason === 'max_tokens';
  if (truncated) {
    // Close the partial JSON after the last complete object so we keep every
    // whole line we did get. Gaps at the very end are the user's to re-import.
    const lastComplete = jsonText.lastIndexOf('}');
    if (lastComplete !== -1) jsonText = jsonText.slice(0, lastComplete + 1) + ']}';
    else jsonText = '{"lines":[]}';
  }

  let raw: { lines?: unknown };
  try { raw = JSON.parse(jsonText); }
  catch {
    return NextResponse.json({ error: 'The AI returned an unreadable result. Please try again.' }, { status: 422 });
  }

  // ── Validate + normalise. Keep only well-formed, real movements. ────────────
  const lines: StatementLine[] = [];
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  for (const item of rawLines) {
    const l = item as Record<string, unknown>;
    const date = String(l.date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    lines.push({
      date,
      description: String(l.description ?? '').trim().slice(0, 500),
      amount: r2(amount),
    });
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: 'No transactions were found on that statement. Check it shows transaction rows, not just a summary.' }, { status: 422 });
  }

  return NextResponse.json({ lines, truncated });
}
