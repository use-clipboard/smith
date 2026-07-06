// Accounts Studio — Companies House lookup (client side).
//
// Wraps GET /api/accounts-studio/company-lookup and applies the result onto an
// engagement (real company number, entity type, registered office, directors,
// Companies House accounts-filing deadline).

import type { Engagement, EntityType } from './types';

export interface StudioCompany {
  companyNumber: string;
  companyName: string;
  entityType: EntityType;
  chType: string;
  status: string;
  incorporationDate: string | null; // dd-mm-yyyy
  registeredOffice: string | null;
  sicCodes: string[];
  accountsNextDue: string | null;   // dd-mm-yyyy
  directors: string[];
}

export type LookupResult =
  | { found: true; company: StudioCompany }
  | { found: false; reason: 'no_number' | 'no_api_key' | 'not_found' | 'rate_limited' | 'bad_key' | 'error' };

export async function lookupCompany(params: { clientId?: string | null; number?: string }): Promise<LookupResult> {
  const qs = new URLSearchParams();
  if (params.number) qs.set('number', params.number);
  else if (params.clientId) qs.set('clientId', params.clientId);
  else return { found: false, reason: 'no_number' };
  try {
    const r = await fetch(`/api/accounts-studio/company-lookup?${qs.toString()}`);
    const d = await r.json();
    if (d.found) return { found: true, company: d.company as StudioCompany };
    return { found: false, reason: (d.reason ?? 'error') };
  } catch {
    return { found: false, reason: 'error' };
  }
}

/** A friendly one-liner for a non-found lookup. */
export function lookupMessage(reason: Exclude<LookupResult, { found: true }>['reason']): string {
  switch (reason) {
    case 'no_number':    return 'No Companies House number on this client record.';
    case 'no_api_key':   return 'No Companies House API key configured for the firm (Settings → CH Secretarial).';
    case 'not_found':    return 'No company found for that number on Companies House.';
    case 'rate_limited': return 'Companies House is rate-limiting requests — try again shortly.';
    case 'bad_key':      return 'The Companies House API key was rejected — check it in Settings.';
    default:             return 'Companies House lookup failed — please try again.';
  }
}

/** Merge CH company data onto an engagement (metadata + filing deadline). */
export function applyCompany(e: Engagement, c: StudioCompany): Engagement {
  const next: Engagement = {
    ...e,
    companyNumber: c.companyNumber || e.companyNumber,
    entityType: c.entityType as EntityType,
    registeredOffice: c.registeredOffice,
    incorporationDate: c.incorporationDate,
    sicCodes: c.sicCodes,
    directors: c.directors,
    chLinked: true,
    // CH's filing deadline is authoritative when present.
    accountsDue: c.accountsNextDue ?? e.accountsDue,
    chDeadline: c.accountsNextDue ?? e.chDeadline,
  };

  // Refresh the Directors' report note with the real names, but only if it
  // hasn't been edited (a single seed version in history).
  if (c.directors.length) {
    next.disclosures = e.disclosures.map(d => {
      if (d.id !== 'directors-report') return d;
      if (d.history.length > 1) return d; // user-touched — leave alone
      const list = c.directors.join(', ');
      const content = `<h3>Directors' report</h3>`
        + `<p>The directors present their report and the financial statements for the year then ended.</p>`
        + `<p><strong>Principal activity.</strong> The principal activity of the company during the year is set out below — please confirm.</p>`
        + `<p><strong>Directors.</strong> The directors who served during the period were ${list}.</p>`;
      return { ...d, content, status: 'needs-review' as const };
    });
  }
  return next;
}
