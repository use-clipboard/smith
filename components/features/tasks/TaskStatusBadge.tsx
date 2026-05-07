'use client';

import type { TaskStatus, StepStatus } from '@/types';

const TASK_STATUS_CONFIG: Record<TaskStatus, { label: string; classes: string }> = {
  not_started:      { label: 'Not Started',       classes: 'bg-gray-100 text-gray-600' },
  in_progress:      { label: 'In Progress',        classes: 'bg-blue-100 text-blue-700' },
  waiting_on_client:{ label: 'Waiting on Client',  classes: 'bg-amber-100 text-amber-700' },
  records_here:     { label: 'Records Here',       classes: 'bg-teal-100 text-teal-700' },
  review:           { label: 'Review',             classes: 'bg-purple-100 text-purple-700' },
  complete:         { label: 'Complete',           classes: 'bg-green-100 text-green-700' },
  draft:            { label: 'Draft',              classes: 'bg-gray-100 text-gray-400' },
};

const STEP_STATUS_CONFIG: Record<StepStatus, { label: string; classes: string; dot: string }> = {
  not_started:      { label: 'Not Started',      classes: 'bg-gray-100 text-gray-600',    dot: 'bg-gray-400' },
  in_progress:      { label: 'In Progress',       classes: 'bg-blue-100 text-blue-700',   dot: 'bg-blue-500' },
  waiting_on_client:{ label: 'Waiting on Client', classes: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  complete:         { label: 'Complete',          classes: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  skipped:          { label: 'Skipped',           classes: 'bg-gray-100 text-gray-400',   dot: 'bg-gray-300' },
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  size?: 'sm' | 'md';
}

export function TaskStatusBadge({ status, size = 'md' }: TaskStatusBadgeProps) {
  const cfg = TASK_STATUS_CONFIG[status];
  const px = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${px} ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

interface StepStatusBadgeProps {
  status: StepStatus;
}

export function StepStatusBadge({ status }: StepStatusBadgeProps) {
  const cfg = STEP_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.classes}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
