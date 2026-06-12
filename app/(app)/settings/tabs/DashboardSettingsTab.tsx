'use client';

import { useState } from 'react';
import { GripVertical, Plus, X, LayoutGrid } from 'lucide-react';
import { useDashboardLayout } from '@/components/ui/DashboardLayoutProvider';
import { useModules } from '@/components/ui/ModulesProvider';
import { DASHBOARD_WIDGETS, DASHBOARD_WIDGET_BY_ID } from '@/config/dashboardWidgets';

/**
 * Settings → Dashboard.
 * Show / hide dashboard widgets and drag to reorder. Writes the same
 * `users.dashboard_layout` the dashboard's own "Customise" mode uses, so the two
 * stay in sync. Mirrors the favourites reorder UX in PreferencesTab.
 */
export default function DashboardSettingsTab() {
  const { layout, updateLayout } = useDashboardLayout();
  const { isModuleActive } = useModules();

  // Visible widgets in saved order (skip unknown ids + off-module widgets)
  const visible = layout.filter(id => {
    const def = DASHBOARD_WIDGET_BY_ID.get(id);
    if (!def) return false;
    return def.moduleId ? isModuleActive(def.moduleId) : true;
  });
  // Widgets available to add
  const available = DASHBOARD_WIDGETS.filter(def =>
    !layout.includes(def.id) && (def.moduleId ? isModuleActive(def.moduleId) : true)
  );

  function removeWidget(id: string) { updateLayout(layout.filter(x => x !== id)); }
  function addWidget(id: string) { updateLayout([...layout, id]); }

  // ── Drag-to-reorder (insertion-line UX, mirrors PreferencesTab) ──────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after'>('before');

  function onDragStart(e: React.DragEvent<HTMLDivElement>, id: string) {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>, overId: string) {
    if (!draggingId || draggingId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    if (dragOverId !== overId) setDragOverId(overId);
    if (dragOverPos !== pos) setDragOverPos(pos);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>, overId: string) {
    e.preventDefault();
    const fromId = draggingId ?? e.dataTransfer.getData('text/plain');
    const pos = dragOverPos;
    setDraggingId(null);
    setDragOverId(null);
    if (!fromId || fromId === overId) return;
    const ids = [...layout];
    const fromIdx = ids.indexOf(fromId);
    const overIdx = ids.indexOf(overId);
    if (fromIdx < 0 || overIdx < 0) return;
    ids.splice(fromIdx, 1);
    const insertIdx = pos === 'before'
      ? (fromIdx < overIdx ? overIdx - 1 : overIdx)
      : (fromIdx < overIdx ? overIdx : overIdx + 1);
    ids.splice(insertIdx, 0, fromId);
    updateLayout(ids);
  }
  function onDragEnd() { setDraggingId(null); setDragOverId(null); }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Current widgets */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Your dashboard</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Drag to reorder. These are the panels shown on your dashboard, in this order.
          You can also do this from the dashboard&apos;s &ldquo;Customise&rdquo; button.
        </p>

        {visible.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-4 text-center">
            No widgets — add some below.
          </p>
        ) : (
          <div className="space-y-1.5">
            {visible.map(id => {
              const def = DASHBOARD_WIDGET_BY_ID.get(id)!;
              const isDragging = draggingId === id;
              const showLine = dragOverId === id && draggingId && draggingId !== id;
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={e => onDragStart(e, id)}
                  onDragOver={e => onDragOver(e, id)}
                  onDrop={e => onDrop(e, id)}
                  onDragEnd={onDragEnd}
                  className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-[var(--bg-card)] cursor-grab active:cursor-grabbing transition-all
                    ${isDragging ? 'opacity-40' : ''}
                    ${showLine && dragOverPos === 'before' ? 'border-t-2 border-t-[var(--accent)]' : ''}
                    ${showLine && dragOverPos === 'after' ? 'border-b-2 border-b-[var(--accent)]' : ''}
                    border-[var(--border-input)]`}
                >
                  <GripVertical size={15} className="text-[var(--text-muted)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{def.label}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{def.description}</p>
                  </div>
                  <button
                    onClick={() => removeWidget(id)}
                    aria-label={`Hide ${def.label}`}
                    className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--danger)] px-2 py-1 rounded hover:bg-[var(--bg-nav-hover)] transition-colors"
                  >
                    <X size={13} /> Hide
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Available widgets */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Available widgets</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Add more panels to your dashboard. The list grows as you enable more tools.
        </p>
        {available.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-2">
            All available widgets are already on your dashboard.
          </p>
        ) : (
          <div className="space-y-1.5">
            {available.map(def => (
              <div
                key={def.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-[var(--border-input)] bg-[var(--bg-card)]"
              >
                <LayoutGrid size={15} className="text-[var(--text-muted)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{def.label}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">{def.description}</p>
                </div>
                <button
                  onClick={() => addWidget(def.id)}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-light)] px-2 py-1 rounded transition-colors"
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
