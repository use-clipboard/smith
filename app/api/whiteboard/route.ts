import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// ── /api/whiteboard ─────────────────────────────────────────────────────────
// GET  → all messages for the current firm (newest first).
// POST → create a new sticky or marker note.
//
// Position is stored as % of the board's visible area so the dashboard
// noticeboard scales gracefully across viewports.

const STICKY_COLORS = ['yellow', 'pink', 'blue', 'green'] as const;
const MARKER_COLORS = ['black', 'blue', 'red'] as const;

const PostSchema = z.object({
  kind: z.enum(['sticky', 'marker']).default('sticky'),
  content: z.string().min(1).max(500),
  color: z.string(),
  author_name: z.string().min(1).max(80),
  pos_x: z.number().min(0).max(100).optional(),
  pos_y: z.number().min(0).max(100).optional(),
  rotation: z.number().min(-15).max(15).optional(),
});

const SELECT = 'id, content, color, author_name, created_at, user_id, kind, pos_x, pos_y, rotation';

// GET /api/whiteboard — list all messages for the current firm
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .select(SELECT)
    .eq('firm_id', ctx.firmId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('GET /api/whiteboard', error);
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
  }

  return NextResponse.json({ messages: data });
}

// POST /api/whiteboard — create a new sticky or marker note
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  // Per-kind palette validation — keeps the DB check column-flexible while
  // giving the user a clear error for "wrong colour for this kind".
  const palette = parsed.data.kind === 'sticky' ? STICKY_COLORS : MARKER_COLORS;
  if (!(palette as readonly string[]).includes(parsed.data.color)) {
    return NextResponse.json({
      error: `Invalid colour "${parsed.data.color}" for ${parsed.data.kind}. Expected one of: ${palette.join(', ')}.`,
    }, { status: 400 });
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('whiteboard_messages')
    .insert({
      firm_id: ctx.firmId,
      user_id: ctx.userId,
      content: parsed.data.content,
      color: parsed.data.color,
      author_name: parsed.data.author_name,
      kind: parsed.data.kind,
      pos_x: parsed.data.pos_x ?? 50,
      pos_y: parsed.data.pos_y ?? 30,
      rotation: parsed.data.rotation ?? 0,
    })
    .select(SELECT)
    .single();

  if (error) {
    console.error('POST /api/whiteboard', error);
    return NextResponse.json({ error: 'Failed to create message' }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}
