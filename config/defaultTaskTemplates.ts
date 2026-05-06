import type { DefaultTemplate } from '@/types';

const X = 220; // centre column x for linear steps
const Y = 200; // vertical step spacing

export const DEFAULT_TASK_TEMPLATES: DefaultTemplate[] = [
  // ─── VAT Return ──────────────────────────────────────────────────────────────
  {
    id: 'default-vat-return',
    name: 'VAT Return',
    description: 'Full VAT return workflow from document collection through HMRC submission.',
    category: 'vat',
    recurrence_type: 'quarterly',
    estimated_duration_days: 14,
    steps: [
      { step_key: 's1', title: 'Request documents from client', description: 'Ask the client to provide bank statements, invoices and receipts for the period.', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Client provides documents', description: 'Wait for the client to send all relevant documents.', assignee_role: 'client', email_reminder_enabled: false, position_x: X, position_y: Y },
      { step_key: 's3', title: 'Process bank statements', description: 'Extract transactions from bank statements.', assignee_role: 'team_member', tool_module_id: 'bank-to-csv', time_estimate_minutes: 30, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Analyse invoices & receipts', description: 'Code all invoices and receipts to the correct accounts.', assignee_role: 'team_member', tool_module_id: 'full-analysis', time_estimate_minutes: 60, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Prepare VAT return', description: 'Reconcile VAT and prepare the return figures.', assignee_role: 'team_member', time_estimate_minutes: 45, position_x: X, position_y: Y * 4 },
      { step_key: 's6', title: 'Manager review', description: 'Senior staff member reviews the return before client sign-off.', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: X, position_y: Y * 5 },
      { step_key: 's7', title: 'Send to client for approval', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 6 },
      { step_key: 's8', title: 'Client approves return', assignee_role: 'client', position_x: X, position_y: Y * 7 },
      { step_key: 's9', title: 'Submit to HMRC', assignee_role: 'team_member', time_estimate_minutes: 20, position_x: X, position_y: Y * 8 },
      { step_key: 's10', title: 'Advise client of payment due', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 10, position_x: X, position_y: Y * 9 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
      { from_step_key: 's5', to_step_key: 's6', condition_type: 'on_complete' },
      { from_step_key: 's6', to_step_key: 's7', condition_type: 'on_complete' },
      { from_step_key: 's7', to_step_key: 's8', condition_type: 'on_complete' },
      { from_step_key: 's8', to_step_key: 's9', condition_type: 'on_complete' },
      { from_step_key: 's9', to_step_key: 's10', condition_type: 'on_complete' },
    ],
  },

  // ─── Year End Accounts (Limited Company) ────────────────────────────────────
  {
    id: 'default-year-end-ltd',
    name: 'Year End Accounts (Ltd)',
    description: 'Full year-end workflow for limited companies including HMRC and Companies House filing.',
    category: 'year_end',
    recurrence_type: 'annually',
    estimated_duration_days: 30,
    steps: [
      { step_key: 's1', title: 'Request year-end documents', description: 'Request bank statements, invoices, payroll records and any other relevant documents.', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 20, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Client provides all documents', assignee_role: 'client', position_x: X, position_y: Y },
      { step_key: 's3', title: 'Process bank statements', assignee_role: 'team_member', tool_module_id: 'bank-to-csv', time_estimate_minutes: 45, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Analyse invoices & receipts', assignee_role: 'team_member', tool_module_id: 'full-analysis', time_estimate_minutes: 90, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Prepare draft accounts', assignee_role: 'team_member', tool_module_id: 'final-accounts', time_estimate_minutes: 120, position_x: X, position_y: Y * 4 },
      { step_key: 's6', title: 'Manager review', assignee_role: 'team_member', time_estimate_minutes: 60, position_x: X, position_y: Y * 5 },
      { step_key: 's7', title: 'Send draft to client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 6 },
      { step_key: 's8', title: 'Director approval meeting', assignee_role: 'client', time_estimate_minutes: 60, position_x: X, position_y: Y * 7 },
      { step_key: 's9', title: 'File accounts with Companies House', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: 80, position_y: Y * 8 },
      { step_key: 's10', title: 'File CT600 with HMRC', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: 360, position_y: Y * 8 },
      { step_key: 's11', title: 'Invoice client & close job', assignee_role: 'team_member', time_estimate_minutes: 15, position_x: X, position_y: Y * 9 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
      { from_step_key: 's5', to_step_key: 's6', condition_type: 'on_complete' },
      { from_step_key: 's6', to_step_key: 's7', condition_type: 'on_complete' },
      { from_step_key: 's7', to_step_key: 's8', condition_type: 'on_complete' },
      { from_step_key: 's8', to_step_key: 's9', label: 'Parallel', condition_type: 'on_complete' },
      { from_step_key: 's8', to_step_key: 's10', label: 'Parallel', condition_type: 'on_complete' },
      { from_step_key: 's9', to_step_key: 's11', condition_type: 'on_complete' },
      { from_step_key: 's10', to_step_key: 's11', condition_type: 'on_complete' },
    ],
  },

  // ─── Year End Accounts (Sole Trader) ────────────────────────────────────────
  {
    id: 'default-year-end-sole-trader',
    name: 'Year End Accounts (Sole Trader)',
    description: 'Year-end workflow for sole traders including SA supplementary pages.',
    category: 'year_end',
    recurrence_type: 'annually',
    estimated_duration_days: 21,
    steps: [
      { step_key: 's1', title: 'Request year-end documents', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 20, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Client provides documents', assignee_role: 'client', position_x: X, position_y: Y },
      { step_key: 's3', title: 'Process bank statements', assignee_role: 'team_member', tool_module_id: 'bank-to-csv', time_estimate_minutes: 45, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Analyse invoices & receipts', assignee_role: 'team_member', tool_module_id: 'full-analysis', time_estimate_minutes: 90, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Prepare accounts & SA supplementary', assignee_role: 'team_member', tool_module_id: 'final-accounts', time_estimate_minutes: 90, position_x: X, position_y: Y * 4 },
      { step_key: 's6', title: 'Manager review', assignee_role: 'team_member', time_estimate_minutes: 45, position_x: X, position_y: Y * 5 },
      { step_key: 's7', title: 'Send to client for approval', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 6 },
      { step_key: 's8', title: 'Client approves accounts', assignee_role: 'client', position_x: X, position_y: Y * 7 },
      { step_key: 's9', title: 'File self assessment return', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: X, position_y: Y * 8 },
      { step_key: 's10', title: 'Advise tax payment dates', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 9 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
      { from_step_key: 's5', to_step_key: 's6', condition_type: 'on_complete' },
      { from_step_key: 's6', to_step_key: 's7', condition_type: 'on_complete' },
      { from_step_key: 's7', to_step_key: 's8', condition_type: 'on_complete' },
      { from_step_key: 's8', to_step_key: 's9', condition_type: 'on_complete' },
      { from_step_key: 's9', to_step_key: 's10', condition_type: 'on_complete' },
    ],
  },

  // ─── Self Assessment ─────────────────────────────────────────────────────────
  {
    id: 'default-self-assessment',
    name: 'Self Assessment Return',
    description: 'Individual self assessment tax return workflow.',
    category: 'self_assessment',
    recurrence_type: 'annually',
    estimated_duration_days: 21,
    steps: [
      { step_key: 's1', title: 'Request personal income information', description: 'Employment income, dividends, interest, rental income, capital gains etc.', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Client provides all income details', assignee_role: 'client', position_x: X, position_y: Y },
      { step_key: 's3', title: 'Process rental income & expenses', description: 'If client has rental properties.', assignee_role: 'team_member', tool_module_id: 'landlord', time_estimate_minutes: 60, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Prepare SA return', assignee_role: 'team_member', time_estimate_minutes: 90, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Manager review', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: X, position_y: Y * 4 },
      { step_key: 's6', title: 'Send to client for approval', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 5 },
      { step_key: 's7', title: 'Client approves return', assignee_role: 'client', position_x: X, position_y: Y * 6 },
      { step_key: 's8', title: 'Submit to HMRC', assignee_role: 'team_member', time_estimate_minutes: 20, position_x: X, position_y: Y * 7 },
      { step_key: 's9', title: 'Advise tax payment dates to client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 8 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
      { from_step_key: 's5', to_step_key: 's6', condition_type: 'on_complete' },
      { from_step_key: 's6', to_step_key: 's7', condition_type: 'on_complete' },
      { from_step_key: 's7', to_step_key: 's8', condition_type: 'on_complete' },
      { from_step_key: 's8', to_step_key: 's9', condition_type: 'on_complete' },
    ],
  },

  // ─── Monthly Payroll ─────────────────────────────────────────────────────────
  {
    id: 'default-payroll-monthly',
    name: 'Payroll Run (Monthly)',
    description: 'Monthly payroll processing and RTI submission workflow.',
    category: 'payroll',
    recurrence_type: 'monthly',
    estimated_duration_days: 5,
    steps: [
      { step_key: 's1', title: 'Receive payroll information from client', description: 'Hours, new starters, leavers, salary changes, bonuses.', assignee_role: 'client', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: '3_days_before_due' }, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Process payroll', assignee_role: 'team_member', time_estimate_minutes: 60, position_x: X, position_y: Y },
      { step_key: 's3', title: 'Prepare P32 summary', assignee_role: 'team_member', tool_module_id: 'p32', time_estimate_minutes: 15, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Submit RTI to HMRC', assignee_role: 'team_member', time_estimate_minutes: 15, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Send payslips & P32 to client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 4 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
    ],
  },

  // ─── Bi-weekly Payroll ───────────────────────────────────────────────────────
  {
    id: 'default-payroll-biweekly',
    name: 'Payroll Run (Bi-weekly)',
    description: 'Bi-weekly payroll processing for clients on a fortnightly pay schedule.',
    category: 'payroll',
    recurrence_type: 'bi-weekly',
    estimated_duration_days: 3,
    steps: [
      { step_key: 's1', title: 'Receive payroll information from client', assignee_role: 'client', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: '1_day_before_due' }, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Process payroll', assignee_role: 'team_member', time_estimate_minutes: 45, position_x: X, position_y: Y },
      { step_key: 's3', title: 'Submit RTI to HMRC', assignee_role: 'team_member', time_estimate_minutes: 15, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Send payslips to client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 10, position_x: X, position_y: Y * 3 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
    ],
  },

  // ─── Confirmation Statement ──────────────────────────────────────────────────
  {
    id: 'default-confirmation-statement',
    name: 'Confirmation Statement',
    description: 'Annual Companies House confirmation statement filing workflow.',
    category: 'companies_house',
    recurrence_type: 'annually',
    estimated_duration_days: 7,
    steps: [
      { step_key: 's1', title: 'Check Companies House data', description: 'Review current officer, PSC, and share capital information on CH.', assignee_role: 'team_member', tool_module_id: 'ch-secretarial', time_estimate_minutes: 20, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Confirm details with client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y },
      { step_key: 's3', title: 'Client confirms all details correct', assignee_role: 'client', position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'File confirmation statement', assignee_role: 'team_member', time_estimate_minutes: 20, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Advise client filing complete', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 10, position_x: X, position_y: Y * 4 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
    ],
  },

  // ─── Bookkeeping Review ──────────────────────────────────────────────────────
  {
    id: 'default-bookkeeping-review',
    name: 'Bookkeeping Review',
    description: 'Periodic bookkeeping review — suitable for monthly or quarterly management accounts clients.',
    category: 'bookkeeping',
    recurrence_type: 'monthly',
    estimated_duration_days: 7,
    steps: [
      { step_key: 's1', title: 'Request documents from client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: 0 },
      { step_key: 's2', title: 'Client provides documents', assignee_role: 'client', position_x: X, position_y: Y },
      { step_key: 's3', title: 'Process bank statements', assignee_role: 'team_member', tool_module_id: 'bank-to-csv', time_estimate_minutes: 30, position_x: X, position_y: Y * 2 },
      { step_key: 's4', title: 'Analyse invoices & receipts', assignee_role: 'team_member', tool_module_id: 'full-analysis', time_estimate_minutes: 60, position_x: X, position_y: Y * 3 },
      { step_key: 's5', title: 'Reconcile accounts', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: X, position_y: Y * 4 },
      { step_key: 's6', title: 'Prepare management accounts', assignee_role: 'team_member', tool_module_id: 'performance', time_estimate_minutes: 45, position_x: X, position_y: Y * 5 },
      { step_key: 's7', title: 'Manager review', assignee_role: 'team_member', time_estimate_minutes: 30, position_x: X, position_y: Y * 6 },
      { step_key: 's8', title: 'Send report to client', assignee_role: 'team_member', email_reminder_enabled: true, email_reminder_config: { recipients: ['client'], timing: 'on_assign' }, time_estimate_minutes: 15, position_x: X, position_y: Y * 7 },
    ],
    edges: [
      { from_step_key: 's1', to_step_key: 's2', condition_type: 'on_complete' },
      { from_step_key: 's2', to_step_key: 's3', condition_type: 'on_complete' },
      { from_step_key: 's3', to_step_key: 's4', condition_type: 'on_complete' },
      { from_step_key: 's4', to_step_key: 's5', condition_type: 'on_complete' },
      { from_step_key: 's5', to_step_key: 's6', condition_type: 'on_complete' },
      { from_step_key: 's6', to_step_key: 's7', condition_type: 'on_complete' },
      { from_step_key: 's7', to_step_key: 's8', condition_type: 'on_complete' },
    ],
  },
];

export const TEMPLATE_CATEGORY_LABELS: Record<string, string> = {
  vat: 'VAT',
  year_end: 'Year End',
  self_assessment: 'Self Assessment',
  payroll: 'Payroll',
  companies_house: 'Companies House',
  bookkeeping: 'Bookkeeping',
  general: 'General',
};
