import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserContext } from '@/lib/getUserContext';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import type { ClientServiceNote } from '@/lib/services/serviceTypes';

// GET /api/clients/[id]/service-notes → internal notes about this client's services.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('client_service_notes')
    .select('id, body, created_at, author:users!client_service_notes_created_by_fkey(full_name, email)')
    .eq('client_id', params.id)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return NextResponse.json({ notes: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const notes: ClientServiceNote[] = (data ?? []).map(r => {
    const raw = (r as { author?: unknown }).author;
    const a = (Array.isArray(raw) ? raw[0] : raw) as { full_name?: string; email?: string } | null | undefined;
    return { id: r.id, body: r.body, createdByName: a?.full_name ?? a?.email ?? null, createdAt: r.created_at };
  });
  return NextResponse.json({ notes });
}

const CreateSchema = z.object({ body: z.string().min(1).max(2000) });

// POST /api/clients/[id]/service-notes → add a note (any firm member).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { data: client } = await service
    .from('clients').select('id').eq('id', params.id).eq('firm_id', ctx.firmId).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data, error } = await service
    .from('client_service_notes')
    .insert({ firm_id: ctx.firmId, client_id: params.id, body: parsed.data.body, created_by: ctx.userId })
    .select('id, body, created_at').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: { id: data.id, body: data.body, createdByName: null, createdAt: data.created_at } }, { status: 201 });
}
