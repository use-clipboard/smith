// Server-side only — generates a quarterly manager briefing for a firm using
// Claude with web search scoped to UK authoritative sources.

import { createServiceClient } from '@/lib/supabase-server';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';

const MODEL = 'claude-sonnet-4-6';

// Allow-list of UK authoritative sources we'll trust.
const ALLOWED_DOMAINS = [
  'gov.uk',
  'acas.org.uk',
  'cipd.org',
  'hmrc.gov.uk',
  'legislation.gov.uk',
  'commonslibrary.parliament.uk',
];

export interface BriefingSection {
  heading: string;
  body: string;
  sources: Array<{ label: string; url: string }>;
}

export interface BriefingContent {
  summary: string;
  sections: BriefingSection[];
  action_items: string[];
  training_tips: string[];
}

interface AnthropicSdk {
  messages: {
    create: (params: Record<string, unknown>) => Promise<{
      content: Array<{ type: string; text?: string }>;
      model?: string;
    }>;
  };
}

interface MinimalUser { id: string; email: string }

export interface GenerateResult {
  briefingId: string | null;
  status: 'success' | 'failed' | 'skipped';
  reason?: string;
}

export interface GenerateOptions {
  firmId: string;
  /** YYYY-Qn — e.g. '2026-Q2' — defaults to the current quarter. */
  quarter?: string;
  /** When provided, this date is used as the "today" reference (mostly for tests). */
  now?: Date;
}

export function currentQuarter(now: Date = new Date()): { quarter: string; periodStart: string; periodEnd: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-11
  const qIdx = Math.floor(month / 3);              // 0..3
  const startMonth = qIdx * 3;                     // 0,3,6,9
  const periodStart = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  // End of quarter = day before next quarter starts
  const endNext = new Date(Date.UTC(year, startMonth + 3, 1));
  endNext.setUTCDate(endNext.getUTCDate() - 1);
  const periodEnd = endNext.toISOString().slice(0, 10);
  return { quarter: `${year}-Q${qIdx + 1}`, periodStart, periodEnd };
}

export function previousQuarter(now: Date = new Date()): { quarter: string; periodStart: string; periodEnd: string } {
  const ref = new Date(now);
  ref.setUTCMonth(ref.getUTCMonth() - 3);
  return currentQuarter(ref);
}

const SYSTEM_PROMPT = `You are an expert UK HR adviser writing a concise quarterly briefing for line managers at an accountancy firm.

Goal: surface UK employment-law changes, regulatory updates, and useful training pointers from the past quarter that managers should know about.

You MUST:
- Use ONLY the web_search tool to gather facts. Do NOT invent statistics, dates, or quotes.
- Cite a source URL for EVERY substantive claim. Sources must come from these UK authoritative domains: gov.uk, acas.org.uk, cipd.org, hmrc.gov.uk, legislation.gov.uk, commonslibrary.parliament.uk.
- If a topic isn't well covered by these sources, omit it.
- Write in clear UK English. Avoid jargon. Plain, actionable, manager-focused.
- This is reading material, not legal advice — frame your phrasing accordingly ("appears", "managers should consider", "review with your HR adviser before applying").

Return your final answer as a single JSON object inside a fenced code block, matching this TypeScript type:

\`\`\`json
{
  "summary": "One paragraph (3-4 sentences) summarising the most important takeaways.",
  "sections": [
    {
      "heading": "Topic title",
      "body": "Plain prose, 2-4 short paragraphs. Mention concrete dates and what changed.",
      "sources": [{ "label": "Display name", "url": "https://www.gov.uk/..." }]
    }
  ],
  "action_items": ["Concrete thing a manager should do this quarter, ≤ 1 sentence each"],
  "training_tips": ["Coaching / discussion prompts for 1:1s, ≤ 1 sentence each"]
}
\`\`\`

Aim for 3-5 sections, 4-6 action items, and 3-5 training tips. Keep total length under ~1,500 words. Output ONLY the JSON code block — no preamble, no closing remarks.`;

function buildUserPrompt(periodStart: string, periodEnd: string): string {
  return `Generate the quarterly UK employment-law briefing covering changes from ${periodStart} to ${periodEnd} (inclusive). Focus on what's new or changed in this window — not evergreen content. Search the allow-listed UK sources for recent updates.`;
}

function extractJson(text: string): unknown {
  // Look for a fenced JSON block first
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : text.trim();
  return JSON.parse(candidate);
}

function isValidContent(c: unknown): c is BriefingContent {
  if (!c || typeof c !== 'object') return false;
  const obj = c as Record<string, unknown>;
  if (typeof obj.summary !== 'string') return false;
  if (!Array.isArray(obj.sections)) return false;
  if (!Array.isArray(obj.action_items)) return false;
  if (!Array.isArray(obj.training_tips)) return false;
  return true;
}

