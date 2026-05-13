// ─── Agent Smith tool catalog ────────────────────────────────────────────────
// Defines every tool the Claude-powered Agent Smith can call, plus
// server-side handlers. Read tools execute immediately. Propose tools
// return a preview only — nothing is mutated until the user clicks
// Confirm and the apply route is called with the proposal id.

import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase-server';

export const MAX_MUTATION_ROWS = 5_000;
export const PREVIEW_SAMPLE_SIZE = 10;

// ── Tool definitions exposed to the model ──────────────────────────────────
// Schemas are kept conservative on purpose. The agent must use these tools;
// it cannot run arbitrary SQL or touch other tables. Anything outside this
// surface is, by construction, on the "never" list.
export const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'search_tasks',
    description: 'Find tasks matching filters. Read-only. Returns up to 100 tasks plus total count. Use for reports and to gather the IDs you need to mutate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['not_started', 'in_progress', 'waiting_on_client', 'records_here', 'review', 'complete', 'draft'] },
        statusNotIn: { type: 'array', items: { type: 'string' }, description: 'Exclude these statuses.' },
        client_id: { type: 'string', description: 'Restrict to one client.' },
        client_business_type: { type: 'string', enum: ['sole_trader', 'partnership', 'limited_company', 'llp', 'trust', 'charity', 'rental_landlord', 'individual'] },
        template_category: { type: 'string', description: 'e.g. self_assessment, vat, year_end' },
        assignee_id: { type: 'string', description: 'User id assigned to a step.' },
        due_before: { type: 'string', description: 'ISO date — due_date < this' },
        due_after:  { type: 'string', description: 'ISO date — due_date > this' },
        completed_before: { type: 'string', description: 'ISO date — completed_at < this' },
        completed_after:  { type: 'string', description: 'ISO date — completed_at > this' },
        include_deleted:  { type: 'boolean', description: 'Default false. If true, also include soft-deleted.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 100.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'search_clients',
    description: 'Find clients matching filters. Read-only. Returns up to 100 clients plus total count.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
        business_type: { type: 'string', enum: ['sole_trader', 'partnership', 'limited_company', 'llp', 'trust', 'charity', 'rental_landlord', 'individual'] },
        risk_rating:   { type: 'string', enum: ['Low', 'Medium', 'High'] },
        name_contains: { type: 'string' },
        client_ref_contains: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'aggregate_tasks',
    description: 'Run aggregations on tasks (counts, percentages, group-by). Use this for report-style questions like "% of limited company tasks completed within 3 months of due date".',
    input_schema: {
      type: 'object' as const,
      properties: {
        groupBy: { type: 'string', enum: ['status', 'template_category', 'client_business_type', 'assignee', 'overdue', 'due_window'] },
        filter:  { type: 'object', description: 'Same shape as search_tasks filters.' },
        metric:  { type: 'string', enum: ['count', 'pct_completed_within_due', 'avg_days_to_complete'], description: 'Default count.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task_bulk_update',
    description: 'Build a preview for a bulk task update. Returns row count, sample rows, and a proposalId. NOTHING IS WRITTEN until apply_proposed_action is called with this id AFTER the user clicks Confirm.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'object', description: 'Filters identifying the tasks to update (same shape as search_tasks).' },
        changes: {
          type: 'object',
          properties: {
            status:                   { type: 'string', enum: ['not_started', 'in_progress', 'waiting_on_client', 'records_here', 'review', 'complete'] },
            due_date:                 { type: 'string', description: 'ISO date or null to clear.' },
            recurrence_type:          { type: 'string', enum: ['once', 'weekly', 'bi-weekly', 'monthly', 'quarterly', 'annually', 'custom', 'none'] },
            recurrence_interval_days: { type: 'integer' },
            reassign_steps_from_user: { type: 'string', description: 'When set, re-assign all step assignments from this user_id to reassign_steps_to_user on each affected task.' },
            reassign_steps_to_user:   { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['filter', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_task_bulk_delete',
    description: 'Build a preview for soft-deleting tasks. Returns row count, sample rows, and a proposalId.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'object' },
      },
      required: ['filter'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_client_bulk_update',
    description: 'Build a preview for a bulk client update. Allowed fields: status, business_type, risk_rating, contact_email.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: { type: 'object', description: 'Same shape as search_clients.' },
        changes: {
          type: 'object',
          properties: {
            status:        { type: 'string', enum: ['active', 'inactive', 'archived'] },
            business_type: { type: 'string', enum: ['sole_trader', 'partnership', 'limited_company', 'llp', 'trust', 'charity', 'rental_landlord', 'individual'] },
            risk_rating:   { type: 'string', enum: ['Low', 'Medium', 'High'] },
            contact_email: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
      required: ['filter', 'changes'],
      additionalProperties: false,
    },
  },
  {
    name: 'render_report',
    description: 'Render a report to the preview pane. Use this when the user asks for a report or analytics — provide a title, a short paragraph summary, optional table rows, and optional chart series for a bar chart.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:   { type: 'string' },
        summary: { type: 'string', description: 'Plain-English paragraph.' },
        table: {
          type: 'object',
          properties: {
            columns: { type: 'array', items: { type: 'string' } },
            rows:    { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
          },
        },
        chart: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['bar', 'line'] },
            xLabel: { type: 'string' },
            yLabel: { type: 'string' },
            data: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'number' } }, required: ['label', 'value'] } },
          },
        },
      },
      required: ['title', 'summary'],
      additionalProperties: false,
    },
  },
];

