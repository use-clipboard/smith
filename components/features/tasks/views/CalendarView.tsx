'use client';

import { useState } from 'react';
import { CalendarDays, CalendarRange } from 'lucide-react';
import MyWeekView from './MyWeekView';
import MyMonthView from './MyMonthView';
import type { Task, TaskStep } from '@/types';

// Calendar view — a Week / Month toggle over the existing (tested) MyWeek /
// MyMonth grids. This is where the old "My Week" and "My Month" nav items now
// live, per the redesign decision.

interface Props {
  tasks: Task[];
  currentUserId: string;
  onTaskClick: (task: Task) => void;
  onStepUpdate?: (taskId: string, stepId: string, updates: Partial<TaskStep>) => Promise<void>;
  onTaskUpdate?: (taskId: string, updates: Partial<Task>) => Promise<void>;
  viewMode: 'grid' | 'list';
  isAdmin?: boolean;
  teamMembers?: { id: string; full_name: string | null; email: string }[];
  onDelete?: (taskId: string) => Promise<void>;
  onStopRecurrence?: (taskId: string) => Promise<void>;
}

export default function CalendarView(props: Props) {
  const [mode, setMode] = useState<'week' | 'month'>('week');

  return (
    <div>
      <div className="inline-flex bg-gray-100 border border-gray-200 rounded-lg p-0.5 mb-4">
        <button
          onClick={() => setMode('week')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${mode === 'week' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <CalendarDays className="h-3.5 w-3.5" /> Week
        </button>
        <button
          onClick={() => setMode('month')}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-semibold transition-colors ${mode === 'month' ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          <CalendarRange className="h-3.5 w-3.5" /> Month
        </button>
      </div>

      {mode === 'week'
        ? <MyWeekView {...props} />
        : <MyMonthView {...props} />}
    </div>
  );
}
