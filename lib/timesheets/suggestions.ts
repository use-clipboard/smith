// Display metadata for AI-suggested time sources. The suggestions themselves
// come from the live endpoint (/api/timesheets/suggestions), which detects real
// completed work from Tasks, Meeting Notes and AI Outputs.

import type { SuggestionSource } from './types';

export const SOURCE_META: Record<SuggestionSource, { label: string; icon: string; hue: number }> = {
  email:           { label: 'Email Triage',     icon: 'Mail',          hue: 220 },
  meeting:         { label: 'Meeting Notes',     icon: 'MicVocal',      hue: 280 },
  task:            { label: 'Tasks',             icon: 'CheckSquare',   hue: 160 },
  accounts_review: { label: 'Accounts Review',   icon: 'ClipboardCheck',hue: 250 },
  capture:         { label: 'Capture',           icon: 'FileSearch',    hue: 200 },
  performance:     { label: 'Performance',       icon: 'Gauge',         hue: 25  },
  calendar:        { label: 'Calendar',          icon: 'CalendarDays',  hue: 330 },
};
