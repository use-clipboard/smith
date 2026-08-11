import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';

export const maxDuration = 60;

// The residence object is free-form (the SA109 model) — we pass a compact,
// human-readable digest to the model rather than the raw shape.
const RequestSchema = z.object({
  taxYear: z.string().max(20),
  clientName: z.string().max(120).optional(),
  residence: z.record(z.string(), z.unknown()).optional(),
  // Generic note context for pages other than SA109 — the caller supplies the
  // form name and a set of plain-English facts to base the draft note on.
  context: z.object({
    form: z.string().max(160),
    facts: z.array(z.string().max(400)).max(60),
  }).optional(),
});

// Turn the SA109 residence data into short English bullet facts for the prompt.
function digest(r: Record<string, unknown>): string[] {
  const out: string[] = [];
  const on = (k: string) => r[k] === true;
  const num = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : 0);
  const str = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim() : '');
  if (on('notResident')) out.push('Client claims non-resident status (box 1).');
  if (on('splitYear')) out.push(`Requesting split-year treatment${on('splitYearMultiple') ? ' (more than one case applies)' : ''}${str('splitYearDate') ? `, UK part date ${str('splitYearDate')}` : ''}.`);
  if (on('residentLastYear')) out.push('Was UK resident last year.');
  if (on('thirdAutoOverseasTest')) out.push('Meets the third automatic overseas test.');
  if (on('homeOverseas')) out.push('Has a home overseas.');
  if (num('daysInUk')) out.push(`Days spent in the UK: ${num('daysInUk')}.`);
  if (num('daysExceptional')) out.push(`Days attributed to exceptional circumstances: ${num('daysExceptional')}.`);
  if (num('ukTies')) out.push(`Number of UK ties: ${num('ukTies')}.`);
  if (num('workdaysUk') || num('workdaysOverseas')) out.push(`Workdays: ${num('workdaysUk')} in the UK, ${num('workdaysOverseas')} overseas.`);
  if (on('paUnderDta')) out.push('Claiming personal allowances under a DTA (box 15).');
  if (on('paOtherBasis')) out.push('Claiming personal allowances on some other basis (box 16).');
  if (str('nationalResidentCountries')) out.push(`National/resident of: ${str('nationalResidentCountries').replace(/\n/g, ', ')}.`);
  if (str('residentCountryCodes')) out.push(`Resident for tax this year in: ${str('residentCountryCodes').replace(/\n/g, ', ')}.`);
  if (on('figIncomeClaim') || on('figGainsClaim')) out.push(`Claiming FIG-regime relief on ${[on('figIncomeClaim') && 'foreign income', on('figGainsClaim') && 'foreign gains'].filter(Boolean).join(' and ')}.`);
  if (str('figArrivalDate')) out.push(`Date of arrival in the UK: ${str('figArrivalDate')}.`);
  if (on('owrClaim') || on('owrElection')) out.push('Overseas Workday Relief claimed/elected.');
  if (on('trfElection')) out.push('Election made under the Temporary Repatriation Facility.');
  return out;
}

// POST /api/tax-studio/suggest-note
// Drafts a short "any other information" note (SA109 box 54) from the residence
// details the preparer has entered — a starting point the user then edits.
export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    const { taxYear, clientName, residence, context } = parsed.data;

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

    // Generic path: caller supplied a form + facts for a non-SA109 note.
    const generic = context && context.facts.length > 0;
    const facts = generic ? context!.facts : (residence ? digest(residence) : []);
    if (facts.length === 0) {
      const empty = generic
        ? `[Describe anything relevant to this client's ${context!.form} entries for ${taxYear} — enter the figures above and SMITH can draft this for you.]`
        : `Residence position for ${taxYear}: [describe the client's residence status and the basis for it — e.g. the SRT test met, split-year case, or treaty position. Enter the residence details above and SMITH can draft this for you.]`;
      return NextResponse.json({ note: empty });
    }

    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const system = generic
      ? `You draft the free-text "Any other information" note for HMRC's ${context!.form}, for a UK accountant preparing a client's Self Assessment.

Write a concise, professional note (1–4 sentences, plain text, no headings or bullet points) that usefully explains or supports the client's figures for the tax year, based ONLY on the facts provided. Do NOT invent facts, figures or dates not given. Where a specific detail would strengthen the note but is missing, insert a clearly bracketed placeholder like [confirm the basis of the balancing charge]. This is a starting draft the accountant will review and edit. Reply with ONLY the note text.`
      : `You draft the free-text "Any other information" note for box 54 of HMRC form SA109 (Residence, remittance basis etc.), for a UK accountant preparing a client's Self Assessment.

Write a concise, professional note (2–5 sentences, plain text, no headings or bullet points) that explains and supports the client's residence position for the tax year, based ONLY on the facts provided. Reference the relevant Statutory Residence Test / split-year / treaty basis where the facts imply it. Do NOT invent facts, figures or dates not given. Where a specific detail would strengthen the note but is missing, insert a clearly bracketed placeholder like [confirm number of full-time working days overseas]. This is a starting draft the accountant will review and edit. Reply with ONLY the note text.`;

    const user = `Tax year: ${taxYear}${clientName ? `\nClient: ${clientName}` : ''}\n${generic ? `${context!.form} facts entered` : 'Residence facts entered'}:\n${facts.map(f => `- ${f}`).join('\n')}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: user }],
    });

    void logAiUsage({ ...ctx, clientId: null, feature: 'tax_studio', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    const block = response.content.find(c => c.type === 'text');
    const note = block && block.type === 'text' ? block.text.trim() : '';
    if (!note) return NextResponse.json({ error: 'No suggestion generated.' }, { status: 502 });
    return NextResponse.json({ note });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/suggest-note]', err);
    return NextResponse.json({ error: 'Could not draft a note.' }, { status: 500 });
  }
}
