import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { getUserContext } from '@/lib/getUserContext';
import { TEMPLATE_FLOW_CHECKER_PROMPT } from '@/prompts/template-builder';

const StepSchema = z.object({
  step_key: z.string(),
  title: z.string(),
  assignee_role: z.string(),
  description: z.string().nullable().optional(),
  email_reminder_enabled: z.boolean().optional(),
  email_reminder_config: z.object({
    recipients: z.array(z.string()),
    timing: z.string(),
  }).optional(),
  client_instructions: z.string().nullable().optional(),
  tool_module_id: z.string().nullable().optional(),
});

const EdgeSchema = z.object({
  from_step_key: z.string(),
  to_step_key: z.string(),
  condition_type: z.string().nullable().optional(),
  condition_config: z.object({
    timeout_days: z.number().optional(),
    timeout_hours: z.number().optional(),
  }).nullable().optional(),
});

const RequestSchema = z.object({
  name: z.string(),
  steps: z.array(StepSchema),
  edges: z.array(EdgeSchema),
});

export interface FlowIssue {
  severity: 'error' | 'warning' | 'info';
  step_key: string | null;
  title: string;
  description: string;
  fix: string;
}

export interface FlowAnalysis {
  issues: FlowIssue[];
  summary: string;
}

export async function POST(req: NextRequest) {
  try {
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    const templateJson = JSON.stringify(parsed.data, null, 2);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: TEMPLATE_FLOW_CHECKER_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Please analyse this workflow template:\n\n${templateJson}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    let result: FlowAnalysis;
    try {
      // Strip any markdown code fences if present
      const clean = text.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim();
      const jsonMatch = clean.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { issues: [], summary: 'Could not parse response.' };
    } catch {
      result = { issues: [], summary: 'Could not parse analysis response.' };
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/tasks/templates/ai-check]', err);
    return NextResponse.json({ error: 'Analysis failed. Please try again.' }, { status: 500 });
  }
}
