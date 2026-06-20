import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase-server';

// GET /api/p/[token]/onboarding — public, no auth. Returns the matching
// onboarding form for the prospect (or null if none configured).
//
// Selection logic:
//   1. If the proposal pins a specific form (post_acceptance_onboarding_form_id)
//      and that form is still active, send exactly that one — the preparer's
//      explicit choice always wins.
//   2. Otherwise auto-pick the most-specific active form for this firm that
//      matches the proposal's accepted package and the prospect's client_type.
//      Priority: client_type match > is_default > any active form.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const service = createServiceClient();
  const { data: proposal } = await service
    .from('proposals')
    .select(`
      id, firm_id, status, post_acceptance_onboarding_form_id,
      prospect:proposal_prospects(client_type),
      line_items:proposal_line_items(service_id),
      response:proposal_onboarding_responses(submitted_at)
    `)
    .eq('public_token', params.token)
    .maybeSingle();
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (proposal.status !== 'accepted') {
    return NextResponse.json({ error: 'Onboarding is only available after the proposal is accepted.' }, { status: 400 });
  }
  if ((proposal.response as Array<{ submitted_at: string }>)?.length > 0) {
    return NextResponse.json({ alreadySubmitted: true });
  }

  // Fetch all active forms for the firm, then pick the best match server-side.
  const { data: forms } = await service
    .from('proposal_onboarding_forms')
    .select('*, fields:proposal_onboarding_form_fields(*)')
    .eq('firm_id', proposal.firm_id)
    .eq('active', true);

  const allForms = forms ?? [];

  // 1. Preparer pinned a specific form on the proposal — honour it if it's
  //    still active. This overrides the auto-scoring below.
  const pinnedId = (proposal as { post_acceptance_onboarding_form_id?: string | null }).post_acceptance_onboarding_form_id ?? null;
  if (pinnedId) {
    const pinned = allForms.find(f => f.id === pinnedId);
    if (pinned) {
      pinned.fields = ((pinned.fields ?? []) as Array<{ display_order: number }>).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
      return NextResponse.json({ form: pinned });
    }
    // Pinned form was deleted/deactivated — fall through to auto-selection.
  }

  const clientType = (proposal.prospect as { client_type?: string } | null)?.client_type ?? null;
  const proposalServiceIds = new Set(((proposal.line_items as Array<{ service_id: string | null }>) ?? []).map(li => li.service_id).filter(Boolean) as string[]);

  function score(f: typeof allForms[number]): number {
    let s = 0;
    if (f.client_type && f.client_type === clientType) s += 10;
    if (!f.client_type) s += 1;
    const filter = (f.service_filter as string[] | null) ?? [];
    if (filter.length > 0) {
      if (filter.some(id => proposalServiceIds.has(id))) s += 5;
      else s -= 100; // service filter set but no overlap — disqualify
    }
    if (f.is_default) s += 2;
    return s;
  }

  const matches = allForms.map(f => ({ form: f, score: score(f) })).filter(m => m.score >= 0).sort((a, b) => b.score - a.score);
  const chosen = matches[0]?.form ?? null;
  if (!chosen) return NextResponse.json({ form: null });

  // Sort fields
  chosen.fields = ((chosen.fields ?? []) as Array<{ display_order: number }>).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  return NextResponse.json({ form: chosen });
}