// ── Filter schemas (also used by tool handlers) ────────────────────────────
const TaskFilterSchema = z.object({
  status: z.string().optional(),
  statusNotIn: z.array(z.string()).optional(),
  client_id: z.string().optional(),
  client_business_type: z.string().optional(),
  template_category: z.string().optional(),
  assignee_id: z.string().optional(),
  due_before: z.string().optional(),
  due_after: z.string().optional(),
  completed_before: z.string().optional(),
  completed_after: z.string().optional(),
  include_deleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).passthrough();

const ClientFilterSchema = z.object({
  status: z.string().optional(),
  business_type: z.string().optional(),
  risk_rating: z.string().optional(),
  name_contains: z.string().optional(),
  client_ref_contains: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
}).passthrough();

// ── Proposal cache ─────────────────────────────────────────────────────────
// Proposals live in-memory keyed by an id the model receives. The model
// shows the user a preview; if confirmed, the apply route fetches the
// proposal here and writes the change. Cleared after apply or after 30 min.
interface PendingProposal {
  id: string;
  firmId: string;
  userId: string;
  kind: 'task_bulk_update' | 'task_bulk_delete' | 'client_bulk_update';
  filter: Record<string, unknown>;
  changes: Record<string, unknown>;
  affectedIds: string[];
  affectedCount: number;
  summary: string;
  createdAt: number;
}
const proposalCache = new Map<string, PendingProposal>();

function newProposalId(): string {
  return 'prop_' + Math.random().toString(36).slice(2, 12);
}

function gcProposals() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, p] of proposalCache.entries()) {
    if (p.createdAt < cutoff) proposalCache.delete(id);
  }
}

export function getProposal(id: string): PendingProposal | undefined {
  gcProposals();
  return proposalCache.get(id);
}

export function deleteProposal(id: string) {
  proposalCache.delete(id);
}

// ── Tool runtime ───────────────────────────────────────────────────────────
type SupabaseClient = ReturnType<typeof createClient>;

export interface ToolContext {
  supabase: SupabaseClient;
  firmId: string;
  userId: string;
  userRole: 'admin' | 'staff';
}

export interface RenderedReport {
  title: string;
  summary: string;
  table?: { columns: string[]; rows: Array<Array<string | number | null>> };
  chart?: { kind: 'bar' | 'line'; xLabel?: string; yLabel?: string; data: { label: string; value: number }[] };
}

export interface ToolResult {
  // What is sent back to the model as the tool's result
  forModel: unknown;
  // Optional UI side-effect (preview pane updates)
  uiUpdate?:
    | { kind: 'proposal'; proposal: PendingProposal; sample: Array<Record<string, unknown>> }
    | { kind: 'report';   report: RenderedReport };
}

