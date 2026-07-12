// Billing module — invoice-email merge tags ({{double_braces}}), resolved at
// send time from the invoice + client + firm. Mirrors lib/emailMergeTags.ts but
// billing-specific (invoice number, amounts, due date, portal link).

export interface InvoiceMergeContext {
  client_name?: string | null;
  invoice_number?: string | null;
  invoice_total?: string | null;   // pre-formatted, e.g. "£1,200.00"
  amount_due?: string | null;      // pre-formatted
  issue_date?: string | null;      // dd-mm-yyyy
  due_date?: string | null;        // dd-mm-yyyy
  firm_name?: string | null;
  portal_link?: string | null;
}

export interface MergeTagDef { tag: string; label: string; example: string }

export const INVOICE_MERGE_TAGS: MergeTagDef[] = [
  { tag: '{{client_name}}',    label: 'Client name',    example: 'Acme Ltd' },
  { tag: '{{invoice_number}}', label: 'Invoice number', example: 'INV-0001' },
  { tag: '{{invoice_total}}',  label: 'Invoice total',  example: '£1,200.00' },
  { tag: '{{amount_due}}',     label: 'Amount due',     example: '£1,200.00' },
  { tag: '{{issue_date}}',     label: 'Issue date',     example: '02-06-2026' },
  { tag: '{{due_date}}',       label: 'Due date',       example: '16-06-2026' },
  { tag: '{{firm_name}}',      label: 'Your firm name', example: 'Marneros Marcus & Co' },
  { tag: '{{portal_link}}',    label: 'Pay/view link',  example: 'https://…/statement/…' },
];

/** Replace all {{tags}} in a template with resolved values. */
export function resolveInvoiceMergeTags(template: string, ctx: InvoiceMergeContext): string {
  const values: Record<string, string> = {
    '{{client_name}}':    ctx.client_name    ?? '[Client name]',
    '{{invoice_number}}': ctx.invoice_number ?? '[Invoice number]',
    '{{invoice_total}}':  ctx.invoice_total  ?? '[Invoice total]',
    '{{amount_due}}':     ctx.amount_due     ?? '[Amount due]',
    '{{issue_date}}':     ctx.issue_date     ?? '[Issue date]',
    '{{due_date}}':       ctx.due_date       ?? '[Due date]',
    '{{firm_name}}':      ctx.firm_name      ?? '[Your firm]',
    '{{portal_link}}':    ctx.portal_link    ?? '',
  };
  return template.replace(/\{\{[a-z_]+\}\}/g, m => values[m] ?? m);
}
