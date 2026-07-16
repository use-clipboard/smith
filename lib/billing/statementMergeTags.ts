// Billing module — statement-email merge tags ({{double_braces}}).
// Mirrors invoiceMergeTags.ts; statement-specific (balance, period, as-at date).

export interface StatementMergeContext {
  client_name?: string | null;
  statement_date?: string | null;   // dd-mm-yyyy
  amount_due?: string | null;       // pre-formatted, e.g. "£1,572.00"
  period_from?: string | null;      // dd-mm-yyyy ('activity' mode)
  invoice_count?: string | null;    // open invoices on the statement
  firm_name?: string | null;
  portal_link?: string | null;
}

export interface StatementTagDef { tag: string; label: string; example: string }

export const STATEMENT_MERGE_TAGS: StatementTagDef[] = [
  { tag: '{{client_name}}',    label: 'Client name',      example: 'Northgate Joinery Ltd' },
  { tag: '{{statement_date}}', label: 'Statement date',   example: '31-07-2026' },
  { tag: '{{amount_due}}',     label: 'Balance due',      example: '£1,572.00' },
  { tag: '{{period_from}}',    label: 'Period from',      example: '01-05-2026' },
  { tag: '{{invoice_count}}',  label: 'Open invoices',    example: '3' },
  { tag: '{{firm_name}}',      label: 'Your firm name',   example: 'Marneros Marcus & Co' },
  { tag: '{{portal_link}}',    label: 'Pay/view link',    example: 'https://…/statement/…' },
];

export function resolveStatementMergeTags(template: string, ctx: StatementMergeContext): string {
  const values: Record<string, string> = {
    '{{client_name}}':    ctx.client_name    ?? '[Client name]',
    '{{statement_date}}': ctx.statement_date ?? '[Statement date]',
    '{{amount_due}}':     ctx.amount_due     ?? '[Balance due]',
    '{{period_from}}':    ctx.period_from    ?? '',
    '{{invoice_count}}':  ctx.invoice_count  ?? '0',
    '{{firm_name}}':      ctx.firm_name      ?? '[Your firm]',
    '{{portal_link}}':    ctx.portal_link    ?? '',
  };
  return template.replace(/\{\{[a-z_]+\}\}/g, m => values[m] ?? m);
}
