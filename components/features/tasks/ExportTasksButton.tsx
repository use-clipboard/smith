'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { exportTasksXlsx } from '@/utils/taskExport';
import type { Task } from '@/types';

interface Props {
  tasks: Task[];
  filename?: string;
  label?: string;
}

export default function ExportTasksButton({ tasks, filename = 'tasks', label = 'Export' }: Props) {
  const [busy, setBusy] = useState(false);

  function handleExport() {
    if (busy || tasks.length === 0) return;
    setBusy(true);
    // Run in next tick so the spinner renders before the synchronous XLSX work
    setTimeout(() => {
      try {
        exportTasksXlsx(tasks, filename);
      } finally {
        setBusy(false);
      }
    }, 0);
  }

  return (
    <Tooltip label={tasks.length === 0 ? 'No tasks to export' : `Export ${tasks.length} task${tasks.length !== 1 ? 's' : ''} to Excel`}>
      <button
        onClick={handleExport}
        disabled={busy || tasks.length === 0}
        aria-label={`Export tasks to Excel`}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-gray-200 hover:border-indigo-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
          : <Download className="h-3.5 w-3.5" />
        }
        {label}
      </button>
    </Tooltip>
  );
}
