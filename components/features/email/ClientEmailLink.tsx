'use client';

import { useState, useEffect, type ReactNode, type MouseEvent } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';

/**
 * A clickable email address that adapts based on whether email can actually be
 * sent in-app:
 *   - Email Triage on AND this user has connected their Gmail
 *                       → opens the in-app compose window in the corner with
 *                         the client pre-filled in the To field AND tagged for
 *                         allocation so the eventual send shows up on the
 *                         client's timeline.
 *   - Otherwise (module off, OR the user hasn't connected Gmail)
 *                       → falls back to a plain mailto: link that hands off to
 *                         the user's preferred email app.
 *
 * Use this anywhere we render `client.contact_email` (MTD IT rows, the Clients
 * list, client detail, Accounts Studio, etc.) so the behaviour is consistent.
 */

// ── Per-user Gmail connection status, cached app-wide ────────────────────────
// A list can render dozens of ClientEmailLinks; without a shared cache each one
// would hit /api/email/status. Cache the boolean (and de-dupe concurrent
// fetches) so it's fetched at most once per page load.
let cachedConnected: boolean | undefined;
let inflight: Promise<boolean> | null = null;

function fetchConnected(): Promise<boolean> {
  if (cachedConnected !== undefined) return Promise.resolve(cachedConnected);
  if (!inflight) {
    inflight = fetch('/api/email/status')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => { cachedConnected = !!d?.connected; return cachedConnected; })
      .catch(() => { cachedConnected = false; return false; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Returns the user's Gmail-connected status, or null while unknown. Only
 *  fetches when `enabled` (the Email Triage module is on for the firm). */
function useGmailConnected(enabled: boolean): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(cachedConnected ?? null);
  useEffect(() => {
    if (!enabled) return;
    if (cachedConnected !== undefined) { setConnected(cachedConnected); return; }
    let cancelled = false;
    fetchConnected().then(c => { if (!cancelled) setConnected(c); });
    return () => { cancelled = true; };
  }, [enabled]);
  return connected;
}

interface Props {
  email: string;
  client: {
    id: string;
    name: string;
    client_ref: string | null;
    contact_email: string | null;
  };
  className?: string;
  children?: ReactNode;
}

export default function ClientEmailLink({ email, client, className, children }: Props) {
  const { isModuleActive } = useModules();
  const compose            = useComposeWindow();
  const triageActive       = isModuleActive('email-triage');
  const connected          = useGmailConnected(triageActive);

  // Use the in-app composer only when the module is on and the user isn't
  // KNOWN to be disconnected. While the status is still loading (null) we keep
  // today's behaviour (composer) so connected users never flicker to mailto;
  // once we learn they're not connected, we fall back to mailto.
  const useCompose = triageActive && connected !== false;

  if (!useCompose) {
    return (
      <a
        href={`mailto:${email}`}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => e.stopPropagation()}
        className={className}
      >
        {children ?? email}
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        // Stop the parent row toggle / link nav firing as well
        e.stopPropagation();
        e.preventDefault();
        compose.open({
          defaultTo:      [{ name: client.name, email }],
          defaultClients: [{
            id:            client.id,
            name:          client.name,
            client_ref:    client.client_ref ?? '',
            contact_email: client.contact_email,
            risk_rating:   null,
          }],
        });
      }}
      className={className}
    >
      {children ?? email}
    </button>
  );
}
