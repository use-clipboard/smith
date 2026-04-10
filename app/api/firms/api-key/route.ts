import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

async function getAdminFirmId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', firmId: null };

  const { data: profile } = await supabase
    .from('users')
    .select('role, firm_id')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') return { error: 'Forbidden', firmId: null };
  if (!profile?.firm_id) return { error: 'No firm found', firmId: null };

  return { error: null, firmId: profile.firm_id as string };
}

/** GET: returns whether an API key is configured (true/false) — never returns the key itself */
export async function GET() {
  const { error, firmId } = await getAdminFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { data: firm } = await service
    .from('firms')
    .select('anthropic_api_key')
    .eq('id', firmId!)
    .single();

  const hasKey = Boolean((firm as { anthropic_api_key?: string } | null)?.anthropic_api_key);

  return NextResponse.json({ hasKey });
}

const patchSchema = z.object({
  apiKey: z.string().min(1, 'API key cannot be empty').max(500),
});

/** PATCH: save or update the firm's Anthropic API key */
export async function PATCH(request: NextRequest) {
  const { error, firmId } = await getAdminFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('firms')
    .update({ anthropic_api_key: parsed.data.apiKey })
    .eq('id', firmId!);

  if (updateError) {
    console.error('PATCH /api/firms/api-key', updateError);
    return NextResponse.json({ error: 'Failed to save API key' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE: remove the firm's Anthropic API key */
export async function DELETE() {
  const { error, firmId } = await getAdminFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('firms')
    .update({ anthropic_api_key: null })
    .eq('id', firmId!);

  if (updateError) {
    console.error('DELETE /api/firms/api-key', updateError);
    return NextResponse.json({ error: 'Failed to remove API key' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
