'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_WIDGET_IDS } from '@/config/dashboardWidgets';

interface DashboardLayoutContextValue {
  /** Ordered list of visible widget ids. */
  layout: string[];
  /** Persist a new ordered list of visible widget ids (optimistic + rollback). */
  updateLayout: (ids: string[]) => Promise<void>;
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue>({
  layout: DEFAULT_DASHBOARD_LAYOUT,
  updateLayout: async () => {},
});

/** Drop unknown ids (e.g. a widget removed from the registry) and de-dupe. */
function normalise(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter(id => DASHBOARD_WIDGET_IDS.has(id) && !seen.has(id) && (seen.add(id), true));
}

export function DashboardLayoutProvider({
  initialLayout,
  children,
}: {
  /** Server-fetched value; null when the user has never customised. */
  initialLayout: string[] | null;
  children: React.ReactNode;
}) {
  const start = normalise(initialLayout ?? DEFAULT_DASHBOARD_LAYOUT);
  const [layout, setLayout] = useState<string[]>(start);
  const previousRef = useRef<string[]>(start);

  const updateLayout = useCallback(async (ids: string[]) => {
    const next = normalise(ids);
    const previous = previousRef.current;
    previousRef.current = next;
    setLayout(next);

    try {
      const res = await fetch('/api/users/dashboard-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: next }),
      });
      if (!res.ok) {
        previousRef.current = previous;
        setLayout(previous);
        console.error('Failed to save dashboard layout — changes reverted');
      }
    } catch {
      previousRef.current = previous;
      setLayout(previous);
      console.error('Network error saving dashboard layout — changes reverted');
    }
  }, []);

  return (
    <DashboardLayoutContext.Provider value={{ layout, updateLayout }}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}

export function useDashboardLayout() {
  return useContext(DashboardLayoutContext);
}
