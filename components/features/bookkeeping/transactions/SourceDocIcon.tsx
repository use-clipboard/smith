'use client';

/**
 * SourceDocIcon — the always-visible paperclip that marks a transaction as
 * having a linked source document (Google Drive via Capture/Vault). Clicking it
 * opens the document in a new tab. Renders nothing when there's no link, so it's
 * safe to drop into every ledger / list row unconditionally.
 *
 * This mirrors the paperclip in useTransactionRowActions' renderActions, so the
 * indicator looks identical everywhere a transaction appears.
 */

import { Paperclip } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

export default function SourceDocIcon({
  url, name, refNo, size = 12, className = '',
}: {
  url: string | null | undefined;
  name?: string | null;
  /** Used only for the accessible label. */
  refNo?: string | null;
  size?: number;
  className?: string;
}) {
  if (!url) return null;
  return (
    <Tooltip label={name ? `Source document — ${name}` : 'Source document'}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        aria-label={refNo ? `Open source document for ${refNo}` : 'Open source document'}
        className={`inline-flex p-1 rounded text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 ${className}`}
      >
        <Paperclip size={size} />
      </a>
    </Tooltip>
  );
}
