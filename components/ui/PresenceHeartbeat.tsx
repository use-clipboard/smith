'use client';

import { useEffect } from 'react';

/**
 * PresenceHeartbeat — periodically tells the server the user is active, so their
 * profile's "last seen" reflects when they were last *in the app* (not just when
 * they last typed their password). Pings on mount, every 90s while the tab is
 * visible, and whenever the tab is brought back to the foreground.
 */
export default function PresenceHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (!document.hidden) fetch('/api/presence/ping', { method: 'POST' }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 90 * 1000);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', ping); };
  }, []);
  return null;
}
