'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

type ViewMode = 'grid' | 'list';

const ViewModeContext = createContext<{ viewMode: ViewMode; setViewMode: (m: ViewMode) => void } | null>(null);

/** Provides the card/list view mode + setter so the toggle can live inside each
 *  view's toolbar (next to Export) without threading props through every view. */
export function ViewModeProvider({
  viewMode,
  setViewMode,
  children,
}: {
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  children: ReactNode;
}) {
  return (
    <ViewModeContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </ViewModeContext.Provider>
  );
}

/** Glass card/list toggle. Reads state from ViewModeProvider — render it
 *  anywhere inside a view's toolbar. Renders nothing if no provider is mounted. */
export default function ViewModeToggle() {
  const ctx = useContext(ViewModeContext);
  if (!ctx) return null;
  const { viewMode, setViewMode } = ctx;

  return (
    <div className="flex items-center gap-0.5 bg-white border border-[var(--border)] shadow-sm rounded-lg p-0.5">
      <Tooltip label="Card view">
        <button
          onClick={() => setViewMode('grid')}
          aria-label="Card view"
          className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
            viewMode === 'grid' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
          }`}
        >
          <LayoutGrid className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </Tooltip>
      <Tooltip label="List view">
        <button
          onClick={() => setViewMode('list')}
          aria-label="List view"
          className={`flex items-center justify-center h-7 w-7 rounded-md transition-colors ${
            viewMode === 'list' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
          }`}
        >
          <List className="h-4 w-4" strokeWidth={2.5} />
        </button>
      </Tooltip>
    </div>
  );
}
