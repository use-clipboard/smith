'use client';

import { useEffect, useState } from 'react';
import { NotebookPen } from 'lucide-react';
import { WidgetCard } from './shared';

/** A private, per-user scratchpad persisted to localStorage (this browser only). */
export default function NotesWidget({ storageKey }: { storageKey: string }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try { setText(localStorage.getItem(storageKey) ?? ''); } catch { /* ignore */ }
    setLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey, text); } catch { /* ignore */ }
  }, [text, loaded, storageKey]);

  return (
    <WidgetCard icon={<NotebookPen size={15} className="text-[var(--accent)]" />} title="My Notes">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Jot something down…"
        className="w-full h-full resize-none bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] scrollbar-thin leading-relaxed"
      />
    </WidgetCard>
  );
}
