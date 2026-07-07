// Accounts Studio — rules-based "is a needed note missing?" check.
//
// Derived entirely from the disclosure rule engine: a note is flagged when it
// SHOULD be present for this engagement (mandatory, or a conditional whose data
// trigger fires) but isn't included. Mandatory → warn; conditional → info.
// The AI "review my disclosures" action is a second opinion on top.

import type { Engagement } from '@/components/features/accounts-studio/types';
import { expectedNotes, type DisclosureContext } from './disclosures';

export interface DisclosureWarning {
  id: string;
  severity: 'warn' | 'info';
  message: string;
  /** The note that resolves it (to offer a one-click include/add). */
  noteId: string;
}

function ctxOf(e: Engagement): DisclosureContext {
  return {
    entityType: e.entityType,
    size: e.size,
    framework: e.framework,
    statements: e.statements ?? null,
    priorYear: e.comparativePeriod ? e.comparativePeriod.slice(-4) : '',
    directors: e.directors,
  };
}

/** Flag notes that should be present given the figures + entity, but aren't. */
export function checkDisclosures(e: Engagement): DisclosureWarning[] {
  const expected = expectedNotes(ctxOf(e));
  // A note counts as present when it's in the set and included (content may
  // still be a draft — emptiness is handled by the completeness check).
  const active = (id: string) => e.disclosures.some(d => d.id === id && d.included !== false);
  const excluded = (id: string) => e.disclosures.some(d => d.id === id && d.included === false);

  const out: DisclosureWarning[] = [];
  for (const n of expected) {
    if (active(n.id)) continue;
    const required = n.level === 'mandatory';
    const word = required ? 'required' : 'expected';
    out.push({
      id: n.id,
      severity: required ? 'warn' : 'info',
      message: excluded(n.id)
        ? `The ${n.title} note has been excluded but is ${word} for these accounts.`
        : `The ${n.title} note is ${word} for these accounts but isn't included.`,
      noteId: n.id,
    });
  }
  return out;
}
