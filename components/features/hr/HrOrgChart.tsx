'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, MarkerType,
  type Node, type Edge, Handle, Position, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember, Department } from './HrClient';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 84;
const H_GAP = 32;       // horizontal gap between sibling subtrees
const V_GAP = 80;       // vertical gap between layers

// Lightweight top-down tree layout. Each forest root is laid out independently
// then placed side-by-side, so multiple "roots" (e.g. CEO + an unmanaged contractor)
// don't overlap. Subtree widths are computed bottom-up; nodes are then placed by
// centring each parent over the span of its children.
interface LayoutResult { positions: Map<string, { x: number; y: number }> }

function layoutTree(team: TeamMember[]): LayoutResult {
  const positions = new Map<string, { x: number; y: number }>();
  if (team.length === 0) return { positions };

  const idSet = new Set(team.map(m => m.id));
  // Children-of map: parent_id → child[]
  const children = new Map<string, string[]>();
  for (const m of team) {
    if (m.manager_id && idSet.has(m.manager_id)) {
      const arr = children.get(m.manager_id) ?? [];
      arr.push(m.id);
      children.set(m.manager_id, arr);
    }
  }
  // Roots: users whose manager isn't in the team (or is null)
  const roots = team
    .filter(m => !m.manager_id || !idSet.has(m.manager_id))
    .map(m => m.id);
  // Cycle-safety: visited set
  const visited = new Set<string>();

  // Compute subtree width (in node-widths) for layout
  const subtreeWidth = new Map<string, number>();
  function computeWidth(id: string): number {
    if (subtreeWidth.has(id)) return subtreeWidth.get(id)!;
    if (visited.has(id)) { subtreeWidth.set(id, 1); return 1; } // cycle guard
    visited.add(id);
    const kids = children.get(id) ?? [];
    if (kids.length === 0) { subtreeWidth.set(id, 1); return 1; }
    const total = kids.reduce((acc, c) => acc + computeWidth(c), 0);
    const w = Math.max(1, total);
    subtreeWidth.set(id, w);
    return w;
  }
  roots.forEach(r => computeWidth(r));

  // Place: each root takes a slot of its subtreeWidth * (NODE_WIDTH + H_GAP)
  function place(id: string, leftPx: number, depth: number, placedSet: Set<string>): number {
    if (placedSet.has(id)) return leftPx;
    placedSet.add(id);
    const kids = children.get(id) ?? [];
    const myWidth = subtreeWidth.get(id) ?? 1;
    const myWidthPx = myWidth * NODE_WIDTH + Math.max(0, myWidth - 1) * H_GAP;
    if (kids.length > 0) {
      let cursor = leftPx;
      const childCenters: number[] = [];
      for (const c of kids) {
        const childWidth = subtreeWidth.get(c) ?? 1;
        const childWidthPx = childWidth * NODE_WIDTH + Math.max(0, childWidth - 1) * H_GAP;
        const childCenter = cursor + childWidthPx / 2;
        childCenters.push(childCenter);
        place(c, cursor, depth + 1, placedSet);
        cursor += childWidthPx + H_GAP;
      }
      // Centre this node over its children
      const cx = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
      positions.set(id, { x: cx - NODE_WIDTH / 2, y: depth * (NODE_HEIGHT + V_GAP) });
    } else {
      positions.set(id, { x: leftPx + (myWidthPx - NODE_WIDTH) / 2, y: depth * (NODE_HEIGHT + V_GAP) });
    }
    return leftPx + myWidthPx;
  }

  let cursor = 0;
  const placed = new Set<string>();
  for (const r of roots) {
    const w = subtreeWidth.get(r) ?? 1;
    place(r, cursor, 0, placed);
    cursor += w * NODE_WIDTH + Math.max(0, w - 1) * H_GAP + H_GAP * 2;
  }

  // Stragglers: anyone not yet placed (cycles, or orphans we missed). Drop them
  // on a separate row at the bottom so the chart still renders something.
  const maxDepth = Math.max(0, ...Array.from(positions.values()).map(p => Math.floor(p.y / (NODE_HEIGHT + V_GAP))));
  let strayCursor = 0;
  for (const m of team) {
    if (!positions.has(m.id)) {
      positions.set(m.id, { x: strayCursor, y: (maxDepth + 1) * (NODE_HEIGHT + V_GAP) });
      strayCursor += NODE_WIDTH + H_GAP;
    }
  }

  return { positions };
}

