'use client';

import { Info } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

/** A subtle ⓘ next to a field label — hovering shows plain-English guidance via
 *  the standard SMITH dark-pill tooltip. Not focusable (supplementary help);
 *  the aria-label carries the same text for screen readers. */
export default function FieldHelp({ help, label }: { help: string; label: string }) {
  return (
    <Tooltip label={help} side="top" bubbleClassName="font-normal leading-snug">
      <button type="button" tabIndex={-1} aria-label={`What to enter for ${label}`} className="text-slate-400 transition-colors hover:text-[var(--accent)]">
        <Info size={11} />
      </button>
    </Tooltip>
  );
}
