import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessTaxStudio } from '@/lib/tax-studio/access';
import { logAiUsage } from '@/lib/driveUpload';
import { TAX_STUDIO_ANALYSE_SYSTEM } from '@/prompts/tax-studio-analyse';
import { computeSa100Full } from '@/components/features/tax-studio/calc';
import type { Sa100Income, ReviewPoint, TaxSuggestion } from '@/components/features/tax-studio/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  income: z.object({}).passthrough(),
  taxYear: z.string(),
  entity: z.string().default(''),
  context: z.string().default(''),
});

// Robust JSON extraction: the model usually returns a bare object, but can wrap
// it in a ```json fence or add a sentence of prose either side. Try a direct
// parse, then fall back to a brace-balanced scan (string/escape aware) so a
// stray character around the object doesn't fail the whole analysis with a 502.
function parseJsonResponse(text: string): unknown {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  try { return JSON.parse(s); } catch { /* fall through to brace scan */ }

  const start = s.indexOf('{');
  if (start === -1) throw new Error('no JSON object in response');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(start, i + 1)); }
  }
  throw new Error('unterminated JSON object in response');
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const SEVERITIES = ['serious', 'minor', 'info'] as const;

export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessTaxStudio(ctx.activeModules)) return NextResponse.json({ error: 'Tax Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try { body = BodySchema.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const income = body.income as unknown as Sa100Income;

  try {
    const anthropic = await getAnthropicForFirm(ctx.firmId);
    const c = computeSa100Full(income, body.taxYear);

    const payload = {
      taxYear: body.taxYear,
      entity: body.entity,
      context: body.context,
      income,
      computation: {
        totalIncome: c.totalIncome, personalAllowance: c.personalAllowance, paTapered: c.paTapered,
        taxableIncome: c.taxableIncome, marginalBand: c.marginalBand,
        incomeTax: c.incomeTax, class4Nic: c.class4Nic, studentLoan: c.studentLoan, hicbc: c.hicbc,
        capitalGainsTax: c.capitalGainsTax, totalDue: c.totalDue,
        balancingPayment: c.balancingPayment, paymentOnAccount: c.paymentOnAccount, poaApplies: c.poaApplies,
        effectiveRate: Math.round(c.effectiveRate * 1000) / 10,
      },
    };

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      system: TAX_STUDIO_ANALYSE_SYSTEM,
      messages: [{ role: 'user', content: `Review this Self Assessment return.\n\n${JSON.stringify(payload, null, 2)}` }],
    });

    const textPart = response.content.find(c2 => c2.type === 'text');
    if (!textPart || textPart.type !== 'text') return NextResponse.json({ error: 'No response from AI.' }, { status: 502 });

    let parsed: { reviewPoints?: unknown; suggestions?: unknown };
    try { parsed = parseJsonResponse(textPart.text) as typeof parsed; }
    catch (e) {
      console.error('[/api/tax-studio/analyse] JSON parse failed:', String(e), '\nraw:', textPart.text.slice(0, 800));
      return NextResponse.json({ error: 'Could not analyse the return — please try again.' }, { status: 502 });
    }

    const reviewPoints: ReviewPoint[] = arr<Record<string, unknown>>(parsed.reviewPoints).map((p, i) => ({
      id: `rp-${i}`,
      area: String(p.area ?? 'Review'),
      issue: String(p.issue ?? ''),
      explanation: String(p.explanation ?? ''),
      severity: (SEVERITIES as readonly string[]).includes(String(p.severity)) ? p.severity as ReviewPoint['severity'] : 'info',
      suggestedFix: p.suggestedFix ? String(p.suggestedFix) : undefined,
      resolved: false,
    })).filter(p => p.issue);

    const suggestions: TaxSuggestion[] = arr<Record<string, unknown>>(parsed.suggestions).map((s, i) => ({
      id: `sg-${i}`,
      title: String(s.title ?? ''),
      category: String(s.category ?? 'Other'),
      estSaving: Math.max(0, Math.round(Number(s.estSaving) || 0)),
      confidence: Math.min(100, Math.max(0, Math.round(Number(s.confidence) || 0))),
      reasoning: String(s.reasoning ?? ''),
      legislation: String(s.legislation ?? ''),
      appliedToSandbox: false,
    })).filter(s => s.title);

    void logAiUsage({ ...ctx, clientId: null, feature: 'tax_studio', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

    return NextResponse.json({ reviewPoints, suggestions });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 402 });
    console.error('[/api/tax-studio/analyse]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 502 });
  }
}
