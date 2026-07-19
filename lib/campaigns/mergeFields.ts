// Campaign personalisation / merge tags.
//
// Campaigns use dotted, namespaced tags — {{client.first_name}},
// {{company.confirmation_statement_due}}, {{billing.balance_outstanding}} — with
// an optional fallback:  {{client.first_name | default: "there"}}.
//
// This is distinct from lib/emailMergeTags.ts (flat {{client_name}} tags used by
// task reminders); campaigns need per-recipient data resolved from several
// sources and a fallback syntax, so they get their own resolver.

export interface CampaignMergeTagDef {
  tag: string;        // the path, e.g. 'client.first_name'
  label: string;
  group: 'Client' | 'Company' | 'Billing';
  example: string;
}

export const CAMPAIGN_MERGE_TAGS: CampaignMergeTagDef[] = [
  { tag: 'client.first_name',     label: 'First name',            group: 'Client',  example: 'Sarah' },
  { tag: 'client.full_name',      label: 'Full name',             group: 'Client',  example: 'Sarah Jones' },
  { tag: 'client.business_name',  label: 'Business name',         group: 'Client',  example: 'Acme Ltd' },
  { tag: 'client.reference',      label: 'Client reference',      group: 'Client',  example: 'ACM001' },
  { tag: 'client.entity_type',    label: 'Entity type',           group: 'Client',  example: 'Limited Company' },
  { tag: 'client.year_end',       label: 'Year end',              group: 'Client',  example: '31 MAR' },
  { tag: 'client.account_manager',label: 'Account manager',       group: 'Client',  example: 'Christos' },
  { tag: 'client.vat_number',     label: 'VAT number',            group: 'Client',  example: 'GB123456789' },
  { tag: 'company.company_number',label: 'Company number',        group: 'Company', example: '12345678' },
  { tag: 'company.confirmation_statement_due', label: 'Confirmation statement due', group: 'Company', example: '5 May 2026' },
  { tag: 'company.accounts_due',  label: 'Accounts due',          group: 'Company', example: '31 Dec 2026' },
  { tag: 'billing.balance_outstanding', label: 'Outstanding balance', group: 'Billing', example: '£1,240.00' },
];

/** Everything the resolver needs to fill in a recipient's tags. All optional. */
export interface CampaignMergeSource {
  name?: string | null;
  first_name?: string | null;
  business_name?: string | null;
  reference?: string | null;
  entity_type?: string | null;    // human label, e.g. 'Limited Company'
  year_end?: string | null;
  account_manager?: string | null;
  vat_number?: string | null;
  company_number?: string | null;
  confirmation_statement_due?: string | null;  // formatted date
  accounts_due?: string | null;                 // formatted date
  balance_outstanding?: string | null;          // formatted £ string
}

/** Build the tag→value map for one recipient. Missing values become '' so the
 *  fallback (or nothing) is used at resolve time. */
export function buildMergeData(src: CampaignMergeSource): Record<string, string> {
  return {
    'client.first_name':     src.first_name ?? '',
    'client.full_name':      src.name ?? '',
    'client.business_name':  src.business_name ?? src.name ?? '',
    'client.reference':      src.reference ?? '',
    'client.entity_type':    src.entity_type ?? '',
    'client.year_end':       src.year_end ?? '',
    'client.account_manager':src.account_manager ?? '',
    'client.vat_number':     src.vat_number ?? '',
    'company.company_number':src.company_number ?? '',
    'company.confirmation_statement_due': src.confirmation_statement_due ?? '',
    'company.accounts_due':  src.accounts_due ?? '',
    'billing.balance_outstanding': src.balance_outstanding ?? '',
  };
}

const TAG_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*(?:\|\s*default:\s*"([^"]*)")?\s*\}\}/gi;

/** Replace all {{tags}} (with optional | default: "…") using the recipient's data. */
export function resolveCampaignMergeTags(template: string, data: Record<string, string>): string {
  return template.replace(TAG_RE, (_m, path: string, fallback: string | undefined) => {
    const val = data[path];
    if (val && val.trim() !== '') return val;
    return fallback ?? '';
  });
}

/** Derive a first name from a full/contact name (best-effort). */
export function firstNameFrom(name?: string | null): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  // For company-style names ("Acme Ltd") the first token isn't a person — but we
  // can't tell reliably, so callers should prefer a key-contact name where they
  // have one. Here we just take the first whitespace-delimited token.
  return trimmed.split(/\s+/)[0];
}

/** List of tag paths a template references, and which have no data + no fallback
 *  (i.e. would render blank). Used by the pre-send merge-field validation. */
export function findUnresolvedTags(template: string, data: Record<string, string>): string[] {
  const missing: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(TAG_RE.source, 'gi');
  while ((m = re.exec(template)) !== null) {
    const path = m[1];
    const hasFallback = m[2] !== undefined;
    const val = data[path];
    if ((!val || val.trim() === '') && !hasFallback) missing.push(path);
  }
  return Array.from(new Set(missing));
}
