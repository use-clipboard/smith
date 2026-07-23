// Accounts Studio — structured inputs behind disclosure notes.
//
// Some notes are really DATA, not prose: the average-employees number, the
// depreciation rates per asset class. Each spec below renders as a small input
// panel above the note editor on Notes & Disclosures; entering values updates
// the engagement AND regenerates the relevant wording in the note content, so
// the accounts pack, the preview and the iXBRL all read the same figures.
//
// Prior-year values are auto-carried from the client's previous engagement when
// one exists (see carryForwardFromPrior + the prior-disclosures API).

import type { Engagement, DisclosureSection, SectionStatus } from '@/components/features/accounts-studio/types';

export interface NoteField {
  key: string;
  label: string;
  kind: 'number' | 'text';
  placeholder?: string;
  /** Only shown when the engagement has prior-year comparatives. */
  priorOnly?: boolean;
  /** Only shown when relevant to this engagement's figures (default: always). */
  relevant?: (e: Engagement) => boolean;
}

export interface NoteInputSpec {
  noteId: string;
  title: string;
  hint: string;
  fields: NoteField[];
  /** Hide the whole panel when it doesn't apply (default: always shown). */
  visible?: (e: Engagement) => boolean;
  /** Current values from the engagement (field key → display string). */
  read(e: Engagement): Record<string, string>;
  /** Store the values on the engagement + regenerate the note wording. */
  apply(e: Engagement, values: Record<string, string>): Engagement;
}

const hasPrior = (e: Engagement) => !!e.statements?.hasPrior;
const priorYearLabel = (e: Engagement) => (e.comparativePeriod ? e.comparativePeriod.slice(-4) : 'prior year');

