import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

// ── POST /api/bookkeeping/books/[id]/management-accounts/narrative ────────────
// Generates the COVER NOTE (basis of preparation) that introduces a set of
// management accounts. Deliberately figure-free — the note describes who the
// accounts are for, the period, the purpose and the basis of preparation; the
// numbers live in the P&L / Balance Sheet the pack renders separately. The AI
// never does arithmetic and the note is fully editable by the user afterwards.
//
// Body: { from?, to?, statements?: ('pnl'|'bs')[], context? }
// Returns: { narrative, entityName, companyNumber }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** ISO yyyy-mm-dd → "5 January 2026" (UK long form). */
function longDate(iso?: string | null): string | null {
  if (!iso || !ISO.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!m || m < 1 || m > 12) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const ENTITY_LABEL: Record<string, string> = {
  ltd: 'limited company',
  limited_company: 'limited company',
  sole_trader: 'sole trader',
  partnership: 'partnership',
  llp: 'limited liability partnership',
  trust: 'trust',
  charity: 'charity',
  basic: 'business',
};

interface ClientMeta {
  name: string | null;
  registration_number: string | null;
  companies_house_id: string | null;
  business_type: string | null;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as {
    from?: string; to?: string; statements?: string[]; context?: string; forecastBasis?: string;
  };
  const from = body.from && ISO.test(body.from) ? body.from : null;
  const to = body.to && ISO.test(body.to) ? body.to : null;
  const statements = Array.isArray(body.statements)
    ? body.statements.filter(s => s === 'pnl' || s === 'bs')
    : ['pnl', 'bs'];
  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 2000) : '';
  const forecastBasis = typeof body.forecastBasis === 'string' ? body.forecastBasis.trim().slice(0, 400) : '';

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select(`id, name, firm_id, template_type, vat_registered,
      client:clients(name, registration_number, companies_house_id, business_type)`)
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Book not found' }, { status: 404 });

  // Supabase types the embedded to-one relation as an array — normalise it.
  const clientArr = (Array.isArray(book.client) ? book.client : book.client ? [book.client] : []) as unknown as ClientMeta[];
  const client: ClientMeta | null = clientArr[0] ?? null;
  const entityName = client?.name || book.name;
  const companyNumber = client?.registration_number || client?.companies_house_id || null;
  const entityTypeKey = client?.business_type || book.template_type || 'basic';
  const entityType = ENTITY_LABEL[entityTypeKey] ?? 'business';

  // What's in the pack drives both the title and the AI's framing.
  const hasPnl = statements.includes('pnl');
  const hasBs = statements.includes('bs');
  const statementsLabel =
    hasPnl && hasBs ? 'Profit and Loss Account and Balance Sheet'
    : hasPnl ? 'Profit and Loss Account'
    : hasBs ? 'Balance Sheet'
    : 'management accounts';

  const periodLabel = from && to
    ? `${longDate(from)} to ${longDate(to)}`
    : to ? `the period ended ${longDate(to)}`
    : 'the period';

  const systemPrompt = `You are a UK accountant writing the COVER NOTE (basis of preparation) that introduces a set of management accounts prepared by an accountancy practice. Write in British English, third person, in a formal, professional tone.

Output ONLY the body paragraphs of the cover note. Do NOT output a title, the entity name, the company number, or the period as separate heading lines — those are printed above your text by the system. Do NOT include any financial figures, numbers, ratios, percentages or commentary on performance — this is a basis-of-preparation note only, never an analysis.

Across 3 to 5 short paragraphs, cover:
- That these management accounts have been prepared for the entity for the stated period.
- The purpose: to give management an overview of the entity's performance/position to support informed business decisions and monitor performance.
- The basis: prepared from the entity's accounting records and the information available at the date of preparation; intended for internal management purposes only; that they do not constitute statutory financial statements. Use the correct framework for the entity type — for a limited company refer to the Companies Act 2006 and applicable UK accounting standards; for an unincorporated business keep it general.
- A closing line that they should be read in conjunction with any accompanying notes and schedules where applicable.

If the preparer supplies extra context, weave it in naturally (e.g. a first trading period following incorporation, a trade transferred from a sole trader to a company, a change of accounting date).

If a forecast basis is supplied, add a short paragraph explaining that the accounts include a forecast prepared on that basis, and note that the forecast figures are estimates based on the information available and the assumptions stated. Do NOT quote any figures other than those given to you verbatim in the forecast basis line.

Return plain text only: paragraphs separated by a single blank line. No markdown, no headings, no bullet points.`;

  const userPrompt = `Entity name: ${entityName}
Entity type: ${entityType}
Statements included in the pack: ${statementsLabel}
Period: ${periodLabel}
VAT registered: ${book.vat_registered ? 'yes' : 'no'}
Forecast basis (if any): ${forecastBasis || 'none — actuals only'}
Additional context from the preparer: ${context || 'none provided'}

Write the cover note body.`;

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const narrative = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '';

    await supabase.from('ai_logs').insert({
      user_id: ctx.userId,
      client_id: null,
      feature: 'management_accounts_narrative',
      input_tokens: message.usage?.input_tokens ?? null,
      output_tokens: message.usage?.output_tokens ?? null,
    });

    return NextResponse.json({ narrative, entityName, companyNumber });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json(
        { error: 'No Anthropic API key is configured for your firm. An admin can add one in Settings.' },
        { status: 400 },
      );
    }
    console.error('[bookkeeping] management-accounts narrative failed', err);
    return NextResponse.json({ error: 'Could not generate the cover note. Please try again.' }, { status: 500 });
  }
}