async function applyTaskFilter(
  ctx: ToolContext,
  filter: z.infer<typeof TaskFilterSchema>,
  selectClause = 'id, title, status, due_date, completed_at, client_id, template_id, recurrence_type',
) {
  let q = ctx.supabase.from('tasks').select(selectClause, { count: 'exact' }).eq('firm_id', ctx.firmId);
  if (!filter.include_deleted) q = q.is('deleted_at', null);
  if (filter.status) q = q.eq('status', filter.status);
  if (filter.statusNotIn && filter.statusNotIn.length) q = q.not('status', 'in', `(${filter.statusNotIn.map(s => `"${s}"`).join(',')})`);
  if (filter.client_id) q = q.eq('client_id', filter.client_id);
  if (filter.due_before) q = q.lt('due_date', filter.due_before);
  if (filter.due_after) q = q.gt('due_date', filter.due_after);
  if (filter.completed_before) q = q.lt('completed_at', filter.completed_before);
  if (filter.completed_after) q = q.gt('completed_at', filter.completed_after);
  // template_category / client_business_type / assignee_id require joins — done in post
  q = q.limit(filter.limit ?? 100);
  return q;
}

// Helpers for joined post-filters when needed (small fan-out)
async function expandTaskIdsForJoinFilters(
  ctx: ToolContext,
  filter: z.infer<typeof TaskFilterSchema>,
): Promise<string[] | null> {
  const restrictSets: string[][] = [];

  if (filter.template_category) {
    const { data: tpls } = await ctx.supabase
      .from('task_templates')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .eq('category', filter.template_category);
    if (!tpls?.length) return [];
    const tplIds = tpls.map(t => t.id);
    const { data: rows } = await ctx.supabase
      .from('tasks')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .in('template_id', tplIds);
    restrictSets.push((rows ?? []).map(r => r.id));
  }
  if (filter.client_business_type) {
    const { data: cs } = await ctx.supabase
      .from('clients')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .eq('business_type', filter.client_business_type);
    if (!cs?.length) return [];
    const ids = cs.map(c => c.id);
    const { data: rows } = await ctx.supabase
      .from('tasks')
      .select('id')
      .eq('firm_id', ctx.firmId)
      .is('deleted_at', null)
      .in('client_id', ids);
    restrictSets.push((rows ?? []).map(r => r.id));
  }
  if (filter.assignee_id) {
    const { data: steps } = await ctx.supabase
      .from('task_steps')
      .select('task_id')
      .eq('assignee_id', filter.assignee_id);
    restrictSets.push([...new Set((steps ?? []).map(r => r.task_id as string))]);
  }
  if (restrictSets.length === 0) return null;
  // Intersect
  return restrictSets.reduce((acc, set) => acc.filter(id => set.includes(id)));
}

async function fetchAffectedTaskIds(
  ctx: ToolContext,
  filter: z.infer<typeof TaskFilterSchema>,
): Promise<{ ids: string[]; capped: boolean }> {
  const joinIds = await expandTaskIdsForJoinFilters(ctx, filter);
  if (joinIds && joinIds.length === 0) return { ids: [], capped: false };

  // Page through to bypass 1000 cap
  const PAGE = 1000;
  const ids: string[] = [];
  for (let p = 0; p < 10; p++) { // hard ceiling at 10k for the *pre*-cap collect
    let q = ctx.supabase.from('tasks').select('id').eq('firm_id', ctx.firmId).is('deleted_at', null);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.statusNotIn?.length) q = q.not('status', 'in', `(${filter.statusNotIn.map(s => `"${s}"`).join(',')})`);
    if (filter.client_id) q = q.eq('client_id', filter.client_id);
    if (filter.due_before) q = q.lt('due_date', filter.due_before);
    if (filter.due_after) q = q.gt('due_date', filter.due_after);
    if (filter.completed_before) q = q.lt('completed_at', filter.completed_before);
    if (filter.completed_after) q = q.gt('completed_at', filter.completed_after);
    if (joinIds) q = q.in('id', joinIds);
    q = q.range(p * PAGE, (p + 1) * PAGE - 1);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    ids.push(...data.map(r => r.id as string));
    if (data.length < PAGE) break;
  }
  return { ids, capped: ids.length > MAX_MUTATION_ROWS };
}

