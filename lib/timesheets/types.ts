// Timesheets module — core domain types.
// Kept in a dedicated module file (rather than the giant shared types/index.ts)
// so the feature stays self-contained and easy to lift into Supabase later.

export type TimeEntryType = 'billable' | 'non_billable' | 'internal';

export type TimesheetTab = 'overview' | 'my_timesheet' | 'reports' | 'settings' | 'approvals';

/** A client the firm records time against. */
export interface TsClient {
  id: string;
  name: string;
  ref: string;
  /** 'active' | 'hold' | 'inactive' — shown in the client picker. */
  status?: string;
}

/** A member of the firm — used for capacity, leaderboard and team views. */
export interface TsStaff {
  id: string;
  name: string;
  role: string;
  department: string;
  /** Contracted chargeable hours per week (used for utilisation). */
  weeklyCapacityHours: number;
  /** Standard charge-out rate, pence per hour. */
  ratePence: number;
  /** Stable hue used for chart colour (and the legacy avatar fallback). */
  hue: number;
  /** Profile photo URL, if the member has uploaded one. */
  avatarUrl?: string | null;
}

/** A predefined activity a user can log against (internal or client work). */
export interface TsActivity {
  id: string;
  label: string;
  type: TimeEntryType;
  /** Which firm department the activity rolls up to. */
  department: string;
}

/** A single recorded block of time. */
export interface TimeEntry {
  id: string;
  userId: string;
  /** ISO yyyy-mm-dd of the working day. */
  date: string;
  /** Start time HH:mm on that day (used to place the block on the timeline). */
  start: string;
  clientId: string | null;
  clientName: string;
  /** Optional link to a Tasks-tool task. */
  taskId: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: TimeEntryType;
  minutes: number;
  /** Charge-out rate applied to this entry, pence per hour. */
  ratePence: number;
  notes: string;
  source: 'manual' | 'timer' | 'ai';
}

/** A live timer's stopwatch + what it's tracking. Persisted so it survives
 *  refresh + tab switches. */
export interface TimerState {
  running: boolean;
  paused: boolean;
  /** Epoch ms when the current running segment began (null while paused/stopped). */
  segmentStartedAt: number | null;
  /** Milliseconds banked from previous (paused) segments. */
  accumulatedMs: number;
  clientId: string | null;
  clientName: string;
  taskId: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: TimeEntryType;
  notes: string;
}

/** One of up to 3 concurrent timers. Only ever one runs (unpaused) at a time —
 *  the rest are paused. `label` + `color` let the user tell them apart. */
export interface TimerInstance extends TimerState {
  id: string;
  label: string;
  color: string;
}

/** Max concurrent timers a user can have open at once. */
export const MAX_TIMERS = 3;

export type WeekApprovalStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface WeekStatus {
  userId: string;
  weekStart: string;   // ISO Monday
  status: WeekApprovalStatus;
  note: string | null;
  reviewedBy: string | null;
  /** The submitter's manager at submit time (null → admins approve). */
  managerId: string | null;
}

export type SuggestionSource =
  | 'email'
  | 'meeting'
  | 'task'
  | 'accounts_review'
  | 'capture'
  | 'performance'
  | 'calendar';

/** An AI-detected block of work the user hasn't recorded yet. */
export interface AiSuggestion {
  id: string;
  source: SuggestionSource;
  clientId: string | null;
  clientName: string;
  activity: string;
  taskTitle: string;
  date: string;
  suggestedMinutes: number;
  type: TimeEntryType;
  /** 0–1 confidence in the detection. */
  confidence: number;
  rationale: string;
}
