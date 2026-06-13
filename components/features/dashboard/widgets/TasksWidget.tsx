'use client';

import { CheckSquare } from 'lucide-react';
import { WidgetCard, StatRow, WidgetLoading, useOpenTool } from './shared';
import { useTasksCount } from '@/components/ui/TasksCountProvider';

export default function TasksWidget() {
  const openTool = useOpenTool();
  // Shared app-wide task counts (same source as the sidebar badge + hero).
  // null while first loading → WidgetLoading.
  const { counts: data } = useTasksCount();

  return (
    <WidgetCard
      icon={<CheckSquare size={15} className="text-[var(--accent)]" />}
      title="Tasks"
      onViewAll={() => openTool('tasks', 'Tasks', '/tasks', CheckSquare)}
    >
      {!data ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex flex-col justify-center gap-2">
          <StatRow label="Overdue" value={data.overdue} color="#ef4444" />
          <StatRow label="Due this week" value={data.dueWithin7} color="#f59e0b" />
          <StatRow label="Due this month" value={data.dueWithin30} color="#4F46E5" />
        </div>
      )}
    </WidgetCard>
  );
}
