import { randomUUID } from 'crypto';

/** Server-safe id for synthetic rule-tree nodes (audience definitions built by
 *  automation triggers). */
export function uidLike(): string {
  try { return randomUUID(); } catch { return `id_${Date.now()}`; }
}
