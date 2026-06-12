'use client';

import { useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import { WidgetCard, StatRow, WidgetLoading, useOpenTool } from './shared';

interface Counts { overdue: number; dueWithin7: number; dueWithin30: number; }

export default function TasksWidget() {
  const openTool = useOpenTool();
  const [data, setData] = useState<Counts | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/tasks/my-count')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (active && d) setData({ overdue: d.overdue ?? 0, dueWithin7: d.dueWithin7 ?? 0, dueWithin30: d.dueWithin30 ?? 0 }); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

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
