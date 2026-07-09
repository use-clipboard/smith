// Billing module — plain status labels (no UI deps), usable in lib/PDF code.

import type { InvoiceStatus } from './types';

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  part_paid: 'Part paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
  bad_debt: 'Bad debt',
};
