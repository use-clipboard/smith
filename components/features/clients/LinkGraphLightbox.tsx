'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ReactFlow, Background, Controls, MarkerType,
  type Node, type Edge, type EdgeProps, BaseEdge, EdgeLabelRenderer, getSmoothStepPath,
  Handle, Position, type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { X } from 'lucide-react';
import type { GraphNode, GraphEdge } from '@/app/api/clients/[id]/links/graph/route';
import { ENTITY_STYLE, FALLBACK_STYLE } from '@/components/features/clients/entityVisuals';
import { LINK_TYPE_EDGE_COLOR, linkForwardLabel } from '@/lib/clientLinks';

// ── Constants ────────────────────────────────────────────────────────────────
// Entity styling and link colours/labels come from the shared modules above so
// the connections map and the link editor stay visually identical.

const NODE_WIDTH = 220;
const NODE_HEIGHT = 108;

// ── Custom Entity Node ───────────────────────────────────────────────────────

interface EntityNodeData extends Record<string, unknown> {
  name: string;
  client_ref: string | null;
  business_type: string | null;
  status: string;
  isRoot: boolean;
  onOpen: (id: string) => void;
  id: string;
  highlighted: boolean;
  dimmed: boolean;
}

function EntityNode({ data }: NodeProps) {
  const d = data as EntityNodeData;
  const style = ENTITY_STYLE[d.business_type ?? ''] ?? FALLBACK_STYLE;
  const Icon = style.Icon;

  const isInactive = d.status === 'inactive';
  const isHold = d.status === 'hold';

  const shapeStyles =
    style.shape === 'circle'  ? { borderRadius: 9999 } :
    style.shape === 'diamond' ? { transform: 'rotate(45deg)' } :
    style.shape === 'pill'    ? { borderRadius: 9999 } :
                                { borderRadius: 12 };

  let bgColor = style.bg;
  let borderColor = style.border;
  let textColor = style.text;
  let opacity = 1;
  let statusBadge: { label: string; color: string; bg: string } | null = null;

  if (isInactive) {
    bgColor = '#f3f4f6';
    borderColor = '#9ca3af';
    textColor = '#6b7280';
    opacity = 0.7;
    statusBadge = { label: 'INACTIVE', color: '#374151', bg: '#e5e7eb' };
  } else if (isHold) {
    bgColor = '#ffedd5';
    borderColor = '#f97316';
    textColor = '#9a3412';
    opacity = 0.85;
    statusBadge = { label: 'ON HOLD', color: '#9a3412', bg: '#fed7aa' };
  }

  if (d.highlighted) {
    opacity = 1;
  } else if (d.dimmed) {
    opacity = opacity * 0.35;
  }

  const highlightShadow = d.highlighted
    ? `0 0 0 4px ${borderColor}66, 0 6px 18px ${borderColor}55`
    : d.isRoot
      ? `0 0 0 4px ${borderColor}33, 0 4px 12px rgba(0,0,0,0.08)`
      : '0 2px 6px rgba(0,0,0,0.06)';

  return (
    <div
      style={{
        position: 'relative', width: NODE_WIDTH, height: NODE_HEIGHT, opacity, cursor: 'pointer',
        transform: d.highlighted ? 'scale(1.04)' : undefined,
        transition: 'opacity 0.15s ease, transform 0.15s ease',
      }}
      onClick={(e) => { e.stopPropagation(); d.onOpen(d.id); }}
    >
      <Handle type="target" position={Position.Top} style={{ background: 'transparent', border: 'none', pointerEvents: 'none' }} />
      <div
        style={{
          position: 'absolute', inset: 0,
          background: bgColor,
          border: `${d.isRoot || d.highlighted ? 3 : 2}px solid ${borderColor}`,
          boxShadow: highlightShadow,
          ...shapeStyles,
          transition: 'box-shadow 0.15s ease, border-width 0.15s ease',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute', inset: 0, padding: 10, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center', textAlign: 'center', gap: 3,
          color: textColor, pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 }}>
          <Icon size={12} />
          <span>{style.label}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {d.name}
        </div>
        {d.client_ref && (
          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', opacity: 0.7 }}>{d.client_ref}</div>
        )}
        {statusBadge && (
          <span style={{ marginTop: 2, padding: '1px 8px', fontSize: 9, borderRadius: 4, background: statusBadge.bg, color: statusBadge.color, fontWeight: 700, letterSpacing: 0.4 }}>
            {statusBadge.label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'transparent', border: 'none', pointerEvents: 'none' }} />
    </div>
  );
}

// ── Custom Hover-Label Edge ──────────────────────────────────────────────────

interface LinkEdgeData extends Record<string, unknown> {
  link_type: string;
  notes: string | null;
  /** Stagger offset in pixels for the orthogonal mid-line so parallel edges don't overlap */
  laneOffset: number;
  hovered: boolean;
  dimmed: boolean;
  onHoverChange: (id: string | null) => void;
}

function LinkEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, markerEnd }: EdgeProps) {
  const ed = data as LinkEdgeData | undefined;
  const linkType = ed?.link_type ?? 'other';
  const notes = ed?.notes ?? null;
  const laneOffset = ed?.laneOffset ?? 0;
  const hovered = ed?.hovered ?? false;
  const dimmed = ed?.dimmed ?? false;
  const color = LINK_TYPE_EDGE_COLOR[linkType] ?? LINK_TYPE_EDGE_COLOR.other;
  const label = linkForwardLabel(linkType);

  const midY = (sourceY + targetY) / 2 + laneOffset;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    borderRadius: 0,
    centerY: midY,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: hovered ? 3.5 : 2,
          opacity: dimmed ? 0.2 : 1,
          transition: 'opacity 0.15s ease, stroke-width 0.15s ease',
        }}
      />
      {/* Wide invisible hit area for hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        style={{ cursor: 'help', pointerEvents: 'stroke' }}
        onMouseEnter={() => ed?.onHoverChange(id)}
        onMouseLeave={() => ed?.onHoverChange(null)}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              borderRadius: 8, overflow: 'hidden', pointerEvents: 'none',
              boxShadow: '0 4px 12px rgba(0,0,0,0.18)', zIndex: 1000,
              maxWidth: 260,
            }}
            className="nodrag nopan"
          >
            <div style={{ background: color, color: 'white', padding: '4px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {label}
            </div>
            {notes && (
              <div style={{
                background: 'white', color: '#374151', padding: '6px 10px',
                fontSize: 11, fontWeight: 400, lineHeight: 1.35,
                borderTop: `2px solid ${color}`, whiteSpace: 'normal',
              }}>
                {notes}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ── Layout via dagre ─────────────────────────────────────────────────────────

function layoutGraph(nodes: Node[], edges: Edge[]): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 160, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const e of edges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  return {
    nodes: nodes.map(n => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
    }),
    edges,
  };
}

// ── Lightbox ─────────────────────────────────────────────────────────────────

interface LinkGraphLightboxProps {
  clientId: string;
  onClose: () => void;
}

const NODE_TYPES = { entity: EntityNode };
const EDGE_TYPES = { link: LinkEdge };

export default function LinkGraphLightbox({ clientId, onClose }: LinkGraphLightboxProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraph] = useState<{ rootId: string; nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hideInactive, setHideInactive] = useState(false);
  const [hideOnHold, setHideOnHold] = useState(false);

  // Filter the graph based on status toggles. The root client is always shown
  // (the user is viewing the connections OF this client) so they don't end up
  // staring at an empty canvas if the client itself is inactive/on-hold.
  const filteredGraph = useMemo(() => {
    if (!graph) return null;
    const visibleNodes = graph.nodes.filter(n =>
      n.id === graph.rootId ||
      (n.status === 'inactive' ? !hideInactive : true) &&
      (n.status === 'hold' ? !hideOnHold : true),
    );
    const visibleIds = new Set(visibleNodes.map(n => n.id));
    const visibleEdges = graph.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
    const counts = {
      inactive: graph.nodes.filter(n => n.status === 'inactive' && n.id !== graph.rootId).length,
      hold: graph.nodes.filter(n => n.status === 'hold' && n.id !== graph.rootId).length,
    };
    return { rootId: graph.rootId, nodes: visibleNodes, edges: visibleEdges, counts };
  }, [graph, hideInactive, hideOnHold]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/clients/${clientId}/links/graph`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || 'Failed to load')))
      .then(d => { if (!cancelled) { setGraph(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(typeof e === 'string' ? e : 'Failed to load graph'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [clientId]);

  // Esc to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleOpen = useCallback((id: string) => {
    if (id === clientId) return;
    onClose();
    router.push(`/clients/${id}`);
  }, [clientId, onClose, router]);

  // Stable layout — recomputed when the filtered graph changes.
  const layout = useMemo(() => {
    if (!filteredGraph) return { nodes: [] as Node[], edges: [] as Edge[] };
    const rfNodes: Node[] = filteredGraph.nodes.map(n => ({
      id: n.id,
      type: 'entity',
      data: {
        name: n.name, client_ref: n.client_ref, business_type: n.business_type,
        status: n.status, isRoot: n.id === filteredGraph.rootId, onOpen: handleOpen, id: n.id,
        highlighted: false, dimmed: false,
      } satisfies EntityNodeData,
      position: { x: 0, y: 0 },
    }));
    const rfEdges: Edge[] = filteredGraph.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'link',
      data: { link_type: e.link_type, notes: e.notes, laneOffset: 0, hovered: false, dimmed: false, onHoverChange: () => {} } satisfies LinkEdgeData,
      markerEnd: { type: MarkerType.ArrowClosed, color: LINK_TYPE_EDGE_COLOR[e.link_type] ?? LINK_TYPE_EDGE_COLOR.other },
    }));
    const laid = layoutGraph(rfNodes, rfEdges);
    const nodePos: Record<string, { x: number; y: number }> = {};
    for (const n of laid.nodes) nodePos[n.id] = n.position;
    const groups: Record<string, Edge[]> = {};
    for (const e of laid.edges) {
      const sy = nodePos[e.source]?.y ?? 0;
      const ty = nodePos[e.target]?.y ?? 0;
      const key = `${Math.round(sy)}->${Math.round(ty)}`;
      (groups[key] ??= []).push(e);
    }
    const LANE_GAP = 14;
    const stagger: Record<string, number> = {};
    for (const grp of Object.values(groups)) {
      if (grp.length <= 1) continue;
      grp.sort((a, b) => (nodePos[a.source]?.x ?? 0) - (nodePos[b.source]?.x ?? 0));
      const start = -((grp.length - 1) / 2) * LANE_GAP;
      grp.forEach((e, i) => { stagger[e.id] = start + i * LANE_GAP; });
    }
    laid.edges = laid.edges.map(e => ({
      ...e,
      data: { ...(e.data as LinkEdgeData), laneOffset: stagger[e.id] ?? 0 },
    }));
    return laid;
  }, [filteredGraph, handleOpen]);

  // Apply hover highlight as a cheap pass over the laid-out elements.
  const { nodes, edges } = useMemo(() => {
    const hoveredEdge = hoveredEdgeId ? layout.edges.find(e => e.id === hoveredEdgeId) : null;
    const highlightIds: Set<string> = hoveredEdge ? new Set([hoveredEdge.source, hoveredEdge.target]) : new Set();
    const dimming = hoveredEdgeId !== null;

    const nextNodes = layout.nodes.map(n => ({
      ...n,
      data: {
        ...(n.data as EntityNodeData),
        highlighted: highlightIds.has(n.id),
        dimmed: dimming && !highlightIds.has(n.id),
      } satisfies EntityNodeData,
    }));
    const nextEdges = layout.edges.map(e => ({
      ...e,
      data: {
        ...(e.data as LinkEdgeData),
        hovered: e.id === hoveredEdgeId,
        dimmed: dimming && e.id !== hoveredEdgeId,
        onHoverChange: setHoveredEdgeId,
      } satisfies LinkEdgeData,
    }));
    return { nodes: nextNodes, edges: nextEdges };
  }, [layout, hoveredEdgeId]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[88vh] flex flex-col overflow-hidden border border-[var(--border)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Connections Map</h2>
            <p className="text-xs text-[var(--text-muted)]">All entities connected to this client. Hover an arrow for the relationship type. Click a node to open it.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {filteredGraph && (filteredGraph.counts.hold > 0 || filteredGraph.counts.inactive > 0) && (
              <div className="flex items-center gap-3 pr-2">
                {filteredGraph.counts.hold > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                    <input type="checkbox" checked={!hideOnHold} onChange={e => setHideOnHold(!e.target.checked)} className="accent-orange-500" />
                    <span>Show on-hold <span className="text-[var(--text-muted)]">({filteredGraph.counts.hold})</span></span>
                  </label>
                )}
                {filteredGraph.counts.inactive > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                    <input type="checkbox" checked={!hideInactive} onChange={e => setHideInactive(!e.target.checked)} className="accent-gray-500" />
                    <span>Show inactive <span className="text-[var(--text-muted)]">({filteredGraph.counts.inactive})</span></span>
                  </label>
                )}
              </div>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 relative bg-white">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">Loading connections…</div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-red-600">{error}</div>
          )}
          {!loading && !error && graph && nodes.length <= 1 && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--text-muted)]">No connections to display yet.</div>
          )}
          {!loading && !error && nodes.length > 1 && (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onNodeClick={(_e, n) => handleOpen(n.id)}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} color="#e5e7eb" />
              <Controls showInteractive={false} />
            </ReactFlow>
          )}
        </div>

        {/* Legend */}
        <div className="px-6 py-3 border-t border-[var(--border)] bg-white flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="font-semibold text-[var(--text-muted)] uppercase tracking-wide">Entities:</span>
          {Object.entries(ENTITY_STYLE).map(([key, s]) => (
            <span key={key} className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <span style={{ width: 10, height: 10, background: s.bg, border: `2px solid ${s.border}`, borderRadius: s.shape === 'circle' || s.shape === 'pill' ? 9999 : 3, transform: s.shape === 'diamond' ? 'rotate(45deg)' : undefined, display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
