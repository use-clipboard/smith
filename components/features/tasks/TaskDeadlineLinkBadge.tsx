'use client';

import { Link2, AlertTriangle } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

export type DeadlineType = 'accounts_due' | 'cs_due' | 'officer_idv_due' | 'psc_idv_due';
export type LinkStatus   = 'active' | 'paused' | 'broken';

const DEADLINE_LABEL: Record<DeadlineType, string> = {
  accounts_due:    'Accounts Due',
  cs_due:          'Confirmation Statement Due',
  officer_idv_due: 'Officer IDV Due',
  psc_idv_due:     'PSC IDV Due',
};

export interface TaskDeadlineLink {
  id: string;
  deadline_type: DeadlineType;
  offset_days: number;
  last_synced_deadline: string | null;
  status: LinkStatus;
  last_error: string | null;
  clients: { name: string | null; client_ref: string | null } | null;
}

interface Props {
  /** All links attached to this task (most tasks have 0 or 1; rarely more). */
  links: TaskDeadlineLink[];
}

/**
 * Inline indicator rendered next to a task title when the task is bound to
 * one or more Companies House deadlines. Hover → tooltip with the deadline
 * type, the current synced date, the offset, and a status note for any
 * paused / broken links. Nothing renders when the task has no links.
 */
export default function TaskDeadlineLinkBadge({ links }: Props) {
  if (links.length === 0) return null;

  const hasBroken = links.some(l => l.status === 'broken');
  const hasPaused = links.some(l => l.status === 'paused');
  // A broken link wins the colour — that's the user-actionable state.
  // Paused is amber; healthy is the accent colour.
  const colour =
    hasBroken ? 'text-amber-500 hover:text-amber-600'   :
    hasPaused ? 'text-amber-400 hover:text-amber-500'   :
                'text-[var(--accent)] hover:text-[var(--accent)]';

  return (
    <Tooltip
      side="top"
      label={
        <div className="space-y-1.5 text-left">
          {links.map(l => (
            <div key={l.id}>
              <div className="text-[11px] font-semibold">
                {DEADLINE_LABEL[l.deadline_type]}
                {l.clients?.name && <span className="font-normal opacity-80"> — {l.clients.name}</span>}
              </div>
              <div className="text-[10px] opacity-80">
                {l.last_synced_deadline
                  ? <>Current deadline <strong>{l.last_synced_deadline}</strong>{l.offset_days !== 0 && <> · offset {l.offset_days > 0 ? '+' : ''}{l.offset_days}d</>}</>
                  : <>Waiting for first CH refresh{l.offset_days !== 0 && <> · offset {l.offset_days > 0 ? '+' : ''}{l.offset_days}d</>}</>}
              </div>
              {l.status === 'broken' && (
                <div className="text-[10px] text-amber-200 mt-0.5">
                  Link broken — {l.last_error ?? 'review required'}
                </div>
              )}
              {l.status === 'paused' && (
                <div className="text-[10px] text-amber-200 mt-0.5">
                  Sync paused — {l.last_error ?? 'awaiting next refresh'}
                </div>
              )}
            </div>
          ))}
        </div>
      }
    >
      <span aria-label={hasBroken ? 'CH deadline link broken' : 'Linked to CH deadline'} className={`inline-flex items-center ${colour}`}>
        {hasBroken
          ? <AlertTriangle size={11} />
          : <Link2 size={11} />}
        {links.length > 1 && <span className="text-[9px] ml-0.5">{links.length}</span>}
      </span>
    </Tooltip>
  );
}
