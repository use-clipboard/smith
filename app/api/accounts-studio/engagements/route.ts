import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import { getAccountsStudioFirmSettings, firmDefaultNotes } from '@/lib/accounts-studio/firmSettings';

export const dynamic = 'force-dynamic';

/**
 * The engagement object is large and evolves with the UI (see
 * components/features/accounts-studio/types.ts). We store it verbatim in the
 * `data` jsonb column and only assert the handful of fields the API relies on,
 * so the client can extend the shape without a schema change here.
 */
const EngagementData = z
  .object({
    id: z.string().optional(),
    clientId: z.string().uuid().nullable().optional(),
    companyName: z.string().min(1).max(300),
    published: z.boolean().optional(),
    preparedBy: z.string().optional(),
  })
  .passthrough();

const CreateBody = z.object({ data: EngagementData });

// ── GET /api/accounts-studio/engagements ─────────────────────────────────────
// List this firm's engagements, most-recently-edited first.
export async function GET() {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  const supabase = createClient();
  const { data, error } = await supabase
    .from('accounts_studio_engagements')
    .select('id, data, created_by, updated_at')
    .eq('firm_id', ctx.firmId)
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const engagements = (data ?? []).map(row => ({
    id: row.id as string,
    data: { ...(row.data as Record<string, unknown>), id: row.id },
    updatedAt: row.updated_at as string,
    mine: row.created_by === ctx.userId,
  }));
  return NextResponse.json({ engagements });
}

// ── POST /api/accounts-studio/engagements ────────────────────────────────────
// Create a new engagement. Stamps preparedBy with the creating user's name.
export async function POST(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccessAccountsStudio(ctx.email)) return NextResponse.json({ error: 'Accounts Studio is not available for your account.' }, { status: 403 });

  let body: z.infer<typeof CreateBody>;
  try { body = CreateBody.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'Invalid payload', detail: String(e) }, { status: 400 }); }

  const supabase = createClient();

  // Author name for preparedBy (falls back to email, then a generic label).
  const { data: profile } = await supabase
    .from('users').select('full_name, email').eq('id', ctx.userId).maybeSingle();
  const authorName = (profile?.full_name as string | null)?.trim()
    || (profile?.email as string | null) || 'SMITH user';

  const clientId = (body.data.clientId as string | null | undefined) ?? null;
  const engagementData: Record<string, unknown> = { ...body.data, preparedBy: authorName };

  // Seed the firm's default notes (accountants' report, accountant details,
  // governing body) into the disclosures so house-style wording appears
  // automatically. Skips any already present by id.
  try {
    const settings = await getAccountsStudioFirmSettings(supabase, ctx.firmId);
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`;
    const defaults = firmDefaultNotes(settings, stamp);
    if (defaults.length) {
      const existing = (Array.isArray(engagementData.disclosures) ? engagementData.disclosures : []) as { id?: string }[];
      // Firm house-style overrides a generated section of the same id (e.g. the
      // accountants' report); otherwise it's appended.
      for (const d of defaults) {
        const idx = existing.findIndex(x => x.id === d.id);
        if (idx >= 0) existing[idx] = { ...existing[idx], ...d };
        else existing.push(d);
      }
      engagementData.disclosures = existing;
    }
  } catch { /* firm settings optional — never block creation */ }

  const { data, error } = await supabase
    .from('accounts_studio_engagements')
    .insert({
      firm_id: ctx.firmId,
      client_id: clientId,
      created_by: ctx.userId,
      data: engagementData,
      published: body.data.published ?? false,
    })
    .select('id, data, created_by, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    engagement: {
      id: data.id as string,
      data: { ...(data.data as Record<string, unknown>), id: data.id },
      updatedAt: data.updated_at as string,
      mine: true,
    },
  });
}
