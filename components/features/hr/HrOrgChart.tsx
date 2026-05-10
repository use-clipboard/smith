'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, Background, Controls, MarkerType,
  type Node, type Edge, Handle, Position, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember, Department } from './HrClient';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 84;

interface PersonNodeData extends Record<string, unknown> {
  name: string;
  email: string;
  jobTitle: string;
  departmentName: string;
  departmentColor: string | null;
  highlighted: boolean;
  dimmed: boolean;
  userId: string;
}

function PersonNode({ data }: NodeProps) {
  const d = data as PersonNodeData;
  const opacity = d.dimmed ? 'opacity-30' : 'opacity-100';
  const ring = d.highlighted ? 'ring-2 ring-[var(--accent)] ring-offset-2' : '';
  return (
    <div
      className={`relative flex items-center gap-3 bg-white border border-[var(--border)] rounded-xl shadow-sm p-3 transition-all ${opacity} ${ring}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !border-0 !w-2 !h-2" />
      <div className={`h-10 w-10 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 ${avatarColour(d.userId)}`}>
        {initials(d.name, d.email)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{d.name || d.email}</p>
        <p className="text-[11px] text-[var(--text-muted)] truncate">{d.jobTitle || <span className="italic">No title</span>}</p>
        {d.departmentName && (
          <span
            className="inline-block mt-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ background: (d.departmentColor || '#94a3b8') + '22', color: d.departmentColor || '#475569' }}
          >
            {d.departmentName}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !border-0 !w-2 !h-2" />
    </div>
  );
}

const nodeTypes = { person: PersonNode };

interface Props {
  team: TeamMember[];
  departments: Department[];
}

export default function HrOrgChart({ team, departments }: Props) {
  const [highlightedDept, setHighlightedDept] = useState<string | null>(null);

  const departmentMap = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);

  const { nodes, edges } = useMemo(() => {
    if (team.length === 0) return { nodes: [], edges: [] };

    // Build nodes
    const nodes: Node[] = team.map(m => {
      const dept = m.department_id ? departmentMap.get(m.department_id) ?? null : null;
      const highlighted = highlightedDept ? m.department_id === highlightedDept : false;
      const dimmed = highlightedDept ? !highlighted : false;
      return {
        id: m.id,
        type: 'person',
        position: { x: 0, y: 0 },
        data: {
          name: m.full_name ?? m.email,
          email: m.email,
          jobTitle: m.job_title ?? '',
          departmentName: dept?.name ?? '',
          departmentColor: dept?.color ?? null,
          highlighted,
          dimmed,
          userId: m.id,
        } as PersonNodeData,
      };
    });

    // Build edges: from manager → report
    const idSet = new Set(team.map(m => m.id));
    const edges: Edge[] = team
      .filter(m => m.manager_id && idSet.has(m.manager_id))
      .map(m => ({
        id: `e-${m.manager_id}-${m.id}`,
        source: m.manager_id as string,
        target: m.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af' },
        style: { stroke: '#9ca3af', strokeWidth: 1.5, opacity: highlightedDept ? 0.3 : 1 },
        animated: false,
      }));

    // Dagre layout — top-down
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 });
    nodes.forEach(n => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    edges.forEach(e => g.setEdge(e.source, e.target));
    dagre.layout(g);
    nodes.forEach(n => {
      const layout = g.node(n.id);
      if (layout) {
        n.position = { x: layout.x - NODE_WIDTH / 2, y: layout.y - NODE_HEIGHT / 2 };
      }
    });
    return { nodes, edges };
  }, [team, departmentMap, highlightedDept]);

  if (team.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[var(--border)] p-12 text-center">
        <p className="text-sm text-[var(--text-muted)]">No team members yet — add some in Settings → HR → Team & Roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Department filter chips */}
      {departments.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Highlight:</span>
          <button
            onClick={() => setHighlightedDept(null)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              highlightedDept === null
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            All
          </button>
          {departments.map(d => (
            <button
              key={d.id}
              onClick={() => setHighlightedDept(highlightedDept === d.id ? null : d.id)}
              className="text-xs px-2.5 py-1 rounded-full border transition-colors"
              style={{
                background: highlightedDept === d.id ? (d.color || '#6366f1') : 'white',
                color: highlightedDept === d.id ? '#fff' : (d.color || '#374151'),
                borderColor: d.color || '#cbd5e1',
              }}
            >
              {d.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden" style={{ height: 600 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} color="#e5e7eb" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
