'use client';

import { useEffect, useState } from 'react';
import MyDayPanel from '@/components/features/tasks/MyDayPanel';
import { openTaskInTool } from '@/lib/notificationTarget';
import type { Task } from '@/types';

// Dashboard "Organise my day" — reuses the Tasks tool's floating plan, adding the
// SMITH Briefing items (emails, notifications, holidays, briefings, events) as
// "Also on your plate". Self-contained: fetches the user's tasks + id.

interface Props {
  extras: { key: string; label: string; count: number; color: string; onClick: () => void }[];
  onClose: () => void;
}

export default function DashboardMyDay({ extras, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/tasks').then(r => (r.ok ? r.json() : { tasks: [] })).then((d: { tasks?: Task[] }) => { if (live) setTasks(d.tasks ?? []); }).catch(() => {});
    fetch('/api/users/me').then(r => (r.ok ? r.json() : {})).then((d: { userId?: string }) => { if (live) setUserId(d.userId ?? ''); }).catch(() => {});
    return () => { live = false; };
  }, []);

  function markDone(id: string) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: 'complete' as Task['status'] } : t)));
    fetch(`/api/tasks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'complete' }) }).catch(() => {});
  }

  return (
    <MyDayPanel
      tasks={tasks}
      currentUserId={userId}
      extras={extras}
      onOpenTask={(t) => { openTaskInTool(t.id); onClose(); }}
      onMarkDone={markDone}
      onClose={onClose}
    />
  );
}
