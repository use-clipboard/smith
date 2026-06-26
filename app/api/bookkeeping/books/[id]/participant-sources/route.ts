import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';
import type { ParticipantSourceOption } from '@/types/bookkeeping';

// ── GET /api/bookkeeping/books/[id]/participant-sources ───────────────────────
// Pickable sources for adding a book participant: the book client's client-links
// and key contacts. Empty when the book has no client (only manual entry then).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book } = await supabase
    .from('bookkeeping_books')
    .select('id, client_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .maybeSingle();
  if (!book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!book.client_id) {
    return NextResponse.json({ links: [], keyContacts: [] });
  }

  // ── Client links (both directions) ──────────────────────────────────────
  const [{ data: outgoing }, { data: incoming }] = await Promise.all([
    supabase.from('client_links')
      .select('link_type, ownership_percentage, linked_client_id')
      .eq('client_id', book.client_id).eq('firm_id', ctx.firmId),
    supabase.from('client_links')
      .select('link_type, ownership_percentage, client_id')
      .eq('linked_client_id', book.client_id).eq('firm_id', ctx.firmId),
  ]);

  const refIds = [...new Set([
    ...(outgoing ?? []).map(l => l.linked_client_id as string),
    ...(incoming ?? []).map(l => l.client_id as string),
  ])];

  const nameMap = new Map<string, string>();
  if (refIds.length > 0) {
    const { data: clients } = await supabase
      .from('clients').select('id, name').in('id', refIds).eq('firm_id', ctx.firmId);
    for (const c of clients ?? []) nameMap.set(c.id as string, c.name as string);
  }

  const links: ParticipantSourceOption[] = [
    ...(outgoing ?? []).map(l => ({
      kind: 'client_link' as const,
      ref_id: l.linked_client_id as string,
      name: nameMap.get(l.linked_client_id as string) ?? 'Unknown',
      role_hint: (l.link_type as string) ?? null,
      linked_client_id: l.linked_client_id as string,
      ownership_percentage: (l.ownership_percentage as number | null) ?? null,
    })),
    ...(incoming ?? []).map(l => ({
      kind: 'client_link' as const,
      ref_id: l.client_id as string,
      name: nameMap.get(l.client_id as string) ?? 'Unknown',
      role_hint: (l.link_type as string) ?? null,
      linked_client_id: l.client_id as string,
      ownership_percentage: (l.ownership_percentage as number | null) ?? null,
    })),
  ].filter(l => nameMap.has(l.ref_id));

  // ── Key contacts (JSONB on the client) ──────────────────────────────────
  const { data: clientRow } = await supabase
    .from('clients').select('key_contacts').eq('id', book.client_id).eq('firm_id', ctx.firmId).maybeSingle();
  const contacts = (clientRow?.key_contacts as Array<{ name?: string; role?: string; linked_client_id?: string | null }> | null) ?? [];
  const keyContacts: ParticipantSourceOption[] = contacts
    .filter(c => c?.name)
    .map((c, i) => ({
      kind: 'key_contact' as const,
      ref_id: `kc_${i}`,
      name: c.name as string,
      role_hint: c.role ?? null,
      linked_client_id: c.linked_client_id ?? null,
      ownership_percentage: null,
    }));

  return NextResponse.json({ links, keyContacts });
}
