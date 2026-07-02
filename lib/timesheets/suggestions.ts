// Demo generator for AI-suggested time entries.
//
// The live endpoint (/api/timesheets/suggestions) detects real completed work
// from Tasks, Meeting Notes and AI Outputs. When a firm has no such data yet
// (fresh install / local demo), we synthesise believable suggestions so the
// "quietly captures work as it happens" experience is visible immediately.

import type { AiSuggestion, SuggestionSource } from './types';
import { SEED_CLIENTS } from './seed';
import { addDays } from './format';

interface Template {
  source: SuggestionSource;
  activity: string;
  taskTitle: string;
  minutes: number;
  confidence: number;
  rationale: (client: string) => string;
  type: AiSuggestion['type'];
}

const TEMPLATES: Template[] = [
  {
    source: 'email', activity: 'Client email & queries', taskTitle: 'Correspondence',
    minutes: 30, confidence: 0.82, type: 'billable',
    rationale: c => `You sent 4 replies to ${c} in Email Triage this morning — no time logged against them.`,
  },
  {
    source: 'meeting', activity: 'Client meeting', taskTitle: 'Client meeting',
    minutes: 60, confidence: 0.94, type: 'billable',
    rationale: c => `Meeting Notes recorded a 58-minute meeting with ${c}, but the time isn't on your sheet.`,
  },
  {
    source: 'accounts_review', activity: 'Review and analysis', taskTitle: 'Quarterly review',
    minutes: 90, confidence: 0.88, type: 'billable',
    rationale: c => `You completed an Accounts Review run for ${c} — typical reviews take ~1.5h.`,
  },
  {
    source: 'capture', activity: 'Bookkeeping & data entry', taskTitle: 'Monthly bookkeeping',
    minutes: 45, confidence: 0.79, type: 'billable',
    rationale: c => `A Capture batch of 22 invoices was processed for ${c} and booked.`,
  },
  {
    source: 'performance', activity: 'Advisory & forecasting', taskTitle: 'Management accounts',
    minutes: 75, confidence: 0.8, type: 'billable',
    rationale: c => `A Performance Analysis report was generated for ${c}.`,
  },
  {
    source: 'task', activity: 'Tax computation', taskTitle: 'CT600 preparation',
    minutes: 120, confidence: 0.86, type: 'billable',
    rationale: c => `You marked the "CT600" task complete for ${c} with no time recorded.`,
  },
  {
    source: 'calendar', activity: 'Internal meeting', taskTitle: 'Team catch-up',
    minutes: 30, confidence: 0.7, type: 'internal',
    rationale: () => `A 30-minute calendar event "Team catch-up" ended earlier and isn't logged.`,
  },
];

export function generateDemoSuggestions(today: string): AiSuggestion[] {
  return TEMPLATES.map((t, i) => {
    const client = t.source === 'calendar' ? null : SEED_CLIENTS[(i * 3) % SEED_CLIENTS.length];
    const date = i < 4 ? today : addDays(today, -1);
    return {
      id: `sg-${i}`,
      source: t.source,
      clientId: client?.id ?? null,
      clientName: client?.name ?? 'Internal',
      activity: t.activity,
      taskTitle: t.taskTitle,
      date,
      suggestedMinutes: t.minutes,
      type: t.type,
      confidence: t.confidence,
      rationale: t.rationale(client?.name ?? 'the team'),
    };
  });
}

export const SOURCE_META: Record<SuggestionSource, { label: string; icon: string; hue: number }> = {
  email:           { label: 'Email Triage',     icon: 'Mail',          hue: 220 },
  meeting:         { label: 'Meeting Notes',     icon: 'MicVocal',      hue: 280 },
  task:            { label: 'Tasks',             icon: 'CheckSquare',   hue: 160 },
  accounts_review: { label: 'Accounts Review',   icon: 'ClipboardCheck',hue: 250 },
  capture:         { label: 'Capture',           icon: 'FileSearch',    hue: 200 },
  performance:     { label: 'Performance',       icon: 'Gauge',         hue: 25  },
  calendar:        { label: 'Calendar',          icon: 'CalendarDays',  hue: 330 },
};
