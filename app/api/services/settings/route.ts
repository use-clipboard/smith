import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient, createServiceClient } from '@/lib/supabase-server';

export interface ServiceTemplate {
  id: string;
  name: string;
  catalogueIds: string[];
}
export interface ServicesSettings {
  templates: ServiceTemplate[];
}

const DEFAULTS: ServicesSettings = { templates: [] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any): ServicesSettings {
  const templates = Array.isArray(raw?.templates)
    ? raw.templates.map((t: { id?: string; name?: string; catalogueIds?: unknown }) => ({
        id: String(t.id ?? ''),
        name: String(t.name ?? ''),
        catalogueIds: Array.isArray(t.catalogueIds) ? t.catalogueIds.map(String) : [],
      })).filter((t: ServiceTemplate) => t.id && t.name)
    : [];
  return { templates };
}

// GET /api/services/settings → the firm's services settings (templates, …).
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const supabase = createClient();
  const { data, error } = await supabase.from('firms').select('services_settings').eq('id', ctx.firmId).single();
  if (error) return NextResponse.json(DEFAULTS);
  return NextResponse.json(normalise(data?.services_settings));
}

const PutSchema = z.object({
  templates: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
    catalogueIds: z.array(z.string().uuid()),
  })).max(50),
});

// PUT /api/services/settings → replace the templates (admin only).
export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (ctx.userRole !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error } = await service.from('firms').update({ services_settings: { templates: parsed.data.templates } }).eq('id', ctx.firmId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, templates: parsed.data.templates });
}
