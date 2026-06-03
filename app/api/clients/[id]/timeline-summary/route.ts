import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── /api/clients/[id]/timeline-summary ───────────────────────────────────────
// AI "state of play" summary of a client's timeline.
//   GET  → the latest saved summary for this client (or null).
//   POST → generate a fresh summary from the current timeline, save it to the
//          `outputs` table (feature='timeline_summary'), and return it.
//
// The summary highlights what an accountant needs at a glance: outstanding
// actions, deadlines/key dates, financial figures, and open / awaiting-reply
// threads. Saved summaries are reused so the page shows one instantly; the user
// regenerates when the timeline has moved on.

const FEATURE = 'timeline_summary';
/** Cap how many timeline items we feed the model, newest first, to bound tokens. */
const MAX_ITEMS = 60;

interface Highlight { category: 'action' | 'deadline' | 'financial' | 'open'; text: string }
interface SummaryData {
  overview: string;
  highlights: Highlight[];
  generatedAt: string;
  noteCount: number;
  truncated: boolean;
}

type NoteRow = {
  title: string | null;
  content: string | null;
  note_type: string;
  note_date: string | null;
  created_at: string;
  users: { full_name: string } | null;
};

/** Render one timeline note as a compact line of text for the model. Email
 *  notes store a JSON blob (subject/sender/snippet); everything else is a plain
 *  title + content. */
function noteToText(n: NoteRow): string {
  const when = (n.note_date || n.created_at || '').slice(0, 10);
  const author = n.users?.full_name ? ` [${n.users.full_name}]` : '';
  if (n.note_type === 'email' && n.content) {
    try {
      const e = JSON.parse(n.content) as Record<string, unknown>;
      if (e.__smith_email__) {
        const subject = String(e.subject ?? '(no subject)');
        const from = String(e.fromName || e.fromEmail || '');
        const body = String(e.bodyText || e.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        return `${when} · EMAIL${author} · From ${from} · "${subject}" — ${body}`;
      }
    } catch { /* fall through to plain rendering */ }
  }
  const body = (n.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
  return `${when} · ${n.note_type.toUpperCase()}${author} · ${n.title ?? ''}${body ? ` — ${body}` : ''}`;
}

async function loadLatest(supabase: ReturnType<typeof createClient>, clientId: string, firmId: string) {
  const { data } = await supabase
    .from('outputs')
    .select('result_data, created_at')
    .eq('client_id', clientId)
    .eq('firm_id', firmId)
    .eq('feature', FEATURE)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.result_data as SummaryData | undefined) ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const summary = await loadLatest(supabase, params.id, ctx.firmId);
  return NextResponse.json({ summary });
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();

  // Confirm the client belongs to this firm and grab its name.
  const { data: client, error: clientErr } = await supabase
    .from('clients')
    .select('id, name, business_type')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (clientErr || !client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  // Pull the timeline, newest first, capped.
  const { data: notes, error: notesErr } = await supabase
    .from('client_timeline_notes')
    .select('title, content, note_type, note_date, created_at, users(full_name)')
    .eq('client_id', params.id)
    .eq('firm_id', ctx.firmId)
    .order('note_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_ITEMS);
  if (notesErr) {
    console.error('timeline-summary: notes load failed', notesErr);
    return NextResponse.json({ error: 'Could not load the timeline.' }, { status: 500 });
  }
  const rows = (notes ?? []) as unknown as NoteRow[];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'There are no timeline entries to summarise yet.' }, { status: 400 });
  }

  // Oldest → newest reads more naturally for the model.
  const digest = rows.slice().reverse().map(noteToText).join('\n');

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are an assistant to a UK accountancy practice. You are given a chronological timeline of interactions with one client (emails, notes, meetings, phone calls). Produce a concise "state of play" summary for a busy accountant who needs to get up to speed quickly.

Focus on, in priority order:
1. Outstanding actions / to-dos — what the firm or the client still needs to do, anything promised or requested and not yet resolved.
2. Deadlines & key dates — filing, VAT, accounts or other time-sensitive dates (note if any look overdue relative to today, ${today}).
3. Financial figures — amounts owed, VAT bills, fees, balances or other money mentioned.
4. Open / awaiting-reply threads — conversations where someone is waiting on a response or a matter is left hanging.

Be specific and factual — quote names, dates and amounts from the timeline. Do not invent anything not present. Use British English and UK date formatting (dd Mmm yyyy). If a category has nothing relevant, omit it rather than padding.

Return ONLY valid JSON, no markdown fences, in exactly this shape:
{
  "overview": "2-4 sentence plain-English summary of where things stand with this client",
  "highlights": [
    { "category": "action" | "deadline" | "financial" | "open", "text": "one specific point" }
  ]
}
Order highlights by importance. Aim for 3-8 highlights.`;

  const userPrompt = `Client: ${client.name}${client.business_type ? ` (${client.business_type})` : ''}
Today's date: ${today}

--- Timeline (oldest first) ---
${digest}
---

Summarise the state of play as JSON.`;

  let anthropic;
  try {
    anthropic = await getAnthropicForFirm(ctx.firmId);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' }, { status: 400 });
    }
    throw err;
  }

  let parsed: { overview: string; highlights: Highlight[] };
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
    // Be forgiving: strip code fences and grab the outermost JSON object.
    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    const jsonStr = cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
    parsed = JSON.parse(jsonStr) as { overview: string; highlights: Highlight[] };
    if (!parsed.overview || !Array.isArray(parsed.highlights)) throw new Error('bad shape');

    // Log usage (best-effort).
    await supabase.from('ai_logs').insert({
      user_id: ctx.userId,
      client_id: params.id,
      feature: FEATURE,
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
    });
  } catch (err) {
    console.error('timeline-summary: AI/parse error', err);
    return NextResponse.json({ error: 'Could not generate a summary. Please try again.' }, { status: 502 });
  }

  const summary: SummaryData = {
    overview: parsed.overview,
    highlights: parsed.highlights
      .filter(h => h && typeof h.text === 'string' && h.text.trim())
      .map(h => ({ category: (['action', 'deadline', 'financial', 'open'] as const).includes(h.category) ? h.category : 'action', text: h.text.trim() })),
    generatedAt: new Date().toISOString(),
    noteCount: rows.length,
    truncated: rows.length >= MAX_ITEMS,
  };

  // Persist for instant reuse next time (one row per generation; we read latest).
  const { error: saveErr } = await supabase.from('outputs').insert({
    firm_id: ctx.firmId,
    client_id: params.id,
    user_id: ctx.userId,
    feature: FEATURE,
    client_name: client.name,
    result_data: summary,
  });
  if (saveErr) console.error('timeline-summary: save failed (non-fatal)', saveErr);

  return NextResponse.json({ summary });
}
