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
 * Companies House FormSubmission `CompanyType` code — the country of
 * incorporation + entity classification. Valid values per FormSubmission-v2-11
 * .xsd: EW (England & Wales), SC (Scotland), NI (Northern Ireland), R (older NI),
 * OC (E&W LLP), SO (Scottish LLP), NC (NI LLP). Jurisdiction is read from the
 * company-number prefix (SCxxxxxx / NIxxxxxx / OCxxxxxx / SOxxxxxx / NCxxxxxx);
 * plain-numeric numbers are England & Wales.
 */
export function chCompanyType(entityType: EntityType, companyNumber: string): string {
  const p = (companyNumber ?? '').trim().toUpperCase();
  const isLlp = entityType === 'llp';
  if (p.startsWith('SO')) return 'SO';
  if (p.startsWith('NC')) return 'NC';
  if (p.startsWith('OC')) return 'OC';
  if (p.startsWith('SC')) return isLlp ? 'SO' : 'SC';
  if (p.startsWith('NI') || p.startsWith('R')) return isLlp ? 'NC' : 'NI';
  return isLlp ? 'OC' : 'EW';
}

/** Firm-level options for the iXBRL that don't live on the engagement itself. */
export interface IxbrlFirmOptions {
  /** True when the firm attaches an accountant's report (→ audit-exempt WITH
   *  report). Derived from the Accounts Studio firm settings. */
  hasAccountantsReport?: boolean;
  /** Override the average number of employees (e.g. from the filing panel before
   *  the engagement autosave lands). Falls back to the engagement value. */
  averageEmployees?: number | null;
}

/** Build the iXBRL accounts document for an engagement (or null if no statements). */
export function buildIxbrlFromEngagement(e: Engagement, opts: IxbrlFirmOptions = {}): string | null {
  if (!e.statements) return null;
  const ii = e.importInfo;
  const directors = (e.directors ?? []).filter(Boolean);
  const signatory = (e.signatory && directors.includes(e.signatory)) ? e.signatory : directors[0] ?? null;
  return buildIxbrl({
    companyName: e.companyName,
    companyNumber: e.companyNumber,
    periodStartIso: ii?.from ?? ddmmyyyyToIso(e.periodStart),
    periodEndIso: ii?.to ?? ddmmyyyyToIso(e.periodEnd),
    priorStartIso: ii?.priorFrom ?? null,
    priorEndIso: ii?.priorTo ?? (e.comparativePeriod ? ddmmyyyyToIso(e.comparativePeriod) : null),
    framework: ixbrlFramework(e.framework),
    statements: e.statements,
    // CH filing metadata, wired to real data:
    signatory,
    approvalDateIso: e.approvedAt ? e.approvedAt.slice(0, 10) : null,
    dormant: e.dormant,
    averageEmployees: opts.averageEmployees ?? e.averageEmployees ?? 0,
    hasAccountantsReport: opts.hasAccountantsReport ?? false,
  });
}
