import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import type { CatalogueItem } from '@/lib/services/serviceTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapCatalogue(r: any): CatalogueItem {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    icon: r.icon ?? null,
    defaultFrequency: r.default_frequency ?? null,
    defaultPricePence: r.default_price_pence ?? null,
    defaultTaskType: r.default_task_type ?? null,
    archived: !!r.archived,
    sortOrder: r.sort_order ?? 0,
  };
}

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(60).nullable().optional(),
  default_frequency: z.string().max(30).nullable().optional(),
  default_price_pence: z.number().int().min(0).nullable().optional(),
  default_task_type: z.string().max(120).nullable().optional(),
});

// GET /api/services/catalogue → the firm's service catalogue (RLS-scoped read).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('firm_service_catalogue')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) {
    // Table not migrated yet → empty catalogue rather than a hard error.
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ items: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: (data ?? []).map(mapCatalogue) });
}

// POST /api/services/catalogue → add a catalogue item (admin only).
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  // Next sort order = end of the list.
  const { data: last } = await service
    .from('firm_service_catalogue').select('sort_order')
    .eq('firm_id', ctx.firmId).order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const sortOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await service
    .from('firm_service_catalogue')
    .insert({ firm_id: ctx.firmId, sort_order: sortOrder, ...parsed.data })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: mapCatalogue(data) }, { status: 201 });
}
