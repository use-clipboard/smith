'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Pencil, Trash2, ExternalLink, FileText, Clock,
  Link2, Plus, X, Search, Pin, PinOff, Phone, Users2, CheckSquare,
  MessageCircle, Mail, StickyNote, ChevronDown, ChevronUp, Check, Paperclip, Image,
  FileSearch, ArrowLeftRight, House, ClipboardCheck, ShieldAlert, Receipt, TrendingUp, Zap,
  Archive, CalendarDays, MicVocal, Network, Sparkles, Info, CalendarCheck,
} from 'lucide-react';
import LinkGraphLightbox from '@/components/features/clients/LinkGraphLightbox';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import Tooltip from '@/components/ui/Tooltip';
import ScheduleMeetingModal from '@/components/features/calendar/ScheduleMeetingModal';
import ToolLayout from '@/components/ui/ToolLayout';
import { Users } from 'lucide-react';
import { useTabContext, Tab } from '@/components/ui/TabContext';
import { useModules } from '@/components/ui/ModulesProvider';
import { useFavourites } from '@/components/ui/FavouritesProvider';
import { setPendingClient } from '@/lib/pendingClient';
import ClientTasksPanel from '@/components/features/tasks/ClientTasksPanel';
import TaskTypeSelector from '@/components/features/tasks/TaskTypeSelector';
import QuickTaskModal from '@/components/features/tasks/QuickTaskModal';
import CreateTaskModal, { type CreateTaskData } from '@/components/features/tasks/CreateTaskModal';
import TemplateBuilder, { type TemplateData, type TaskCreationOutput } from '@/components/features/tasks/TemplateBuilder';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import type { TaskTemplate } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClientStatus = 'active' | 'hold' | 'inactive';

const STATUS_CONFIG: Record<ClientStatus, { dot: string; bg: string; text: string; label: string }> = {
  active:   { dot: 'bg-green-500',  bg: 'bg-green-100',  text: 'text-green-700',  label: 'Active'    },
  hold:     { dot: 'bg-amber-500',  bg: 'bg-amber-100',  text: 'text-amber-700',  label: 'On Hold'   },
  inactive: { dot: 'bg-gray-400',   bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Inactive'  },
};

// ── VAT scheme period-end helpers ────────────────────────────────────────────
// Yearly schemes can end in any month (Jan–Dec).
// Quarterly schemes follow HMRC's three stagger groups; we store the
// representative month (1, 2, or 3) and display the full quarter pattern.
const MONTHS_FULL = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const QUARTERLY_STAGGERS: Record<number, string> = {
  3: 'Mar / Jun / Sep / Dec',
  1: 'Apr / Jul / Oct / Jan',
  2: 'May / Aug / Nov / Feb',
};
function describeVatPeriodEnd(scheme: string | null, month: number | null): string | null {
  if (!scheme || month == null) return null;
  if (scheme === 'Yearly')    return `ends ${MONTHS_FULL[month - 1]}`;
  if (scheme === 'Quarterly') return `quarter-ends ${QUARTERLY_STAGGERS[month] ?? '—'}`;
  return null;
}

interface Client {
  id: string; name: string; client_ref: string | null; business_type: string | null;
  contact_email: string | null; risk_rating: string | null; status: ClientStatus; created_at: string;
  address: string | null; utr_number: string | null; registration_number: string | null;
  national_insurance_number: string | null; companies_house_id: string | null;
  vat_number: string | null; companies_house_auth_code: string | null; date_of_birth: string | null;
  contact_number: string | null;
  paye_reference: string | null;
  paye_accounts_office_reference: string | null;
  vat_submit_type: string | null;
  vat_scheme: string | null;
  vat_scheme_period_end_month: number | null;
  year_end: string | null;
  mtd_it: boolean;
}
interface ClientLink {
  id: string; link_type: string; notes: string | null; direction: 'outgoing' | 'incoming';
  other_client: { id: string; name: string; client_ref: string | null; business_type: string | null; status: ClientStatus; } | null;
}
interface Output { id: string; feature: string; target_software: string | null; created_at: string; }
interface Document { id: string; file_name: string; document_type: string | null; created_at: string; drive_file_id: string | null; }
interface VaultDoc {
  id: string; file_name: string; tag_document_type: string | null; tag_supplier_name: string | null;
  tag_document_date: string | null; tag_amount: number | null; tag_currency: string | null;
  tag_tax_year: string | null; tag_summary: string | null; google_drive_url: string | null;
  tagging_status: string; indexed_at: string;
}
interface NoteAttachment { name: string; url: string; mimeType: string; }
interface MeetingNotesMetadata {
  summary: string;
  keyPoints: string[];
  actionItems: { action: string; owner: string; deadline: string }[];
  decisions: string[];
  formalMinutes: string;
  nextMeeting: string;
  attendees: string[];
  location: string;
  meetingTime: string;
  meetingOrigin: string;
}
interface TimelineNote {
  id: string; title: string; content: string | null; note_type: string;
  note_date: string; is_pinned: boolean; created_at: string; updated_at: string;
  users: { full_name: string } | null;
  attachments?: NoteAttachment[];
  /** Set when this note was created by the Meeting Notes tool */
  meeting_note_id?: string | null;
  /** Google Drive URL for the meeting notes PDF */
  google_drive_url?: string | null;
  /** Structured data for meeting_notes type cards */
  metadata?: MeetingNotesMetadata | null;
}
interface SearchableClient { id: string; name: string; client_ref: string | null; business_type: string | null; }

// ── Constants ──────────────────────────────────────────────────────────────────

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader: 'Sole Trader', partnership: 'Partnership', limited_company: 'Limited Company',
  individual: 'Individual', trust: 'Trust', charity: 'Charity', rental_landlord: 'Rental Landlord',
};
const LINK_TYPE_LABELS: Record<string, string> = {
  director: 'Director of', shareholder: 'Shareholder of', spouse_partner: 'Spouse / Partner of',
  trustee: 'Trustee of', beneficiary: 'Beneficiary of', associated_company: 'Associated Company',
  parent_company: 'Parent Company of', subsidiary: 'Subsidiary of', guarantor: 'Guarantor of', other: 'Linked to',
};
const LINK_TYPE_COLOURS: Record<string, string> = {
  director: 'bg-blue-100 text-blue-700', shareholder: 'bg-indigo-100 text-indigo-700',
  spouse_partner: 'bg-pink-100 text-pink-700', trustee: 'bg-purple-100 text-purple-700',
  beneficiary: 'bg-violet-100 text-violet-700', associated_company: 'bg-amber-100 text-amber-700',
  parent_company: 'bg-orange-100 text-orange-700', subsidiary: 'bg-yellow-100 text-yellow-700',
  guarantor: 'bg-red-100 text-red-700', other: 'bg-gray-100 text-gray-600',
};
const FEATURE_LABELS: Record<string, string> = {
  full_analysis: 'Full Analysis', bank_to_csv: 'Bank to CSV', landlord_analysis: 'Landlord Analysis',
  final_accounts_review: 'Accounts Review', performance_analysis: 'Performance Analysis',
  p32_summary: 'P32 Summary', risk_assessment: 'Risk Assessment', summarise: 'Summarise',
};
const RISK_COLOURS: Record<string, string> = {
  Low: 'bg-green-100 text-green-700', Medium: 'bg-amber-100 text-amber-700', High: 'bg-red-100 text-red-700',
};
const DOC_TYPE_COLOURS: Record<string, string> = {
  invoice: 'bg-blue-100 text-blue-700', receipt: 'bg-green-100 text-green-700',
  bank_statement: 'bg-purple-100 text-purple-700', payslip: 'bg-orange-100 text-orange-700',
  risk_assessment: 'bg-rose-100 text-rose-700', other: 'bg-gray-100 text-gray-600',
};
const NOTE_TYPE_META: Record<string, { label: string; icon: React.ReactNode; colour: string }> = {
  phone_call:    { label: 'Phone Call',    icon: <Phone size={11} />,    colour: 'bg-sky-100 text-sky-700' },
  meeting:       { label: 'Meeting',       icon: <Users2 size={11} />,   colour: 'bg-emerald-100 text-emerald-700' },
  meeting_notes: { label: 'Meeting Notes', icon: <MicVocal size={11} />, colour: 'bg-indigo-100 text-indigo-700' },
  conversation:  { label: 'Conversation',  icon: <MessageCircle size={11} />, colour: 'bg-violet-100 text-violet-700' },
  email:         { label: 'Email',         icon: <Mail size={11} />,     colour: 'bg-amber-100 text-amber-700' },
  other:         { label: 'Note',          icon: <StickyNote size={11} />, colour: 'bg-gray-100 text-gray-600' },
};
const NOTE_TYPE_OPTIONS = [
  { key: 'phone_call', label: 'Phone Call', icon: <Phone size={14} /> },
  { key: 'meeting', label: 'Meeting', icon: <Users2 size={14} /> },
  { key: 'conversation', label: 'Conversation', icon: <MessageCircle size={14} /> },
  { key: 'email', label: 'Email', icon: <Mail size={14} /> },
  { key: 'other', label: 'Note', icon: <StickyNote size={14} /> },
] as const;
const SUGGESTED_TITLES = [
  'Change in Fee', 'New Employee', 'Director Change', 'Ownership Change',
  'VAT Registration', 'Address Change', 'Year End Change', 'New Service Agreed',
  'Payment Arrangement', 'Client Meeting', 'Phone Call', 'Risk Review',
  'AML Check', 'Bank Details Change', 'Compliance Update',
];

const NON_INDIVIDUAL = ['sole_trader', 'partnership', 'limited_company', 'trust', 'charity', 'rental_landlord'];

