/**
 * Client-link relationship types — the single source of truth.
 *
 * Every relationship between two client records is a typed, directional edge:
 * the "subject" (stored as `client_links.client_id`) → the "object"
 * (`linked_client_id`). Because links are directional, each type carries a
 * FORWARD label (read from the subject's page) and a REVERSE label (read from
 * the object's page), e.g. an individual's page says "Director of [company]"
 * while the company's page says "Director is [individual]".
 *
 * Pure module (no React/lucide imports) so both server routes and client
 * components can import it. Entity node styling (icons/shapes) lives in
 * components/features/clients/entityVisuals.tsx.
 */

export const LINK_TYPES = [
  'director',
  'shareholder',
  'partner',
  'sole_trader',
  'spouse_partner',
  'trustee',
  'beneficiary',
  'associated_company',
  'parent_company',
  'subsidiary',
  'guarantor',
  'other',
] as const;

export type LinkType = (typeof LINK_TYPES)[number];

/** Direction of a link relative to the client whose page you're viewing. */
export type LinkDirection = 'outgoing' | 'incoming';

interface LinkTypeMeta {
  /** Dropdown label — the forward reading (subject → object). */
  option: string;
  /** Read from the subject's page (this client is `client_id`). */
  forward: string;
  /** Read from the object's page (this client is `linked_client_id`). */
  reverse: string;
  /** Hex stroke colour for the connector (inline SVG value, not a CSS var). */
  color: string;
  /**
   * Natural orientation by business_type, used to auto-arrange the two
   * entities in the link editor. `subject` sits on top, `object` on the
   * bottom. Omit for symmetric/ambiguous relationships (no auto-orient).
   */
  orient?: { subject: string[]; object: string[] };
}

/**
 * Parent/Subsidiary are two ends of ONE relationship (option B): the reverse of
 * "Parent company of" reads "Subsidiary of", and vice-versa — so whichever way
 * a user records it, both clients' pages read correctly.
 */
export const LINK_TYPE_META: Record<LinkType, LinkTypeMeta> = {
  director: {
    option: 'Director of', forward: 'Director of', reverse: 'Director is',
    color: '#2563eb',
    orient: { subject: ['individual'], object: ['limited_company'] },
  },
  shareholder: {
    option: 'Shareholder of', forward: 'Shareholder of', reverse: 'Shareholder is',
    color: '#4f46e5',
    orient: { subject: ['individual', 'limited_company'], object: ['limited_company'] },
  },
  partner: {
    option: 'Partner of', forward: 'Partner of', reverse: 'Partner is',
    color: '#0d9488',
    orient: { subject: ['individual'], object: ['partnership'] },
  },
  sole_trader: {
    option: 'Sole trader of', forward: 'Sole trader of', reverse: 'Sole trader is',
    color: '#b45309',
    orient: { subject: ['individual'], object: ['sole_trader'] },
  },
  spouse_partner: {
    option: 'Spouse / Partner of', forward: 'Spouse / Partner of', reverse: 'Spouse / Partner of',
    color: '#db2777',
  },
  trustee: {
    option: 'Trustee of', forward: 'Trustee of', reverse: 'Trustee is',
    color: '#9333ea',
    orient: { subject: ['individual'], object: ['trust'] },
  },
  beneficiary: {
    option: 'Beneficiary of', forward: 'Beneficiary of', reverse: 'Beneficiary is',
    color: '#7c3aed',
    orient: { subject: ['individual'], object: ['trust'] },
  },
  associated_company: {
    option: 'Associated Company', forward: 'Associated Company', reverse: 'Associated Company',
    color: '#d97706',
  },
  parent_company: {
    option: 'Parent Company of', forward: 'Parent Company of', reverse: 'Subsidiary of',
    color: '#ea580c',
    orient: { subject: ['limited_company'], object: ['limited_company'] },
  },
  subsidiary: {
    option: 'Subsidiary of', forward: 'Subsidiary of', reverse: 'Parent Company of',
    color: '#ca8a04',
    orient: { subject: ['limited_company'], object: ['limited_company'] },
  },
  guarantor: {
    option: 'Guarantor of', forward: 'Guarantor of', reverse: 'Guarantor is',
    color: '#dc2626',
    orient: { subject: ['individual', 'limited_company'], object: ['limited_company'] },
  },
  other: {
    option: 'Other / Associated', forward: 'Other / Associated', reverse: 'Other / Associated',
    color: '#6b7280',
  },
};

/** Ordered options for the relationship <select>. */
export const LINK_TYPE_OPTIONS: { value: LinkType; label: string }[] =
  LINK_TYPES.map(t => ({ value: t, label: LINK_TYPE_META[t].option }));

export const LINK_TYPE_EDGE_COLOR: Record<string, string> =
  Object.fromEntries(LINK_TYPES.map(t => [t, LINK_TYPE_META[t].color]));

/** Forward (subject-side) label — also used for org-chart edges (arrow shows direction). */
export function linkForwardLabel(type: string): string {
  return LINK_TYPE_META[type as LinkType]?.forward ?? type;
}

/** Direction-aware label for a client's Linked-Clients card. */
export function linkLabelForDirection(type: string, direction: LinkDirection): string {
  const meta = LINK_TYPE_META[type as LinkType];
  if (!meta) return type;
  return direction === 'outgoing' ? meta.forward : meta.reverse;
}

/**
 * Decide whether two entities should be swapped so the relationship reads in
 * its natural direction (subject on top). Returns true when the SUBJECT role
 * matches `otherType` and the OBJECT role matches `currentType` — i.e. the
 * current client belongs on the bottom. Returns false when orientation is
 * already natural or can't be determined.
 */
export function shouldSwapForOrientation(
  type: string,
  currentType: string | null,
  otherType: string | null,
): boolean {
  const orient = LINK_TYPE_META[type as LinkType]?.orient;
  if (!orient || !currentType || !otherType) return false;
  const currentIsObject = orient.object.includes(currentType);
  const otherIsSubject = orient.subject.includes(otherType);
  const currentIsSubject = orient.subject.includes(currentType);
  const otherIsObject = orient.object.includes(otherType);
  // Swap only when the natural fit is unambiguously "other on top".
  if (otherIsSubject && currentIsObject && !(currentIsSubject && otherIsObject)) return true;
  return false;
}
