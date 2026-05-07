'use client';

/**
 * StartNode  — trigger node at the beginning of a workflow (rocket icon).
 * EndNode    — completion node at the end of a workflow (flag icon).
 *
 * Icons match the toolbar buttons in TemplateBuilder (lucide Rocket / Flag).
 * Both are React Flow custom node types registered in TaskFlowChart.tsx.
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Rocket, Flag } from 'lucide-react';
import type { StartTriggerConfig, EndConfig, StepStatus } from '@/types';

// ── Shared handle style ───────────────────────────────────────────────────────

const HANDLE_BASE: React.CSSProperties = {
  width: 11, height: 11,
  background: '#818cf8', border: '2px solid white',
  borderRadius: '50%', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
  cursor: 'crosshair', zIndex: 10,
  transition: 'opacity 0.15s',
};
const HIDDEN: React.CSSProperties = { opacity: 0, pointerEvents: 'none' };

// ── triggerLabel ─────────────────────────────────────────────────────────────

export function triggerLabel(cfg: StartTriggerConfig | null): string {
  if (!cfg) return 'Triggered manually';
  switch (cfg.type) {
    case 'manual':
      return 'Triggered manually';
    case 'deadline_relative': {
      const unit = cfg.deadline_unit ?? 'months';
      const n = unit === 'weeks' ? (cfg.weeks_before ?? 0)
              : unit === 'days'  ? (cfg.days_before  ?? 0)
              :                    (cfg.months_before ?? 0);
      const unitLabel = unit === 'weeks' ? (n === 1 ? 'week' : 'weeks')
                      : unit === 'days'  ? (n === 1 ? 'day'  : 'days')
                      :                    (n === 1 ? 'month' : 'months');
      const lbl = cfg.deadline_label ? `before ${cfg.deadline_label}` : 'before deadline';
      return `${n} ${unitLabel} ${lbl}`;
    }
    case 'day_of_month': {
      const day = cfg.day_of_month ?? 1;
      const ord = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`;
      if (cfg.month) {
        const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${ord} ${months[cfg.month]} each year`;
      }
      return `${ord} of each period`;
    }
    case 'date_of_year': {
      const day = cfg.day_of_month ?? 1;
      const ord = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`;
      const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const mon = cfg.month ? months[cfg.month] : 'Jan';
      return `${ord} ${mon} annually`;
    }
    default:
      return 'Triggered manually';
  }
}

// ── StartNode ─────────────────────────────────────────────────────────────────

export interface StartNodeData {
  label: string;
  triggerConfig: StartTriggerConfig | null;
  mode: 'view' | 'edit';
  selected?: boolean;
  status?: StepStatus;
}

function StartNode({ data, selected }: NodeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as unknown as StartNodeData;
  const isEdit = d.mode === 'edit';
  const [hovered, setHovered] = useState(false);

  const showHandles = isEdit && (hovered || selected);
  const handleStyle: React.CSSProperties = showHandles ? HANDLE_BASE : { ...HANDLE_BASE, ...HIDDEN };

  return (
    <div
      className={`
        rounded-xl border-2 shadow-md min-w-[190px] max-w-[220px] overflow-hidden
        ${selected ? 'ring-2 ring-green-400 ring-offset-1' : ''}
        ${isEdit ? 'cursor-pointer' : ''}
        border-green-400 bg-white
      `}
      style={{ fontFamily: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Handles — all sides, shown on hover/select in edit mode */}
      <Handle type="source" position={Position.Top}    id="h-top"   style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Bottom} id="h-bot"   style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Left}   id="h-left"  style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Right}  id="h-right" style={isEdit ? handleStyle : HIDDEN} />

      {/* Header band with lucide Rocket icon */}
      <div className="bg-green-500 px-3 py-2 flex items-center gap-2">
        <Rocket className="h-4 w-4 text-white flex-shrink-0" />
        <span className="text-sm font-bold text-white tracking-wide truncate">{d.label || 'Start'}</span>
      </div>

      {/* Trigger description */}
      <div className="px-3 py-2">
        <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-0.5">Trigger</p>
        <p className="text-xs text-gray-700 font-medium leading-snug">
          {triggerLabel(d.triggerConfig)}
        </p>
      </div>
    </div>
  );
}

// ── EndNode ───────────────────────────────────────────────────────────────────

export interface EndNodeData {
  label: string;
  endConfig: EndConfig | null;
  mode: 'view' | 'edit';
  selected?: boolean;
  status?: StepStatus;
}

function EndNode({ data, selected }: NodeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as unknown as EndNodeData;
  const isEdit = d.mode === 'edit';
  const [hovered, setHovered] = useState(false);

  const showHandles = isEdit && (hovered || selected);
  const handleStyle: React.CSSProperties = showHandles ? HANDLE_BASE : { ...HANDLE_BASE, ...HIDDEN };

  const notifyEnabled = d.endConfig?.send_completion_notification ?? false;
  const recipients = d.endConfig?.notification_recipients ?? [];

  return (
    <div
      className={`
        rounded-xl border-2 shadow-md min-w-[190px] max-w-[220px] overflow-hidden
        ${selected ? 'ring-2 ring-purple-400 ring-offset-1' : ''}
        ${isEdit ? 'cursor-pointer' : ''}
        border-purple-400 bg-white
      `}
      style={{ fontFamily: 'inherit' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Handles */}
      <Handle type="source" position={Position.Top}    id="h-top"   style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Bottom} id="h-bot"   style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Left}   id="h-left"  style={isEdit ? handleStyle : HIDDEN} />
      <Handle type="source" position={Position.Right}  id="h-right" style={isEdit ? handleStyle : HIDDEN} />

      {/* Header band with lucide Flag icon */}
      <div className="bg-purple-600 px-3 py-2 flex items-center gap-2">
        <Flag className="h-4 w-4 text-white flex-shrink-0" />
        <span className="text-sm font-bold text-white tracking-wide truncate">{d.label || 'Complete'}</span>
      </div>

      {/* Notification info */}
      <div className="px-3 py-2">
        {notifyEnabled ? (
          <>
            <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-0.5">On completion</p>
            <p className="text-xs text-gray-700 font-medium leading-snug">
              {recipients.length > 0
                ? `Notify: ${recipients.join(' & ')}`
                : 'Completion notification enabled'}
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-400 italic">No completion notification</p>
        )}
      </div>
    </div>
  );
}

export const StartNodeMemo = memo(StartNode);
export const EndNodeMemo = memo(EndNode);
