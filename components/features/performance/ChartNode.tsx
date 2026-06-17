'use client';
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { chartToHtml, chartToDom, type ChartSpec } from './chart';

export interface ChartNodeOptions {
  /** Called when a chart is double-clicked — opens the builder to edit it. */
  onEdit: (pos: number, spec: ChartSpec, width: number | null) => void;
}

// ─── Interactive node view (move handle, resize handle, double-click to edit) ─────

function ChartNodeView({ node, selected, updateAttributes, extension, getPos }: NodeViewProps) {
  const spec = node.attrs.spec as ChartSpec | null;
  const width = node.attrs.width as number | null;
  const innerRef = useRef<HTMLDivElement>(null);

  const handleEdit = () => {
    const pos = typeof getPos === 'function' ? getPos() : null;
    if (pos != null && spec) (extension.options as ChartNodeOptions).onEdit(pos, spec, width);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const parentW = innerRef.current?.parentElement?.offsetWidth ?? 700;
    const startX = e.clientX;
    const startW = innerRef.current?.offsetWidth ?? parentW;
    const onMove = (me: MouseEvent) => {
      const px = Math.max(180, Math.min(parentW, startW + (me.clientX - startX)));
      updateAttributes({ width: Math.max(25, Math.min(100, Math.round((px / parentW) * 100))) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!spec) return <NodeViewWrapper />;

  return (
    <NodeViewWrapper className="perf-chart-nv" style={{ position: 'relative' }}>
      <div ref={innerRef} onDoubleClick={handleEdit}
        style={{
          width: width ? `${width}%` : '100%', position: 'relative', borderRadius: 8,
          outline: selected ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
        }}>
        <div dangerouslySetInnerHTML={{ __html: chartToHtml(spec, width) }} />

        {selected && (<>
          {/* Move handle (ProseMirror drag handle) */}
          <div data-drag-handle aria-hidden="true" contentEditable={false} title="Drag to move"
            style={{
              position: 'absolute', top: 6, left: 6, width: 22, height: 22, borderRadius: 6,
              background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center',
              justifyContent: 'center', cursor: 'grab', zIndex: 4,
            }}>
            <GripVertical size={13} />
          </div>
          {/* Resize handle */}
          <div aria-hidden="true" contentEditable={false} onMouseDown={startResize} title="Drag to resize"
            style={{
              position: 'absolute', bottom: 5, right: 5, width: 14, height: 14, borderRadius: 3,
              background: '#fff', border: '2px solid var(--accent)', cursor: 'nwse-resize', zIndex: 4,
            }} />
        </>)}
      </div>
    </NodeViewWrapper>
  );
}

// ─── Node ─────────────────────────────────────────────────────────────────────────

export const ChartNode = Node.create<ChartNodeOptions>({
  name: 'perfChart',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onEdit: () => {} };
  },

  addAttributes() {
    return {
      spec: {
        default: null as ChartSpec | null,
        parseHTML: (el: HTMLElement) => {
          try { return JSON.parse(el.getAttribute('data-chart-spec') || 'null'); }
          catch { return null; }
        },
        renderHTML: () => ({}),
      },
      width: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const w = el.getAttribute('data-chart-width');
          return w ? parseInt(w, 10) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-perf-chart]' }];
  },

  renderHTML({ node }) {
    const spec = node.attrs.spec as ChartSpec | null;
    if (!spec) return ['div', { 'data-perf-chart': '' }];
    return chartToDom(spec, node.attrs.width as number | null);
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartNodeView);
  },
});
