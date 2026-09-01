'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import OrganiseMyDayLightbox from './OrganiseMyDayLightbox';

// App-wide controller for "Organise my day". A single lightbox instance lives at
// the shell level; the header button and the dashboard Briefing tile both drive
// it through this context so the plan can be opened, minimised (kept mounted, so
// its state survives) and reopened from anywhere.

interface OrganiseMyDayCtx {
  /** Open the plan (mounts it, un-minimises). */
  open: () => void;
  /** Close + unmount (next open re-fetches a fresh plan). */
  close: () => void;
  /** Collapse to a floating chip without losing the plan. */
  toggleMinimise: () => void;
  /** Whether the plan is currently mounted (open or minimised). */
  mounted: boolean;
  minimised: boolean;
}

const Ctx = createContext<OrganiseMyDayCtx>({
  open: () => {}, close: () => {}, toggleMinimise: () => {}, mounted: false, minimised: false,
});

export function useOrganiseMyDay(): OrganiseMyDayCtx {
  return useContext(Ctx);
}

export default function OrganiseMyDayProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [minimised, setMinimised] = useState(false);

  const open = useCallback(() => { setMounted(true); setMinimised(false); }, []);
  const close = useCallback(() => { setMounted(false); setMinimised(false); }, []);
  const toggleMinimise = useCallback(() => setMinimised(m => !m), []);

  return (
    <Ctx.Provider value={{ open, close, toggleMinimise, mounted, minimised }}>
      {children}
      {mounted && (
        <OrganiseMyDayLightbox minimised={minimised} onMinimise={toggleMinimise} onClose={close} />
      )}
    </Ctx.Provider>
  );
}
