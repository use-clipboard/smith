/**
 * Email merge tags for task reminder emails.
 * Tags use {{double_braces}} syntax and are resolved at send time
 * from the task's linked client data and task metadata.
 */

export interface MergeTagContext {
  // Client fields
  client_name?: string | null;
  client_ref?: string | null;
  business_type?: string | null;
  contact_email?: string | null;
  contact_number?: string | null;
  address?: string | null;
  year_end?: string | null;
  vat_number?: string | null;
  companies_house_id?: string | null;
  utr_number?: string | null;
  paye_reference?: string | null;
  // Task fields
  task_title?: string | null;
  step_title?: string | null;
  due_date?: string | null;
  // Recipient
  recipient_name?: string | null;
}

export interface MergeTagDefinition {
  tag: string;           // e.g. "{{client_name}}"
  label: string;         // e.g. "Client Name"
  group: 'Client' | 'Task' | 'Recipient';
  example: string;       // e.g. "Acme Ltd"
}

export const MERGE_TAGS: MergeTagDefinition[] = [
  // Client
  { tag: '{{client_name}}',      label: 'Client Name',        group: 'Client',    example: 'Acme Ltd' },
  { tag: '{{client_ref}}',       label: 'Client Ref',         group: 'Client',    example: 'ACM001' },
  { tag: '{{business_type}}',    label: 'Business Type',      group: 'Client',    example: 'Limited Company' },
  { tag: '{{year_end}}',         label: 'Year End',           group: 'Client',    example: '31 MAR' },
  { tag: '{{vat_number}}',       label: 'VAT Number',         group: 'Client',    example: 'GB123456789' },
  { tag: '{{companies_house_id}}', label: 'Company Number',   group: 'Client',    example: '12345678' },
  { tag: '{{utr_number}}',       label: 'UTR Number',         group: 'Client',    example: '1234567890' },
  { tag: '{{paye_reference}}',   label: 'PAYE Reference',     group: 'Client',    example: '123/AB456' },
  { tag: '{{contact_email}}',    label: 'Client Email',       group: 'Client',    example: 'contact@acme.co.uk' },
  { tag: '{{contact_number}}',   label: 'Client Phone',       group: 'Client',    example: '01234 567890' },
  { tag: '{{address}}',          label: 'Client Address',     group: 'Client',    example: '1 High Street, London' },
  // Task
  { tag: '{{task_title}}',       label: 'Task Title',         group: 'Task',      example: 'VAT Return Q1 2025' },
  { tag: '{{step_title}}',       label: 'Step Title',         group: 'Task',      example: 'Review VAT figures' },
  { tag: '{{due_date}}',         label: 'Due Date',           group: 'Task',      example: '31 January 2025' },
  // Recipient
  { tag: '{{recipient_name}}',   label: 'Recipient Name',     group: 'Recipient', example: 'John Smith' },
];

/** Replace all {{tags}} in a string with their resolved values from context. */
export function resolveMergeTags(template: string, ctx: MergeTagContext): string {
  const BUSINESS_TYPE_LABELS: Record<string, string> = {
    limited_company: 'Limited Company',
    sole_trader:     'Sole Trader',
    partnership:     'Partnership',
    llp:             'LLP',
    trust:           'Trust',
    charity:         'Charity',
    individual:      'Individual',
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return null;
    try {
      return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch { return d; }
  };

  const values: Record<string, string> = {
    '{{client_name}}':        ctx.client_name       ?? '[Client Name]',
    '{{client_ref}}':         ctx.client_ref         ?? '[Client Ref]',
    '{{business_type}}':      ctx.business_type ? (BUSINESS_TYPE_LABELS[ctx.business_type] ?? ctx.business_type) : '[Business Type]',
    '{{year_end}}':           ctx.year_end           ?? '[Year End]',
    '{{vat_number}}':         ctx.vat_number         ?? '[VAT Number]',
    '{{companies_house_id}}': ctx.companies_house_id ?? '[Company Number]',
    '{{utr_number}}':         ctx.utr_number         ?? '[UTR Number]',
    '{{paye_reference}}':     ctx.paye_reference     ?? '[PAYE Reference]',
    '{{contact_email}}':      ctx.contact_email      ?? '[Client Email]',
    '{{contact_number}}':     ctx.contact_number     ?? '[Client Phone]',
    '{{address}}':            ctx.address            ?? '[Address]',
    '{{task_title}}':         ctx.task_title         ?? '[Task Title]',
    '{{step_title}}':         ctx.step_title         ?? '[Step Title]',
    '{{due_date}}':           formatDate(ctx.due_date) ?? '[Due Date]',
    '{{recipient_name}}':     ctx.recipient_name     ?? '[Recipient Name]',
  };

  return template.replace(/\{\{[a-z_]+\}\}/g, match => values[match] ?? match);
}
