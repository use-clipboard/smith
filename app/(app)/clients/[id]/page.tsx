'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, Pencil, Trash2, ExternalLink, FileText, Clock,
  Link2, Plus, X, Search, Pin, PinOff, Phone, Users2,
  MessageCircle, Mail, StickyNote, ChevronDown, ChevronUp, Check, Paperclip, Image,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { Users } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Client {
  id: string; name: string; client_ref: string | null; business_type: string | null;
  contact_email: string | null; risk_rating: string | null; is_active: boolean; created_at: string;
  address: string | null; utr_number: string | null; registration_number: string | null;
  national_insurance_number: string | null; companies_house_id: string | null;
  vat_number: string | null; companies_house_auth_code: string | null; date_of_birth: string | null;
}
interface ClientLink {
  id: string; link_type: string; notes: string | null; direction: 'outgoing' | 'incoming';
  other_client: { id: string; name: string; client_ref: string | null; business_type: string | null; is_active: boolean; } | null;
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
interface TimelineNote {
  id: string; title: string; content: string | null; note_type: string;
  note_date: string; is_pinned: boolean; created_at: string; updated_at: string;
  users: { full_name: string } | null;
  attachments?: NoteAttachment[];
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
  phone_call: { label: 'Phone Call', icon: <Phone size={11} />, colour: 'bg-sky-100 text-sky-700' },
  meeting: { label: 'Meeting', icon: <Users2 size={11} />, colour: 'bg-emerald-100 text-emerald-700' },
  conversation: { label: 'Conversation', icon: <MessageCircle size={11} />, colour: 'bg-violet-100 text-violet-700' },
  email: { label: 'Email', icon: <Mail size={11} />, colour: 'bg-amber-100 text-amber-700' },
  other: { label: 'Note', icon: <StickyNote size={11} />, colour: 'bg-gray-100 text-gray-600' },
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

  const [editTitle, setEditTitle] = useState(note.title);
  const [editContent, setEditContent] = useState(note.content ?? '');
  const [editType, setEditType] = useState(note.note_type);
  const [editDate, setEditDate] = useState(note.note_date);

  const meta = NOTE_TYPE_META[note.note_type] ?? NOTE_TYPE_META.other;

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

        {/* Content */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Notes</label>
          <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={4}
            placeholder="Record what was discussed, agreed, or noted…"
            className="input-base w-full resize-none text-sm leading-relaxed" />
        </div>

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

  return (
    <div className={`glass-solid rounded-xl border p-4 transition-all group ${note.is_pinned ? 'border-[var(--accent)]/40 bg-[var(--accent-light)]/30' : 'border-[var(--border)]'}`}>
      <div className="flex items-start justify-between gap-3">
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
          <p className="font-semibold text-[var(--text-primary)] text-sm">{note.title}</p>
          {note.content && (
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
        </div>

        {/* Actions (appear on hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => void onPin(note.id, !note.is_pinned)}
            title={note.is_pinned ? 'Unpin' : 'Pin to top'}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors">
            {note.is_pinned ? <PinOff size={13} /> : <Pin size={13} />}
          </button>
          <button onClick={startEdit} title="Edit note"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
            <Pencil size={13} />
          </button>
        </div>
      </div>
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
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    setAttachmentFiles(prev => [...prev, ...files].slice(0, 5));
    e.target.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      // Encode attachments as base64
      const encodedAttachments = await Promise.all(
        attachmentFiles.map(async f => {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(f);
          });
          return { name: f.name, mimeType: f.type || 'application/octet-stream', base64 };
        })
      );

      const res = await fetch(`/api/clients/${clientId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          note_type: noteType,
          note_date: noteDate,
          is_pinned: isPinned,
          attachments: encodedAttachments,
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

      {/* Attachments */}
      <div>
        <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Attachments</label>
        {attachmentFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachmentFiles.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 bg-[var(--accent-light)] border border-[var(--accent)]/30 rounded-lg text-xs text-[var(--accent)] font-medium">
                {f.type.startsWith('image/') ? <Image size={11} /> : <Paperclip size={11} />}
                {f.name}
                <button type="button" onClick={() => setAttachmentFiles(prev => prev.filter((_, j) => j !== i))}
                  className="p-0.5 rounded hover:bg-[var(--accent)]/20 transition-colors">
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <button type="button" onClick={() => fileInputRef.current?.click()}
          disabled={attachmentFiles.length >= 5}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-dashed border-[var(--border)] rounded-lg text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors disabled:opacity-40">
          <Paperclip size={13} />
          Add attachment{attachmentFiles.length > 0 ? ` (${attachmentFiles.length}/5)` : ''}
        </button>
        <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.xlsx,.csv"
          onChange={handleFileChange} className="hidden" />
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
  const clientId = params.id as string;

  const [client, setClient] = useState<Client | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'outputs' | 'documents' | 'timeline' | 'details'>('details');

  // Documents tab
  const [docsTabLoading, setDocsTabLoading] = useState(false);

  // Timeline
  const [vaultDocs, setVaultDocs] = useState<VaultDoc[]>([]);
  const [notes, setNotes] = useState<TimelineNote[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineFetched, setTimelineFetched] = useState(false);
  const [showAddNote, setShowAddNote] = useState(false);
  const [showVaultItems, setShowVaultItems] = useState(true);

  // Links
  const [links, setLinks] = useState<ClientLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksFetched, setLinksFetched] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<SearchableClient[]>([]);
  const [linkSearchLoading, setLinkSearchLoading] = useState(false);
  const [selectedLinkClient, setSelectedLinkClient] = useState<SearchableClient | null>(null);
  const [newLinkType, setNewLinkType] = useState('other');
  const [newLinkNotes, setNewLinkNotes] = useState('');
  const [addingLink, setAddingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [removingLinkId, setRemovingLinkId] = useState<string | null>(null);

  // Edit
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editRef, setEditRef] = useState('');
  const [editType, setEditType] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRisk, setEditRisk] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editAddress, setEditAddress] = useState('');
  const [editUtr, setEditUtr] = useState('');
  const [editRegNo, setEditRegNo] = useState('');
  const [editNI, setEditNI] = useState('');
  const [editCHId, setEditCHId] = useState('');
  const [editVat, setEditVat] = useState('');
  const [editCHAuth, setEditCHAuth] = useState('');
  const [editDob, setEditDob] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    if (timelineFetched) return;
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
  }, [clientId, timelineFetched]);

