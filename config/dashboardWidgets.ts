/**
 * Dashboard widget registry.
 *
 * Each section of the dashboard is a "widget" the user can show/hide and
 * reorder (managed in Settings → Dashboard, or via the dashboard's own
 * "Edit layout" mode). Per-user order + visibility is stored as an ordered
 * array of widget ids in `users.dashboard_layout` (see DashboardLayoutProvider).
 *
 * Widgets may be gated to an enabled module via `moduleId` — those only become
 * available to add when the firm has that tool switched on. Core widgets (no
 * moduleId) are always available.
 *
 * To add a new widget: add an entry here, then render a case for its id in
 * DashboardClient's `renderWidget`. Nothing else needs to change.
 */
/**
 * Widget footprint:
 *   small  — 1 column  (the Recent Clients size)
 *   medium — 2 columns, same height as a small widget
 *   large  — full width (the Team Noticeboard size), self-sizing height
 */
export type DashboardWidgetSize = 'small' | 'medium' | 'large';

export interface DashboardWidgetDef {
  id: string;
  label: string;
  description: string;
  size: DashboardWidgetSize;
  /** When set, the widget is only available if this module is active. */
  moduleId?: string;
}

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  { id: 'whiteboard',      label: 'Team Noticeboard', description: 'Shared sticky notes & pen markers for the whole firm.', size: 'large'  },
  { id: 'needs-attention',  label: 'Needs Attention',  description: 'Clients with overdue or imminent tasks.',              size: 'small'  },
  { id: 'upcoming-deadlines', label: 'Upcoming Deadlines', description: 'Companies House & MTD filing deadlines, soonest first.', size: 'small' },
  { id: 'recent-clients',  label: 'Recent Clients',   description: 'Your most recently added clients.',                    size: 'small'  },
  { id: 'recent-activity', label: 'Recent Activity',  description: 'Latest AI tool outputs across the firm.',              size: 'small'  },
  { id: 'team',            label: 'Team',             description: "Who's online in your firm right now.",                 size: 'small'  },
  { id: 'quick-launch',    label: 'Quick Launch',     description: 'One-click tiles for every enabled tool.',              size: 'medium' },

  // ── Module-gated widgets — only available when the firm has the tool enabled ──
  { id: 'tasks',    label: 'Tasks',            description: 'Your overdue and upcoming task counts.',                size: 'small',  moduleId: 'tasks' },
  { id: 'calendar', label: "Today's Calendar", description: 'Your events for the next 24 hours.',                    size: 'small',  moduleId: 'google-calendar' },
  { id: 'mtd-it',   label: 'MTD IT',           description: 'Four-quarter client submission status donuts.',         size: 'large',  moduleId: 'mtd-it' },
  { id: 'hr',       label: 'HR',               description: 'Holidays, requests to approve, and upcoming dates.',    size: 'medium', moduleId: 'hr' },
  { id: 'email-triage',   label: 'Email Triage',   description: 'Your unread inbox count.',                            size: 'small',  moduleId: 'email-triage' },
  { id: 'document-vault', label: 'Document Vault', description: 'Documents waiting to be tagged.',                     size: 'small',  moduleId: 'document-vault' },
  { id: 'proposals',      label: 'Proposals',      description: 'Proposals awaiting a response, and outcomes.',        size: 'small',  moduleId: 'proposals' },

  // Always available (no module gate) — a private scratchpad.
  { id: 'notes',          label: 'My Notes',       description: 'A private scratchpad, just for you.',                 size: 'small' },
];

/** Default order + visibility for users with no saved layout.
 *  The Team Noticeboard (`whiteboard`) is intentionally NOT a default — it
 *  remains available to add via Settings → Dashboard / Customise. */
export const DEFAULT_DASHBOARD_LAYOUT: string[] = [
  'needs-attention',
  'upcoming-deadlines',
  'recent-clients',
  'recent-activity',
  'team',
  'quick-launch',
];

/** Fast lookup: widget id → definition. */
export const DASHBOARD_WIDGET_BY_ID = new Map<string, DashboardWidgetDef>(
  DASHBOARD_WIDGETS.map(w => [w.id, w]),
);

/** Set of all known widget ids (used to drop stale ids from a saved layout). */
export const DASHBOARD_WIDGET_IDS = new Set(DASHBOARD_WIDGETS.map(w => w.id));
