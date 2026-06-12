'use client';

/**
 * EmailCategoryCards — the triage category bar above the body. Each card shows a
 * count and acts as a filter chip; clicking toggles the list filter for that
 * category. Cards are also DROP TARGETS: drag one or more emails onto a card to
 * set that category. "Completed" is styled pale-green and hides its count (it
 * grows unbounded over time).
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2 } from 'lucide-react';
import { EMAIL_CATEGORIES, CATEGORY_META, type EmailCategory } from './emailCategories';

interface Props {
  counts: Record<EmailCategory, number>;
  active: EmailCategory | null;
  onSelect: (c: EmailCategory | null) => void;
  /** Apply a category to the dragged email(s). */
  onDropCategory?: (category: EmailCategory, threadIds: string[]) => void;
  /** While Auto Triage runs, its progress renders as a bar on the Untriaged card. */
  untriagedProgress?: { done: number; total: number } | null;
  /** Right-click menu action: move everything in this category to "No Action
   *  Needed". Not offered on the No Action Needed card itself. */
  onMarkAllNoAction?: (category: EmailCategory) => void;
}

/** Read the dragged email ids (multi-select array, or single fallback). */
function draggedIds(e: React.DragEvent): string[] {
  const multi = e.dataTransfer.getData('application/x-smith-emails');
  if (multi) { try { const a = JSON.parse(multi); if (Array.isArray(a)) return a as string[]; } catch { /* ignore */ } }
  const single = e.dataTransfer.getData('application/x-smith-email') || e.dataTransfer.getData('text/plain');
  return single ? [single] : [];
}

export default function EmailCategoryCards({ counts, active, onSelect, onDropCategory, untriagedProgress, onMarkAllNoAction }: Props) {
  const [dragOver, setDragOver] = useState<EmailCategory | null>(null);
  // Right-click context menu — anchored at the cursor, fixed so it escapes the
  // horizontal scroll container.
  const [contextMenu, setContextMenu] = useState<{ cat: EmailCategory; x: number; y: number } | null>(null);

  return (
    <div className="flex items-stretch gap-2">
      {EMAIL_CATEGORIES.map(cat => {
        const meta = CATEGORY_META[cat];
        const Icon = meta.icon;
        const isActive = active === cat;
        const isCompleted = cat === 'completed';
        const isOver = dragOver === cat;

        const base = isActive
          ? (isCompleted ? 'border-emerald-400 bg-emerald-100 shadow-sm' : 'border-[var(--accent)] bg-[var(--accent-light)] shadow-sm')
          : isCompleted
            ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:shadow-sm'
            : 'border-[var(--border-card)] bg-white/50 hover:border-[var(--accent)] hover:shadow-sm';

        return (
          <button
            key={cat}
            onClick={() => onSelect(isActive ? null : cat)}
            onContextMenu={onMarkAllNoAction && cat !== 'completed' ? e => {
              e.preventDefault();
              setContextMenu({ cat, x: e.clientX, y: e.clientY });
            } : undefined}
            onDragOver={onDropCategory ? e => { e.preventDefault(); if (dragOver !== cat) setDragOver(cat); } : undefined}
            onDragLeave={onDropCategory ? () => setDragOver(p => (p === cat ? null : p)) : undefined}
            onDrop={onDropCategory ? e => {
              e.preventDefault();
              const ids = draggedIds(e);
              if (ids.length) onDropCategory(cat, ids);
              setDragOver(null);
            } : undefined}
            className={`shrink-0 min-w-[150px] text-left rounded-xl border px-3 py-2 transition-all ${base} ${isOver ? 'ring-2 ring-[var(--accent)] ring-offset-1 scale-[1.02] relative z-10' : ''}`}
          >
            <div className="flex items-center justify-between mb-1 min-h-[24px]">
              <span className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: `${meta.color}1a` }}>
                <Icon size={13} style={{ color: meta.color }} />
              </span>
              {!isCompleted && (
                <span className="text-xl font-bold leading-none" style={{ color: meta.color }}>{counts[cat] ?? 0}</span>
              )}
            </div>
            <p className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">{meta.label}</p>
            {cat === 'untriaged' && untriagedProgress && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${untriagedProgress.total > 0 ? Math.round((untriagedProgress.done / untriagedProgress.total) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-[10px] font-semibold tabular-nums text-[var(--text-muted)] whitespace-nowrap">
                  {untriagedProgress.done}/{untriagedProgress.total}
                </span>
              </div>
            )}
          </button>
        );
      })}

      {/* Right-click context menu — portalled to <body>: an ancestor here has
          backdrop-blur, which re-anchors position:fixed to itself and throws
          the cursor coordinates way off. */}
      {contextMenu && typeof document !== 'undefined' && createPortal(
        <>
          <div
            className="fixed inset-0 z-[70]"
            onClick={() => setContextMenu(null)}
            onContextMenu={e => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
            className="z-[71] bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl py-1 min-w-[230px]"
          >
            <button
              onClick={() => { onMarkAllNoAction?.(contextMenu.cat); setContextMenu(null); }}
              className="w-full text-left px-3 py-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] flex items-center gap-2"
            >
              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
              Mark all {CATEGORY_META[contextMenu.cat].label} as No Action Needed
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
