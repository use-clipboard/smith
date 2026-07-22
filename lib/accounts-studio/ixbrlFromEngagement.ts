// Accounts Studio — map an Engagement to iXBRL, in one place.
//
// Both the Publish stage (the "Download (beta)" button) and the Companies House
// submit route must produce the SAME iXBRL from an engagement — otherwise the
// accountant reviews one document and files another. This is the single mapper.

import { buildIxbrl, ddmmyyyyToIso, type IxbrlFramework } from './ixbrl';
import type { Engagement, EntityType } from '@/components/features/accounts-studio/types';

/** Resolve the FRC framework entry point from the engagement's framework label. */
export function ixbrlFramework(framework: string): IxbrlFramework {
  return /105/.test(framework) ? 'frs105' : 'frs102-1a';
}

/**
 * Companies House FormSubmission CompanyType code for the entity.
 *
 * ⚠ These codes are best-known and must be confirmed against
 * FormSubmission-v2-11.xsd — the first CH validation response is the oracle.
 * Isolated here so a correction is a one-line change. 'EW' = England & Wales.
 */
export function chCompanyType(entityType: EntityType): string {
  switch (entityType) {
    case 'llp': return 'LLEW';
    default: return 'EW';
  }
}

/** Build the iXBRL accounts document for an engagement (or null if no statements). */
export function buildIxbrlFromEngagement(e: Engagement): string | null {
  if (!e.statements) return null;
  const ii = e.importInfo;
  return buildIxbrl({
    companyName: e.companyName,
    companyNumber: e.companyNumber,
    periodStartIso: ii?.from ?? ddmmyyyyToIso(e.periodStart),
    periodEndIso: ii?.to ?? ddmmyyyyToIso(e.periodEnd),
    priorStartIso: ii?.priorFrom ?? null,
    priorEndIso: ii?.priorTo ?? (e.comparativePeriod ? ddmmyyyyToIso(e.comparativePeriod) : null),
    framework: ixbrlFramework(e.framework),
    statements: e.statements,
  });
}
