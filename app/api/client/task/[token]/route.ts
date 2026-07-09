import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/client/task/[token]
// Public — no auth required. Returns task/step info for the client portal page.
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServiceClient();
  const { token } = params;

  // Fetch token + related data in one query
  const { data, error } = await supabase
    .from('task_client_tokens')
    .select(`
      id,
      expires_at,
      completed_at,
      task:tasks(
        id, title, description, deleted_at,
        client:clients(name, client_ref)
      ),
      step:task_steps(
        id, title, description, client_instructions, client_can_upload, status, due_date
      ),
      firm:firms(
        id, name, email_from_name, logo_url
      )
    `)
    .eq('token', token)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // A soft-deleted task revokes its client links — the portal routes bypass RLS
  // (service client), so this is the only thing stopping a live link to a
  // deleted task. Treat as an invalid link.
  if ((data.task as { deleted_at?: string | null } | null)?.deleted_at) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const now = new Date();
  const expired = new Date(data.expires_at) < now;
  const completed = !!data.completed_at;

  return NextResponse.json({
    token_id: data.id,
    expired,
    completed,
    expires_at: data.expires_at,
    completed_at: data.completed_at,
    task: data.task,
    step: data.step,
    firm: {
      name: (data.firm as { name?: string; email_from_name?: string | null; logo_url?: string | null } | null)?.email_from_name
        || (data.firm as { name?: string } | null)?.name
        || 'Your Accountant',
      logo_url: (data.firm as { logo_url?: string | null } | null)?.logo_url ?? null,
    },
  });
}
