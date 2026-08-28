// Safety net for CH Secretarial refreshes: any company with an ACTIVE (or
// paused) CH-deadline task link must always be refreshed, so its linked task
// keeps auto-sliding / renewing — regardless of the firm's chosen refresh list
// (client list vs a curated custom list). Both the nightly cron and the manual
// refresh union these numbers into whatever list they were going to fetch.

import type { SupabaseClient } from '@supabase/supabase-js';

/** Raw company numbers (as stored) that have an active/paused deadline link. */
export async function getLinkedCompanyNumbers(supabase: SupabaseClient, firmId: string): Promise<string[]> {
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0, pages = 0; pages < 50; pages++) {
    const { data } = await supabase
      .from('ch_deadline_task_links')
      .select('linked_company_number')
      .eq('firm_id', firmId)
      .in('status', ['active', 'paused'])
      .range(from, from + PAGE - 1);
    const rows = (data ?? []) as { linked_company_number: string | null }[];
    for (const r of rows) if (r.linked_company_number?.trim()) out.add(r.linked_company_number.trim());
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return [...out];
}

/** Merge `extra` numbers into `base`, de-duplicating by normalised (8-char) form. */
export function unionCompanyNumbers(base: string[], extra: string[]): string[] {
  const norm = (n: string) => n.trim().toUpperCase().padStart(8, '0');
  const have = new Set(base.map(norm));
  const merged = [...base];
  for (const n of extra) {
    if (!n?.trim()) continue;
    const k = norm(n);
    if (!have.has(k)) { have.add(k); merged.push(n); }
  }
  return merged;
}
