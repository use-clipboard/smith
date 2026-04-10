'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type ActivityState = 'idle' | 'processing' | 'done';

interface TabActivityContextValue {
  getActivity: (route: string) => ActivityState;
  setActivity: (route: string, state: ActivityState) => void;
  /** Reset done → idle when the user switches to that tab. Has no effect if state is idle or processing. */
  resetIfDone: (route: string) => void;
}

const TabActivityContext = createContext<TabActivityContextValue>({
  getActivity: () => 'idle',
  setActivity: () => {},
  resetIfDone: () => {},
});

export function useTabActivityContext() {
  return useContext(TabActivityContext);
}

export function TabActivityProvider({ children }: { children: ReactNode }) {
  const [activities, setActivities] = useState<Record<string, ActivityState>>({});

  const getActivity = useCallback((route: string): ActivityState => {
    return activities[route] ?? 'idle';
  }, [activities]);

  const setActivity = useCallback((route: string, state: ActivityState) => {
    setActivities(prev => ({ ...prev, [route]: state }));
  }, []);

  const resetIfDone = useCallback((route: string) => {
    setActivities(prev => {
      if (prev[route] === 'done') return { ...prev, [route]: 'idle' };
      return prev;
    });
  }, []);

  return (
    <TabActivityContext.Provider value={{ getActivity, setActivity, resetIfDone }}>
      {children}
    </TabActivityContext.Provider>
  );
}

/**
 * Add this to any tool page to automatically drive the sidebar tab indicator.
 * Pass the page's route and its current appState — the indicator will show:
 *   loading          → spinning animation (analysis in progress)
 *   success / scan_results → tick (done — even if you've switched away)
 *   idle / error     → plain dot (or nothing if tab is active)
 */
export function useTabActivitySync(route: string, appState: string) {
  const { setActivity } = useTabActivityContext();

  useEffect(() => {
    if (appState === 'loading') {
      setActivity(route, 'processing');
    } else if (appState === 'success' || appState === 'scan_results') {
      setActivity(route, 'done');
    } else {
      setActivity(route, 'idle');
    }
  }, [appState, route, setActivity]);
}
