/**
 * Email triage categories — the shared taxonomy.
 *
 * Triage is MANUAL-FIRST: a thread has no category until a user sets one (or
 * the Auto Triage sweep assigns one with AI). Overrides live in a map persisted
 * to email_message_triage (per user, per email); no entry = "untriaged".
 *
 * NOTE on values vs labels: the stored values 'fyi' and 'completed' are kept
 * for backwards compatibility with existing DB rows — only their display
 * labels changed ('Ad-hoc / Misc' and 'No Action Needed' respectively).
 */

import type { LucideIcon } from 'lucide-react';
import { Inbox, Reply, ListTodo, Clock, Paperclip, Building2, Shapes, CheckCircle2 } from 'lucide-react';

export type EmailCategory = 'untriaged' | 'needs_reply' | 'to_do' | 'waiting_client' | 'documents' | 'internal' | 'fyi' | 'completed';

export const EMAIL_CATEGORIES: EmailCategory[] = ['untriaged', 'needs_reply', 'to_do', 'waiting_client', 'documents', 'internal', 'fyi', 'completed'];

export const CATEGORY_META: Record<EmailCategory, { label: string; icon: LucideIcon; color: string; chip: string }> = {
  untriaged:      { label: 'Untriaged',         icon: Inbox,        color: '#64748b', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
  needs_reply:    { label: 'Needs reply',       icon: Reply,        color: '#ef4444', chip: 'bg-red-50 text-red-700 border-red-200' },
  to_do:          { label: 'To Do',             icon: ListTodo,     color: '#3b82f6', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  waiting_client: { label: 'Waiting on client', icon: Clock,        color: '#f59e0b', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  documents:      { label: 'Documents',         icon: Paperclip,    color: '#8b5cf6', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  internal:       { label: 'Internal',          icon: Building2,    color: '#6366f1', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  fyi:            { label: 'Ad-hoc / Misc',     icon: Shapes,       color: '#0891b2', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  completed:      { label: 'No Action Needed',  icon: CheckCircle2, color: '#16a34a', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