/** Parse a non-negative integer from an input string ('' → null). */
function intOrNull(s: string | undefined): number | null {
  const t = (s ?? '').trim();
  if (t === '') return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Replace one disclosure section's content (and optionally status). */
function withNote(e: Engagement, noteId: string, content: string, status?: SectionStatus): Engagement {
  return {
    ...e,
    disclosures: e.disclosures.map((s: DisclosureSection) =>
      s.id === noteId ? { ...s, content, ...(status ? { status } : {}) } : s),
  };
}

// ── Employees ────────────────────────────────────────────────────────────────
const employeesSpec: NoteInputSpec = {
  noteId: 'employees',
  title: 'Average number of employees',
  hint: 'Feeds the Employees note, the accounts and the Companies House iXBRL.',
  fields: [
    { key: 'current', label: 'Current year', kind: 'number', placeholder: 'e.g. 6' },
    { key: 'prior', label: 'Prior year', kind: 'number', placeholder: 'e.g. 5', priorOnly: true },
  ],
  read: e => ({
    current: e.averageEmployees != null ? String(e.averageEmployees) : '',
    prior: e.averageEmployeesPrior != null ? String(e.averageEmployeesPrior) : '',
  }),
  apply: (e, values) => {
    const cur = intOrNull(values.current);
    const prior = intOrNull(values.prior);
    const next: Engagement = { ...e, averageEmployees: cur, averageEmployeesPrior: prior };
    const priorPart = hasPrior(e) ? ` (${priorYearLabel(e)}: ${prior != null ? prior : '[ ]'})` : '';
    const content = `<h3>Employees</h3><p>The average number of employees during the year was ${cur != null ? cur : '[ ]'}${priorPart}.</p>`;
    const complete = cur != null && (!hasPrior(e) || prior != null);
    return withNote(next, 'employees', content, complete ? 'complete' : 'needs-review');
  },
};

// ── Depreciation rates & methods (accounting policies note) ──────────────────
const DEP_CLASSES: { key: string; label: string }[] = [
  { key: 'plant', label: 'Plant and machinery' },
  { key: 'motor', label: 'Motor vehicles' },
  { key: 'fixtures', label: 'Fixtures and fittings' },
  { key: 'computer', label: 'Computer equipment' },
  { key: 'property', label: 'Land and buildings' },
];

/** Classify one fixed-asset account name into a depreciation class (first match
 *  wins — computer/fixtures before the generic plant "equipment" catch-all). */
function classifyAssetName(name: string): string | null {
  const s = name.toLowerCase();
  if (/computer|laptop|\bict\b|it equipment/.test(s)) return 'computer';
  if (/fixture|fitting|furniture|office equipment/.test(s)) return 'fixtures';
  if (/motor|vehicle|\bvan\b|\bcar\b|\blorry\b/.test(s)) return 'motor';
  if (/freehold|leasehold|\bland\b|building|property/.test(s)) return 'property';
  if (/plant|machin|equipment|tooling/.test(s)) return 'plant';
  return null;
}

/** Which depreciation classes the accounts actually contain — detected from the
 *  fixed-asset section of the statements + fixed-asset trial-balance rows.
 *  Falls back to ALL classes when fixed assets exist but none of the names
 *  match (unusual naming — let the accountant pick). */
function detectedDepClasses(e: Engagement): Set<string> {
  const names: string[] = [];
  for (const g of e.statements?.balanceSheet.fixedAssets ?? []) {
    names.push(g.title, ...g.lines.map(l => l.label));
  }
  for (const r of e.trialBalance ?? []) {
    if ((r.ledger ?? '').toLowerCase().includes('fixed')) names.push(r.name);
  }
  const found = new Set<string>();
  for (const n of names) { const c = classifyAssetName(n); if (c) found.add(c); }
  if (found.size === 0 && hasFixedAssets(e)) return new Set(DEP_CLASSES.map(c => c.key));
  return found;
}

function hasFixedAssets(e: Engagement): boolean {
  const bs = e.statements?.balanceSheet;
  return !!bs && (bs.fixedAssets.length > 0 || Math.abs(bs.fixedAssetsTotal) > 0.005);
}

const DEP_PARA_RE = /<p><strong>Tangible fixed assets\.<\/strong>[\s\S]*?<\/p>/;

const depreciationSpec: NoteInputSpec = {
  noteId: 'policies',
  title: 'Depreciation rates & methods',
  hint: 'Only the asset classes found in these accounts are shown — the tangible fixed assets policy is rewritten from them.',
  // Nothing to depreciate → no panel at all.
  visible: e => hasFixedAssets(e),
  fields: DEP_CLASSES.map(c => ({
    key: c.key, label: c.label, kind: 'text' as const, placeholder: 'e.g. 25% reducing balance',
    // Show only classes detected in the accounts (keep any with a value already
    // entered/carried so it stays editable rather than silently stuck).
    relevant: (e: Engagement) => detectedDepClasses(e).has(c.key) || !!(e.disclosureData?.policies?.[c.key]),
  })),
  read: e => ({ ...(e.disclosureData?.policies ?? {}) }),
  apply: (e, values) => {
    const cleaned: Record<string, string> = {};
    for (const c of DEP_CLASSES) { const v = (values[c.key] ?? '').trim(); if (v) cleaned[c.key] = v; }
    const next: Engagement = { ...e, disclosureData: { ...(e.disclosureData ?? {}), policies: cleaned } };

    const entries = DEP_CLASSES.filter(c => cleaned[c.key]).map(c => `${c.label} — ${cleaned[c.key]}`);
    const sentence = entries.length
      ? `Depreciation is provided at the following annual rates and methods: ${entries.join('; ')}.`
      : 'Depreciation is provided to write off the cost less estimated residual value of each asset over its expected useful life.';
    const para = `<p><strong>Tangible fixed assets.</strong> Tangible fixed assets are stated at cost less accumulated depreciation. ${sentence}</p>`;

    const note = e.disclosures.find(s => s.id === 'policies');
    if (!note) return next;
    const content = DEP_PARA_RE.test(note.content) ? note.content.replace(DEP_PARA_RE, para) : `${note.content}${para}`;
    return withNote(next, 'policies', content);
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────
export const NOTE_INPUT_SPECS: NoteInputSpec[] = [employeesSpec, depreciationSpec];

export function noteInputSpec(noteId: string): NoteInputSpec | null {
  return NOTE_INPUT_SPECS.find(s => s.noteId === noteId) ?? null;
}

/** What last year's engagement carries forward into this one. */
export interface PriorCarry {
  averageEmployees?: number | null;
  disclosureData?: Record<string, Record<string, string>> | null;
}

/**
 * Auto-fill prior-year values from the client's previous engagement. Only fills
 * gaps — never overwrites something already entered. Returns the updated
 * engagement, or null when there was nothing to apply.
 */
export function carryForwardFromPrior(e: Engagement, prior: PriorCarry): Engagement | null {
  let next = e;
  let changed = false;

  // Prior-year employee count → the Employees note comparative.
  if (hasPrior(e) && e.averageEmployeesPrior == null && prior.averageEmployees != null) {
    const values = employeesSpec.read(next);
    values.prior = String(prior.averageEmployees);
    next = employeesSpec.apply(next, values);
    changed = true;
  }

  // Depreciation rates → same policies as last year (only when none entered
  // yet, and only for asset classes these accounts actually contain).
  const havePolicies = Object.keys(next.disclosureData?.policies ?? {}).length > 0;
  const priorPolicies = prior.disclosureData?.policies ?? {};
  const detected = detectedDepClasses(next);
  const carried: Record<string, string> = {};
  for (const [k, v] of Object.entries(priorPolicies)) if (v && detected.has(k)) carried[k] = v;
  if (!havePolicies && Object.keys(carried).length > 0) {
    next = depreciationSpec.apply(next, carried);
    changed = true;
  }

  return changed ? next : null;
}
