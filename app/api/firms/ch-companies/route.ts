import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';

async function getAuthFirmId() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorised', firmId: null };

  const { data: profile } = await supabase
    .from('users')
    .select('firm_id')
    .eq('id', user.id)
    .single();

  if (!profile?.firm_id) return { error: 'No firm found', firmId: null };
  return { error: null, firmId: profile.firm_id as string };
}

/** GET: return the firm's saved company number list */
export async function GET() {
  const { error, firmId } = await getAuthFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { data: firm } = await service
    .from('firms')
    .select('ch_company_numbers')
    .eq('id', firmId!)
    .single();

  const numbers = (firm as { ch_company_numbers?: string[] | null } | null)?.ch_company_numbers ?? null;
  return NextResponse.json({ numbers });
}

const putSchema = z.object({
  numbers: z.array(z.string().min(1)).min(1).max(500),
});

/** PUT: save (replace) the firm's company number list — any authenticated user */
export async function PUT(request: NextRequest) {
  const { error, firmId } = await getAuthFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const body = await request.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('firms')
    .update({ ch_company_numbers: parsed.data.numbers })
    .eq('id', firmId!);

  if (updateError) {
    console.error('PUT /api/firms/ch-companies', updateError);
    return NextResponse.json({ error: 'Failed to save list' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** DELETE: clear the firm's company number list */
export async function DELETE() {
  const { error, firmId } = await getAuthFirmId();
  if (error) return NextResponse.json({ error }, { status: error === 'Unauthorised' ? 401 : 403 });

  const service = createServiceClient();
  const { error: updateError } = await service
    .from('firms')
    .update({ ch_company_numbers: null })
    .eq('id', firmId!);

  if (updateError) {
    console.error('DELETE /api/firms/ch-companies', updateError);
    return NextResponse.json({ error: 'Failed to clear list' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
