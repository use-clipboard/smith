'use client';

import { useCallback, useMemo, useState } from 'react';
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

// ── PDF/PNG export ────────────────────────────────────────────────────────────
// We build a self-contained SVG of the whole tree rather than screenshotting the
// live ReactFlow canvas: html2canvas drops ReactFlow's edge SVG (so the connector
// lines vanish) and renders the white cards indistinctly. A hand-built SVG gives
// crisp text, guaranteed card borders, and explicit connector lines every time.

const AVATAR_HEX = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6'];
// Mirrors avatarColour()'s hash so exported avatars match the on-screen colours.
function avatarHex(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HEX[hash % AVATAR_HEX.length];
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

// Approximate single-line truncation to a pixel width (SVG can't auto-ellipsize).
function fitText(s: string, maxW: number, fs: number, bold: boolean): string {
  const charW = fs * (bold ? 0.62 : 0.55);
  const max = Math.floor(maxW / charW);
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)).trimEnd() + '…';
}

function buildOrgChartSvg(nodes: Node[], edges: Edge[]): { svg: string; width: number; height: number } {
  const PAD = 56;
  const minX = Math.min(...nodes.map(n => n.position.x));
  const minY = Math.min(...nodes.map(n => n.position.y));
  const maxX = Math.max(...nodes.map(n => n.position.x + NODE_WIDTH));
  const maxY = Math.max(...nodes.map(n => n.position.y + NODE_HEIGHT));
  const width = Math.ceil(maxX - minX + PAD * 2);
  const height = Math.ceil(maxY - minY + PAD * 2);
  const offX = PAD - minX, offY = PAD - minY;

  const pos = new Map(nodes.map(n => [n.id, n.position] as const));

  // Edges: orthogonal parent-bottom → child-top connectors (matches the on-screen
  // smoothstep shape closely enough) with a small arrowhead into each report.
  const edgeMarkup = edges.map(e => {
    const s = pos.get(e.source), t = pos.get(e.target);
    if (!s || !t) return '';
    const sx = s.x + NODE_WIDTH / 2 + offX, sy = s.y + NODE_HEIGHT + offY;
    const tx = t.x + NODE_WIDTH / 2 + offX, ty = t.y + offY;
    const midY = (sy + ty) / 2;
    return `<path d="M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}" fill="none" stroke="#94a3b8" stroke-width="1.5" marker-end="url(#arrow)"/>`;
  }).join('');

  const TEXT_W = NODE_WIDTH - 62 - 10; // card width minus avatar column and right padding
  const nodeMarkup = nodes.map(n => {
    const d = n.data as PersonNodeData;
    const name = fitText(d.name || d.email, TEXT_W, 13, true);
    const hasTitle = !!d.jobTitle;
    const title = fitText(hasTitle ? d.jobTitle : 'No title', TEXT_W, 11, false);
    const avatar = avatarHex(d.userId);
    const ini = initials(d.name, d.email);
    let badge = '';
    if (d.departmentName) {
      const label = d.departmentName.toUpperCase();
      const bw = Math.min(TEXT_W, label.length * 6.4 + 16);
      const col = d.departmentColor || '#64748b';
      badge = `<rect x="62" y="56" width="${bw.toFixed(1)}" height="16" rx="8" fill="${col}" fill-opacity="0.15"/>`
        + `<text x="${(62 + bw / 2).toFixed(1)}" y="67" text-anchor="middle" font-size="9" font-weight="700" letter-spacing="0.4" fill="${col}">${escapeXml(label)}</text>`;
    }
    return `<g transform="translate(${n.position.x + offX} ${n.position.y + offY})">`
      + `<rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="12" fill="#ffffff" stroke="#e2e8f0" stroke-width="1" filter="url(#nshadow)"/>`
      + `<circle cx="32" cy="42" r="20" fill="${avatar}"/>`
      + `<text x="32" y="42" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="700" fill="#ffffff">${escapeXml(ini)}</text>`
      + `<text x="62" y="34" font-size="13" font-weight="700" fill="#0f172a">${escapeXml(name)}</text>`
      + `<text x="62" y="50" font-size="11" fill="#64748b"${hasTitle ? '' : ' font-style="italic"'}>${escapeXml(title)}</text>`
      + badge
      + `</g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif">`
    + '<defs>'
    + '<filter id="nshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#0f172a" flood-opacity="0.08"/></filter>'
    + '<marker id="arrow" markerWidth="7" markerHeight="7" refX="5.5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L6,3 L0,6 z" fill="#94a3b8"/></marker>'
    + '</defs>'
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`
    + edgeMarkup
    + nodeMarkup
    + '</svg>';
  return { svg, width, height };
}

interface Props {
  team: TeamMember[];
  departments: Department[];
}

export default function HrOrgChart({ team, departments }: Props) {
  const [highlightedDept, setHighlightedDept] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

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

  // Export the whole org chart as a single high-resolution PNG. We render the tree
  // to a self-contained SVG (see buildOrgChartSvg) and rasterise it at 2× — this
  // always includes every node, the connector lines, and the current department
  // colours, regardless of the on-screen zoom/pan or highlight filter. A PNG (not
  // a PDF) sidesteps fixed page sizes: a wide firm chart is just a wide image that
  // any viewer fits to the window.
  const exportImage = useCallback(async () => {
    if (nodes.length === 0) return;
    setExporting(true);
    setExportError(null);

    try {
      const { svg, width, height } = buildOrgChartSvg(nodes, edges);
      const SCALE = 2;

      const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('SVG failed to load'));
          img.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = width * SCALE;
        canvas.height = height * SCALE;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context unavailable');
        ctx.scale(SCALE, SCALE);
        ctx.drawImage(img, 0, 0);

        const blob: Blob = await new Promise((resolve, reject) => {
          canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png');
        });

        const today = new Date();
        const stamp = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Org-Chart-${stamp}.png`;
        a.click();
        URL.revokeObjectURL(url);
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
    } catch (err) {
      console.error('Org chart image export failed', err);
      setExportError("Sorry — we couldn't generate the image. Please try again.");
    } finally {
      setExporting(false);
    }
  }, [nodes, edges]);

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

        {/* Download the full chart as a PNG image */}
        <button
          onClick={exportImage}
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
              Download image
            </>
          )}
        </button>
      </div>

      {exportError && (
        <p className="text-xs text-red-600" role="alert">{exportError}</p>
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
