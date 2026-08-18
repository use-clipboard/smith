'use client';

import { UserCog } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

/** Shown on a task whose workflow has been edited for this client only — i.e.
 *  it no longer follows the standard template (tasks.workflow_customised). */
export default function ClientSpecificBadge({ className = '' }: { className?: string }) {
  return (
    <Tooltip label="This client's workflow has been customised — it no longer follows the standard template. Changes carry to future recurrences.">
      <span
        aria-label="Client-specific workflow"
        className={`inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ${className}`}
      >
        <UserCog className="h-2.5 w-2.5" /> Client-specific
      </span>
    </Tooltip>
  );
}
