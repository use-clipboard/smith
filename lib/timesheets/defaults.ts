// Built-in defaults for the Timesheets module — the departments and work
// activities a firm starts with (editable in Settings → Timesheets). These are
// sensible defaults, not demo data.

import type { TsActivity } from './types';

export const DEPARTMENTS: string[] = [
  'Accounts', 'Tax', 'Bookkeeping', 'Audit', 'Advisory', 'Payroll',
];

export const DEFAULT_ACTIVITIES: TsActivity[] = [
  { id: 'a-accprep', label: 'Accounts preparation',    type: 'billable',     department: 'Accounts' },
  { id: 'a-review',  label: 'Review and analysis',     type: 'billable',     department: 'Accounts' },
  { id: 'a-vat',     label: 'VAT return',              type: 'billable',     department: 'Bookkeeping' },
  { id: 'a-book',    label: 'Bookkeeping & data entry', type: 'billable',    department: 'Bookkeeping' },
  { id: 'a-tax',     label: 'Tax computation',         type: 'billable',     department: 'Tax' },
  { id: 'a-plan',    label: 'Tax planning',            type: 'billable',     department: 'Tax' },
  { id: 'a-audit',   label: 'Audit fieldwork',         type: 'billable',     department: 'Audit' },
  { id: 'a-advis',   label: 'Advisory & forecasting',  type: 'billable',     department: 'Advisory' },
  { id: 'a-payroll', label: 'Payroll run',             type: 'billable',     department: 'Payroll' },
  { id: 'a-meeting', label: 'Client meeting',          type: 'billable',     department: 'Accounts' },
  { id: 'a-email',   label: 'Client email & queries',  type: 'non_billable', department: 'Accounts' },
  { id: 'a-admin',   label: 'Admin',                   type: 'non_billable', department: 'Accounts' },
  { id: 'a-train',   label: 'Training & CPD',          type: 'internal',     department: 'Advisory' },
  { id: 'a-intmtg',  label: 'Internal meeting',        type: 'internal',     department: 'Advisory' },
  { id: 'a-bd',      label: 'Business development',     type: 'internal',     department: 'Advisory' },
];