async function fetchAffectedClientIds(
  ctx: ToolContext,
  filter: z.infer<typeof ClientFilterSchema>,
): Promise<{ ids: string[]; capped: boolean }> {
  const PAGE = 1000;
  const ids: string[] = [];
  for (let p = 0; p < 10; p++) {
    let q = ctx.supabase.from('clients').select('id').eq('firm_id', ctx.firmId);
    if (filter.status) q = q.eq('status', filter.status);
    if (filter.business_type) q = q.eq('business_type', filter.business_type);
    if (filter.risk_rating) q = q.eq('risk_rating', filter.risk_rating);
    if (filter.name_contains) q = q.ilike('name', `%${filter.name_contains}%`);
    if (filter.client_ref_contains) q = q.ilike('client_ref', `%${filter.client_ref_contains}%`);
    q = q.range(p * PAGE, (p + 1) * PAGE - 1);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    ids.push(...data.map(r => r.id as string));
    if (data.length < PAGE) break;
  }
  return { ids, capped: ids.length > MAX_MUTATION_ROWS };
}

function summariseChanges(kind: string, changes: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k} → ${String(v)}`);
  }
  return parts.length ? parts.join(', ') : kind;
}

// ── Main runtime ───────────────────────────────────────────────────────────
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  const input = (rawInput ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'search_tasks': {
      const filter = TaskFilterSchema.parse(input);
      const joinIds = await expandTaskIdsForJoinFilters(ctx, filter);
      if (joinIds && joinIds.length === 0) {
        return { forModel: { tasks: [], total: 0 } };
      }
      let q = ctx.supabase.from('tasks').select('id, title, status, due_date, completed_at, client_id, template_id', { count: 'exact' }).eq('firm_id', ctx.firmId);
      if (!filter.include_deleted) q = q.is('deleted_at', null);
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.statusNotIn?.length) q = q.not('status', 'in', `(${filter.statusNotIn.map(s => `"${s}"`).join(',')})`);
      if (filter.client_id) q = q.eq('client_id', filter.client_id);
      if (filter.due_before) q = q.lt('due_date', filter.due_before);
      if (filter.due_after)  q = q.gt('due_date', filter.due_after);
      if (filter.completed_before) q = q.lt('completed_at', filter.completed_before);
      if (filter.completed_after)  q = q.gt('completed_at', filter.completed_after);
      if (joinIds) q = q.in('id', joinIds);
      q = q.limit(filter.limit ?? 100);
      const { data, count, error } = await q;
      if (error) return { forModel: { error: error.message } };
      return { forModel: { tasks: data ?? [], total: count ?? 0 } };
    }

    case 'search_clients': {
      const filter = ClientFilterSchema.parse(input);
      let q = ctx.supabase.from('clients').select('id, name, client_ref, status, business_type, risk_rating, contact_email', { count: 'exact' }).eq('firm_id', ctx.firmId);
      if (filter.status) q = q.eq('status', filter.status);
      if (filter.business_type) q = q.eq('business_type', filter.business_type);
      if (filter.risk_rating) q = q.eq('risk_rating', filter.risk_rating);
      if (filter.name_contains) q = q.ilike('name', `%${filter.name_contains}%`);
      if (filter.client_ref_contains) q = q.ilike('client_ref', `%${filter.client_ref_contains}%`);
      q = q.limit(filter.limit ?? 100);
      const { data, count, error } = await q;
      if (error) return { forModel: { error: error.message } };
      return { forModel: { clients: data ?? [], total: count ?? 0 } };
    }

    case 'aggregate_tasks': {
      const filter = TaskFilterSchema.parse(input.filter ?? {});
      const metric = (input.metric as string) ?? 'count';
      const { ids } = await fetchAffectedTaskIds(ctx, filter);
      if (ids.length === 0) return { forModel: { groups: [], total: 0 } };

      // Pull the rows we need for aggregation
      const { data: tasks } = await ctx.supabase
        .from('tasks')
        .select('id, status, due_date, completed_at, client_id, template_id')
        .in('id', ids);
      const taskRows = tasks ?? [];

      // Join helpers
      let templates: Record<string, { category: string | null }> = {};
      let clients: Record<string, { business_type: string | null }> = {};
      const tplIds = [...new Set(taskRows.map(t => t.template_id).filter(Boolean) as string[])];
      const cliIds = [...new Set(taskRows.map(t => t.client_id).filter(Boolean) as string[])];
      if (tplIds.length) {
        const { data } = await ctx.supabase.from('task_templates').select('id, category').in('id', tplIds);
        templates = Object.fromEntries((data ?? []).map(r => [r.id, { category: r.category }]));
      }
      if (cliIds.length) {
        const { data } = await ctx.supabase.from('clients').select('id, business_type').in('id', cliIds);
        clients = Object.fromEntries((data ?? []).map(r => [r.id, { business_type: r.business_type }]));
      }

      function bucketKey(t: typeof taskRows[number]): string {
        const groupBy = (input.groupBy as string) ?? 'status';
        if (groupBy === 'status') return t.status ?? 'unknown';
        if (groupBy === 'template_category') return (t.template_id && templates[t.template_id]?.category) || 'uncategorised';
        if (groupBy === 'client_business_type') return (t.client_id && clients[t.client_id]?.business_type) || 'unknown';
        if (groupBy === 'overdue') {
          if (!t.due_date) return 'no_due_date';
          return new Date(t.due_date) < new Date() ? 'overdue' : 'on_track';
        }
        return 'all';
      }

      const buckets = new Map<string, typeof taskRows>();
      for (const t of taskRows) {
        const k = bucketKey(t);
        const arr = buckets.get(k) ?? [];
        arr.push(t);
        buckets.set(k, arr);
      }

      const groups = [...buckets.entries()].map(([key, rows]) => {
        let value: number;
        if (metric === 'pct_completed_within_due') {
          const withDue = rows.filter(r => r.due_date && r.completed_at);
          const withinDue = withDue.filter(r => new Date(r.completed_at!).getTime() <= new Date(r.due_date!).getTime() + 90 * 86_400_000);
          value = withDue.length ? Math.round((withinDue.length / withDue.length) * 1000) / 10 : 0;
        } else if (metric === 'avg_days_to_complete') {
          const completed = rows.filter(r => r.completed_at && r.due_date);
          const totalDays = completed.reduce((s, r) => s + Math.round((new Date(r.completed_at!).getTime() - new Date(r.due_date!).getTime()) / 86_400_000), 0);
          value = completed.length ? Math.round((totalDays / completed.length) * 10) / 10 : 0;
        } else {
          value = rows.length;
        }
        return { key, value, count: rows.length };
      }).sort((a, b) => b.value - a.value);

      return { forModel: { groups, total: taskRows.length, metric } };
    }

    case 'propose_task_bulk_update':
    case 'propose_task_bulk_delete': {
      const filter = TaskFilterSchema.parse(input.filter ?? {});
      const changesRaw = (input.changes ?? {}) as Record<string, unknown>;
      const { ids, capped } = await fetchAffectedTaskIds(ctx, filter);
      if (capped) {
        return { forModel: { error: `Result includes ${ids.length} rows which exceeds the ${MAX_MUTATION_ROWS} row cap. Narrow your filter or split the action.` } };
      }
      if (ids.length === 0) {
        return { forModel: { error: 'No tasks matched the filter — nothing to change.' } };
      }
      const { data: sample } = await ctx.supabase
        .from('tasks')
        .select('id, title, status, due_date, client:clients(name, client_ref)')
        .in('id', ids.slice(0, PREVIEW_SAMPLE_SIZE));

      const kind = name === 'propose_task_bulk_delete' ? 'task_bulk_delete' : 'task_bulk_update';
      const summary = kind === 'task_bulk_delete'
        ? `Delete ${ids.length} task${ids.length !== 1 ? 's' : ''}`
        : `Update ${ids.length} task${ids.length !== 1 ? 's' : ''} (${summariseChanges('update', changesRaw)})`;
      const proposal: PendingProposal = {
        id: newProposalId(),
        firmId: ctx.firmId,
        userId: ctx.userId,
        kind: kind as PendingProposal['kind'],
        filter: filter as Record<string, unknown>,
        changes: kind === 'task_bulk_delete' ? {} : changesRaw,
        affectedIds: ids,
        affectedCount: ids.length,
        summary,
        createdAt: Date.now(),
      };
      proposalCache.set(proposal.id, proposal);
      return {
        forModel: { proposalId: proposal.id, affectedCount: ids.length, sample: sample ?? [], summary },
        uiUpdate: { kind: 'proposal', proposal, sample: sample ?? [] },
      };
    }

    case 'propose_client_bulk_update': {
      const filter = ClientFilterSchema.parse(input.filter ?? {});
      const changes = (input.changes ?? {}) as Record<string, unknown>;
      const { ids, capped } = await fetchAffectedClientIds(ctx, filter);
      if (capped) return { forModel: { error: `Result includes ${ids.length} rows which exceeds the ${MAX_MUTATION_ROWS} row cap.` } };
      if (ids.length === 0) return { forModel: { error: 'No clients matched the filter.' } };
      const { data: sample } = await ctx.supabase
        .from('clients')
        .select('id, name, client_ref, status, business_type, risk_rating')
        .in('id', ids.slice(0, PREVIEW_SAMPLE_SIZE));
      const summary = `Update ${ids.length} client${ids.length !== 1 ? 's' : ''} (${summariseChanges('update', changes)})`;
      const proposal: PendingProposal = {
        id: newProposalId(),
        firmId: ctx.firmId,
        userId: ctx.userId,
        kind: 'client_bulk_update',
        filter: filter as Record<string, unknown>,
        changes,
        affectedIds: ids,
        affectedCount: ids.length,
        summary,
        createdAt: Date.now(),
      };
      proposalCache.set(proposal.id, proposal);
      return {
        forModel: { proposalId: proposal.id, affectedCount: ids.length, sample: sample ?? [], summary },
        uiUpdate: { kind: 'proposal', proposal, sample: sample ?? [] },
      };
    }

    case 'render_report': {
      const report: RenderedReport = {
        title:   String(input.title ?? 'Report'),
        summary: String(input.summary ?? ''),
        table:   (input.table as RenderedReport['table']) ?? undefined,
        chart:   (input.chart as RenderedReport['chart']) ?? undefined,
      };
      return { forModel: { acknowledged: true }, uiUpdate: { kind: 'report', report } };
    }

    default:
      return { forModel: { error: `Unknown tool: ${name}` } };
  }
}

// ── Apply a confirmed proposal ─────────────────────────────────────────────
export async function applyProposal(proposalId: string, ctx: ToolContext): Promise<
  | { ok: true; actionId: string; affectedCount: number; summary: string }
  | { ok: false; error: string }
> {
  const p = proposalCache.get(proposalId);
  if (!p) return { ok: false, error: 'Proposal expired or not found. Please ask Agent Smith to re-propose.' };
  if (p.firmId !== ctx.firmId) return { ok: false, error: 'Proposal belongs to a different firm.' };

  const now = new Date().toISOString();

  if (p.kind === 'task_bulk_update') {
    // Snapshot before
    const { data: before } = await ctx.supabase
      .from('tasks')
      .select('*, steps:task_steps(id, assignee_id)')
      .in('id', p.affectedIds);
    const snapshot = { tasks: before ?? [] };

    // Build update object
    const updates: Record<string, unknown> = { updated_at: now };
    const c = p.changes as Record<string, unknown>;
    if (c.status) updates.status = c.status;
    if (c.due_date !== undefined) updates.due_date = c.due_date || null;
    if (c.recurrence_type === 'none') { updates.recurrence_type = null; updates.recurrence_interval_days = null; }
    else if (c.recurrence_type) updates.recurrence_type = c.recurrence_type;
    if (c.recurrence_interval_days) updates.recurrence_interval_days = c.recurrence_interval_days;
    if (Object.keys(updates).length > 1) {
      const { error } = await ctx.supabase.from('tasks').update(updates).in('id', p.affectedIds);
      if (error) return { ok: false, error: error.message };
    }
    // Reassign steps
    if (c.reassign_steps_from_user && c.reassign_steps_to_user) {
      const { error: rerr } = await ctx.supabase
        .from('task_steps')
        .update({ assignee_id: c.reassign_steps_to_user, updated_at: now })
        .in('task_id', p.affectedIds)
        .eq('assignee_id', c.reassign_steps_from_user);
      if (rerr) return { ok: false, error: rerr.message };
    }

    const { data: action, error: aerr } = await ctx.supabase.from('agent_actions').insert({
      firm_id: ctx.firmId, performed_by: ctx.userId,
      action_type: p.kind, summary: p.summary, affected_count: p.affectedCount, snapshot,
    }).select().single();
    if (aerr) return { ok: false, error: aerr.message };
    proposalCache.delete(proposalId);
    return { ok: true, actionId: action.id as string, affectedCount: p.affectedCount, summary: p.summary };
  }

  if (p.kind === 'task_bulk_delete') {
    const { data: before } = await ctx.supabase.from('tasks').select('*').in('id', p.affectedIds);
    const snapshot = { tasks: before ?? [] };
    const { error } = await ctx.supabase
      .from('tasks')
      .update({ deleted_at: now, deleted_by: ctx.userId, updated_at: now })
      .in('id', p.affectedIds)
      .is('deleted_at', null);
    if (error) return { ok: false, error: error.message };
    const { data: action, error: aerr } = await ctx.supabase.from('agent_actions').insert({
      firm_id: ctx.firmId, performed_by: ctx.userId,
      action_type: p.kind, summary: p.summary, affected_count: p.affectedCount, snapshot,
    }).select().single();
    if (aerr) return { ok: false, error: aerr.message };
    proposalCache.delete(proposalId);
    return { ok: true, actionId: action.id as string, affectedCount: p.affectedCount, summary: p.summary };
  }

  if (p.kind === 'client_bulk_update') {
    const { data: before } = await ctx.supabase.from('clients').select('*').in('id', p.affectedIds);
    const snapshot = { clients: before ?? [] };
    const updates: Record<string, unknown> = { updated_at: now };
    const c = p.changes as Record<string, unknown>;
    if (c.status) updates.status = c.status;
    if (c.business_type) updates.business_type = c.business_type;
    if (c.risk_rating) updates.risk_rating = c.risk_rating;
    if (c.contact_email) updates.contact_email = c.contact_email;
    if (Object.keys(updates).length === 1) return { ok: false, error: 'No changes specified.' };
    const { error } = await ctx.supabase.from('clients').update(updates).in('id', p.affectedIds);
    if (error) return { ok: false, error: error.message };
    const { data: action, error: aerr } = await ctx.supabase.from('agent_actions').insert({
      firm_id: ctx.firmId, performed_by: ctx.userId,
      action_type: p.kind, summary: p.summary, affected_count: p.affectedCount, snapshot,
    }).select().single();
    if (aerr) return { ok: false, error: aerr.message };
    proposalCache.delete(proposalId);
    return { ok: true, actionId: action.id as string, affectedCount: p.affectedCount, summary: p.summary };
  }

  return { ok: false, error: 'Unknown proposal kind.' };
}

// ── Undo a previously-applied action ───────────────────────────────────────
export async function undoAction(actionId: string, ctx: ToolContext): Promise<
  | { ok: true; summary: string }
  | { ok: false; error: string }
> {
  const { data: action, error } = await ctx.supabase.from('agent_actions').select('*').eq('id', actionId).eq('firm_id', ctx.firmId).maybeSingle();
  if (error || !action) return { ok: false, error: 'Action not found.' };
  if (action.undone_at) return { ok: false, error: 'This action has already been undone.' };
  if (new Date(action.expires_at).getTime() < Date.now()) return { ok: false, error: 'Undo window has expired (24 hours).' };

  const snapshot = action.snapshot as { tasks?: Record<string, unknown>[]; clients?: Record<string, unknown>[] };
  const now = new Date().toISOString();

  try {
    if (action.action_type === 'task_bulk_update' || action.action_type === 'task_bulk_delete') {
      // Restore each task's previous column values
      for (const row of snapshot.tasks ?? []) {
        const { id, steps, ...cols } = row as Record<string, unknown> & { id: string; steps?: { id: string; assignee_id: string | null }[] };
        await ctx.supabase.from('tasks').update({ ...cols, updated_at: now }).eq('id', id).eq('firm_id', ctx.firmId);
        if (steps) {
          for (const s of steps) {
            await ctx.supabase.from('task_steps').update({ assignee_id: s.assignee_id, updated_at: now }).eq('id', s.id);
          }
        }
      }
    } else if (action.action_type === 'client_bulk_update') {
      for (const row of snapshot.clients ?? []) {
        const { id, ...cols } = row as Record<string, unknown> & { id: string };
        await ctx.supabase.from('clients').update({ ...cols, updated_at: now }).eq('id', id).eq('firm_id', ctx.firmId);
      }
    } else {
      return { ok: false, error: `Cannot undo ${action.action_type}.` };
    }

    await ctx.supabase.from('agent_actions').update({ undone_at: now, undone_by: ctx.userId }).eq('id', actionId);
    return { ok: true, summary: action.summary as string };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await ctx.supabase.from('agent_actions').update({ undo_error: message }).eq('id', actionId);
    return { ok: false, error: message };
  }
}
