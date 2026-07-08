'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { GroupNode } from '@/lib/timesheets/compute';
import { valueOf } from '@/lib/timesheets/compute';
import type { TimeEntry } from '@/lib/timesheets/types';
import { fmtDuration, fmtPct, fmtGBPCompact, fmtDateUK } from '@/lib/timesheets/format';
import { TYPE_COLORS } from '@/lib/timesheets/palette';

const INDENT = 16;

function EntryRows({ entries, depth }: { entries: TimeEntry[]; depth: number }) {
  return (
    <div>
      {entries.map(e => (
        <div
          key={e.id}
          className="flex items-center gap-2 py-1 text-[11px] text-[var(--text-muted)]"
          style={{ paddingLeft: depth * INDENT + 26 }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TYPE_COLORS[e.type] }} />
          <span className="w-12 shrink-0 tabular-nums">{fmtDateUK(e.date).slice(0, 5)}</span>
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
            {e.taskTitle || e.activity || 'Work'}
            {e.notes ? <span className="text-[var(--text-muted)]"> · {e.notes}</span> : null}
          </span>
          <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-[var(--text-primary)]">{fmtDuration(e.minutes)}</span>
          <span className="w-14 shrink-0 text-right tabular-nums">{e.type === 'billable' ? fmtGBPCompact(valueOf(e)) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function NodeRow({ node, depth, color, maxMinutes }: { node: GroupNode; depth: number; color: string; maxMinutes: number }) {
  const [open, setOpen] = useState(false);
  const kids = node.children ?? null;
  const leaf = node.entries ?? null;
  const expandable = (kids?.length ?? 0) > 0 || (leaf?.length ?? 0) > 0;
  const childMax = kids?.length ? Math.max(1, ...kids.map(k => k.minutes)) : 1;
  const billablePct = node.minutes ? node.billableMinutes / node.minutes : 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen(o => !o)}
        className={`flex w-full items-center gap-2 rounded-lg py-1.5 pr-1 text-left transition-colors ${expandable ? 'hover:bg-black/[0.03]' : 'cursor-default'}`}
        style={{ paddingLeft: depth * INDENT + 4 }}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''} ${expandable ? '' : 'opacity-0'}`}
        />
        <span className="w-40 shrink-0 truncate text-[12.5px] font-medium text-[var(--text-primary)]">{node.label}</span>
        <div className="relative h-4 flex-1 overflow-hidden rounded bg-black/[0.04]">
          <div
            className="h-full rounded"
            style={{ width: `${Math.max(2, (node.minutes / maxMinutes) * 100)}%`, background: color, opacity: depth === 0 ? 1 : 0.5 }}
          />
        </div>
        <span className="w-12 shrink-0 text-right text-[10.5px] tabular-nums text-[var(--text-muted)]">{fmtPct(billablePct)}</span>
        <span className="w-16 shrink-0 text-right text-[12px] font-bold tabular-nums text-[var(--text-primary)]">{fmtDuration(node.minutes)}</span>
        <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-[var(--text-muted)]">{fmtGBPCompact(node.valuePence)}</span>
      </button>

      {open && kids && kids.map(c => (
        <NodeRow key={c.key} node={c} depth={depth + 1} color={color} maxMinutes={childMax} />
      ))}
      {open && leaf && <EntryRows entries={leaf} depth={depth + 1} />}
    </div>
  );
}

/** Renders a drill-down tree of GroupNodes. Each top-level node gets a colour;
 *  its subtree shares that hue (lighter) so a branch reads as one group. */
export default function BreakdownTree({ nodes, colorFor }: { nodes: GroupNode[]; colorFor: (i: number) => string }) {
  if (nodes.length === 0) {
    return <p className="py-8 text-center text-[12px] text-[var(--text-muted)]">No entries for this selection.</p>;
  }
  const max = Math.max(1, ...nodes.map(n => n.minutes));
  return (
    <div>
      {/* Column header */}
      <div className="mb-1 flex items-center gap-2 border-b border-black/5 px-1 pb-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]" style={{ paddingLeft: 21 }}>
        <span className="w-40 shrink-0">Name</span>
        <span className="flex-1">Share of time</span>
        <span className="w-12 shrink-0 text-right">Bill.</span>
        <span className="w-16 shrink-0 text-right">Hours</span>
        <span className="w-16 shrink-0 text-right">Fees</span>
      </div>
      {nodes.map((n, i) => (
        <NodeRow key={n.key} node={n} depth={0} color={colorFor(i)} maxMinutes={max} />
      ))}
    </div>
  );
}
