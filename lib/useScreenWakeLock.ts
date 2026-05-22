'use client';

import { useEffect, useRef } from 'react';

/**
 * Keep the device's screen awake while `active` is true.
 *
 * Uses the W3C Screen Wake Lock API. Two important behaviours:
 *
 *  1. The browser automatically releases the wake lock whenever the page
 *     becomes hidden (tab switch, phone screen lock). We re-acquire on
 *     `visibilitychange` while still active, so a user who briefly leaves
 *     the tab doesn't end up with a sleeping device for the rest of the
 *     recording.
 *
 *  2. iOS Safari and some older browsers don't expose `navigator.wakeLock`.
 *     We fail silently — recording still works, the screen just may sleep,
 *     which matches today's behaviour.
 *
 * Usage:
 *   useScreenWakeLock(isRecording);
 */
export function useScreenWakeLock(active: boolean) {
  // Keep the current sentinel in a ref so the visibilitychange handler can
  // re-acquire without triggering effect re-runs.
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active) return;

    // Some browsers (iOS Safari < 16.4, older Firefox) don't ship the API.
    type WakeLockNavigator = Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> };
    };
    const wakeLock = (navigator as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let cancelled = false;

    async function acquire() {
      try {
        const sentinel = await wakeLock!.request('screen');
        if (cancelled) {
          sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // If something external (e.g. the browser) releases it, just clear
        // our ref so the next visibility event re-acquires cleanly.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null;
        });
      } catch {
        // Permissions denied or transient browser error — silent fail.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !sentinelRef.current && active) {
        void acquire();
      }
    }

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) s.release().catch(() => {});
    };
  }, [active]);
}