interface PersonNodeData extends Record<string, unknown> {
  name: string;
  email: string;
  jobTitle: string;
  departmentName: string;
  departmentColor: string | null;
  highlighted: boolean;
  dimmed: boolean;
  userId: string;
  /** Number of completed years of service today (0 if started <1 year ago, null if unknown). */
  yearsOfService: number | null;
  /** Whether today is the work anniversary (within ±1 day). */
  isAnniversaryThisWeek: boolean;
  /** Whether today is the birthday (within ±3 days) — only if shared. */
  isBirthdayThisWeek: boolean;
}

// Returns true if the iso date's month/day falls within `days` of today.
function isWithinDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const today = new Date();
  const d = new Date(iso + 'T12:00:00Z');
  const thisYearAnniv = new Date(today.getFullYear(), d.getUTCMonth(), d.getUTCDate());
  const diff = Math.abs((thisYearAnniv.getTime() - today.getTime()) / 86_400_000);
  // Also handle year-boundary
  const lastYear = new Date(today.getFullYear() - 1, d.getUTCMonth(), d.getUTCDate());
  const nextYear = new Date(today.getFullYear() + 1, d.getUTCMonth(), d.getUTCDate());
  return diff <= days
    || Math.abs((lastYear.getTime() - today.getTime()) / 86_400_000) <= days
    || Math.abs((nextYear.getTime() - today.getTime()) / 86_400_000) <= days;
}