  const fetchLinks = useCallback(async () => {
    if (linksFetched) return;
    setLinksLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/links`);
      if (res.ok) { const d = await res.json(); setLinks(d.links ?? []); setLinksFetched(true); }
    } finally { setLinksLoading(false); }
  }, [clientId, linksFetched]);

  useEffect(() => {
    if (!showAddLink || linkSearch.length < 2) { setLinkSearchResults([]); return; }
    const t = setTimeout(async () => {
      setLinkSearchLoading(true);
      try {
        const res = await fetch(`/api/clients?search=${encodeURIComponent(linkSearch)}`);
        if (res.ok) {
          const d = await res.json();
          const linkedIds = new Set(links.map(l => l.other_client?.id).filter(Boolean));
          setLinkSearchResults((d.clients as SearchableClient[]).filter(c => c.id !== clientId && !linkedIds.has(c.id)).slice(0, 8));
        }
      } finally { setLinkSearchLoading(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [linkSearch, showAddLink, clientId, links]);

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
      setLinksFetched(false); await fetchLinks();
      setShowAddLink(false); setLinkSearch(''); setSelectedLinkClient(null); setNewLinkType('other'); setNewLinkNotes('');
    } catch { setLinkError('An unexpected error occurred'); } finally { setAddingLink(false); }
  }

  async function handleRemoveLink(linkId: string) {
    setRemovingLinkId(linkId);
    try { await fetch(`/api/clients/${clientId}/links/${linkId}`, { method: 'DELETE' }); setLinks(prev => prev.filter(l => l.id !== linkId)); }
    finally { setRemovingLinkId(null); }
  }

  // ── Edit / Delete ─────────────────────────────────────────────────────────────

  function startEdit() {
    if (!client) return;
    setEditName(client.name); setEditRef(client.client_ref ?? ''); setEditType(client.business_type ?? '');
    setEditEmail(client.contact_email ?? ''); setEditRisk(client.risk_rating ?? ''); setEditActive(client.is_active);
    setEditAddress(client.address ?? ''); setEditUtr(client.utr_number ?? ''); setEditRegNo(client.registration_number ?? '');
    setEditNI(client.national_insurance_number ?? ''); setEditCHId(client.companies_house_id ?? '');
    setEditVat(client.vat_number ?? ''); setEditCHAuth(client.companies_house_auth_code ?? '');
    setEditDob(client.date_of_birth ?? ''); setEditError(null); setEditing(true);
  }

  async function handleSave() {
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName, client_ref: editRef, business_type: editType || undefined,
          contact_email: editEmail || undefined, risk_rating: editRisk || undefined, is_active: editActive,
          address: editAddress || undefined, utr_number: editUtr || undefined,
          registration_number: editRegNo || undefined, national_insurance_number: editNI || undefined,
          companies_house_id: editCHId || undefined, vat_number: editVat || undefined,
          companies_house_auth_code: editCHAuth || undefined, date_of_birth: editDob || undefined,
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
  const pinnedNotes = notes.filter(n => n.is_pinned);
  const unpinnedNotes = notes.filter(n => !n.is_pinned);

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
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push('/clients')} className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
            <ArrowLeft size={14} />Clients
          </button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-[var(--text-primary)]">{client.name}</h1>
              {client.client_ref && <span className="px-2 py-0.5 bg-[var(--bg-nav-hover)] text-[var(--text-muted)] text-xs font-mono rounded border border-[var(--border)]">{client.client_ref}</span>}
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${client.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${client.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                {client.is_active ? 'Active' : 'Inactive'}
              </span>
              {client.risk_rating && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLOURS[client.risk_rating] ?? ''}`}>{client.risk_rating} Risk</span>}
            </div>
            {client.business_type && <p className="text-sm text-[var(--text-muted)] mt-0.5">{CLIENT_TYPE_LABELS[client.business_type] ?? client.business_type}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={startEdit} className="btn-secondary"><Pencil size={13} />Edit</button>
          <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
            <Trash2 size={13} />Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {(['outputs', 'documents', 'timeline', 'details'] as const).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'documents') void fetchDocumentsTab(); if (tab === 'timeline') void fetchTimeline(); if (tab === 'details') void fetchLinks(); }}
            className={`px-4 py-2 rounded-lg font-medium text-sm capitalize transition-colors ${activeTab === tab ? 'bg-[var(--accent)] text-white' : 'glass-solid text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}>
            {tab === 'outputs' ? `AI Outputs (${outputs.length})` : tab === 'documents' ? `Documents${vaultDocs.length > 0 ? ` (${vaultDocs.length})` : ''}` : tab === 'timeline' ? `Timeline${notes.length > 0 ? ` (${notes.length})` : ''}` : 'Details'}
          </button>
        ))}
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
                  {notes.length} note{notes.length !== 1 ? 's' : ''}
                  {showVaultItems ? ` · ${vaultDocs.length} vault document${vaultDocs.length !== 1 ? 's' : ''}` : ''}
                </p>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-solid rounded-xl p-6">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Client Information</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
              <InfoRow label="Client Name" value={client.name} />
              <InfoRow label="Client Reference" value={client.client_ref} mono />
              <InfoRow label="Client Type" value={client.business_type ? CLIENT_TYPE_LABELS[client.business_type] ?? client.business_type : null} />
              <InfoRow label="Contact Email" value={client.contact_email} />
              <div>
                <dt className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Status</dt>
                <dd className="mt-1">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${client.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${client.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    {client.is_active ? 'Active' : 'Inactive'}
                  </span>
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
            </dl>
          </div>

          <div className="glass-solid rounded-xl p-6">
            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest mb-4">Address</h3>
            <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{client.address ?? <span className="text-[var(--text-muted)]">—</span>}</p>
          </div>

          {/* Linked Clients */}
          <div className="glass-solid rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Link2 size={16} className="text-[var(--accent)]" />
                <h3 className="font-semibold text-[var(--text-primary)] text-sm">Linked Clients</h3>
                {links.length > 0 && <span className="px-1.5 py-0.5 bg-[var(--accent-light)] text-[var(--accent)] text-xs font-medium rounded">{links.length}</span>}
              </div>
              <button onClick={() => { setShowAddLink(v => !v); setLinkError(null); }} className="btn-secondary text-xs py-1.5"><Plus size={12} />Add Link</button>
            </div>

            {showAddLink && (
              <div className="mb-4 p-4 bg-[var(--bg-page)] rounded-xl border border-[var(--border)] space-y-3">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Add a Link</p>
                {!selectedLinkClient ? (
                  <div className="relative">
                    <div className="flex items-center gap-2 px-3 py-2 glass-solid rounded-lg border border-[var(--border-input)]">
                      <Search size={13} className="text-[var(--text-muted)]" />
                      <input value={linkSearch} onChange={e => setLinkSearch(e.target.value)} placeholder="Search for a client to link…"
                        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
                      {linkSearchLoading && <span className="text-xs text-[var(--text-muted)]">…</span>}
                    </div>
                    {linkSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 glass-solid rounded-xl border border-[var(--border)] shadow-lg z-10 overflow-hidden">
                        {linkSearchResults.map(c => (
                          <button key={c.id} onClick={() => { setSelectedLinkClient(c); setLinkSearch(''); setLinkSearchResults([]); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-nav-hover)] transition-colors text-left">
                            <div>
                              <p className="text-sm font-medium text-[var(--text-primary)]">{c.name}</p>
                              <p className="text-xs text-[var(--text-muted)]">{c.client_ref && <span className="font-mono mr-2">{c.client_ref}</span>}{c.business_type ? CLIENT_TYPE_LABELS[c.business_type] ?? c.business_type : ''}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-3 py-2 bg-[var(--accent-light)] rounded-lg border border-[var(--accent)]/20">
                    <div>
                      <p className="text-sm font-medium text-[var(--accent)]">{selectedLinkClient.name}</p>
                      {selectedLinkClient.client_ref && <p className="text-xs text-[var(--accent)]/70 font-mono">{selectedLinkClient.client_ref}</p>}
                    </div>
                    <button onClick={() => setSelectedLinkClient(null)} className="text-[var(--accent)] hover:text-[var(--accent)]/70"><X size={14} /></button>
                  </div>
                )}
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
                  <button onClick={() => { setShowAddLink(false); setSelectedLinkClient(null); setLinkSearch(''); }} className="btn-ghost text-xs">Cancel</button>
                  <button onClick={() => void handleAddLink()} disabled={!selectedLinkClient || addingLink} className="btn-primary text-xs disabled:opacity-50">
                    {addingLink ? 'Linking…' : 'Add Link'}
                  </button>
                </div>
              </div>
            )}

            {linksLoading ? <p className="text-sm text-[var(--text-muted)] py-4 text-center">Loading links…</p>
              : links.length === 0 ? <p className="text-sm text-[var(--text-muted)] py-4 text-center">No linked clients yet.</p>
              : (
                <ul className="space-y-2">
                  {links.map(link => {
                    if (!link.other_client) return null;
                    const tc = LINK_TYPE_COLOURS[link.link_type] ?? LINK_TYPE_COLOURS.other;
                    return (
                      <li key={link.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-[var(--bg-page)] border border-[var(--border)]">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${tc}`}>{LINK_TYPE_LABELS[link.link_type] ?? link.link_type}</span>
                          <div className="min-w-0">
                            <button onClick={() => router.push(`/clients/${link.other_client!.id}`)} className="text-sm font-medium text-[var(--accent)] hover:underline truncate">
                              {link.other_client.name}
                            </button>
                            <div className="flex items-center gap-2">
                              {link.other_client.client_ref && <span className="text-xs text-[var(--text-muted)] font-mono">{link.other_client.client_ref}</span>}
                              {link.other_client.business_type && <span className="text-xs text-[var(--text-muted)]">· {CLIENT_TYPE_LABELS[link.other_client.business_type] ?? link.other_client.business_type}</span>}
                              {!link.other_client.is_active && <span className="text-xs text-gray-400 italic">Inactive</span>}
                            </div>
                            {link.notes && <p className="text-xs text-[var(--text-muted)] mt-0.5">{link.notes}</p>}
                          </div>
                        </div>
                        <button onClick={() => void handleRemoveLink(link.id)} disabled={removingLinkId === link.id}
                          className="shrink-0 p-1.5 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40">
                          <X size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
          </div>
        </div>
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
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1.5">Risk Rating</label>
                  <select value={editRisk} onChange={e => setEditRisk(e.target.value)} className="input-base w-full">
                    <option value="">— Not set —</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-2 px-3 bg-[var(--bg-page)] rounded-lg border border-[var(--border)]">
                  <div><p className="text-sm font-medium text-[var(--text-primary)]">Active</p><p className="text-xs text-[var(--text-muted)]">Inactive clients are dimmed in the list</p></div>
                  <button type="button" onClick={() => setEditActive(v => !v)} className={`relative w-10 h-6 rounded-full transition-colors ${editActive ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${editActive ? 'translate-x-4' : ''}`} />
                  </button>
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
    </ToolLayout>
  );
}
