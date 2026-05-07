import * as XLSX from 'xlsx';
import { sortStepsByWorkflow } from './taskUtils';
import type { Task } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtStatus(s: string): string {
  return s
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ── Main export ───────────────────────────────────────────────────────────────

export function exportTasksXlsx(tasks: Task[], filename = 'tasks-export') {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Tasks ────────────────────────────────────────────────────────

  const taskRows = tasks.map(t => {
    const allSteps   = t.steps ?? [];
    const edges      = t.edges ?? [];
    const sorted     = sortStepsByWorkflow(allSteps, edges);
    const workSteps  = sorted.filter(s => s.step_type !== 'start');
    const doneSteps  = workSteps.filter(s => s.status === 'complete' || s.status === 'skipped').length;
    const totalSteps = workSteps.length;

    const assignees = [...new Set(
      allSteps
        .filter(s => s.assignee && !s.is_client_step)
        .map(s => s.assignee!.full_name ?? s.assignee!.email),
    )].join(', ');

    return {
      Task:        t.title,
      Client:      t.client?.name ?? (t.is_internal ? 'Internal' : ''),
      'Client Ref':t.client?.client_ref ?? '',
      Status:      fmtStatus(t.status),
      Progress:    totalSteps > 0 ? `${doneSteps}/${totalSteps}` : '',
      '% Complete':totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : '',
      'Due Date':  fmtDate(t.due_date),
      Recurrence:  fmtStatus(t.recurrence_type ?? 'once'),
      Assignees:   assignees,
      Created:     fmtDate(t.created_at ?? null),
    };
  });

  const wsT = XLSX.utils.json_to_sheet(taskRows);

  // Column widths
  wsT['!cols'] = [
    { wch: 36 }, // Task
    { wch: 24 }, // Client
    { wch: 12 }, // Client Ref
    { wch: 18 }, // Status
    { wch: 10 }, // Progress
    { wch: 12 }, // % Complete
    { wch: 14 }, // Due Date
    { wch: 14 }, // Recurrence
    { wch: 30 }, // Assignees
    { wch: 14 }, // Created
  ];

  XLSX.utils.book_append_sheet(wb, wsT, 'Tasks');

  // ── Sheet 2: Steps ────────────────────────────────────────────────────────

  const stepRows: Record<string, string | number>[] = [];

  tasks.forEach(t => {
    const allSteps  = t.steps ?? [];
    const edges     = t.edges ?? [];
    const sorted    = sortStepsByWorkflow(allSteps, edges);
    const workSteps = sorted.filter(s => s.step_type !== 'start');

    workSteps.forEach((s, idx) => {
      stepRows.push({
        Task:           t.title,
        Client:         t.client?.name ?? (t.is_internal ? 'Internal' : ''),
        'Client Ref':   t.client?.client_ref ?? '',
        'Task Status':  fmtStatus(t.status),
        'Step #':       idx + 1,
        Step:           s.title,
        Description:    s.description ?? '',
        'Step Status':  fmtStatus(s.status),
        Assignee:       s.assignee ? (s.assignee.full_name ?? s.assignee.email) : '',
        'Client Step':  s.is_client_step ? 'Yes' : 'No',
        'Due Date':     fmtDate(s.due_date),
      });
    });
  });

  if (stepRows.length > 0) {
    const wsS = XLSX.utils.json_to_sheet(stepRows);
    wsS['!cols'] = [
      { wch: 36 }, // Task
      { wch: 24 }, // Client
      { wch: 12 }, // Client Ref
      { wch: 18 }, // Task Status
      { wch: 8  }, // Step #
      { wch: 30 }, // Step
      { wch: 40 }, // Description
      { wch: 18 }, // Step Status
      { wch: 22 }, // Assignee
      { wch: 12 }, // Client Step
      { wch: 14 }, // Due Date
    ];
    XLSX.utils.book_append_sheet(wb, wsS, 'Steps');
  }

  // ── Download ──────────────────────────────────────────────────────────────

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  XLSX.writeFile(wb, `${filename}-${dateStr}.xlsx`);
}
