import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getBookkeepingContext } from '@/lib/bookkeeping/server';

// ── /api/bookkeeping/books/[id]/whiteboard ──────────────────────────────────
// GET  → all notes for the book (newest first).
// POST → create a new note.
//
// Notes are firm-scoped via the RLS policy on bookkeeping_whiteboard_notes,
// so we only need to verify the book belongs to the user's firm.

const STICKY_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
const MARKER_COLORS = ['black', 'blue', 'red'] as const;

const CreateBody = z.object({
  kind: z.enum(['sticky', 'marker']),
  content: z.string().max(2000).default(''),
  color: z.string(),
  pos_x: z.number().min(0).max(100).default(50),
  pos_y: z.number().min(0).max(100).default(50),
  rotation: z.number().min(-15).max(15).default(0),
});

const SELECT = 'id, book_id, kind, content, color, pos_x, pos_y, rotation, author_id, author_name, created_at, updated_at';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('bookkeeping_whiteboard_notes')
    .select(SELECT)
    .eq('book_id', params.id)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getBookkeepingContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  // Per-kind colour palette validation. The DB column is generic text so we
  // gate it here for nicer error messages.
  const palette = body.kind === 'sticky' ? STICKY_COLORS : MARKER_COLORS;
  if (!(palette as readonly string[]).includes(body.color)) {
    return NextResponse.json({
      error: `Invalid colour "${body.color}" for ${body.kind}. Expected one of: ${palette.join(', ')}.`,
    }, { status: 400 });
  }

  const supabase = createClient();
  const { data: book, error: bookErr } = await supabase
    .from('bookkeeping_books')
    .select('id, firm_id')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .single();
  if (bookErr || !book) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Look up the author's display name once so it travels with the note
  // (avoids per-render joins in the UI).
  const { data: author } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();
  const authorName = author?.full_name ?? author?.email ?? null;

  const { data, error } = await supabase
    .from('bookkeeping_whiteboard_notes')
    .insert({
      book_id: params.id,
      kind: body.kind,
      content: body.content,
      color: body.color,
      pos_x: body.pos_x,
      pos_y: body.pos_y,
      rotation: body.rotation,
      author_id: ctx.userId,
      author_name: authorName,
    })
    .select(SELECT)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });

  return NextResponse.json({ note: data });
}
