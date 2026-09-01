'use client';

import { type ReactNode, type CSSProperties, useId } from 'react';
import SortHeader, { type SortDir } from './SortHeader';
import { useResizableColumns, type ResizableColumnDef } from './useResizableColumns';
import Tooltip from '@/components/ui/Tooltip';
import { Settings2 } from 'lucide-react';

/**
 * Shared shell for Tasks-tool list tables. Mirrors the MTD-IT pattern:
 *   - bounded scroll container so sticky <th> cells pin to the top of the
 *     container instead of the page (works correctly inside scrolled pages)
 *   - explicit colgroup so column widths can be user-resized + persisted
 *   - drag handles between columns
 *
 * Each view passes a stable `viewKey` (used as the localStorage cache key)
 * and a list of `columns`. The body is rendered as a render-prop receiving
 * the colgroup + thead so the view can interleave grouped sections / empty
 * states / etc. without losing the shared scroll/sticky behaviour.
 */
export interface TaskColumn<SortField extends string = string> {
  id: string;
  /** Header label. Pass null for icon-only / unlabelled columns. */
  label: ReactNode;
  defaultWidth: number;
  minWidth?: number;
  /** When set, the header acts as a sort toggle for this field. */
  sortField?: SortField;
  /** When true, this column can't be drag-resized (e.g. expand chevron, actions). */
  fixed?: boolean;
  /** Extra classes for the <th>. */
  thClassName?: string;
  /** Optional alignment for the label. */
  align?: 'left' | 'right' | 'center';
}

interface Props<SortField extends string> {
  /** Stable cache key for column widths in localStorage. */
  viewKey: string;
  columns: TaskColumn<SortField>[];
  /** Current sort state — used to render the active arrow on a SortHeader. */
  sortField?: SortField;
  sortDir?: SortDir;
  onToggleSort?: (field: SortField) => void;
  /**
   * Max height for the scroll container. Defaults to roughly the page body
   * height minus the standard sticky filter bar. Override per view if the
   * sticky area above is taller / shorter.
   */
  maxHeight?: string;
  /** Body content — typically a single <tbody> or several grouped sections. */
  children: ReactNode;
  /** Optional toolbar rendered above the table inside the same card. */
  toolbar?: ReactNode;
}

export default function TaskTable<SortField extends string>({
  viewKey, columns, sortField, sortDir, onToggleSort,
  maxHeight = 'calc(100vh - 260px)', children, toolbar,
}: Props<SortField>) {
  const colDefs: ResizableColumnDef[] = columns.map(c => ({
    id:           c.id,
    defaultWidth: c.defaultWidth,
    minWidth:     c.minWidth ?? 60,
    fixed:        c.fixed,
  }));
  const { widths, startDrag, reset } = useResizableColumns(viewKey, colDefs);
  const totalWidth = columns.reduce((sum, c) => sum + (widths[c.id] ?? c.defaultWidth), 0);
  const tableId = useId();

  return (
    <div className="bg-white/[0.78] backdrop-blur-md border border-[var(--border)] rounded-xl">
      {(toolbar || true) && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-gray-100 bg-gray-50/50 rounded-t-xl">
          <div className="flex-1 min-w-0">{toolbar}</div>
          <Tooltip label="Reset column widths">
            <button
              onClick={reset}
              aria-label="Reset column widths"
              className="text-[11px] text-gray-400 hover:text-gray-600 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              <Settings2 size={11} /> Reset columns
            </button>
          </Tooltip>
        </div>
      )}
      {/* overflow-x-hidden + percentage column widths keep the whole task line
          inside the view (no horizontal scroll to reach the far-right columns);
          overflow-y-auto + maxHeight keeps the header row pinned while the rows
          scroll beneath it. */}
      <div className="overflow-x-hidden overflow-y-auto rounded-b-xl" style={{ maxHeight }}>
        <table
          id={tableId}
          className="text-sm border-collapse"
          style={{ width: '100%', tableLayout: 'fixed' }}
        >
          <colgroup>
            {columns.map(c => {
              const w = widths[c.id] ?? c.defaultWidth;
              return <col key={c.id} style={{ width: `${(w / totalWidth) * 100}%` }} />;
            })}
          </colgroup>
          <thead>
            <tr>
              {columns.map(c => {
                const w = widths[c.id] ?? c.defaultWidth;
                const baseTh = 'sticky top-0 z-10 bg-gray-50/85 backdrop-blur-sm border-b border-[var(--border)] px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide select-none';
                const alignCls = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left';
                // Percentage width (no fixed px min) so columns share the width
                // and the table never exceeds 100% → no horizontal scroll.
                const thStyle: CSSProperties = { width: `${(w / totalWidth) * 100}%` };
                if (c.sortField && onToggleSort && sortField !== undefined) {
                  return (
                    <SortHeader<SortField>
                      key={c.id}
                      field={c.sortField}
                      label={c.label as string}
                      activeField={sortField}
                      activeDir={sortDir ?? 'asc'}
                      onToggle={onToggleSort}
                      thClassName={`${baseTh} ${alignCls} ${c.thClassName ?? ''} relative`}
                      style={thStyle}
                      rightSlot={!c.fixed ? <ResizeHandle onMouseDown={e => startDrag(c.id, e)} /> : null}
                    />
                  );
                }
                return (
                  <th key={c.id} className={`${baseTh} ${alignCls} ${c.thClassName ?? ''} relative`} style={thStyle}>
                    <span className="inline-block">{c.label}</span>
                    {!c.fixed && <ResizeHandle onMouseDown={e => startDrag(c.id, e)} />}
                  </th>
                );
              })}
            </tr>
          </thead>
          {children}
        </table>
      </div>
    </div>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      onClick={e => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize group/handle"
    >
      <span className="block h-full w-px ml-auto bg-transparent group-hover/handle:bg-indigo-400 transition-colors" />
    </span>
  );
}