function yearsOfServiceFor(startIso: string | null): number | null {
  if (!startIso) return null;
  const start = new Date(startIso + 'T12:00:00Z');
  const now = new Date();
  let years = now.getFullYear() - start.getUTCFullYear();
  const beforeAnniv = (now.getMonth() < start.getUTCMonth()) ||
    (now.getMonth() === start.getUTCMonth() && now.getDate() < start.getUTCDate());
  if (beforeAnniv) years -= 1;
  return Math.max(0, years);
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
      {(d.isBirthdayThisWeek || d.isAnniversaryThisWeek) && (
        <div className="absolute -top-2 -right-2 flex gap-1">
          {d.isBirthdayThisWeek && (
            <span title="Birthday this week" className="text-[10px] bg-pink-500 text-white px-1.5 py-0.5 rounded-full font-bold shadow">🎂</span>
          )}
          {d.isAnniversaryThisWeek && d.yearsOfService != null && d.yearsOfService > 0 && (
            <span title={`${d.yearsOfService}-year work anniversary`} className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold shadow">🎉 {d.yearsOfService}y</span>
          )}
        </div>
      )}
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
          yearsOfService: yearsOfServiceFor(m.employment_start_date),
          isAnniversaryThisWeek: isWithinDays(m.employment_start_date, 3),
          isBirthdayThisWeek: m.show_birthday_to_team && isWithinDays(m.date_of_birth, 3),
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

    // DIY top-down tree layout (avoids the dagre dependency)
    const { positions } = layoutTree(team);
    nodes.forEach(n => {
      const p = positions.get(n.id);
      if (p) n.position = p;
    });
    return { nodes, edges };
  }, [team, departmentMap, highlightedDept]);

  // Export the whole org chart to a single-page PDF. We screenshot ReactFlow's
  // `.react-flow__viewport` (which holds only the nodes + edges — not the dotted
  // background or the zoom controls) after temporarily setting its transform to
  // frame every node, so the export always contains the full tree regardless of
  // the user's current zoom/pan or the active highlight filter.
  const exportPdf = useCallback(async () => {
    const container = containerRef.current;
    const viewport = container?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewport || nodes.length === 0) return;

    setExporting(true);
    setExportError(null);
    // Snapshot the styles we override so we can always restore the live view.
    const prevTransform = viewport.style.transform;
    const prevWidth = viewport.style.width;
    const prevHeight = viewport.style.height;

    try {
      const { default: html2canvas } = await import('html2canvas');
      const { default: jsPDF } = await import('jspdf');

      const PAD = 48; // px of whitespace around the tree
      const minX = Math.min(...nodes.map(n => n.position.x));
      const minY = Math.min(...nodes.map(n => n.position.y));
      const maxX = Math.max(...nodes.map(n => n.position.x + NODE_WIDTH));
      const maxY = Math.max(...nodes.map(n => n.position.y + NODE_HEIGHT));
      const layoutW = Math.ceil(maxX - minX + PAD * 2);
      const layoutH = Math.ceil(maxY - minY + PAD * 2);

      // Frame the whole tree at 1:1 with the top-left node at (PAD, PAD).
      viewport.style.transform = `translate(${PAD - minX}px, ${PAD - minY}px) scale(1)`;
      viewport.style.width = `${layoutW}px`;
      viewport.style.height = `${layoutH}px`;

      const canvas = await html2canvas(viewport, {
        width: layoutW,
        height: layoutH,
        windowWidth: layoutW,
        windowHeight: layoutH,
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        onclone: (_doc, clonedViewport) => {
          // Always export the complete chart: undo any highlight dimming/rings so
          // the PDF looks the same whether or not a department filter is active.
          clonedViewport.querySelectorAll<HTMLElement>('.react-flow__node > div').forEach(el => {
            el.style.opacity = '1';
            el.style.boxShadow = 'none';
            el.style.outline = 'none';
          });
          clonedViewport.querySelectorAll<HTMLElement>('.react-flow__edge path').forEach(el => {
            el.style.opacity = '1';
          });
        },
      });

      // Choose a page: native size on A4 landscape if it fits; scale down onto A4
      // landscape if that stays legible; otherwise a single wide custom sheet sized
      // to the chart so nodes never shrink to unreadable and nothing is cropped.
      const PX_TO_MM = 25.4 / 96;
      const wmm = layoutW * PX_TO_MM;
      const hmm = layoutH * PX_TO_MM;
      const A4_W = 297, A4_H = 210, MARGIN = 10;
      const availW = A4_W - MARGIN * 2, availH = A4_H - MARGIN * 2;

      let pageW: number, pageH: number, drawW: number, drawH: number;
      if (wmm <= availW && hmm <= availH) {
        pageW = A4_W; pageH = A4_H; drawW = wmm; drawH = hmm;
      } else {
        const fit = Math.min(availW / wmm, availH / hmm);
        if (fit >= 0.5) {
          pageW = A4_W; pageH = A4_H; drawW = wmm * fit; drawH = hmm * fit;
        } else {
          pageW = wmm + MARGIN * 2; pageH = hmm + MARGIN * 2; drawW = wmm; drawH = hmm;
        }
      }

      const landscape = pageW >= pageH;
      const pdf = new jsPDF({
        orientation: landscape ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [Math.max(pageW, pageH), Math.min(pageW, pageH)],
      });
      const actualW = pdf.internal.pageSize.getWidth();
      const actualH = pdf.internal.pageSize.getHeight();
      pdf.addImage(
        canvas.toDataURL('image/png'), 'PNG',
        (actualW - drawW) / 2, (actualH - drawH) / 2, drawW, drawH,
      );

      const today = new Date();
      const stamp = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
      pdf.save(`Org-Chart-${stamp}.pdf`);
    } catch (err) {
      console.error('Org chart PDF export failed', err);
      setExportError("Sorry — we couldn't generate the PDF. Please try again.");
    } finally {
      viewport.style.transform = prevTransform;
      viewport.style.width = prevWidth;
      viewport.style.height = prevHeight;
      setExporting(false);
    }
  }, [nodes]);

  if (team.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[var(--border)] p-12 text-center">
        <p className="text-sm text-[var(--text-muted)]">No team members yet — add some in Settings → HR → Team & Roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        {/* Department filter chips */}
        {departments.length > 0 && (
          <>
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
          </>
        )}

        {/* Download the full chart as a PDF */}
        <button
          onClick={exportPdf}
          disabled={exporting}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {exporting ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating…
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </>
          )}
        </button>
      </div>

      {exportError && (
        <p className="text-xs text-red-600" role="alert">{exportError}</p>
      )}

      <div ref={containerRef} className="bg-white rounded-xl border border-[var(--border)] overflow-hidden" style={{ height: 600 }}>
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
