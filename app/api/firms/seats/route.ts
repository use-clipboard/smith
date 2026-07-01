import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';

// Seats = paid capacity (firms.seat_count). "In use" = number of users in the
// firm. You can't buy fewer seats than you have people.

async function inUseCount(firmId: string): Promise<number> {
  const service = createServiceClient();
  const { count } = await service
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId);
  return count ?? 0;
}

/** GET /api/firms/seats — current paid seats + seats in use. */
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createClient();
  const { data: firm } = await supabase.from('firms').select('seat_count').eq('id', ctx.firmId).single();
  const inUse = await inUseCount(ctx.firmId);
  return NextResponse.json({ seatCount: (firm?.seat_count as number | null) ?? 1, inUse });
}

/** PATCH /api/firms/seats — admin sets paid seats (>= seats in use). */
export async function PATCH(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.userRole !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', message: 'Only firm admins can change seats.' }, { status: 403 });
  }

  const parsed = z.object({ seatCount: z.number().int().min(1).max(1000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const inUse = await inUseCount(ctx.firmId);
  if (parsed.data.seatCount < inUse) {
    return NextResponse.json(
      { error: 'too_few_seats', message: `You have ${inUse} team member${inUse === 1 ? '' : 's'} using SMITH — you can't drop below ${inUse} seats. Remove a team member first.` },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const { error } = await supabase.from('firms').update({ seat_count: parsed.data.seatCount }).eq('id', ctx.firmId);
  if (error) {
    console.error('[/api/firms/seats PATCH]', error);
    return NextResponse.json({ error: 'Failed to update seats' }, { status: 500 });
  }

  return NextResponse.json({ success: true, seatCount: parsed.data.seatCount, inUse });
}
