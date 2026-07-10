/**
 * Email triage categories — the taxonomy.
 *
 * Triage is MANUAL-FIRST: a thread has no category until a user sets one (or the
 * Auto Triage sweep assigns one with AI). Overrides live in email_message_triage
 * (per user, per email); no entry = "untriaged".
 *
 * CATEGORIES ARE NOW PER-USER CUSTOMISABLE. Two anchors are FIXED and can't be
 * changed: 'untriaged' (always first — it's the absence of a category) and
 * 'completed'/"No Action Needed" (always last — the terminal bucket). The MIDDLE
 * categories between them are user-editable (name / colour / icon / order),
 * stored on users.email_triage_categories; absent = DEFAULT_MIDDLE below.
 *
 * Categories are stored on emails by their stable `key`. Renaming changes the
 * label, never the key, so existing rows keep working. The legacy default keys
 * ('fyi', 'completed', …) are preserved for backwards compatibility.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Inbox, Reply, ListTodo, Clock, Paperclip, Building2, Shapes, CheckCircle2,
  Mail, Flag, Star, AlertCircle, FileText, Users, Briefcase, Phone, Calendar,
  PoundSterling, Receipt, Bell, Bookmark, Tag, Folder, Zap, Send, Archive,
  TrendingUp, ShieldCheck, HelpCircle, Megaphone, Scale, Landmark,
} from 'lucide-react';

/** A category value is now a free-form stable key, not a fixed union. */
export type EmailCategory = string;

export interface CategoryDef {
  key: string;
  label: string;
  /** Key into ICON_REGISTRY. */
  iconName: string;
  /** Hex colour that drives the icon + chip styling. */
  color: string;
  /** Guidance for the Auto Triage AI: when should an email go in this bucket? */
  aiDescription: string;
  /** True for the two fixed anchors (untriaged / completed). */
  system?: boolean;
}

// ── Fixed anchors ────────────────────────────────────────────────────────────
export const UNTRIAGED_KEY = 'untriaged';
export const COMPLETED_KEY = 'completed';

export const FIXED_FIRST: CategoryDef = {
  key: UNTRIAGED_KEY, label: 'Untriaged', iconName: 'Inbox', color: '#64748b',
  aiDescription: 'unclear or genuinely cannot be categorised', system: true,
};
export const FIXED_LAST: CategoryDef = {
  key: COMPLETED_KEY, label: 'No Action Needed', iconName: 'CheckCircle2', color: '#16a34a',
  aiDescription: 'concluded — nothing further is required from us', system: true,
};

/** The out-of-the-box middle categories (today's set). Seeded for every user
 *  until they customise. */
export const DEFAULT_MIDDLE: CategoryDef[] = [
  { key: 'needs_reply',    label: 'Needs reply',       iconName: 'Reply',     color: '#ef4444', aiDescription: 'the latest message is from someone else and clearly wants a response' },
  { key: 'to_do',          label: 'To Do',             iconName: 'ListTodo',  color: '#3b82f6', aiDescription: 'requires an action from us beyond just replying' },
  { key: 'waiting_client', label: 'Waiting on client', iconName: 'Clock',     color: '#f59e0b', aiDescription: 'we have replied / are waiting on the client or a third party' },
  { key: 'documents',      label: 'Documents',         iconName: 'Paperclip', color: '#8b5cf6', aiDescription: 'centres on attachments or files to review or save' },
  { key: 'internal',       label: 'Internal',          iconName: 'Building2', color: '#6366f1', aiDescription: 'internal correspondence between colleagues at the firm' },
  { key: 'fyi',            label: 'Ad-hoc / Misc',     iconName: 'Shapes',    color: '#0891b2', aiDescription: 'informational only, with no specific action needed' },
];

// ── Icon registry (the picker's options) ─────────────────────────────────────
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Inbox, Reply, ListTodo, Clock, Paperclip, Building2, Shapes, CheckCircle2,
  Mail, Flag, Star, AlertCircle, FileText, Users, Briefcase, Phone, Calendar,
  PoundSterling, Receipt, Bell, Bookmark, Tag, Folder, Zap, Send, Archive,
  TrendingUp, ShieldCheck, HelpCircle, Megaphone, Scale, Landmark,
};
/** Icon names offered in the customisation picker (anchors' icons excluded — they're fixed). */
export const ICON_OPTIONS: string[] = Object.keys(ICON_REGISTRY);

export function iconFor(name: string | undefined | null): LucideIcon {
  return (name && ICON_REGISTRY[name]) || Shapes;
}

// ── Colour palette (the picker's swatches) ───────────────────────────────────
export const CATEGORY_PALETTE: string[] = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#16a34a',
  '#0891b2', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#db2777',
  '#64748b', '#0f766e', '#b45309', '#be123c',
];

// ── Builders ─────────────────────────────────────────────────────────────────
/** Full ordered list = [Untriaged, ...middle, No Action Needed]. */
export function buildCategoryList(middle?: CategoryDef[] | null): CategoryDef[] {
  const mid = middle && middle.length ? middle : DEFAULT_MIDDLE;
  return [FIXED_FIRST, ...mid, FIXED_LAST];
}

export function buildMetaMap(list: CategoryDef[]): Record<string, CategoryDef> {
  return Object.fromEntries(list.map(c => [c.key, c]));
}

/** A safe meta lookup that never returns undefined (unknown keys → a neutral
 *  fallback), important now that keys are dynamic. */
export function metaFor(map: Record<string, CategoryDef>, key: string): CategoryDef {
  return map[key] ?? { key, label: key, iconName: 'Shapes', color: '#64748b', aiDescription: '' };
}

// ── Back-compat static exports (DEFAULTS) ────────────────────────────────────
// Code paths not yet wired to a user's config fall back to the default set.
const DEFAULT_LIST = buildCategoryList();

export const EMAIL_CATEGORIES: string[] = DEFAULT_LIST.map(c => c.key);

export const CATEGORY_META: Record<string, { label: string; icon: LucideIcon; color: string }> =
  Object.fromEntries(DEFAULT_LIST.map(c => [c.key, { label: c.label, icon: iconFor(c.iconName), color: c.color }]));
