// Automation trigger metadata — pure data, safe to import on client or server.
// The runtime (lib/campaigns/automations.ts) and the editor UI both read this.

import type { AutomationTriggerType } from '@/types/campaigns';

export interface TriggerMeta {
  type: AutomationTriggerType;
  label: string;
  description: string;
  recurring: boolean;
  /** Days before re-emailing the same client is allowed (event triggers only). */
  cooldownDays: number;
  /** Whether the trigger takes a "days" lead-time input. */
  hasDays: boolean;
  defaultDays?: number;
}

export const TRIGGERS: TriggerMeta[] = [
  { type: 'recurring',               label: 'On a schedule',                description: 'Send to a saved audience every month or week — e.g. a newsletter.', recurring: true,  cooldownDays: 0,   hasDays: false },
  { type: 'year_end_approaching',    label: 'Company year end approaching', description: 'When a company’s accounts fall due within the lead time.',           recurring: false, cooldownDays: 300, hasDays: true, defaultDays: 60 },
  { type: 'cs_approaching',          label: 'Confirmation statement due',   description: 'When a confirmation statement falls due within the lead time.',       recurring: false, cooldownDays: 300, hasDays: true, defaultDays: 30 },
  { type: 'invoice_overdue',         label: 'Invoice overdue',              description: 'When a client has an invoice past its due date.',                     recurring: false, cooldownDays: 21,  hasDays: false },
  { type: 'mtd_quarter_outstanding', label: 'MTD IT quarter outstanding',   description: 'When a client has an MTD IT quarter not yet submitted.',              recurring: false, cooldownDays: 60,  hasDays: false },
  { type: 'task_overdue',            label: 'Task overdue',                 description: 'When a client has an overdue task.',                                  recurring: false, cooldownDays: 21,  hasDays: false },
];

export const TRIGGER_BY_TYPE: Record<string, TriggerMeta> =
  Object.fromEntries(TRIGGERS.map(t => [t.type, t]));
