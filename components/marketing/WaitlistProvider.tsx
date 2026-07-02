'use client';

import { createContext, useCallback, useContext, useState } from 'react';
import WaitlistModal from './WaitlistModal';

/**
 * Pre-launch waitlist context. Wraps the marketing site so any CTA (nav, hero,
 * pricing, final CTA) can open the notify-me lightbox via useWaitlist().open().
 * A single <WaitlistModal> is rendered here so there's only ever one instance.
 */
interface WaitlistCtx {
  /** Open the waitlist lightbox. `source` tags where the click came from. */
  open: (source?: string) => void;
}

const Ctx = createContext<WaitlistCtx>({ open: () => {} });

export function useWaitlist(): WaitlistCtx {
  return useContext(Ctx);
}

export default function WaitlistProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [source, setSource] = useState<string | undefined>(undefined);

  const open = useCallback((src?: string) => {
    setSource(src);
    setIsOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <WaitlistModal open={isOpen} source={source} onClose={() => setIsOpen(false)} />
    </Ctx.Provider>
  );
}
