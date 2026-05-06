'use client';

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  ReactFlow, Background, Panel,
  useReactFlow,
  type Connection, type Edge, type Node, type EdgeProps,
  type OnConnect, type OnNodesChange, type OnEdgesChange,
  MarkerType, BaseEdge, EdgeLabelRenderer, getBezierPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import StepNode, { type StepNodeData } from './StepNode';
import { MODULES } from '@/config/modules.config';
import type { TaskStep, TaskStepEdge, TaskTemplateStep, TaskTemplateEdge, StepStatus, EdgeConditionType, EdgeConditionConfig } from '@/types';

const NODE_TYPES = { stepNode: StepNode };

// ── Condition colours & labels ────────────────────────────────────────────────

const CONDITION_COLORS: Record<EdgeConditionType, string> = {
  on_complete: '#16a34a',
  timeout:     '#d97706',
  always:      '#6b7280',
};

const CONDITION_LABELS: Record<EdgeConditionType, string> = {
  on_complete: 'On complete',
  timeout:     'After delay',
  always:      'Always',
};

// ── Insertable edge (edit mode only) ─────────────────────────────────────────

interface InsertableEdgeData {
  onInsert?: (fromKey: string, toKey: string) => void;
  onCondition?: (fromKey: string, toKey: string) => void;
  conditionType?: EdgeConditionType | null;
  conditionConfig?: EdgeConditionConfig | null;
  [key: string]: unknown;
}

