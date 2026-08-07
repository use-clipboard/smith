'use client';

import { Undo2, Redo2, Loader2, Check, CloudOff, PanelRightClose, PanelRightOpen } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Undo/redo + save status + assistant toggle — rendered in the working area of
 *  both the return workflow and the planning sandbox so it's in view while
 *  editing (rather than tucked in the page header). */
export function WorkspaceControls({
  canUndo, canRedo, onUndo, onRedo, saveState, assistantOpen, onToggleAssistant,
}: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  saveState: SaveState; assistantOpen: boolean; onToggleAssistant: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <Tooltip label="Undo (Ctrl+Z)">
          <button onClick={onUndo} disabled={!canUndo} aria-label="Undo" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-secondary)] transition-colors hover:bg-black/[0.03] disabled:opacity-40"><Undo2 size={14} /></button>
        </Tooltip>
        <Tooltip label="Redo (Ctrl+Shift+Z)">
          <button onClick={onRedo} disabled={!canRedo} aria-label="Redo" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-secondary)] transition-colors hover:bg-black/[0.03] disabled:opacity-40"><Redo2 size={14} /></button>
        </Tooltip>
      </div>
      <SaveIndicator state={saveState} />
      <button onClick={onToggleAssistant} className="btn-secondary">
        {assistantOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Assistant
      </button>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<SaveState, 'idle'>, { icon: React.ReactNode; text: string; cls: string }> = {
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: 'Saving…', cls: 'text-[var(--text-muted)]' },
    saved:  { icon: <Check size={12} />, text: 'Saved', cls: 'text-emerald-600' },
    error:  { icon: <CloudOff size={12} />, text: 'Not saved', cls: 'text-red-600' },
  };
  const m = map[state];
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>{m.icon}{m.text}</span>;
}