/**
 * Generate (or skip if already present) a quarterly manager briefing for a firm.
 * Idempotent on (firm_id, quarter) — safe to retry.
 */
export async function generateBriefingForFirm(opts: GenerateOptions): Promise<GenerateResult> {
  const service = createServiceClient();
  const now = opts.now ?? new Date();
  const periodInfo = opts.quarter
    ? parseQuarterToPeriod(opts.quarter)
    : previousQuarter(now); // briefing reflects on the *previous* completed quarter
  const { quarter, periodStart, periodEnd } = periodInfo;

  // Skip if firm has opted out
  const { data: settings } = await service
    .from('firm_hr_settings')
    .select('manager_briefings_enabled')
    .eq('firm_id', opts.firmId)
    .maybeSingle();
  if (settings && settings.manager_briefings_enabled === false) {
    return { briefingId: null, status: 'skipped', reason: 'Disabled in firm settings' };
  }

  // Skip if a briefing for this quarter already exists with status=success
  const { data: existing } = await service
    .from('hr_manager_briefings')
    .select('id, status')
    .eq('firm_id', opts.firmId)
    .eq('quarter', quarter)
    .maybeSingle();
  if (existing && existing.status === 'success') {
    return { briefingId: existing.id, status: 'skipped', reason: 'Already exists' };
  }

  let anthropic: AnthropicSdk;
  try {
    anthropic = (await getAnthropicForFirm(opts.firmId)) as unknown as AnthropicSdk;
  } catch (e) {
    if (e instanceof ApiKeyNotConfiguredError) {
      return { briefingId: null, status: 'skipped', reason: 'No Anthropic API key' };
    }
    throw e;
  }

  let content: BriefingContent | null = null;
  let modelUsed = MODEL;
  let error: string | null = null;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 8,
          allowed_domains: ALLOWED_DOMAINS,
        },
      ],
      messages: [{ role: 'user', content: buildUserPrompt(periodStart, periodEnd) }],
    });
    modelUsed = response.model ?? MODEL;
    const text = response.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text as string)
      .join('\n');
    if (!text) throw new Error('Empty response from model');
    const parsed = extractJson(text);
    if (!isValidContent(parsed)) throw new Error('Response did not match expected schema');
    content = parsed;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  // Upsert the briefing row (whether success or failure — keeps an audit trail)
  const { data: row, error: dbErr } = await service
    .from('hr_manager_briefings')
    .upsert(
      {
        firm_id: opts.firmId,
        quarter,
        period_start: periodStart,
        period_end: periodEnd,
        summary: content?.summary ?? null,
        content,
        status: error ? 'failed' : 'success',
        error_detail: error,
        model: modelUsed,
        generated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,quarter' },
    )
    .select('id')
    .single();
  if (dbErr) {
    return { briefingId: null, status: 'failed', reason: dbErr.message };
  }

  return {
    briefingId: row?.id ?? null,
    status: error ? 'failed' : 'success',
    reason: error ?? undefined,
  };
}

/** Parse 'YYYY-Qn' to period bounds. */
function parseQuarterToPeriod(quarter: string): { quarter: string; periodStart: string; periodEnd: string } {
  const m = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!m) throw new Error(`Invalid quarter '${quarter}' — expected 'YYYY-Qn'`);
  const year = parseInt(m[1], 10);
  const qIdx = parseInt(m[2], 10) - 1;
  const startMonth = qIdx * 3;
  const periodStart = new Date(Date.UTC(year, startMonth, 1)).toISOString().slice(0, 10);
  const endNext = new Date(Date.UTC(year, startMonth + 3, 1));
  endNext.setUTCDate(endNext.getUTCDate() - 1);
  const periodEnd = endNext.toISOString().slice(0, 10);
  return { quarter, periodStart, periodEnd };
}

/** Find managers (people who have direct reports) + admins for a firm. */
export async function getManagerRecipientsForFirm(firmId: string): Promise<MinimalUser[]> {
  const service = createServiceClient();
  // Anyone in the firm whose `id` appears as `manager_id` on another firm user, plus all admins.
  const { data: allUsers } = await service
    .from('users')
    .select('id, email, role, manager_id')
    .eq('firm_id', firmId);
  if (!allUsers || allUsers.length === 0) return [];
  const managedBy = new Set<string>();
  for (const u of allUsers) {
    if (u.manager_id) managedBy.add(u.manager_id as string);
  }
  return allUsers
    .filter(u => u.role === 'admin' || managedBy.has(u.id))
    .map(u => ({ id: u.id, email: u.email as string }));
}
