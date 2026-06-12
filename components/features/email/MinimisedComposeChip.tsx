'use client';

import { Mail, X, Maximize2 } from 'lucide-react';
import { useComposeWindow } from './ComposeWindowProvider';

/**
 * Docked tab that appears bottom-right when the user minimises an email.
 * Lives at AppShell level so it persists across navigation.
 */
export default function MinimisedComposeChip() {
  const { mode, snapshot, ctx, restore, close, pendingSend } = useComposeWindow();

  // During the undo-send countdown the window is technically minimised (so
  // Undo can restore it), but the user sees the send toast instead of a chip.
  if (mode !== 'minimised' || !snapshot || pendingSend) return null;

  const label =
    snapshot.subject.trim() ||
    ctx?.replyTo?.subject ||
    ctx?.forwardOf?.subject ||
    'New message';

  // Show "to" or recipient name for context
  const recipient =
    snapshot.to[0]?.name || snapshot.to[0]?.email ||
    ctx?.replyTo?.from?.name || ctx?.replyTo?.from?.email ||
    ctx?.forwardOf?.from?.name || '';

  return (
    <button
      onClick={restore}
      className="fixed bottom-4 right-4 z-[60] flex items-center gap-2 max-w-sm pl-3 pr-1 py-2 rounded-xl bg-[var(--accent)] text-white shadow-2xl ring-1 ring-[var(--accent)]/40 hover:brightness-110 transition-all"
      aria-label={`Restore email: ${label}`}
    >
      <Mail size={14} className="shrink-0 opacity-90" />
      <div className="flex-1 min-w-0 text-left">
        <p className="text-[10px] font-semibold uppercase tracking-widest opacity-80 leading-none">
          Minimised
        </p>
        <p className="text-sm font-medium truncate leading-tight mt-0.5">{label}</p>
        {recipient && (
          <p className="text-[11px] opacity-80 truncate leading-tight">to {recipient}</p>
        )}
      </div>
      <span
        role="button"
        aria-label="Discard draft"
        onClick={e => { e.stopPropagation(); close(); }}
        className="shrink-0 p-1 rounded hover:bg-white/15 cursor-pointer"
      >
        <X size={14} />
      </span>
      <span
        aria-hidden
        className="shrink-0 p-1 rounded hover:bg-white/15 ml-0.5"
        title="Restore"
      >
        <Maximize2 size={12} />
      </span>
    </button>
  );
}
