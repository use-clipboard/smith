// Maps a time_entries DB row to the client-facing shape (field names match the
// TimeEntry type so the provider can consume rows directly). Kept in lib rather
// than the route file so route modules only export HTTP handlers.

export interface ApiEntry {
  id: string;
  userId: string;
  date: string;
  start: string;
  clientId: string | null;
  clientName: string;
  taskId: string | null;
  taskTitle: string;
  activity: string;
  department: string;
  type: 'billable' | 'non_billable' | 'internal';
  minutes: number;
  ratePence: number;
  notes: string;
  source: 'manual' | 'timer' | 'ai';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRow(r: any): ApiEntry {
  return {
    id: r.id,
    userId: r.user_id,
    date: r.entry_date,
    start: r.start_time ?? '—',
    clientId: r.client_id ?? null,
    clientName: r.client_name ?? 'Internal',
    taskId: r.task_id ?? null,
    taskTitle: r.task_title ?? '',
    activity: r.activity,
    department: r.department ?? 'General',
    type: r.entry_type,
    minutes: r.minutes,
    ratePence: r.rate_pence ?? 0,
    notes: r.notes ?? '',
    source: r.source ?? 'manual',
  };
}
