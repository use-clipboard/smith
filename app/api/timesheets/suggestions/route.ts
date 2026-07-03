import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { createClient } from '@/lib/supabase-server';
import { logAiUsage } from '@/lib/driveUpload';

export const maxDuration = 60;

const RequestSchema = z.object({ days: z.number().int().min(1).max(31).default(7) });

/** A normalised piece of "work done" gathered from across SMITH. */
interface WorkSignal {
  source: string;
  clientName: string | null;
  title: string;
  when: string;
  hint?: string;
}

const FEATURE_SOURCE: Record<string, string> = {
  meeting_notes: 'meeting',
  full_analysis: 'capture',
  performance_analysis: 'performance',
  final_accounts_review: 'accounts_review',
};

const emptyOk = () => NextResponse.json({ suggestions: [] });

export async function POST(req: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await req.json().catch(() => ({})));
    const days = parsed.success ? parsed.data.days : 7;

    const ctx = await getUserContext();
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(ctx.activeModules);
    if (!isModuleActive('timesheets')) return moduleNotActive('timesheets');

    const supabase = createClient();
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    const signals: WorkSignal[] = [];

    // 1) Completed tasks assigned to / created by the user.
    try {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('title, completed_at, updated_at, is_internal, clients(name)')
        .eq('firm_id', ctx.firmId)
        .eq('status', 'complete')
        .gte('updated_at', sinceIso)
        .limit(40);
      for (const t of (tasks ?? []) as unknown as { title: string; updated_at: string; completed_at: string | null; is_internal: boolean; clients?: { name?: string } | null }[]) {
        signals.push({
          source: 'task',
          clientName: t.clients?.name ?? null,
          title: t.title,
          when: t.completed_at ?? t.updated_at,
          hint: t.is_internal ? 'internal' : 'billable',
        });
      }
    } catch { /* table may not exist / no access */ }

    // 2) AI outputs the user produced (meeting notes, capture, performance, reviews).
    try {
      const { data: outputs } = await supabase
        .from('outputs')
        .select('feature, created_at, clients(name), result_data')
        .eq('firm_id', ctx.firmId)
        .eq('user_id', ctx.userId)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(40);
      for (const o of (outputs ?? []) as unknown as { feature: string; created_at: string; clients?: { name?: string } | null; result_data?: Record<string, unknown> | null }[]) {
        const src = FEATURE_SOURCE[o.feature];
        if (!src) continue;
        const rd = o.result_data ?? {};
        const title =
          (rd['meetingTitle'] as string) ||
          (rd['clientCode'] as string) ||
          o.feature.replace(/_/g, ' ');
        signals.push({ source: src, clientName: o.clients?.name ?? null, title, when: o.created_at });
      }
    } catch { /* ignore */ }

    if (signals.length === 0) {
      // No live data — client will synthesise a demo detector.
      return emptyOk();
    }

    // Ask Claude to turn raw signals into time-entry suggestions.
    let anthropic;
    try {
      anthropic = await getAnthropicForFirm(ctx.firmId);
    } catch (e) {
      if (e instanceof ApiKeyNotConfiguredError) return emptyOk();
      throw e;
    }

    const today = new Date().toISOString().slice(0, 10);
    const system = `You are a time-recording assistant for a UK accountancy firm. You are given a list of work items a team member completed. For each, estimate a realistic amount of time and whether it is billable, non_billable or internal.
Return ONLY a valid JSON object: {"suggestions":[{"source","clientName","activity","taskTitle","date","suggestedMinutes","type","confidence","rationale"}]}.
- source: one of email, meeting, task, accounts_review, capture, performance, calendar.
- type: one of billable, non_billable, internal.
- suggestedMinutes: integer, rounded to the nearest 15, typically 30–150.
- confidence: 0–1.
- date: YYYY-MM-DD (use the item's date; today is ${today}).
- rationale: one short sentence a user would see. No text outside the JSON.`;

    const userMsg = signals.slice(0, 25).map((s, i) =>
      `${i + 1}. [${s.source}] ${s.title}${s.clientName ? ` — client: ${s.clientName}` : ''} (done ${s.when.slice(0, 10)})${s.hint ? ` [${s.hint}]` : ''}`,
    ).join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: `Completed work:\n${userMsg}` }],
    });

    logAiUsage({
      userId: ctx.userId,
      clientId: null,
      feature: 'timesheets_suggestions',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    }).catch(() => {});

    const textBlock = response.content.find(c => c.type === 'text');
    let jsonText = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : '';
    if (jsonText.startsWith('```json')) jsonText = jsonText.slice(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.slice(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.slice(0, -3).trim();

    let suggestions: unknown[] = [];
    try {
      const obj = JSON.parse(jsonText) as { suggestions?: unknown[] };
      suggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];
    } catch {
      return emptyOk();
    }

    // Normalise + tag ids so the client can render them directly.
    const clean = suggestions.slice(0, 12).map((raw, i) => {
      const s = raw as Record<string, unknown>;
      const type = ['billable', 'non_billable', 'internal'].includes(String(s.type)) ? String(s.type) : 'billable';
      return {
        id: `sg-live-${i}`,
        source: String(s.source ?? 'task'),
        clientId: null,
        clientName: (s.clientName as string) || 'Internal',
        activity: (s.activity as string) || 'Work',
        taskTitle: (s.taskTitle as string) || (s.activity as string) || 'Work',
        date: (s.date as string) || today,
        suggestedMinutes: Math.max(15, Math.round((Number(s.suggestedMinutes) || 30) / 15) * 15),
        type,
        confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.75)),
        rationale: (s.rationale as string) || 'Detected completed work with no time logged.',
      };
    });

    return NextResponse.json({ suggestions: clean });
  } catch (err) {
    console.error('[/api/timesheets/suggestions]', err);
    // Graceful — the client falls back to its local detector.
    return NextResponse.json({ suggestions: [] });
  }
}
