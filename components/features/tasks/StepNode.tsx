'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { User, Puzzle, Mail, CheckCircle2, Circle, Loader2, Clock, SkipForward } from 'lucide-react';
import type { StepStatus } from '@/types';

export interface StepNodeData {
  label: string;
  description?: string | null;
  status?: StepStatus;
  assigneeName?: string | null;
  isClientStep?: boolean;
  toolModuleId?: string | null;
  toolModuleName?: string | null;
  emailReminder?: boolean;
  timeEstimate?: number | null;
  mode: 'view' | 'edit';
  selected?: boolean;
  onStatusChange?: (status: StepStatus) => void;
}

const STATUS_BORDER: Record<StepStatus, string> = {
  not_started:       'border-gray-200',
  in_progress:       'border-blue-400',
  waiting_on_client: 'border-amber-400',
  complete:          'border-green-400',
  skipped:           'border-gray-200 opacity-60',
};

const STATUS_BG: Record<StepStatus, string> = {
  not_started:       'bg-white',
  in_progress:       'bg-blue-50',
  waiting_on_client: 'bg-amber-50',
  complete:          'bg-green-50',
  skipped:           'bg-gray-50',
};

function StatusIcon({ status }: { status: StepStatus }) {
  const cls = 'h-4 w-4 flex-shrink-0';
  if (status === 'complete')          return <CheckCircle2 className={`${cls} text-green-500`} />;
  if (status === 'in_progress')       return <Loader2 className={`${cls} text-blue-500 animate-spin`} />;
  if (status === 'waiting_on_client') return <Clock className={`${cls} text-amber-500`} />;
  if (status === 'skipped')           return <SkipForward className={`${cls} text-gray-400`} />;
  return <Circle className={`${cls} text-gray-300`} />;
}

// Shared handle styles — visible dots in edit mode, invisible in view mode
const HANDLE_SRC: React.CSSProperties = {
  width: 11, height: 11,
  background: '#818cf8', border: '2px solid white',
  borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
  cursor: 'crosshair', zIndex: 10,
};
const HANDLE_TGT: React.CSSProperties = {
  width: 11, height: 11,
  background: '#818cf8', border: '2px solid white',
  borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
  cursor: 'crosshair', zIndex: 10,
};
const HIDDEN: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

function StepNode({ data, selected }: NodeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as unknown as StepNodeData;
  const status = d.status ?? 'not_started';
  const borderClass = STATUS_BORDER[status];
  const bgClass = STATUS_BG[status];
  const isEdit = d.mode === 'edit';

  const srcStyle = isEdit ? HANDLE_SRC : HIDDEN;
  const tgtStyle = isEdit ? HANDLE_TGT : HIDDEN;

  return (
    <div
      className={`
        rounded-lg border-2 ${borderClass} ${bgClass} shadow-sm
        min-w-[200px] max-w-[240px]
        ${selected ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}
        ${isEdit ? 'cursor-pointer' : ''}
      `}
      style={{ fontFamily: 'inherit' }}
    >
      {/* ── Handles — all 4 sides, source + target at each ── */}
      <Handle type="target" position={Position.Top}    id="t-top"   style={tgtStyle} />
      <Handle type="source" position={Position.Top}    id="s-top"   style={{ ...srcStyle, opacity: 0 }} />

      <Handle type="source" position={Position.Bottom} id="s-bot"   style={srcStyle} />
      <Handle type="target" position={Position.Bottom} id="t-bot"   style={{ ...tgtStyle, opacity: 0 }} />

      <Handle type="source" position={Position.Left}   id="s-left"  style={srcStyle} />
      <Handle type="target" position={Position.Left}   id="t-left"  style={{ ...tgtStyle, opacity: 0 }} />

      <Handle type="source" position={Position.Right}  id="s-right" style={srcStyle} />
      <Handle type="target" position={Position.Right}  id="t-right" style={{ ...tgtStyle, opacity: 0 }} />

      <div className="p-3">
        <div className="flex items-start gap-2 mb-1.5">
          {!isEdit && <StatusIcon status={status} />}
          <p className="text-sm font-semibold text-gray-800 leading-tight">{d.label}</p>
        </div>

        {d.description && (
          <p className="text-xs text-gray-500 mb-2 leading-snug line-clamp-2">{d.description}</p>
        )}

        <div className="flex flex-wrap gap-1.5 mt-1">
          {d.isClientStep ? (
            <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">
              <User className="h-3 w-3" /> Client
            </span>
          ) : d.assigneeName ? (
            <span className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
              <User className="h-3 w-3" /> {d.assigneeName}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] bg-gray-50 text-gray-400 rounded px-1.5 py-0.5">
              <User className="h-3 w-3" /> Unassigned
            </span>
          )}

          {d.toolModuleId && (
            <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">
              <Puzzle className="h-3 w-3" /> {d.toolModuleName ?? 'Tool'}
            </span>
          )}

          {d.emailReminder && (
            <span className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-600 rounded px-1.5 py-0.5">
              <Mail className="h-3 w-3" /> Reminder
            </span>
          )}
        </div>

        {d.timeEstimate && (
          <p className="text-[11px] text-gray-400 mt-1.5">Est: {d.timeEstimate >= 60 ? `${Math.floor(d.timeEstimate / 60)}h ${d.timeEstimate % 60}m` : `${d.timeEstimate}m`}</p>
        )}
      </div>
    </div>
  );
}

export default memo(StepNode);