function InsertableEdge({
  id, sourceX, sourceY, targetX, targetY,
  markerEnd, source, target, data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const edgeData = data as InsertableEdgeData | undefined;

  const conditionType = edgeData?.conditionType ?? null;
  const hasCondition = !!conditionType;
  const edgeColor = conditionType ? (CONDITION_COLORS[conditionType] ?? '#9ca3af') : '#ef4444';

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, curvature: 0.5,
  });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: edgeColor,
          strokeWidth: 2,
          strokeDasharray: hasCondition ? undefined : '5,4',
        }}
      />
      {/* Wide invisible path for hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: 'pointer' }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            position: 'absolute',
            pointerEvents: 'all',
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {hovered ? (
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => { e.stopPropagation(); edgeData?.onInsert?.(source, target); }}
                className="flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-[11px] font-medium rounded-full shadow-md hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                + Insert Step
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); edgeData?.onCondition?.(source, target); }}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-full shadow-md transition-colors whitespace-nowrap text-white"
                style={{ backgroundColor: edgeColor }}
              >
                {hasCondition ? 'Change Condition' : '⚠ Add Condition'}
              </button>
            </div>
          ) : (
            <div
              className="w-4 h-4 rounded-full border-2 border-white shadow"
              style={{ backgroundColor: edgeColor }}
              title={hasCondition ? CONDITION_LABELS[conditionType!] : 'No condition set — click to add'}
            />
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const EDGE_TYPES = { insertable: InsertableEdge };

// ── Placement controller (uses useReactFlow inside ReactFlow context) ─────────

interface PlacementControllerProps {
  placementMode: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  onPlace: (x: number, y: number) => void;
  onCancel: () => void;
  onGhostMove: (pos: { x: number; y: number } | null) => void;
}

function PlacementController({ placementMode, containerRef, onPlace, onCancel, onGhostMove }: PlacementControllerProps) {
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!placementMode) {
      onGhostMove(null);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onGhostMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [placementMode, containerRef, onCancel, onGhostMove]);

  const handlePaneClick = useCallback((e: React.MouseEvent) => {
    if (!placementMode) return;
    const flowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onPlace(flowPos.x - 100, flowPos.y - 40);
  }, [placementMode, screenToFlowPosition, onPlace]);

  if (!placementMode) return null;
  return (
    <div
      className="absolute inset-0 z-10"
      style={{ cursor: 'crosshair' }}
      onClick={handlePaneClick}
    />
  );
}

// ── View mode (task instance) ─────────────────────────────────────────────────

interface ViewFlowChartProps {
  steps: TaskStep[];
  edges: TaskStepEdge[];
  onStepClick?: (stepId: string) => void;
  onStepStatusChange?: (stepId: string, status: StepStatus) => void;
}

export function TaskViewFlowChart({ steps, edges, onStepClick, onStepStatusChange }: ViewFlowChartProps) {
  const nodes: Node[] = useMemo(() => steps.map(s => ({
    id: s.id,
    type: 'stepNode',
    position: { x: s.position_x, y: s.position_y },
    data: {
      label: s.title,
      description: s.description,
      status: s.status,
      assigneeName: s.assignee?.full_name ?? s.assignee?.email ?? null,
      isClientStep: s.is_client_step,
      toolModuleId: s.tool_module_id,
      toolModuleName: s.tool_module_id ? (MODULES.find(m => m.id === s.tool_module_id)?.name ?? null) : null,
      emailReminder: s.email_reminder_enabled,
      mode: 'view',
      onStatusChange: onStepStatusChange ? (status: StepStatus) => onStepStatusChange(s.id, status) : undefined,
    } satisfies StepNodeData,
  })), [steps, onStepStatusChange]);

  const rfEdges: Edge[] = useMemo(() => edges.map(e => {
    const ct = e.condition_type ?? null;
    const edgeColor = ct ? (CONDITION_COLORS[ct] ?? '#9ca3af') : '#d1d5db';
    return {
      id: e.id,
      source: steps.find(s => s.step_key === e.from_step_key)?.id ?? e.from_step_key,
      target: steps.find(s => s.step_key === e.to_step_key)?.id ?? e.to_step_key,
      sourceHandle: e.source_handle ?? undefined,
      targetHandle: e.target_handle ?? undefined,
      label: e.label ?? undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeColor },
      style: { stroke: edgeColor, strokeWidth: 2 },
      labelStyle: { fontSize: 11, fill: '#9ca3af' },
    };
  }), [edges, steps]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      nodeTypes={NODE_TYPES}
      onNodeClick={(_, node) => onStepClick?.(node.id)}
      fitView
      fitViewOptions={{ padding: 0.3 }}
      proOptions={{ hideAttribution: true }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={true}
    >
      <Background gap={20} color="#f3f4f6" />
      <Panel position="bottom-left">
        <p className="text-[11px] text-gray-400 bg-white/80 px-2 py-1 rounded shadow-sm select-none">
          Scroll to zoom · Drag to pan
        </p>
      </Panel>
    </ReactFlow>
  );
}

// ── Edit mode (template builder) ──────────────────────────────────────────────

interface EditFlowChartProps {
  steps: TaskTemplateStep[];
  edges: TaskTemplateEdge[];
  selectedStepKey: string | null;
  onSelectStep: (key: string | null) => void;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onNodePositionChange: (stepKey: string, x: number, y: number) => void;
  placementMode?: boolean;
  onPlaceStep?: (x: number, y: number) => void;
  onCancelPlacement?: () => void;
  onInsertOnEdge?: (fromKey: string, toKey: string) => void;
  onConditionChange?: (fromKey: string, toKey: string) => void;
}

export function TaskEditFlowChart({
  steps, edges, selectedStepKey,
  onSelectStep, onNodesChange, onEdgesChange, onConnect,
  onNodePositionChange, placementMode = false,
  onPlaceStep, onCancelPlacement, onInsertOnEdge, onConditionChange,
}: EditFlowChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);

  const nodes: Node[] = useMemo(() => steps.map(s => ({
    id: s.step_key,
    type: 'stepNode',
    position: { x: s.position_x, y: s.position_y },
    selected: s.step_key === selectedStepKey,
    data: {
      label: s.title,
      description: s.description,
      assigneeName: s.default_assignee?.full_name ?? null,
      isClientStep: s.assignee_role === 'client',
      toolModuleId: s.tool_module_id,
      toolModuleName: s.tool_module_id ? (MODULES.find(m => m.id === s.tool_module_id)?.name ?? null) : null,
      emailReminder: s.email_reminder_enabled,
      timeEstimate: s.time_estimate_minutes,
      mode: 'edit',
      selected: s.step_key === selectedStepKey,
    } satisfies StepNodeData,
  })), [steps, selectedStepKey]);

  const rfEdges: Edge[] = useMemo(() => edges.map(e => {
    const ct = e.condition_type ?? null;
    const edgeColor = ct ? (CONDITION_COLORS[ct] ?? '#9ca3af') : '#ef4444';
    return {
      id: `${e.from_step_key}-${e.to_step_key}`,
      source: e.from_step_key,
      target: e.to_step_key,
      sourceHandle: e.source_handle ?? undefined,
      targetHandle: e.target_handle ?? undefined,
      type: onInsertOnEdge ? 'insertable' : 'default',
      label: e.label ?? undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: edgeColor },
      style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray: ct ? undefined : '5,4' },
      labelStyle: { fontSize: 11, fill: '#9ca3af' },
      data: {
        onInsert: onInsertOnEdge,
        onCondition: onConditionChange,
        conditionType: e.condition_type,
        conditionConfig: e.condition_config,
      },
    };
  }), [edges, onInsertOnEdge, onConditionChange]);

  const handleConnect = useCallback((connection: Connection) => {
    onConnect(connection);
  }, [onConnect]);

  const handleNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    onNodePositionChange(node.id, node.position.x, node.position.y);
  }, [onNodePositionChange]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Ghost step silhouette in placement mode */}
      {placementMode && ghostPos && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{ left: ghostPos.x, top: ghostPos.y }}
        >
          <div className="w-52 rounded-lg border-2 border-dashed border-indigo-400 bg-indigo-50/70 shadow-lg p-3 opacity-80">
            <div className="h-3 w-32 bg-indigo-300 rounded mb-2" />
            <div className="h-2 w-24 bg-indigo-200 rounded mb-3" />
            <div className="h-5 w-20 bg-indigo-200 rounded-full" />
          </div>
        </div>
      )}

      {/* Placement mode hint banner */}
      {placementMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <div className="flex items-center gap-2 bg-indigo-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg">
            <span>Click anywhere to place the step</span>
            <kbd className="ml-1 px-1.5 py-0.5 bg-indigo-500 rounded text-[11px] pointer-events-auto cursor-pointer"
              onClick={onCancelPlacement}
            >ESC to cancel</kbd>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => { if (!placementMode) onSelectStep(node.id); }}
        onPaneClick={() => { if (!placementMode) onSelectStep(null); }}
        onNodeDragStop={handleNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{ stroke: '#9ca3af', strokeWidth: 2 }}
        defaultEdgeOptions={{
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          style: { stroke: '#9ca3af' },
        }}
        nodesDraggable={!placementMode}
        nodesConnectable={!placementMode}
        style={{ cursor: placementMode ? 'crosshair' : undefined }}
      >
        <Background gap={20} color="#f3f4f6" />

        <Panel position="bottom-left">
          <p className="text-[11px] text-gray-400 bg-white/80 px-2 py-1 rounded shadow-sm select-none">
            Scroll to zoom · Drag to pan
          </p>
        </Panel>

        <PlacementController
          placementMode={placementMode}
          containerRef={containerRef}
          onPlace={(x, y) => onPlaceStep?.(x, y)}
          onCancel={() => onCancelPlacement?.()}
          onGhostMove={setGhostPos}
        />
      </ReactFlow>
    </div>
  );
}