function showFor(field: string, type: string | null): boolean {
  if (!type) return true;
  const map: Record<string, string[]> = {
    utr_number: ['sole_trader', 'partnership', 'limited_company', 'individual'],
    registration_number: ['limited_company'],
    national_insurance_number: ['individual', 'sole_trader'],
    companies_house_id: ['sole_trader', 'individual'],
    vat_number: ['sole_trader', 'limited_company', 'partnership'],
    companies_house_auth_code: ['limited_company'],
    date_of_birth: ['individual', 'sole_trader'],
    paye_reference: NON_INDIVIDUAL,
    paye_accounts_office_reference: NON_INDIVIDUAL,
    vat_submit_type: NON_INDIVIDUAL,
    vat_scheme: NON_INDIVIDUAL,
    year_end: NON_INDIVIDUAL,
    mtd_it: ['individual'],
  };
  return map[field] ? map[field].includes(type) : true;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function InfoRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{label}</dt>
      <dd className={`mt-1 text-[var(--text-primary)] font-medium ${mono ? 'font-mono' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

// ── Note Card ──────────────────────────────────────────────────────────────────

function NoteCard({
  note, onUpdate, onDelete, onPin,
}: {
  note: TimelineNote;
  onUpdate: (id: string, data: Partial<TimelineNote>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPin: (id: string, pinned: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showTitleSuggestions, setShowTitleSuggestions] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [editTitle, setEditTitle] = useState(note.title);
  const [editContent, setEditContent] = useState(note.content ?? '');
  const [editType, setEditType] = useState(note.note_type);
  const [editDate, setEditDate] = useState(note.note_date);

  const meta = NOTE_TYPE_META[note.note_type] ?? NOTE_TYPE_META.other;

  const emailData = (() => {
    if (!note.content) return null;
    try {
      const parsed = JSON.parse(note.content) as Record<string, unknown>;
      if (parsed.__smith_email__) return parsed as {
        threadId: string; subject: string; snippet: string;
        fromName: string; fromEmail: string; date: string;
        to?: string; cc?: string; bcc?: string; sentAt?: string;
        bodyText?: string;
        attachments?: { filename: string; mimeType: string; size: number }[];
      };
    } catch { /* not JSON */ }
    return null;
  })();
  const isEmailNote = !!emailData;

  function startEdit() {
    setEditTitle(note.title); setEditContent(note.content ?? '');
    setEditType(note.note_type); setEditDate(note.note_date);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(note.id, { title: editTitle, content: editContent, note_type: editType, note_date: editDate });
      setEditing(false);
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { await onDelete(note.id); } finally { setDeleting(false); setConfirmDel(false); }
  }

  if (editing) {
    return (
      <div className="glass-solid rounded-xl border-2 border-[var(--accent)] p-4 space-y-3">
        {/* Title + suggestions */}
        <div className="relative">
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Title</label>
          <input
            value={editTitle} onChange={e => setEditTitle(e.target.value)}
            onFocus={() => setShowTitleSuggestions(true)} onBlur={() => setTimeout(() => setShowTitleSuggestions(false), 150)}
            className="input-base w-full" placeholder="e.g. Change in Fee"
          />
          {showTitleSuggestions && (
            <div className="absolute top-full left-0 right-0 mt-1 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-lg overflow-hidden max-h-48 overflow-y-auto">
              {SUGGESTED_TITLES.filter(t => t.toLowerCase().includes(editTitle.toLowerCase()) || !editTitle).map(t => (
                <button key={t} onMouseDown={() => { setEditTitle(t); setShowTitleSuggestions(false); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)] transition-colors">
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Type + Date */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Type</label>
            <div className="grid grid-cols-5 gap-1">
              {NOTE_TYPE_OPTIONS.map(opt => (
                <button key={opt.key} type="button" onClick={() => setEditType(opt.key)}
                  className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-colors ${
                    editType === opt.key
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                  }`}>
                  {opt.icon}
                  <span className="leading-tight text-center">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Date</label>
            <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className="input-base w-full text-sm" />
          </div>
        </div>

        {/* Content — hidden for email notes (content is system-managed JSON) */}
        {!isEmailNote && (
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Notes</label>
            <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={4}
              placeholder="Record what was discussed, agreed, or noted…"
              className="input-base w-full resize-none text-sm leading-relaxed" />
          </div>
        )}

        <div className="flex justify-between items-center pt-1">
          <button onClick={() => setConfirmDel(true)} className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors">
            <Trash2 size={12} />Delete note
          </button>
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="btn-ghost text-xs">Cancel</button>
            <button onClick={() => void handleSave()} disabled={saving || !editTitle}
              className="btn-primary text-xs disabled:opacity-50 flex items-center gap-1.5">
              <Check size={12} />{saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {confirmDel && (
          <div className="border-t border-red-200 pt-3 mt-1 flex items-center justify-between gap-3">
            <p className="text-xs text-red-600 font-medium">Delete this note permanently?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDel(false)} className="btn-ghost text-xs">Cancel</button>
              <button onClick={() => void handleDelete()} disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                <Trash2 size={11} />{deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const parsedMd = (() => {
    if (!note.content) return null;
    if (note.metadata) return note.metadata;
    try {
      const parsed = JSON.parse(note.content) as Record<string, unknown>;
      if (parsed.__smith_meeting_notes__) return parsed as unknown as MeetingNotesMetadata;
    } catch { /* not JSON */ }
    return null;
  })();
  const isMeetingNote = !!parsedMd;
  const md = parsedMd;

  return (
    <div className={`glass-solid rounded-xl border transition-all group ${note.is_pinned ? 'border-[var(--accent)]/40 bg-[var(--accent-light)]/30' : 'border-[var(--border)]'}`}>
      {/* ── Header row ── */}
      <div className="flex items-start justify-between gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${meta.colour}`}>
              {meta.icon}{meta.label}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{formatDate(note.note_date)}</span>
            {note.users?.full_name && <span className="text-xs text-[var(--text-muted)]">· {note.users.full_name}</span>}
            {note.is_pinned && (
              <span className="inline-flex items-center gap-0.5 text-xs text-[var(--accent)] font-medium">
                <Pin size={10} className="fill-[var(--accent)]" />Pinned
              </span>
            )}
          </div>

          {/* Title — clickable expand toggle for meeting notes */}
          {isMeetingNote ? (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1.5 text-left group/title w-full"
            >
              <span className="font-semibold text-[var(--text-primary)] text-sm group-hover/title:text-[var(--accent)] transition-colors">
                {note.title}
              </span>
              <ChevronDown size={14} className={`text-[var(--text-muted)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <p className="font-semibold text-[var(--text-primary)] text-sm">{note.title}</p>
          )}

          {/* Summary line for meeting notes (collapsed) */}
          {isMeetingNote && !expanded && md && (
            <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed line-clamp-2">{md.summary}</p>
          )}

          {/* Email note — collapsible card */}
          {isEmailNote && emailData && (
            <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)] overflow-hidden">
              {/* From line + expand toggle — always visible */}
              <button
                onClick={() => setExpanded(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-[var(--border)]/30 transition-colors text-left"
              >
                <p className="text-xs text-[var(--text-muted)] truncate">
                  <span className="font-medium text-[var(--text-secondary)]">From: </span>
                  {emailData.fromName && <span className="text-[var(--text-primary)]">{emailData.fromName} </span>}
                  {emailData.fromEmail && <span className="text-[var(--text-muted)]">&lt;{emailData.fromEmail}&gt;</span>}
                </p>
                <ChevronDown size={13} className={`shrink-0 text-[var(--text-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded body + attachments */}
              {expanded && (
                <div className="border-t border-[var(--border)] px-3 py-2.5 space-y-2">
                  {/* Addressing + sent time */}
                  <div className="space-y-0.5 text-xs pb-2 border-b border-[var(--border)]">
                    {emailData.to && (
                      <p className="text-[var(--text-muted)]"><span className="font-medium text-[var(--text-secondary)] w-8 inline-block">To:</span> {emailData.to}</p>
                    )}
                    {emailData.cc && (
                      <p className="text-[var(--text-muted)]"><span className="font-medium text-[var(--text-secondary)] w-8 inline-block">CC:</span> {emailData.cc}</p>
                    )}
                    {emailData.bcc && (
                      <p className="text-[var(--text-muted)]"><span className="font-medium text-[var(--text-secondary)] w-8 inline-block">BCC:</span> {emailData.bcc}</p>
                    )}
                    {emailData.sentAt && (
                      <p className="text-[var(--text-muted)]"><span className="font-medium text-[var(--text-secondary)] w-8 inline-block">Sent:</span> {new Date(emailData.sentAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
                    )}
                  </div>
                  {emailData.bodyText ? (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{emailData.bodyText}</p>
                  ) : emailData.snippet ? (
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic">{emailData.snippet}</p>
                  ) : null}
                  {emailData.attachments && emailData.attachments.length > 0 && (
                    <div className="pt-1.5 border-t border-[var(--border)]">
                      <p className="text-[11px] font-medium text-[var(--text-muted)] mb-1.5">Attachments</p>
                      <div className="flex flex-wrap gap-1.5">
                        {emailData.attachments.map((a, i) => (
                          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card-solid)] text-xs text-[var(--text-secondary)]">
                            <Paperclip size={10} className="shrink-0 text-[var(--text-muted)]" />
                            <span className="max-w-[180px] truncate">{a.filename}</span>
                            {a.size > 0 && <span className="text-[var(--text-muted)] shrink-0">({Math.round(a.size / 1024)}KB)</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Regular note content */}
          {!isMeetingNote && !isEmailNote && note.content && (
            <p className="text-sm text-[var(--text-secondary)] mt-1.5 leading-relaxed whitespace-pre-wrap">{note.content}</p>
          )}

          {note.attachments && note.attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {note.attachments.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-2 py-1 bg-[var(--bg-nav-hover)] border border-[var(--border)] rounded-lg text-xs text-[var(--accent)] hover:underline font-medium">
                  {a.mimeType.startsWith('image/') ? <Image size={11} /> : <Paperclip size={11} />}
                  {a.name}
                </a>
              ))}
            </div>
          )}
          {note.google_drive_url && (
            <div className="mt-2">
              <a href={note.google_drive_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-2 py-1 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700 hover:bg-indigo-100 font-medium transition-colors">
                <FileText size={11} />View meeting notes PDF<ExternalLink size={10} />
              </a>
            </div>
          )}
        </div>

        {/* Actions (appear on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <Tooltip label={note.is_pinned ? 'Unpin' : 'Pin to top'}>
            <button onClick={() => void onPin(note.id, !note.is_pinned)}
              aria-label={note.is_pinned ? 'Unpin' : 'Pin to top'}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors">
              {note.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
            </button>
          </Tooltip>
          {!isEmailNote && (
            <Tooltip label="Edit note">
              <button onClick={startEdit} aria-label="Edit note"
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
                <Pencil size={13} />
              </button>
            </Tooltip>
          )}
        </div>
      </div>

      {/* ── Expanded meeting notes body ── */}
      {isMeetingNote && expanded && md && (
        <div className="border-t border-[var(--border)] px-4 pb-4 pt-3 space-y-4">

          {/* Meta row */}
          {(md.meetingTime || md.location || md.attendees.length > 0) && (
            <div className="flex flex-wrap gap-3 text-xs text-[var(--text-muted)]">
              {md.meetingTime && <span>🕐 {md.meetingTime}</span>}
              {md.location    && <span>📍 {md.location}</span>}
              {md.attendees.length > 0 && <span>👥 {md.attendees.join(', ')}</span>}
            </div>
          )}

          {/* Summary */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Summary</p>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{md.summary}</p>
          </div>

          {/* Key Points */}
          {md.keyPoints.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Key Discussion Points</p>
              <ol className="space-y-1">
                {md.keyPoints.map((pt, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                    <span className="text-[var(--text-muted)] shrink-0 w-5 text-right">{i + 1}.</span>
                    <span>{pt}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Decisions */}
          {md.decisions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Decisions Made</p>
              <ul className="space-y-1">
                {md.decisions.map((d, i) => (
                  <li key={i} className="flex gap-2 text-sm text-[var(--text-secondary)]">
                    <span className="text-[var(--accent)] shrink-0">–</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Items */}
          {md.actionItems.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Action Items</p>
              <div className="space-y-1.5">
                {md.actionItems.map((item, i) => (
                  <div key={i} className="rounded-lg bg-[var(--bg-nav-hover)] px-3 py-2">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{i + 1}. {item.action}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {item.owner} · Deadline: {item.deadline}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formal Minutes */}
          {md.formalMinutes && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Minutes</p>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{md.formalMinutes}</p>
            </div>
          )}

          {/* Next Meeting */}
          {md.nextMeeting && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Next Meeting</p>
              <p className="text-sm text-[var(--text-secondary)]">{md.nextMeeting}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Note Form ──────────────────────────────────────────────────────────────

function AddNoteForm({ clientId, onAdd, onCancel }: {
  clientId: string;
  onAdd: (note: TimelineNote) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [noteType, setNoteType] = useState('other');
  const [noteDate, setNoteDate] = useState(new Date().toISOString().split('T')[0]);
  const [isPinned, setIsPinned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          note_type: noteType,
          note_date: noteDate,
          is_pinned: isPinned,
          attachments: [],
        }),
      });
      if (res.ok) {
        const { note } = await res.json() as { note: TimelineNote };
        onAdd(note);
      }
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={e => void handleSubmit(e)} className="glass-solid rounded-xl border-2 border-[var(--accent)] p-5 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Add Timeline Note</p>
        <button type="button" onClick={onCancel} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
      </div>

      {/* Title */}
      <div className="relative">
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Title *</label>
        <input value={title} onChange={e => setTitle(e.target.value)} required
          onFocus={() => setShowSuggestions(true)} onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="e.g. Change in Fee, New Employee…" className="input-base w-full" />
        {showSuggestions && (
          <div className="absolute top-full left-0 right-0 mt-1 z-20 glass-solid border border-[var(--border)] rounded-xl shadow-lg overflow-hidden max-h-52 overflow-y-auto">
            {SUGGESTED_TITLES.filter(t => !title || t.toLowerCase().includes(title.toLowerCase())).map(t => (
              <button key={t} type="button" onMouseDown={() => { setTitle(t); setShowSuggestions(false); }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-[var(--bg-nav-hover)] text-[var(--text-primary)] transition-colors">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Type */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Type</label>
        <div className="grid grid-cols-5 gap-1">
          {NOTE_TYPE_OPTIONS.map(opt => (
            <button key={opt.key} type="button" onClick={() => setNoteType(opt.key)}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-colors ${
                noteType === opt.key
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
              }`}>
              {opt.icon}
              <span className="leading-tight text-center">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Date */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Date</label>
        <input type="date" value={noteDate} onChange={e => setNoteDate(e.target.value)} className="input-base w-full" />
      </div>

      {/* Content */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Notes</label>
        <textarea value={content} onChange={e => setContent(e.target.value)} rows={4}
          placeholder="Record what was discussed, agreed, or noted…"
          className="input-base w-full resize-none leading-relaxed" />
      </div>

      {/* Pin toggle */}
      <div className="flex items-center gap-3 py-1">
        <button type="button" onClick={() => setIsPinned(v => !v)}
          className={`relative w-10 h-6 rounded-full transition-colors ${isPinned ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
          <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${isPinned ? 'translate-x-4' : ''}`} />
        </button>
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Pin to top</p>
          <p className="text-xs text-[var(--text-muted)]">Pinned notes always appear above the timeline</p>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
        <button type="submit" disabled={saving || !title.trim()} className="btn-primary disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Note'}
        </button>
      </div>
    </form>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { openInNewTab } = useTabContext();
  const { isModuleActive } = useModules();
  const { favourites } = useFavourites();
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'outputs' | 'documents' | 'timeline' | 'details' | 'tasks'>('details');

  // Documents tab
  const [docsTabLoading, setDocsTabLoading] = useState(false);

  // Timeline
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [notes, setNotes] = useState<TimelineNote[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineFetched, setTimelineFetched] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showVaultItems, setShowVaultItems] = useState(true);
  const [timelineSearch, setTimelineSearch] = useState('');
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<string | null>(null);

  // Links
  const [links, setLinks] = useState<ClientLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksFetched, setLinksFetched] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [selectedLinkClient, setSelectedLinkClient] = useState<SearchableClient | null>(null);
  const [newLinkType, setNewLinkType] = useState('other');
  const [newLinkNotes, setNewLinkNotes] = useState('');
  const [addingLink, setAddingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);
  const [showLinkGraph, setShowLinkGraph] = useState(false);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editLinkType, setEditLinkType] = useState('other');
  const [editLinkNotes, setEditLinkNotes] = useState('');
  const [editLinkSaving, setEditLinkSaving] = useState(false);
  const [editLinkError, setEditLinkError] = useState<string | null>(null);
  const [hideHoldLinks, setHideHoldLinks] = useState(false);
  const [hideInactiveLinks, setHideInactiveLinks] = useState(false);
  const holdLinkCount = links.filter(l => l.other_client?.status === 'hold').length;
  const inactiveLinkCount = links.filter(l => l.other_client?.status === 'inactive').length;
  const visibleLinks = links.filter(l => {
    const s = l.other_client?.status;
    if (s === 'hold' && hideHoldLinks) return false;
    if (s === 'inactive' && hideInactiveLinks) return false;
    return true;
  });

  // Edit
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRef, setEditRef] = useState('');
  const [editType, setEditType] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRisk, setEditRisk] = useState('');
  const [editStatus, setEditStatus] = useState<ClientStatus>('active');
  const [editAddress, setEditAddress] = useState('');
  const [editUtr, setEditUtr] = useState('');
  const [editRegNo, setEditRegNo] = useState('');
  const [editNI, setEditNI] = useState('');
  const [editCHId, setEditCHId] = useState('');
  const [editVat, setEditVat] = useState('');
  const [editCHAuth, setEditCHAuth] = useState('');
  const [editDob, setEditDob] = useState('');
  const [editContactNumber, setEditContactNumber] = useState('');
  const [editPayeRef, setEditPayeRef] = useState('');
  const [editPayeAOR, setEditPayeAOR] = useState('');
  const [editVatSubmitType, setEditVatSubmitType] = useState('');
  const [editVatScheme, setEditVatScheme] = useState('');
  // Period-end month: '' when not set, otherwise '1'..'12' as a string for the <select>
  const [editVatPeriodEnd, setEditVatPeriodEnd] = useState('');
  const [editYearEndDay, setEditYearEndDay] = useState('');
  const [editYearEndMonth, setEditYearEndMonth] = useState('');
  const [editMtdIt, setEditMtdIt] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showScheduleMeeting, setShowScheduleMeeting] = useState(false);

  // Email compose now goes through the global compose window (lives at AppShell
  // level so the modal is minimisable and survives navigation between tools).
  const composeWindow = useComposeWindow();

  // Task creation flow (launched from header button)
  const [showTaskTypeSelector, setShowTaskTypeSelector] = useState(false);
  const [showQuickTask, setShowQuickTask]               = useState(false);
  const [showCreate, setShowCreate]                     = useState(false);
  const [showTaskBuilder, setShowTaskBuilder]           = useState(false);
  const [taskBuilderInitialData, setTaskBuilderInitialData] = useState<TemplateData | null>(null);
  const [taskTeamMembers, setTaskTeamMembers] = useState<{ id: string; full_name: string | null; email: string }[]>([]);
  const [taskFirmTemplates, setTaskFirmTemplates] = useState<TaskTemplate[]>([]);
  const [taskDataLoaded, setTaskDataLoaded] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────────

  const fetchClient = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.status === 404) { router.push('/clients'); return; }
      if (res.ok) { const d = await res.json(); setClient(d.client); setOutputs(d.outputs ?? []); setDocuments(d.documents ?? []); }
    } finally { setLoading(false); }
  }, [clientId, router]);

  useEffect(() => { void fetchClient(); }, [fetchClient]);

  const fetchDocumentsTab = useCallback(async () => {
    setDocsTabLoading(true);
    try {
      const res = await fetch(`/api/vault/documents?client_id=${clientId}&per_page=200`);
      if (res.ok) {
        const data = await res.json();
        setVaultDocs((data.documents as VaultDoc[]).sort((a, b) =>
          new Date(b.tag_document_date ?? b.indexed_at).getTime() - new Date(a.tag_document_date ?? a.indexed_at).getTime()
        ));
      }
    } finally { setDocsTabLoading(false); }
  }, [clientId]);

  const fetchTimeline = useCallback(async () => {
    setTimelineLoading(true);
    try {
      const [vaultRes, notesRes] = await Promise.all([
        fetch(`/api/vault/documents?client_id=${clientId}&per_page=200`),
        fetch(`/api/clients/${clientId}/notes`),
      ]);
      if (vaultRes.ok) {
        const data = await vaultRes.json();
        setVaultDocs((data.documents as VaultDoc[]).sort((a, b) =>
          new Date(b.tag_document_date ?? b.indexed_at).getTime() - new Date(a.tag_document_date ?? a.indexed_at).getTime()
        ));
      }
      if (notesRes.ok) {
        const data = await notesRes.json();
        setNotes(data.notes ?? []);
      }
      setTimelineFetched(true);
    } finally { setTimelineLoading(false); }
  }, [clientId]);

  const fetchLinks = useCallback(async (force = false) => {
    if (!force && linksFetched) return;
    setLinksLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/links`);
      if (res.ok) { const d = await res.json(); setLinks(d.links ?? []); setLinksFetched(true); }
    } finally { setLinksLoading(false); }
  }, [clientId, linksFetched]);

  // Details is the default tab so fetch links on mount — can't rely on tab-click alone
  useEffect(() => {
    void fetchLinks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  /** Open the global compose window pre-filled with this client's email
   *  and the client allocation tag. The provider handles signature/identity
   *  loading lazily on first open. */
  function openCompose() {
    if (!client) return;
    composeWindow.open({
      defaultTo: client.contact_email
        ? [{ name: client.name, email: client.contact_email }]
        : [],
      defaultClients: [{
        id:            client.id,
        name:          client.name,
        client_ref:    client.client_ref ?? '',
        contact_email: client.contact_email,
        risk_rating:   client.risk_rating,
      }],
    });
  }

  /** Lazy-load team members + firm templates on first "Create Task" click */
  async function ensureTaskData() {
    if (taskDataLoaded) return;
    const [teamRes, templatesRes] = await Promise.allSettled([
      fetch('/api/users/team'),
      fetch('/api/tasks/templates'),
    ]);
    if (teamRes.status === 'fulfilled' && teamRes.value.ok) {
      const d = await teamRes.value.json();
      setTaskTeamMembers(d.members ?? []);
    }
    if (templatesRes.status === 'fulfilled' && templatesRes.value.ok) {
      const d = await templatesRes.value.json();
      setTaskFirmTemplates(d.templates ?? []);
    }
    setTaskDataLoaded(true);
  }

  function openTaskTypeSelector() {
    void ensureTaskData();
    setShowTaskTypeSelector(true);
  }

  async function handleCreateTask(data: CreateTaskData) {
    // Always pre-populate client_id with the current client (overridable by the modals)
    const payload: CreateTaskData = {
      ...data,
      client_id: data.client_id !== undefined ? data.client_id : clientId,
    };
    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error('Failed to create task');
  }

  async function handleTaskBuilderCreate(data: TaskCreationOutput, saveAsTemplate: boolean, templateData: TemplateData) {
    await handleCreateTask(data as CreateTaskData);
    if (saveAsTemplate) {
      await fetch('/api/tasks/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateData),
      });
    }
    setShowTaskBuilder(false);
    setTaskBuilderInitialData(null);
  }

  function handleGoToBuilder(initialData?: TemplateData | null) {
    setShowCreate(false);
    setTaskBuilderInitialData(initialData ?? null);
    setShowTaskBuilder(true);
  }

  // ── Note CRUD ─────────────────────────────────────────────────────────────────

  function handleAddNote(note: TimelineNote) {
    setNotes(prev => {
      const next = [note, ...prev];
      return next.sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
        return new Date(b.note_date).getTime() - new Date(a.note_date).getTime();
      });
    });
    setShowAddNote(false);
  }

  async function handleUpdateNote(id: string, data: Partial<TimelineNote>) {
    const res = await fetch(`/api/clients/${clientId}/notes/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (res.ok) {
      const { note } = await res.json() as { note: TimelineNote };
      setNotes(prev => {
        const next = prev.map(n => n.id === id ? note : n);
        return next.sort((a, b) => {
          if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
          return new Date(b.note_date).getTime() - new Date(a.note_date).getTime();
        });
      });
    }
  }

  async function handleDeleteNote(id: string) {
    const res = await fetch(`/api/clients/${clientId}/notes/${id}`, { method: 'DELETE' });
    if (res.ok) setNotes(prev => prev.filter(n => n.id !== id));
  }

  async function handlePinNote(id: string, pinned: boolean) {
    await handleUpdateNote(id, { is_pinned: pinned } as Partial<TimelineNote>);
  }

  // ── Link CRUD ────────────────────────────────────────────────────────────────

  async function handleAddLink() {
    if (!selectedLinkClient) return;
    setAddingLink(true); setLinkError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linked_client_id: selectedLinkClient.id, link_type: newLinkType, notes: newLinkNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setLinkError(data.error || 'Failed to create link'); return; }
      await fetchLinks(true);
      setShowAddLink(false); setSelectedLinkClient(null); setNewLinkType('other'); setNewLinkNotes('');
    } catch { setLinkError('An unexpected error occurred'); } finally { setAddingLink(false); }
  }

  function handleStartEditLink(link: ClientLink) {
    setEditingLinkId(link.id);
    setEditLinkType(link.link_type);
    setEditLinkNotes(link.notes ?? '');
    setEditLinkError(null);
  }

  async function handleSaveLinkEdit() {
    if (!editingLinkId) return;
    setEditLinkSaving(true); setEditLinkError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/links/${editingLinkId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_type: editLinkType, notes: editLinkNotes || null }),
      });
      const data = await res.json();
      if (!res.ok) { setEditLinkError(data.error || 'Failed to update link'); return; }
      setLinks(prev => prev.map(l => l.id === editingLinkId ? { ...l, link_type: editLinkType, notes: editLinkNotes || null } : l));
      setEditingLinkId(null);
    } catch { setEditLinkError('An unexpected error occurred'); } finally { setEditLinkSaving(false); }
  }

  async function handleRemoveLink(linkId: string) {
    const link = links.find(l => l.id === linkId);
    const targetName = link?.other_client?.name ?? 'this client';
    const typeLabel = link ? (LINK_TYPE_LABELS[link.link_type] ?? link.link_type) : 'link';
    if (!window.confirm(`Remove the "${typeLabel} ${targetName}" link?\n\nThis only removes the relationship — neither client is deleted.`)) return;
    setRemovingLinkId(linkId);
    try { await fetch(`/api/clients/${clientId}/links/${linkId}`, { method: 'DELETE' }); setLinks(prev => prev.filter(l => l.id !== linkId)); }
    finally { setRemovingLinkId(null); }
  }

  // ── Edit / Delete ─────────────────────────────────────────────────────────────

  function startEdit() {
    if (!client) return;
    setEditName(client.name); setEditRef(client.client_ref ?? ''); setEditType(client.business_type ?? '');
    setEditEmail(client.contact_email ?? ''); setEditRisk(client.risk_rating ?? ''); setEditStatus(client.status ?? 'active');
    setEditAddress(client.address ?? ''); setEditUtr(client.utr_number ?? ''); setEditRegNo(client.registration_number ?? '');
    setEditNI(client.national_insurance_number ?? ''); setEditCHId(client.companies_house_id ?? '');
    setEditVat(client.vat_number ?? ''); setEditCHAuth(client.companies_house_auth_code ?? '');
    setEditDob(client.date_of_birth ?? '');
    setEditContactNumber(client.contact_number ?? '');
    setEditPayeRef(client.paye_reference ?? '');
    setEditPayeAOR(client.paye_accounts_office_reference ?? '');
    setEditVatSubmitType(client.vat_submit_type ?? '');
    setEditVatScheme(client.vat_scheme ?? '');
    setEditVatPeriodEnd(client.vat_scheme_period_end_month != null ? String(client.vat_scheme_period_end_month) : '');
    // year_end stored as "31 MAR" — split into day and month for the editor
    const [yeDay = '', yeMonth = ''] = (client.year_end ?? '').split(' ');
    setEditYearEndDay(yeDay); setEditYearEndMonth(yeMonth);
    setEditMtdIt(client.mtd_it ?? false);
    setEditError(null); setEditing(true);
  }

  async function handleSave() {
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName, client_ref: editRef, business_type: editType || undefined,
          contact_email: editEmail || undefined, risk_rating: editRisk || undefined, status: editStatus,
          address: editAddress || undefined, utr_number: editUtr || undefined,
          registration_number: editRegNo || undefined, national_insurance_number: editNI || undefined,
          companies_house_id: editCHId || undefined, vat_number: editVat || undefined,
          companies_house_auth_code: editCHAuth || undefined, date_of_birth: editDob || undefined,
          contact_number: editContactNumber || undefined,
          paye_reference: editPayeRef || undefined,
          paye_accounts_office_reference: editPayeAOR || undefined,
          vat_submit_type: editVatSubmitType || undefined,
          vat_scheme: editVatScheme || undefined,
          vat_scheme_period_end_month: editVatPeriodEnd ? Number(editVatPeriodEnd) : null,
          year_end: (editYearEndDay && editYearEndMonth) ? `${editYearEndDay.padStart(2, '0')} ${editYearEndMonth}` : undefined,
          mtd_it: editMtdIt,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setEditError(data.error || 'Save failed'); return; }
      setClient(data.client); setEditing(false);
    } catch { setEditError('An unexpected error occurred'); } finally { setSaving(false); }
  }

  async function handleDelete() {
    setDeleting(true);
    try { const res = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' }); if (res.ok) router.push('/clients'); }
    finally { setDeleting(false); setConfirmDelete(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) return <ToolLayout title="Client" icon={Users} iconColor="#4F46E5"><div className="py-16 text-center"><p className="text-[var(--text-muted)] text-sm">Loading…</p></div></ToolLayout>;
  if (!client) return null;

  const type = client.business_type;

  const filteredNotes = notes.filter(n => {
    const matchesType = !timelineTypeFilter || n.note_type === timelineTypeFilter;
    const matchesSearch = !timelineSearch.trim() || n.title.toLowerCase().includes(timelineSearch.toLowerCase());
    return matchesType && matchesSearch;
  });
  const pinnedNotes = filteredNotes.filter(n => n.is_pinned);
  const unpinnedNotes = filteredNotes.filter(n => !n.is_pinned);

  // Build year groups for unpinned notes + vault docs merged
  const timelineItems: Array<{ kind: 'note'; data: TimelineNote } | { kind: 'vault'; data: VaultDoc }> = [
    ...unpinnedNotes.map(n => ({ kind: 'note' as const, data: n })),
    ...(showVaultItems ? vaultDocs.map(d => ({ kind: 'vault' as const, data: d })) : []),
  ].sort((a, b) => {
    const da = a.kind === 'note' ? a.data.note_date : (a.data.tag_document_date ?? a.data.indexed_at);
    const db = b.kind === 'note' ? b.data.note_date : (b.data.tag_document_date ?? b.data.indexed_at);
    return new Date(db).getTime() - new Date(da).getTime();
  });

  const yearGroups: Record<string, typeof timelineItems> = {};
  for (const item of timelineItems) {
    const dateStr = item.kind === 'note' ? item.data.note_date : (item.data.tag_document_date ?? item.data.indexed_at);
    const year = new Date(dateStr).getFullYear().toString();
    if (!yearGroups[year]) yearGroups[year] = [];
    yearGroups[year].push(item);
  }
  const years = Object.keys(yearGroups).sort((a, b) => Number(b) - Number(a));

  return (
    <ToolLayout title={client.name} icon={Users} iconColor="#4F46E5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="space-y-1.5">
          <button onClick={() => router.push('/clients')} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={14} />All Clients
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            {client.client_ref && <span className="px-2 py-0.5 bg-[var(--bg-nav-hover)] text-[var(--text-muted)] text-xs font-mono rounded border border-[var(--border)]">{client.client_ref}</span>}
            {(() => { const s = STATUS_CONFIG[client.status] ?? STATUS_CONFIG.inactive; return (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                {s.label}
              </span>
            ); })()}
            {client.risk_rating && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLOURS[client.risk_rating] ?? ''}`}>{client.risk_rating} Risk</span>}
            {client.business_type && <span className="text-xs text-[var(--text-muted)]">{CLIENT_TYPE_LABELS[client.business_type] ?? client.business_type}</span>}
          </div>
        </div>
        {/* Combined pill: favourites on the left, actions on the right */}
        {(() => {
          const btype = client.business_type;
          const pendingClient = { id: client.id, name: client.name, client_ref: client.client_ref, business_type: btype, vat_number: client.vat_number, status: client.status ?? 'active' };
          type QuickTool = { moduleId: string; label: string; icon: React.ElementType; route: string; color: string; hoverBg: string; hoverText: string; show: boolean };
          const quickTools: QuickTool[] = [
            { moduleId: 'full-analysis',   label: 'Full Analysis',    icon: FileSearch,     route: '/full-analysis',   color: '#4F46E5', hoverBg: 'hover:bg-indigo-50',  hoverText: 'hover:text-indigo-600', show: true },
            { moduleId: 'bank-to-csv',     label: 'Bank to CSV',      icon: ArrowLeftRight, route: '/bank-to-csv',     color: '#0891B2', hoverBg: 'hover:bg-cyan-50',    hoverText: 'hover:text-cyan-600',   show: true },
            { moduleId: 'landlord',        label: 'Landlord',         icon: House,          route: '/landlord',        color: '#D97706', hoverBg: 'hover:bg-amber-50',   hoverText: 'hover:text-amber-600',  show: true },
            { moduleId: 'final-accounts',  label: 'Accounts Review',  icon: ClipboardCheck, route: '/final-accounts',  color: '#7C3AED', hoverBg: 'hover:bg-violet-50',  hoverText: 'hover:text-violet-600', show: true },
            { moduleId: 'risk-assessment', label: 'Risk Assessment',  icon: ShieldAlert,    route: '/risk-assessment', color: '#DC2626', hoverBg: 'hover:bg-red-50',     hoverText: 'hover:text-red-600',    show: true },
            { moduleId: 'p32',             label: 'P32 Summary',      icon: Receipt,        route: '/p32',             color: '#CA8A04', hoverBg: 'hover:bg-yellow-50',  hoverText: 'hover:text-yellow-600', show: true },
            { moduleId: 'performance',     label: 'Performance',      icon: TrendingUp,     route: '/performance',     color: '#059669', hoverBg: 'hover:bg-emerald-50', hoverText: 'hover:text-emerald-600',show: ['limited_company','partnership','sole_trader'].includes(btype ?? '') },
            { moduleId: 'summarise',       label: 'Summarise',        icon: FileText,       route: '/summarise',       color: '#6B7280', hoverBg: 'hover:bg-gray-100',   hoverText: 'hover:text-gray-700',   show: true },
            { moduleId: 'document-vault',  label: 'Document Vault',   icon: Archive,        route: '/vault',           color: '#0F766E', hoverBg: 'hover:bg-teal-50',    hoverText: 'hover:text-teal-600',   show: true },
            { moduleId: 'meeting-notes',   label: 'Meeting Notes',    icon: MicVocal,       route: '/meeting-notes',   color: '#6D28D9', hoverBg: 'hover:bg-purple-50',  hoverText: 'hover:text-purple-600', show: true },
            // MTD IT — only relevant for clients flagged as MTD IT enabled.
            // Route carries ?expand= so the dashboard auto-opens the row.
            { moduleId: 'mtd-it',          label: 'MTD IT',           icon: CalendarCheck,  route: `/mtd-it?expand=${client.id}`, color: '#8B85CF', hoverBg: 'hover:bg-[var(--accent-light)]', hoverText: 'hover:text-[var(--accent)]', show: !!client.mtd_it },
          ];
          const activeTools = quickTools.filter(t => t.show && favourites.includes(t.moduleId) && isModuleActive(t.moduleId));

          return (
            <div className="flex items-center gap-1 p-1 rounded-xl border border-[var(--border)] bg-[var(--bg-card-solid)] shadow-sm">

              {/* ── Left: Favourited quick-launch tools ── */}
              {activeTools.length > 0 && (
                <>
                  {activeTools.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <button
                        key={tool.route}
                        onClick={() => {
                          setPendingClient(tool.route, pendingClient);
                          openInNewTab({ id: tool.moduleId, title: tool.label, route: tool.route, icon: Icon as Tab['icon'] });
                          window.history.replaceState(null, '', tool.route);
                        }}
                        className={`group relative p-2 rounded-lg text-[var(--text-muted)] ${tool.hoverText} ${tool.hoverBg} transition-all`}
                      >
                        <Icon size={17} style={{ color: 'currentColor' }} className="transition-colors" />
                        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                          {tool.label}
                        </span>
                      </button>
                    );
                  })}
                  {/* Divider between favourites and actions */}
                  <div className="w-px h-5 bg-[var(--border)] mx-0.5" />
                </>
              )}

              {/* ── Right: Context actions ── */}
              {isModuleActive('google-calendar') && (
                <button
                  onClick={() => setShowScheduleMeeting(true)}
                  className="group relative p-2 rounded-lg text-[var(--text-muted)] hover:text-blue-600 hover:bg-blue-50 transition-all"
                >
                  <CalendarDays size={17} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Schedule Meeting
                  </span>
                </button>
              )}
              {isModuleActive('email-triage') && client?.contact_email && (
                <button
                  onClick={openCompose}
                  className="group relative p-2 rounded-lg text-[var(--text-muted)] hover:text-sky-600 hover:bg-sky-50 transition-all"
                >
                  <Mail size={17} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Email Client
                  </span>
                </button>
              )}
              {isModuleActive('tasks') && (
                <button
                  onClick={openTaskTypeSelector}
                  className="group relative p-2 rounded-lg text-[var(--text-muted)] hover:text-indigo-600 hover:bg-indigo-50 transition-all"
                >
                  <CheckSquare size={17} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                    Create Task
                  </span>
                </button>
              )}
              {/* Divider before edit/delete */}
              <div className="w-px h-5 bg-[var(--border)] mx-0.5" />
              <button
                onClick={startEdit}
                className="group relative p-2 rounded-lg text-[var(--text-muted)] hover:text-slate-700 hover:bg-slate-100 transition-all"
              >
                <Pencil size={17} />
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                  Edit Client
                </span>
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="group relative p-2 rounded-lg text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 transition-all"
              >
                <Trash2 size={17} />
                <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-gray-900 text-white text-xs px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg">
                  Delete Client
                </span>
              </button>
            </div>
          );
        })()}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {([
          ['outputs',   Sparkles, `AI Outputs (${outputs.length})`],
          ['documents', FileText, `Documents${vaultDocs.length > 0 ? ` (${vaultDocs.length})` : ''}`],
          ['timeline',  Clock,    `Timeline${notes.length > 0 ? ` (${notes.length})` : ''}`],
          ['details',   Info,     'Details'],
        ] as const).map(([tab, Icon, label]) => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'documents') void fetchDocumentsTab(); if (tab === 'timeline') void fetchTimeline(); if (tab === 'details') void fetchLinks(); }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === tab ? 'bg-[var(--accent)] text-white' : 'glass-solid text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>
            <Icon size={14} />
            {label}
          </button>
        ))}
        {isModuleActive('tasks') && (
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${activeTab === 'tasks' ? 'bg-[var(--accent)] text-white' : 'glass-solid text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}
          >
            <CheckSquare size={14} />
            Tasks
          </button>
        )}
      </div>

      {/* ── Outputs Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'outputs' && (
        <div className="glass-solid rounded-xl overflow-hidden">
          {outputs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[var(--text-muted)] text-sm">No AI outputs recorded for this client yet.</p>
              <p className="text-xs text-[var(--text-muted)] mt-1 opacity-70">Outputs are saved when you run any analysis tool with this client code.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>{['Feature', 'Software', 'Date'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {outputs.map(o => (
                  <tr key={o.id} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                    <td className="px-4 py-3 font-medium text-[var(--text-primary)]">{FEATURE_LABELS[o.feature] ?? o.feature}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] uppercase text-xs">{o.target_software ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(o.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Documents Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'documents' && (
        <div className="glass-solid rounded-xl overflow-hidden">
          {docsTabLoading ? (
            <div className="py-12 text-center">
              <Clock size={20} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2 animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Loading documents…</p>
            </div>
          ) : vaultDocs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[var(--text-muted)] text-sm">No documents saved for this client yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--border)]">
                <tr>{['File', 'Type', 'Date', ''].map((h, i) => <th key={i} className="px-4 py-3 text-left text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {vaultDocs.map(d => (
                  <tr key={d.id} className="hover:bg-[var(--bg-nav-hover)] transition-colors">
                    <td className="px-4 py-3 text-[var(--text-primary)]">{d.file_name}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{d.tag_document_type ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text-muted)]">{d.tag_document_date ? formatDate(d.tag_document_date) : formatDate(d.indexed_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {d.google_drive_url && (
                        <a href={d.google_drive_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline text-xs font-medium">
                          View in Drive <ExternalLink size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Timeline Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div>
          {timelineLoading ? (
            <div className="py-16 text-center">
              <Clock size={24} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Loading timeline…</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Controls */}
              <div className="space-y-3">
                {/* Top row: Add Note + Vault toggle + count */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowAddNote(v => !v)}
                      className={`btn-primary ${showAddNote ? 'opacity-80' : ''}`}>
                      <Plus size={14} />Add Note
                    </button>
                    <button onClick={() => setShowVaultItems(v => !v)}
                      className={`btn-secondary text-xs py-1.5 ${showVaultItems ? '' : 'opacity-60'}`}>
                      <FileText size={12} />
                      {showVaultItems ? 'Hide Vault Docs' : 'Show Vault Docs'}
                    </button>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    {filteredNotes.length !== notes.length
                      ? `${filteredNotes.length} of ${notes.length} note${notes.length !== 1 ? 's' : ''}`
                      : `${notes.length} note${notes.length !== 1 ? 's' : ''}`}
                    {showVaultItems ? ` · ${vaultDocs.length} vault document${vaultDocs.length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>

                {/* Search + type filter row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Keyword search */}
                  <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                    <input
                      value={timelineSearch}
                      onChange={e => setTimelineSearch(e.target.value)}
                      placeholder="Search notes by title…"
                      className="input-base w-full pl-8 text-sm py-1.5"
                    />
                    {timelineSearch && (
                      <button onClick={() => setTimelineSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Type filter chips */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      onClick={() => setTimelineTypeFilter(null)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                        timelineTypeFilter === null
                          ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                      }`}
                    >
                      All
                    </button>
                    {NOTE_TYPE_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => setTimelineTypeFilter(timelineTypeFilter === opt.key ? null : opt.key)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                          timelineTypeFilter === opt.key
                            ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                            : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                        }`}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Add Note form */}
              {showAddNote && (
                <AddNoteForm clientId={clientId} onAdd={handleAddNote} onCancel={() => setShowAddNote(false)} />
              )}

              {/* Pinned notes */}
              {pinnedNotes.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Pin size={12} className="text-[var(--accent)] fill-[var(--accent)]" />
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--accent)]">Pinned</span>
                    <div className="flex-1 h-px bg-[var(--accent)]/20" />
                  </div>
                  {pinnedNotes.map(note => (
                    <NoteCard key={note.id} note={note} onUpdate={handleUpdateNote} onDelete={handleDeleteNote} onPin={handlePinNote} />
                  ))}
                </div>
              )}

              {/* Empty state */}
              {timelineItems.length === 0 && pinnedNotes.length === 0 && !showAddNote && (
                <div className="glass-solid rounded-xl py-16 text-center">
                  <FileText size={28} className="mx-auto text-[var(--text-muted)] opacity-30 mb-3" />
                  <p className="text-sm text-[var(--text-muted)]">No timeline activity yet for this client.</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1 opacity-70">Add a note above, or sync documents in the Document Vault.</p>
                </div>
              )}

              {/* Year groups */}
              {years.map(year => (
                <div key={year}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">{year}</span>
                    <div className="flex-1 h-px bg-[var(--border)]" />
                    <span className="text-xs text-[var(--text-muted)]">
                      {yearGroups[year].length} item{yearGroups[year].length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="relative">
                    <div className="absolute left-3.5 top-2 bottom-2 w-px bg-[var(--border)]" />
                    <ul className="space-y-3">
                      {yearGroups[year].map((item) => {
                        if (item.kind === 'note') {
                          const note = item.data as TimelineNote;
                          return (
                            <li key={`note-${note.id}`} className="flex gap-4 items-start pl-2">
                              <div className="shrink-0 w-4 h-4 rounded-full border-2 border-[var(--accent)] bg-[var(--bg-card-solid)] mt-3 z-10" />
                              <div className="flex-1">
                                <NoteCard note={note} onUpdate={handleUpdateNote} onDelete={handleDeleteNote} onPin={handlePinNote} />
                              </div>
                            </li>
                          );
                        }
                        const doc = item.data as VaultDoc;
                        const dateStr = doc.tag_document_date ?? doc.indexed_at;
                        const displayDate = new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
                        const typeKey = doc.tag_document_type?.toLowerCase().replace(/\s+/g, '_') ?? 'other';
                        const typeColour = DOC_TYPE_COLOURS[typeKey] ?? DOC_TYPE_COLOURS.other;
                        const typeLabel = doc.tag_document_type ? doc.tag_document_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Other';
                        return (
                          <li key={`vault-${doc.id}`} className="flex gap-4 items-start pl-2">
                            <div className="shrink-0 w-4 h-4 rounded-full border-2 border-[var(--border)] bg-[var(--bg-card-solid)] mt-3 z-10" />
                            <div className="flex-1 glass-solid rounded-xl p-3.5 border border-[var(--border)] hover:border-[var(--accent)]/30 transition-colors group">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap mb-1">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeColour}`}>{typeLabel}</span>
                                    {doc.tag_tax_year && <span className="text-xs text-[var(--text-muted)] font-mono">Tax year {doc.tag_tax_year}</span>}
                                  </div>
                                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{doc.file_name}</p>
                                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                                    <span className="text-xs text-[var(--text-muted)]">{displayDate}</span>
                                    {doc.tag_supplier_name && <span className="text-xs text-[var(--text-muted)]">· {doc.tag_supplier_name}</span>}
                                    {doc.tag_amount != null && (
                                      <span className="text-xs font-medium text-[var(--text-primary)]">
                                        · {doc.tag_currency ?? '£'}{doc.tag_amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                                      </span>
                                    )}
                                  </div>
                                  {doc.tag_summary && <p className="text-xs text-[var(--text-muted)] mt-1.5 line-clamp-2">{doc.tag_summary}</p>}
                                </div>
                                {doc.google_drive_url && (
                                  <a href={doc.google_drive_url} target="_blank" rel="noreferrer"
                                    className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--accent)] hover:underline flex items-center gap-1 text-xs font-medium mt-1">
                                    Open <ExternalLink size={11} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Details Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'details' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-solid rounded-xl p-6">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Client Information</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <InfoRow label="Client Name" value={client.name} />
              <InfoRow label="Client Reference" value={client.client_ref} mono />
              <InfoRow label="Client Type" value={client.business_type ? CLIENT_TYPE_LABELS[client.business_type] ?? client.business_type : null} />
              <InfoRow label="Contact Email" value={client.contact_email} />
              <InfoRow label="Contact Number" value={client.contact_number} />
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Status</dt>
                <dd className="mt-1">
                  {(() => { const s = STATUS_CONFIG[client.status] ?? STATUS_CONFIG.inactive; return (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                      {s.label}
                    </span>
                  ); })()}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Risk Rating</dt>
                <dd className="mt-1">
                  {client.risk_rating
                    ? <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLOURS[client.risk_rating] ?? ''}`}>{client.risk_rating}</span>
                    : <span className="text-[var(--text-muted)]">—</span>}
                </dd>
              </div>
              <InfoRow label="Created" value={formatDate(client.created_at)} />
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Address</dt>
                <dd className="mt-1 text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                  {client.address ?? <span className="text-[var(--text-muted)]">—</span>}
                </dd>
              </div>
            </dl>
          </div>

          <div className="glass-solid rounded-xl p-6">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Regulatory &amp; Tax Details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              {showFor('utr_number', type) && <InfoRow label="UTR Number" value={client.utr_number} mono />}
              {showFor('registration_number', type) && <InfoRow label="Company Registration Number" value={client.registration_number} mono />}
              {showFor('national_insurance_number', type) && <InfoRow label="National Insurance Number" value={client.national_insurance_number} mono />}
              {showFor('companies_house_id', type) && <InfoRow label="Companies House ID" value={client.companies_house_id} mono />}
              {showFor('vat_number', type) && <InfoRow label="VAT Number" value={client.vat_number} mono />}
              {showFor('companies_house_auth_code', type) && <InfoRow label="Companies House Auth Code" value={client.companies_house_auth_code} mono />}
              {showFor('date_of_birth', type) && <InfoRow label="Date of Birth" value={client.date_of_birth ? new Date(client.date_of_birth).toLocaleDateString('en-GB') : null} />}
              {showFor('mtd_it', type) && (
                <div>
                  <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">MTD IT</dt>
                  <dd className="mt-1">
                    {client.mtd_it
                      ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />Enrolled</span>
                      : <span className="text-[var(--text-muted)]">—</span>}
                  </dd>
                </div>
              )}
              {showFor('paye_reference', type) && <InfoRow label="PAYE Reference" value={client.paye_reference} mono />}
              {showFor('paye_accounts_office_reference', type) && <InfoRow label="PAYE Accounts Office Reference" value={client.paye_accounts_office_reference} mono />}
              {showFor('vat_submit_type', type) && <InfoRow label="VAT Submit Type" value={client.vat_submit_type} />}
              {showFor('vat_scheme', type) && (
                <InfoRow
                  label="VAT Scheme"
                  value={(() => {
                    if (!client.vat_scheme) return null;
                    const extra = describeVatPeriodEnd(client.vat_scheme, client.vat_scheme_period_end_month);
                    return extra ? `${client.vat_scheme} · ${extra}` : client.vat_scheme;
                  })()}
                />
              )}
              {showFor('year_end', type) && <InfoRow label="Year End" value={client.year_end} />}
            </dl>
          </div>

          </div>

          {/* Linked Clients — full width */}
          <div className="glass-solid rounded-xl p-6">
            <div className="flex items-center justify-between mb-4 gap-4">
              <div className="flex items-center gap-2 min-w-0">
                <Link2 size={16} className="text-[var(--accent)]" />
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">Linked Clients</h3>
                {links.length > 0 && <span className="px-1.5 py-0.5 bg-[var(--accent-light)] text-[var(--accent)] text-xs font-medium rounded">{visibleLinks.length}{visibleLinks.length !== links.length && <span className="text-[var(--text-muted)] font-normal"> / {links.length}</span>}</span>}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {(holdLinkCount > 0 || inactiveLinkCount > 0) && (
                  <div className="flex items-center gap-3 pr-1">
                    {holdLinkCount > 0 && (
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                        <input type="checkbox" checked={!hideHoldLinks} onChange={e => setHideHoldLinks(!e.target.checked)} className="accent-orange-500" />
                        <span>Show on-hold <span className="text-[var(--text-muted)]">({holdLinkCount})</span></span>
                      </label>
                    )}
                    {inactiveLinkCount > 0 && (
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
                        <input type="checkbox" checked={!hideInactiveLinks} onChange={e => setHideInactiveLinks(!e.target.checked)} className="accent-gray-500" />
                        <span>Show inactive <span className="text-[var(--text-muted)]">({inactiveLinkCount})</span></span>
                      </label>
                    )}
                  </div>
                )}
                <Tooltip label={links.length === 0 ? 'No links to map yet' : 'Open connections map — click to expand'}>
                  <button
                    onClick={() => setShowLinkGraph(true)}
                    disabled={links.length === 0}
                    aria-label="Open connections map"
                    className="group p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-all disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] hover:scale-110"
                  >
                    <Network size={16} className="transition-transform group-hover:rotate-3" />
                  </button>
                </Tooltip>
                <button onClick={() => { setShowAddLink(v => !v); setLinkError(null); }} className="btn-secondary text-xs py-1.5"><Plus size={12} />Add Link</button>
              </div>
            </div>

            {showAddLink && (
              <div className="mb-4 p-4 bg-[var(--bg-page)] rounded-xl border border-[var(--border)] space-y-3">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Add a Link</p>
                <ClientSearchInput
                  value={selectedLinkClient?.id ?? ''}
                  valueName={selectedLinkClient?.name}
                  onChange={(id, name, clientRef) => {
                    if (!id) { setSelectedLinkClient(null); setLinkError(null); return; }
                    if (id === clientId) { setLinkError("Can't link a client to itself"); return; }
                    setLinkError(null);
                    setSelectedLinkClient({ id, name, client_ref: clientRef, business_type: null });
                  }}
                  placeholder="Search for a client to link…"
                />
                <select value={newLinkType} onChange={e => setNewLinkType(e.target.value)} className="input-base w-full text-sm">
                  <option value="director">Director of</option><option value="shareholder">Shareholder of</option>
                  <option value="spouse_partner">Spouse / Partner of</option><option value="trustee">Trustee of</option>
                  <option value="beneficiary">Beneficiary of</option><option value="associated_company">Associated Company</option>
                  <option value="parent_company">Parent Company of</option><option value="subsidiary">Subsidiary of</option>
                  <option value="guarantor">Guarantor of</option><option value="other">Other / Associated</option>
                </select>
                <input value={newLinkNotes} onChange={e => setNewLinkNotes(e.target.value)} placeholder="Notes (optional)" className="input-base w-full text-sm" />
                {linkError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{linkError}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => { setShowAddLink(false); setSelectedLinkClient(null); }} className="btn-ghost text-xs">Cancel</button>
                  <button onClick={() => void handleAddLink()} disabled={!selectedLinkClient || addingLink} className="btn-primary text-xs disabled:opacity-50">
                    {addingLink ? 'Linking…' : 'Add Link'}
                  </button>
                </div>
              </div>
            )}

            {linksLoading ? <p className="text-sm text-[var(--text-muted)] py-4 text-center">Loading links…</p>
              : links.length === 0 ? <p className="text-sm text-[var(--text-muted)] py-4 text-center">No linked clients yet.</p>
              : visibleLinks.length === 0 ? <p className="text-sm text-[var(--text-muted)] py-4 text-center">All linked clients are hidden by the filters above.</p>
              : (
                <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                  {visibleLinks.map(link => {
                    if (!link.other_client) return null;
                    const tc = LINK_TYPE_COLOURS[link.link_type] ?? LINK_TYPE_COLOURS.other;
                    const isEditing = editingLinkId === link.id;
                    if (isEditing) {
                      return (
                        <li key={link.id} className="px-3 py-3 rounded-lg bg-[var(--bg-page)] border border-[var(--accent)]/30 space-y-2">
                          <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Edit link to {link.other_client.name}</div>
                          <select value={editLinkType} onChange={e => setEditLinkType(e.target.value)} className="input-base w-full text-sm">
                            <option value="director">Director of</option><option value="shareholder">Shareholder of</option>
                            <option value="spouse_partner">Spouse / Partner of</option><option value="trustee">Trustee of</option>
                            <option value="beneficiary">Beneficiary of</option><option value="associated_company">Associated Company</option>
                            <option value="parent_company">Parent Company of</option><option value="subsidiary">Subsidiary of</option>
                            <option value="guarantor">Guarantor of</option><option value="other">Other / Associated</option>
                          </select>
                          <input value={editLinkNotes} onChange={e => setEditLinkNotes(e.target.value)} placeholder="Notes (optional)" className="input-base w-full text-sm" />
                          {editLinkError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{editLinkError}</p>}
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setEditingLinkId(null)} className="btn-ghost text-xs">Cancel</button>
                            <button onClick={() => void handleSaveLinkEdit()} disabled={editLinkSaving} className="btn-primary text-xs disabled:opacity-50">
                              {editLinkSaving ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </li>
                      );
                    }
                    return (
                      <li key={link.id} className="group flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-page)] border border-[var(--border)]">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${tc}`}>{LINK_TYPE_LABELS[link.link_type] ?? link.link_type}</span>
                          <div className="min-w-0">
                            <button onClick={() => router.push(`/clients/${link.other_client!.id}`)} className="text-sm font-medium text-[var(--accent)] hover:underline truncate">
                              {link.other_client.name}
                            </button>
                            <div className="flex items-center gap-2 flex-wrap">
                              {link.other_client.client_ref && <span className="text-xs text-[var(--text-muted)] font-mono">{link.other_client.client_ref}</span>}
                              {link.other_client.business_type && <span className="text-xs text-[var(--text-muted)]">· {CLIENT_TYPE_LABELS[link.other_client.business_type] ?? link.other_client.business_type}</span>}
                              {link.other_client.status !== 'active' && (() => {
                                const s = STATUS_CONFIG[link.other_client.status] ?? STATUS_CONFIG.inactive;
                                return (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                                    {s.label}
                                  </span>
                                );
                              })()}
                            </div>
                            {link.notes && <p className="text-xs text-[var(--text-muted)] mt-0.5">{link.notes}</p>}
                          </div>
                        </div>
                        <div className="shrink-0 flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip label="Remove link" side="left">
                            <button onClick={() => void handleRemoveLink(link.id)} disabled={removingLinkId === link.id} aria-label="Remove link"
                              className="p-1 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40">
                              <X size={13} />
                            </button>
                          </Tooltip>
                          <Tooltip label="Edit link" side="left">
                            <button onClick={() => handleStartEditLink(link)} aria-label="Edit link"
                              className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] rounded transition-colors">
                              <Pencil size={13} />
                            </button>
                          </Tooltip>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
        </div>
      )}

      {/* ── Tasks Tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'tasks' && isModuleActive('tasks') && (
        <ClientTasksPanel clientId={clientId} />
      )}

      {/* ── Edit Modal ────────────────────────────────────────────────────────── */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="glass-solid rounded-xl shadow-2xl w-full max-w-lg border border-[var(--border)] flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
              <h2 className="font-semibold text-[var(--text-primary)]">Edit Client</h2>
              <button onClick={() => setEditing(false)} className="btn-ghost p-1"><X size={16} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-6 space-y-5">
              <div className="space-y-4">
                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Client Information</p>
                <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Name *</label><input value={editName} onChange={e => setEditName(e.target.value)} className="input-base w-full" /></div>
                <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Reference *</label><input value={editRef} onChange={e => setEditRef(e.target.value.toUpperCase())} className="input-base w-full font-mono" /></div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Client Type</label>
                  <select value={editType} onChange={e => setEditType(e.target.value)} className="input-base w-full">
                    <option value="">— Select —</option>
                    <option value="sole_trader">Sole Trader</option><option value="partnership">Partnership</option>
                    <option value="limited_company">Limited Company</option><option value="individual">Individual</option>
                    <option value="trust">Trust</option><option value="charity">Charity</option><option value="rental_landlord">Rental Landlord</option>
                  </select>
                </div>
                <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Contact Email</label><input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} className="input-base w-full" /></div>
                <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Contact Number</label><input type="tel" value={editContactNumber} onChange={e => setEditContactNumber(e.target.value)} className="input-base w-full" /></div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Risk Rating</label>
                  <select value={editRisk} onChange={e => setEditRisk(e.target.value)} className="input-base w-full">
                    <option value="">— Not set —</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Status</label>
                  <div className="flex items-center gap-1 bg-[var(--bg-page)] rounded-lg border border-[var(--border)] p-1">
                    {([
                      ['active',   'Active',   'bg-green-600 text-white'],
                      ['hold',     'On Hold',  'bg-amber-500 text-white'],
                      ['inactive', 'Inactive', 'bg-gray-500 text-white'],
                    ] as [ClientStatus, string, string][]).map(([val, label, activeCls]) => (
                      <button key={val} type="button" onClick={() => setEditStatus(val)}
                        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${editStatus === val ? activeCls : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest pt-1">Address</p>
                <textarea value={editAddress} onChange={e => setEditAddress(e.target.value)} rows={3} placeholder="Street, City, Postcode" className="input-base w-full resize-none" />
              </div>
              <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest pt-1">Regulatory &amp; Tax Details</p>
                {showFor('utr_number', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">UTR Number</label><input value={editUtr} onChange={e => setEditUtr(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('registration_number', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Company Registration Number</label><input value={editRegNo} onChange={e => setEditRegNo(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('national_insurance_number', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">National Insurance Number</label><input value={editNI} onChange={e => setEditNI(e.target.value.toUpperCase())} className="input-base w-full font-mono" /></div>}
                {showFor('companies_house_id', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Companies House ID</label><input value={editCHId} onChange={e => setEditCHId(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('vat_number', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">VAT Number</label><input value={editVat} onChange={e => setEditVat(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('companies_house_auth_code', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Companies House Authentication Code</label><input value={editCHAuth} onChange={e => setEditCHAuth(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('date_of_birth', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Date of Birth</label><input type="date" value={editDob} onChange={e => setEditDob(e.target.value)} className="input-base w-full" /></div>}
                {showFor('mtd_it', editType || null) && (
                  <div className="flex items-center justify-between py-2 px-3 bg-[var(--bg-page)] rounded-lg border border-[var(--border)]">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">MTD IT</p>
                      <p className="text-xs text-[var(--text-muted)]">Making Tax Digital for Income Tax</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditMtdIt(v => !v)}
                      className={`relative w-10 h-6 rounded-full transition-colors ${editMtdIt ? 'bg-blue-500' : 'bg-[var(--border)]'}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${editMtdIt ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                )}
                {showFor('paye_reference', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">PAYE Reference</label><input value={editPayeRef} onChange={e => setEditPayeRef(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('paye_accounts_office_reference', editType || null) && <div><label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">PAYE Accounts Office Reference</label><input value={editPayeAOR} onChange={e => setEditPayeAOR(e.target.value)} className="input-base w-full font-mono" /></div>}
                {showFor('vat_submit_type', editType || null) && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">VAT Submit Type</label>
                    <select value={editVatSubmitType} onChange={e => setEditVatSubmitType(e.target.value)} className="input-base w-full">
                      <option value="">— Not set —</option>
                      <option value="Cash">Cash</option>
                      <option value="Accrual">Accrual</option>
                    </select>
                  </div>
                )}
                {showFor('vat_scheme', editType || null) && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">VAT Scheme</label>
                    <select
                      value={editVatScheme}
                      onChange={e => {
                        const next = e.target.value;
                        setEditVatScheme(next);
                        // Clear the period-end month when the scheme changes
                        // to anything that wouldn't accept the current value:
                        //   • Monthly / unset → never has a month
                        //   • Quarterly → only 1, 2, 3 are valid
                        if (!next || next === 'Monthly') setEditVatPeriodEnd('');
                        else if (next === 'Quarterly') {
                          const n = editVatPeriodEnd ? Number(editVatPeriodEnd) : 0;
                          if (n < 1 || n > 3) setEditVatPeriodEnd('');
                        }
                      }}
                      className="input-base w-full"
                    >
                      <option value="">— Not set —</option>
                      <option value="Monthly">Monthly</option>
                      <option value="Quarterly">Quarterly</option>
                      <option value="Yearly">Yearly</option>
                    </select>
                  </div>
                )}
                {showFor('vat_scheme', editType || null) && editVatScheme === 'Yearly' && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">VAT Period End</label>
                    <select value={editVatPeriodEnd} onChange={e => setEditVatPeriodEnd(e.target.value)} className="input-base w-full">
                      <option value="">— Select month —</option>
                      {MONTHS_FULL.map((m, i) => (
                        <option key={m} value={i + 1}>{m}</option>
                      ))}
                    </select>
                  </div>
                )}
                {showFor('vat_scheme', editType || null) && editVatScheme === 'Quarterly' && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">VAT Quarter Stagger</label>
                    <select value={editVatPeriodEnd} onChange={e => setEditVatPeriodEnd(e.target.value)} className="input-base w-full">
                      <option value="">— Select stagger —</option>
                      <option value="3">Quarter-ends Mar / Jun / Sep / Dec</option>
                      <option value="1">Quarter-ends Apr / Jul / Oct / Jan</option>
                      <option value="2">Quarter-ends May / Aug / Nov / Feb</option>
                    </select>
                  </div>
                )}
                {showFor('year_end', editType || null) && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Year End</label>
                    <div className="flex gap-2">
                      <input
                        type="number" min="1" max="31" placeholder="Day"
                        value={editYearEndDay} onChange={e => setEditYearEndDay(e.target.value)}
                        className="input-base w-24 text-center"
                      />
                      <select value={editYearEndMonth} onChange={e => setEditYearEndMonth(e.target.value)} className="input-base flex-1">
                        <option value="">— Month —</option>
                        {['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                    {editYearEndDay && editYearEndMonth && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">Displays as: {editYearEndDay.padStart(2,'0')} {editYearEndMonth}</p>
                    )}
                  </div>
                )}
              </div>
              {editError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200">{editError}</p>}
            </div>
            <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-3 flex-shrink-0">
              <button onClick={() => setEditing(false)} className="btn-ghost">Cancel</button>
              <button onClick={() => void handleSave()} disabled={saving || !editName || !editRef} className="btn-primary">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation ───────────────────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="glass-solid rounded-xl shadow-2xl w-full max-w-sm p-6 border border-[var(--border)]">
            <h2 className="font-semibold text-[var(--text-primary)] mb-2">Delete Client?</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              This will permanently delete <strong className="text-[var(--text-primary)]">{client.name}</strong> and all their associated records. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelete(false)} className="btn-ghost">Cancel</button>
              <button onClick={() => void handleDelete()} disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                <Trash2 size={14} />{deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connections map lightbox */}
      {showLinkGraph && client && (
        <LinkGraphLightbox clientId={client.id} onClose={() => setShowLinkGraph(false)} />
      )}

      {/* Schedule Meeting modal */}
      {showScheduleMeeting && client && (
        <ScheduleMeetingModal
          clientId={client.id}
          clientName={client.name}
          clientEmail={client.contact_email}
          onClose={() => setShowScheduleMeeting(false)}
        />
      )}

      {/* Email compose is mounted globally at AppShell level (see GlobalComposeWindow).
          openCompose() above pre-fills the To field and client allocation. */}

      {/* ── Task creation flow ─────────────────────────────────────────────────── */}

      {/* Step 0: Quick vs Full selector */}
      {showTaskTypeSelector && (
        <TaskTypeSelector
          onQuickTask={() => { setShowTaskTypeSelector(false); setShowQuickTask(true); }}
          onFullTask={() =>  { setShowTaskTypeSelector(false); setShowCreate(true); }}
          onClose={() => setShowTaskTypeSelector(false)}
        />
      )}

      {/* Quick Task modal — client pre-populated */}
      {showQuickTask && client && (
        <QuickTaskModal
          onClose={() => setShowQuickTask(false)}
          onCreate={async (data) => {
            // Pre-populate client unless user explicitly cleared it
            await handleCreateTask({
              ...data,
              client_id: data.client_id !== undefined ? data.client_id : client.id,
              is_internal: data.is_internal,
            });
          }}
          teamMembers={taskTeamMembers}
          defaultClientId={client.id}
          defaultClientName={client.name}
        />
      )}

      {/* Full Task wizard — client pre-populated */}
      {showCreate && client && (
        <CreateTaskModal
          onClose={() => setShowCreate(false)}
          onCreate={async (data) => {
            await handleCreateTask({
              ...data,
              client_id: data.client_id !== undefined ? data.client_id : client.id,
            });
          }}
          clients={[]}
          teamMembers={taskTeamMembers}
          firmTemplates={taskFirmTemplates}
          onGoToBuilder={handleGoToBuilder}
          defaultClientId={client.id}
          defaultClientName={client.name}
        />
      )}

      {/* Full Task visual builder */}
      {showTaskBuilder && client && (
        <TemplateBuilder
          template={null}
          mode="task"
          initialData={taskBuilderInitialData ?? undefined}
          onSave={async () => { setShowTaskBuilder(false); setTaskBuilderInitialData(null); }}
          onCreateTask={async (data, saveAsTemplate, templateData) => {
            await handleTaskBuilderCreate(
              { ...data, client_id: data.client_id ?? client.id } as TaskCreationOutput,
              saveAsTemplate,
              templateData,
            );
          }}
          onClose={() => { setShowTaskBuilder(false); setTaskBuilderInitialData(null); }}
          clients={[{ id: client.id, name: client.name, client_ref: client.client_ref ?? '' }]}
          teamMembers={taskTeamMembers}
          defaultClientId={client.id}
          defaultClientName={client.name}
        />
      )}
    </ToolLayout>
  );
}
