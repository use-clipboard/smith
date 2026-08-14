import { NextRequest, NextResponse } from 'next/server';
import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';
import { getRefreshedGmailClient } from '@/lib/gmail';
import type { EmailRule } from '@/app/api/email/rules/route';

// Applying a rule to existing mail is a whole-mailbox sweep (list + fetch +
// batch-modify), so give it room beyond the default.
export const maxDuration = 120;

// Cap how many messages a single "apply to existing" sweep will touch, so a
// broad rule can't run away. Reported back so the UI can say "first N".
const MAX_MATCHES = 500;
// The exact-operator post-filter fetches metadata per candidate (one Gmail call
// each), so it gets a tighter cap than the fast contains path.
const MAX_EXACT_SCAN = 200;

function quote(v: string): string { const t = v.trim(); return /\s/.test(t) ? `"${t}"` : t; }

// Translate a rule condition into a Gmail search query. Gmail search is token/
// prefix based, so it can't express equals/starts_with/ends_with exactly — those
// use this as a candidate query and are then post-filtered precisely below.
function buildQuery(field: EmailRule['condition_field'], value: string): string {
  const q = quote(value);
  switch (field) {
    case 'from':    return `from:${q}`;
    case 'to':      return `to:${q}`;
    case 'subject': return `subject:${q}`;
    case 'has_words':
    default:        return q;
  }
}

// POST /api/email/rules/[id]/apply — run this user's rule across their existing
// mail and apply its action to every match. Returns { applied, capped }.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const supabase = createClient();
  const { data: rule } = await supabase
    .from('email_rules')
    .select('*')
    .eq('id', params.id)
    .eq('firm_id', ctx.firmId)
    .eq('created_by', ctx.userId)   // per-user: only your own rules
    .single();
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
  const r = rule as EmailRule;

  const { data: connection } = await supabase
    .from('email_connections')
    .select('refresh_token')
    .eq('user_id', ctx.userId)
    .single();
  if (!connection?.refresh_token) return NextResponse.json({ error: 'Gmail not connected' }, { status: 400 });

  try {
    const { gmail } = await getRefreshedGmailClient(connection.refresh_token);
    const value = String(r.condition_value ?? '');
    // Default scope deliberately excludes Spam/Trash, so we never re-act on mail
    // the user already binned.
    const query = buildQuery(r.condition_field, value);

    // Collect candidate message ids (paginated, capped).
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const res = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 500, pageToken });
      for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < MAX_MATCHES);
    const capped = ids.length > MAX_MATCHES;
    let targetIds = ids.slice(0, MAX_MATCHES);

    // For exact operators, verify each candidate precisely (Gmail's search only
    // approximates them). Matches the going-forward matchesRule semantics.
    if (r.condition_operator !== 'contains') {
      const val = value.trim().toLowerCase();
      const kept: string[] = [];
      for (const id of targetIds.slice(0, MAX_EXACT_SCAN)) {
        const m = await gmail.users.messages
          .get({ userId: 'me', id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] })
          .catch(() => null);
        if (!m) continue;
        const headers = m.data.payload?.headers ?? [];
        const h = (n: string) => (headers.find(x => (x.name ?? '').toLowerCase() === n)?.value ?? '').toLowerCase();
        let target = '';
        switch (r.condition_field) {
          case 'from':     target = h('from'); break;
          case 'to':       target = h('to'); break;
          case 'subject':  target = h('subject'); break;
          case 'has_words': target = `${h('subject')} ${(m.data.snippet ?? '').toLowerCase()}`; break;
        }
        const ok =
          r.condition_operator === 'equals'      ? target === val :
          r.condition_operator === 'starts_with' ? target.startsWith(val) :
          r.condition_operator === 'ends_with'   ? target.endsWith(val) :
          target.includes(val);
        if (ok) kept.push(id);
      }
      targetIds = kept;
    }

    if (targetIds.length === 0) return NextResponse.json({ applied: 0, capped: false });

    // Trash has no batch endpoint — loop (best-effort, capped by MAX_MATCHES).
    if (r.action_type === 'trash') {
      let n = 0;
      for (const id of targetIds) {
        await gmail.users.messages.trash({ userId: 'me', id }).then(() => { n++; }).catch(() => {});
      }
      return NextResponse.json({ applied: n, capped });
    }

    // Everything else is a label change — batchModify handles up to 1000 at once.
    const mod: { addLabelIds?: string[]; removeLabelIds?: string[] } = {};
    if (r.action_type === 'archive') mod.removeLabelIds = ['INBOX'];
    else if (r.action_type === 'mark_read') mod.removeLabelIds = ['UNREAD'];
    else if (r.action_type === 'star') mod.addLabelIds = ['STARRED'];
    else if (r.action_type === 'label' && r.action_label_id) mod.addLabelIds = [r.action_label_id];

    if (!mod.addLabelIds && !mod.removeLabelIds) return NextResponse.json({ applied: 0, capped });

    for (let i = 0; i < targetIds.length; i += 1000) {
      await gmail.users.messages.batchModify({ userId: 'me', requestBody: { ids: targetIds.slice(i, i + 1000), ...mod } });
    }
    return NextResponse.json({ applied: targetIds.length, capped });
  } catch (err) {
    console.error('POST /api/email/rules/[id]/apply', err);
    return NextResponse.json({ error: 'Failed to apply the rule to existing emails' }, { status: 500 });
  }
}
