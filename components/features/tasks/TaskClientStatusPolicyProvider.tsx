'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_POLICY, type TaskClientStatusPolicy } from '@/lib/taskClientStatusPolicy';

/**
 * Provider for the firm-level client-status policy. Loaded once on mount
 * and made available to every TaskListRow / TaskCard / view header so we
 * don't refetch per row. The default policy is used while the API call is
 * in flight so the UI never renders against an uninitialised shape.
 *
 * `showOnHold` is a per-session client-side toggle: even when policy says
 * "hide from default", users can flip this on to peek at on-hold tasks
 * without changing the firm-level setting.
 */
interface ContextValue {
  policy: TaskClientStatusPolicy;
  /** User toggle (per-session) to override the policy's hide-from-default. */
  showOnHold: boolean;
  setShowOnHold: (v: boolean) => void;
  showInactive: boolean;
  setShowInactive: (v: boolean) => void;
}

const Ctx = createContext<ContextValue>({
  policy:          DEFAULT_POLICY,
  showOnHold:      false,
  setShowOnHold:   () => {},
  showInactive:    false,
  setShowInactive: () => {},
});

export function useTaskClientStatusPolicy(): ContextValue {
  return useContext(Ctx);
}

export default function TaskClientStatusPolicyProvider({ children }: { children: ReactNode }) {
  const [policy, setPolicy]               = useState<TaskClientStatusPolicy>(DEFAULT_POLICY);
  const [showOnHold, setShowOnHold]       = useState(false);
  const [showInactive, setShowInactive]   = useState(false);

  useEffect(() => {
    void fetch('/api/tasks/settings/client-status-policy')
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j?.policy) setPolicy(j.policy); })
      .catch(() => { /* defaults stand */ });
  }, []);

  return (
    <Ctx.Provider value={{ policy, showOnHold, setShowOnHold, showInactive, setShowInactive }}>
      {children}
    </Ctx.Provider>
  );
}
