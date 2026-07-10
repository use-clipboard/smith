import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { createClient, createServiceClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { getUserMiddleCategories } from '@/lib/emailTriageCategories';
import { UNTRIAGED_KEY, COMPLETED_KEY, type CategoryDef } from '@/components/features/email/emailCategories';

// GET  → the user's ordered MIDDLE triage categories (defaults if uncustomised).
// PUT  → replace them. Categories removed by the save have their filed emails
//        dropped back to Untriaged (per-user), so nothing is silently lost.

export async function GET(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ error: 'Module not active' }, { status: 403 });

  // ?countFor=<key> → how many of this user's emails are filed under that
  // category (used by the delete dialog to offer "move them to …").
  const countFor = new URL(req.url).searchParams.get('countFor');
  if (countFor) {
    const service = createServiceClient();
    const { count } = await service
      .from('email_message_triage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', ctx.userId)
      .eq('category', countFor);
    return NextResponse.json({ count: count ?? 0 });
  }

  const supabase = createClient();
  const middle = await getUserMiddleCategories(supabase, ctx.userId);
  return NextResponse.json({ middle });
}

const CatSchema = z.object({
  key:           z.string().trim().max(64).optional(),
  label:         z.string().trim().min(1, 'Name is required').max(40),
  iconName:      z.string().trim().min(1).max(40),
  color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a hex value'),
  aiDescription: z.string().trim().max(300).optional().default(''),
});
const BodySchema = z.object({
  middle: z.array(CatSchema).max(24),
  // Optional { deletedKey: destinationKey } — where to move a deleted category's
  // filed emails. Destination may be another category key, 'untriaged', or
  // 'completed'. Anything missing/invalid defaults to Untriaged.
  reassign: z.record(z.string(), z.string()).optional(),
});

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'cat';

export async function PUT(req: NextRequest) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!ctx.activeModules.includes('email-triage')) return NextResponse.json({ error: 'Module not active' }, { status: 403 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });

  // Assign stable keys (keep existing ones; generate for new categories) and
  // guard the reserved anchor keys + duplicates.
  const taken = new Set<string>([UNTRIAGED_KEY, COMPLETED_KEY]);
  const middle: CategoryDef[] = [];
  for (const c of parsed.data.middle) {
    let key = (c.key ?? '').trim();
    if (key === UNTRIAGED_KEY || key === COMPLETED_KEY) {
      return NextResponse.json({ error: 'Those category names are reserved.' }, { status: 400 });
    }
    if (!key || taken.has(key)) {
      const base = `c_${slugify(c.label)}`;
      key = base;
      while (taken.has(key)) key = `${base}_${randomBytes(2).toString('hex')}`;
    }
    taken.add(key);
    middle.push({ key, label: c.label, iconName: c.iconName, color: c.color, aiDescription: c.aiDescription ?? '' });
  }

  const supabase = createClient();

  // Which category keys existed before this save? Anything dropped has its
  // filed emails reset to Untriaged.
  const previous = await getUserMiddleCategories(supabase, ctx.userId);
  const nextKeys = new Set(middle.map(c => c.key));
  const removed = previous.map(c => c.key).filter(k => !nextKeys.has(k));

  const { error: saveErr } = await supabase
    .from('users')
    .update({ email_triage_categories: middle })
    .eq('id', ctx.userId);
  if (saveErr) {
    console.error('[triage-category-config] save', saveErr);
    return NextResponse.json({ error: 'Failed to save categories' }, { status: 500 });
  }

  if (removed.length > 0) {
    // email_message_triage is service-role only (RLS). For each removed
    // category, move its emails to the chosen destination — or, when that's
    // Untriaged (or unset/invalid), delete the rows (untriaged = no row).
    const service = createServiceClient();
    const reassign = parsed.data.reassign ?? {};
    const validDest = new Set<string>([...nextKeys, UNTRIAGED_KEY, COMPLETED_KEY]);
    const now = new Date().toISOString();
    for (const key of removed) {
      const wanted = reassign[key];
      const dest = wanted && validDest.has(wanted) ? wanted : UNTRIAGED_KEY;
      if (dest === UNTRIAGED_KEY) {
        const { error } = await service.from('email_message_triage').delete().eq('user_id', ctx.userId).eq('category', key);
        if (error) console.error('[triage-category-config] delete removed', key, error);
      } else {
        const { error } = await service.from('email_message_triage').update({ category: dest, updated_at: now }).eq('user_id', ctx.userId).eq('category', key);
        if (error) console.error('[triage-category-config] move removed', key, '->', dest, error);
      }
    }
  }

  return NextResponse.json({ middle, reassigned: removed });
}
