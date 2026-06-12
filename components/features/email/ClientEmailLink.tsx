'use client';

import type { ReactNode, MouseEvent } from 'react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';

/**
 * A clickable email address that adapts based on whether the user has the
 * Email Triage module switched on:
 *   - Triage active  → opens the in-app compose window in the corner with
 *                       the client pre-filled in the To field AND tagged
 *                       for allocation so the eventual send shows up on
 *                       the client's timeline.
 *   - Triage inactive → falls back to a plain mailto: link that hands off
 *                       to the user's preferred email app.
 *
 * Use this anywhere we render `client.contact_email` (MTD IT rows, the
 * Clients list, client detail, etc.) so the behaviour is consistent.
 */
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

  if (!triageActive) {
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
