'use client';
// vault page
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Archive,
  Search,
  Upload,
  RefreshCw,
  Grid3X3,
  List,
  Tag,
  ChevronDown,
  X,
  ExternalLink,
  Download,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  FileSpreadsheet,
  FileImage,
  File,
  FolderOpen,
  ChevronRight,
  Check,
  MoreHorizontal,
  Users,
} from 'lucide-react';
import type { VaultDocument, VaultSyncState, VaultTaggingStatus } from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getMimeIcon(mimeType: string | null) {
  if (!mimeType) return File;
  if (mimeType === 'application/pdf') return FileText;
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv')) return FileSpreadsheet;
  return File;
}

const STATUS_COLOURS: Record<VaultTaggingStatus, string> = {
  tagged: 'bg-green-500',
  untagged: 'bg-amber-400',
  pending: 'bg-blue-500',
  failed: 'bg-red-500',
  manually_reviewed: 'bg-purple-500',
};

const STATUS_LABELS: Record<VaultTaggingStatus, string> = {
  tagged: 'Tagged',
  untagged: 'Untagged',
  pending: 'Pending',
  failed: 'Failed',
  manually_reviewed: 'Reviewed',
};

const DOC_TYPES = [
  'invoice', 'credit_note', 'bank_statement', 'receipt', 'hmrc_letter',
  'tax_return', 'p60', 'p45', 'p11d', 'p32', 'payslip', 'accounts',
  'management_accounts', 'trial_balance', 'contract', 'letter', 'report',
  'utility_bill', 'insurance', 'mortgage', 'lease', 'correspondence', 'other',
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
  client_ref: string | null;
}

interface DocsResponse {
  documents: VaultDocument[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface SyncStatusResponse {
  syncState: VaultSyncState | null;
  untaggedCount: number;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TaggingDot({ status }: { status: VaultTaggingStatus }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOURS[status]}`}
      title={STATUS_LABELS[status]}
    />
  );
}

function DocTypeBadge({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--bg-page)] text-[var(--text-muted)] capitalize">
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function ClientBadge({ name, clientRef }: { name?: string | null; clientRef?: string | null }) {
  if (!name) {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Unassigned
      </span>
    );
  }
  return (
    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
      {clientRef ? `${clientRef} – ${name}` : name}
    </span>
  );
}

// ─── Upload Modal ─────────────────────────────────────────────────────────────

interface UploadModalProps {
  clients: Client[];
  preselectedClientId?: string | null;
  onClose: () => void;
  onDone: () => void;
}

function UploadModal({ clients, preselectedClientId, onClose, onDone }: UploadModalProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [clientId, setClientId] = useState<string>(preselectedClientId ?? '');
  const [dragOver, setDragOver] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, 'idle' | 'uploading' | 'tagging' | 'done' | 'failed'>>({});
  const [uploading, setUploading] = useState(false);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      const newFiles = Array.from(incoming).filter(f => !existing.has(f.name));
      return [...prev, ...newFiles];
    });
  }

  async function handleUpload() {
    if (!files.length) return;
    setUploading(true);

    for (const file of files) {
      setStatuses(s => ({ ...s, [file.name]: 'uploading' }));
      try {
        const fd = new FormData();
        fd.append('file', file);
        if (clientId) fd.append('client_id', clientId);

        const res = await fetch('/api/vault/upload', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(await res.text());

        setStatuses(s => ({ ...s, [file.name]: 'done' }));
      } catch {
        setStatuses(s => ({ ...s, [file.name]: 'failed' }));
      }
    }

    setUploading(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Upload Documents</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-page)] text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => document.getElementById('vault-file-input')?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)] hover:border-[var(--accent)]/50'}`}
          >
            <Upload size={24} className="mx-auto mb-2 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-secondary)]">Drop files here or click to browse</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">PDF, images, spreadsheets</p>
            <input
              id="vault-file-input"
              type="file"
              multiple
              className="hidden"
              onChange={e => addFiles(e.target.files)}
            />
          </div>

          {/* File list */}
          {files.length > 0 && (
            <ul className="space-y-1 max-h-40 overflow-y-auto">
              {files.map(f => {
                const status = statuses[f.name];
                return (
                  <li key={f.name} className="flex items-center gap-2 text-sm py-1">
                    <FileText size={14} className="text-[var(--text-muted)] shrink-0" />
                    <span className="flex-1 truncate text-[var(--text-primary)]">{f.name}</span>
                    <span className="text-xs text-[var(--text-muted)]">{formatBytes(f.size)}</span>
                    {!status && (
                      <button onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))} className="p-0.5 hover:text-red-500 text-[var(--text-muted)]">
                        <X size={12} />
                      </button>
                    )}
                    {status === 'uploading' && <span className="text-xs text-blue-500">Uploading…</span>}
                    {status === 'tagging' && <span className="text-xs text-blue-500">Tagging…</span>}
                    {status === 'done' && <Check size={14} className="text-green-500" />}
                    {status === 'failed' && <X size={14} className="text-red-500" />}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Client selector */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Assign to client (optional)</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            >
              <option value="">— No client —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name} {c.client_ref ? `(${c.client_ref})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]">
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={!files.length || uploading}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload & Tag'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Preview Drawer ──────────────────────────────────────────────────────────

interface PreviewDrawerProps {
  doc: VaultDocument;
  clients: Client[];
  onClose: () => void;
  onUpdate: (updated: VaultDocument) => void;
  onDelete: (id: string) => void;
}

function PreviewDrawer({ doc, clients, onClose, onUpdate, onDelete }: PreviewDrawerProps) {
  const [editing, setEditing] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteDrive, setDeleteDrive] = useState(false);

  const hasEdits = Object.keys(editing).length > 0;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/vault/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      onUpdate(updated);
      setEditing({});
    } catch {
      alert('Failed to save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/vault/documents/${doc.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete_from_drive: deleteDrive }),
      });
      if (!res.ok) throw new Error('Delete failed');
      onDelete(doc.id);
      onClose();
    } catch {
      alert('Failed to delete document.');
    } finally {
      setDeleting(false);
    }
  }

  function field(label: string, key: string, value: string | null | undefined) {
    const isEditing = key in editing;
    const displayValue = isEditing ? editing[key] : value;

    return (
      <div key={key} className="group flex items-start gap-2 py-2 border-b border-[var(--border)] last:border-0">
        <div className="w-36 shrink-0">
          <span className="text-xs text-[var(--text-muted)] font-medium">{label}</span>
        </div>
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              autoFocus
              value={displayValue ?? ''}
              onChange={e => setEditing(prev => ({ ...prev, [key]: e.target.value }))}
              className="w-full text-sm px-2 py-0.5 rounded border border-[var(--accent)] bg-[var(--bg-page)] text-[var(--text-primary)]"
              onKeyDown={e => { if (e.key === 'Escape') { const next = { ...editing }; delete next[key]; setEditing(next); } }}
            />
          ) : (
            <span className="text-sm text-[var(--text-primary)]">{displayValue || <span className="text-[var(--text-muted)] italic">—</span>}</span>
          )}
        </div>
        {!isEditing && (
          <button
            onClick={() => setEditing(prev => ({ ...prev, [key]: value ?? '' }))}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] transition-opacity"
          >
            <Pencil size={12} />
          </button>
        )}
      </div>
    );
  }

  const isImage = doc.file_mime_type?.startsWith('image/');
  const isPdf = doc.file_mime_type === 'application/pdf';

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-50 w-[480px] bg-[var(--bg-card-solid)] border-l border-[var(--border)] flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <TaggingDot status={doc.tagging_status} />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">{doc.file_name}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-page)] text-[var(--text-muted)] shrink-0">
            <X size={16} />
          </button>
        </div>

        {/* Preview */}
        <div className="h-64 bg-[var(--bg-page)] border-b border-[var(--border)] shrink-0 flex items-center justify-center">
          {isPdf && doc.google_drive_file_id && !doc.google_drive_file_id.startsWith('tool:') ? (
            <iframe
              src={`https://drive.google.com/file/d/${doc.google_drive_file_id}/preview`}
              className="w-full h-full border-0"
              title={doc.file_name}
            />
          ) : isImage && doc.google_drive_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.google_drive_url} alt={doc.file_name} className="max-h-full max-w-full object-contain" />
          ) : (
            <div className="text-center text-[var(--text-muted)]">
              <File size={32} className="mx-auto mb-2" />
              <p className="text-sm">Preview not available</p>
              {doc.google_drive_url && (
                <a href={doc.google_drive_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] mt-1 flex items-center justify-center gap-1 hover:underline">
                  Open in Google Drive <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-3">Document Tags</h4>
          <div>
            {field('Summary', 'tag_summary', doc.tag_summary)}
            {field('Document Type', 'tag_document_type', doc.tag_document_type)}
            {field('Supplier', 'tag_supplier_name', doc.tag_supplier_name)}
            {field('Client', 'tag_client_name', doc.tag_client_name)}
            {field('Date', 'tag_document_date', doc.tag_document_date)}
            {field('Amount', 'tag_amount', doc.tag_amount != null ? String(doc.tag_amount) : null)}
            {field('Currency', 'tag_currency', doc.tag_currency)}
            {field('Tax Year', 'tag_tax_year', doc.tag_tax_year)}
            {field('Acc. Period', 'tag_accounting_period', doc.tag_accounting_period)}
            {field('HMRC Ref', 'tag_hmrc_reference', doc.tag_hmrc_reference)}
            {field('VAT Number', 'tag_vat_number', doc.tag_vat_number)}
            <div className="py-2 flex items-center gap-2">
              <span className="w-36 text-xs text-[var(--text-muted)] font-medium shrink-0">Assign Client</span>
              <select
                className="flex-1 text-sm px-2 py-1 rounded border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)]"
                value={(editing['client_id'] as string | undefined) ?? doc.client_id ?? ''}
                onChange={e => setEditing(prev => ({ ...prev, client_id: e.target.value || null }))}
              >
                <option value="">— Unassigned —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.client_ref ? `${c.client_ref} – ${c.name}` : c.name}</option>)}
              </select>
            </div>
          </div>

          {doc.google_drive_folder_path && (
            <div className="mt-4 pt-3 border-t border-[var(--border)]">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] mb-1">Drive Location</p>
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <FolderOpen size={12} className="shrink-0" />
                <span className="break-all">{doc.google_drive_folder_path}</span>
              </div>
            </div>
          )}

          {doc.tagging_error && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-xs">
              <strong>Tagging failed:</strong> {doc.tagging_error}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 py-4 border-t border-[var(--border)] shrink-0 space-y-3">
          {hasEdits && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          )}

          <div className="flex gap-2">
            {doc.google_drive_url && (
              <>
                <a
                  href={doc.google_drive_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]"
                >
                  <ExternalLink size={12} /> Open in Drive
                </a>
                <a
                  href={`https://drive.google.com/uc?export=download&id=${doc.google_drive_file_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]"
                >
                  <Download size={12} /> Download
                </a>
              </>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs rounded-lg border border-red-200 dark:border-red-900/50 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>

          {confirmDelete && (
            <div className="p-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 space-y-2">
              <p className="text-xs text-red-700 dark:text-red-400 font-medium">Are you sure you want to delete &ldquo;{doc.file_name}&rdquo;?</p>
              <label className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400 cursor-pointer">
                <input type="checkbox" checked={deleteDrive} onChange={e => setDeleteDrive(e.target.checked)} />
                Also permanently delete from Google Drive (cannot be undone)
              </label>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-1.5 text-xs rounded border border-[var(--border)] text-[var(--text-secondary)]">Cancel</button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-1.5 text-xs rounded bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Document Row (list view) ─────────────────────────────────────────────────

interface DocRowProps {
  doc: VaultDocument;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onClick: () => void;
  onTag: (id: string) => void;
}

function DocRow({ doc, selected, onSelect, onClick, onTag }: DocRowProps) {
  const Icon = getMimeIcon(doc.file_mime_type);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <tr
      className={`group border-b border-[var(--border)] transition-colors cursor-pointer ${selected ? 'bg-[var(--accent)]/5' : 'bg-white dark:bg-[var(--bg-card-solid)] hover:bg-[var(--bg-page)]'}`}
    >
      <td className="w-10 px-3 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={e => { e.stopPropagation(); onSelect(doc.id, e.target.checked); }}
          className="rounded border-[var(--border)]"
        />
      </td>
      <td className="w-8 px-1 py-3" onClick={onClick}>
        <Icon size={16} className="text-[var(--text-muted)]" />
      </td>
      <td className="px-2 py-3 max-w-[200px]" onClick={onClick}>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate block">{doc.file_name}</span>
        {doc.tag_summary && <span className="text-xs text-[var(--text-muted)] truncate block">{doc.tag_summary}</span>}
        {doc.google_drive_folder_path && (
          <span className="text-xs text-[var(--text-muted)]/70 truncate block flex items-center gap-0.5 mt-0.5">
            <FolderOpen size={10} className="shrink-0" />
            {doc.google_drive_folder_path}
          </span>
        )}
      </td>
      <td className="px-2 py-3" onClick={onClick}>
        <ClientBadge name={doc.client_name} clientRef={doc.client_ref} />
      </td>
      <td className="px-2 py-3" onClick={onClick}>
        <DocTypeBadge type={doc.tag_document_type} />
      </td>
      <td className="px-2 py-3 text-sm text-[var(--text-secondary)] max-w-[120px] truncate" onClick={onClick}>
        {doc.tag_supplier_name ?? '—'}
      </td>
      <td className="px-2 py-3 text-sm text-[var(--text-secondary)]" onClick={onClick}>
        {doc.tag_document_date ?? (doc.drive_modified_at ? new Date(doc.drive_modified_at).toLocaleDateString('en-GB') : '—')}
      </td>
      <td className="px-2 py-3 text-sm text-right text-[var(--text-secondary)]" onClick={onClick}>
        {doc.tag_amount != null ? `${doc.tag_currency === 'GBP' ? '£' : doc.tag_currency}${doc.tag_amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}
      </td>
      <td className="px-2 py-3 text-sm text-[var(--text-secondary)]" onClick={onClick}>
        {doc.tag_tax_year ?? '—'}
      </td>
      <td className="px-2 py-3 text-center" onClick={onClick}>
        <TaggingDot status={doc.tagging_status} />
      </td>
      <td className="px-2 py-3 relative">
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
          className="p-1 rounded hover:bg-[var(--bg-page)] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-30 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-lg shadow-lg py-1 w-44" onMouseLeave={() => setMenuOpen(false)}>
            {[
              { label: 'Preview', action: () => { setMenuOpen(false); onClick(); } },
              { label: 'Open in Drive', action: () => { if (doc.google_drive_url) window.open(doc.google_drive_url, '_blank'); } },
              { label: 'Retag', action: () => { setMenuOpen(false); onTag(doc.id); } },
            ].map(item => (
              <button key={item.label} onClick={item.action} className="w-full text-left px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-page)]">
                {item.label}
              </button>
            ))}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Document Card (grid view) ────────────────────────────────────────────────

function DocCard({ doc, onClick }: { doc: VaultDocument; onClick: () => void }) {
  const Icon = getMimeIcon(doc.file_mime_type);
  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl p-4 cursor-pointer hover:shadow-md hover:border-[var(--accent)]/30 transition-all group relative"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-[var(--bg-page)] flex items-center justify-center shrink-0">
          <Icon size={20} className="text-[var(--text-muted)]" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{doc.file_name}</p>
          <p className="text-xs text-[var(--text-muted)]">{formatBytes(doc.file_size_bytes)}</p>
          {doc.google_drive_folder_path && (
            <p className="text-xs text-[var(--text-muted)]/70 truncate flex items-center gap-0.5 mt-0.5">
              <FolderOpen size={10} className="shrink-0" />
              {doc.google_drive_folder_path}
            </p>
          )}
        </div>
        <TaggingDot status={doc.tagging_status} />
      </div>
      <div className="flex flex-wrap gap-1 mb-2">
        <ClientBadge name={doc.client_name} clientRef={doc.client_ref} />
        <DocTypeBadge type={doc.tag_document_type} />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{doc.tag_document_date ?? (doc.drive_modified_at ? new Date(doc.drive_modified_at).toLocaleDateString('en-GB') : '—')}</span>
        {doc.tag_amount != null && (
          <span className="font-medium text-[var(--text-secondary)]">
            £{doc.tag_amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VaultPage() {
  const [activeTab, setActiveTab] = useState<'all' | 'clients'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Data
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse | null>(null);
  const [taxYears, setTaxYears] = useState<string[]>([]);

  // Loading states
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [bulkTagging, setBulkTagging] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ completed: 0, total: 0, failed: 0 });

  // Filters
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterDocTypes, setFilterDocTypes] = useState<string[]>([]);
  const [filterClient, setFilterClient] = useState('');
  const [filterTaxYear, setFilterTaxYear] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterStatus, setFilterStatus] = useState<VaultTaggingStatus | ''>('');


  // UI state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [previewDoc, setPreviewDoc] = useState<VaultDocument | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadPreselectedClient, setUploadPreselectedClient] = useState<string | null>(null);
  const [bulkDismissed, setBulkDismissed] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const hasFilters = filterDocTypes.length > 0 || filterClient || filterTaxYear || filterDateFrom || filterDateTo || filterStatus;

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchDocs = useCallback(async (pageNum = 1) => {
    setLoadingDocs(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pageNum));
      params.set('per_page', '50');
      if (activeTab === 'clients' && selectedClient) params.set('client_id', selectedClient.id);
      if (filterDocTypes.length) filterDocTypes.forEach(t => params.append('document_type', t));
      if (filterClient) params.set('client_id', filterClient);
      if (filterTaxYear) params.set('tax_year', filterTaxYear);
      if (filterDateFrom) params.set('date_from', filterDateFrom);
      if (filterDateTo) params.set('date_to', filterDateTo);
      if (filterStatus) params.set('tagging_status', filterStatus);

      if (search) params.set('search', search);

      const res = await fetch(`/api/vault/documents?${params}`);
      if (!res.ok) throw new Error('Failed to load');
      const data: DocsResponse = await res.json();
      setDocs(data.documents);
      setTotal(data.total);
      setTotalPages(data.total_pages);
      setPage(pageNum);

      // Extract distinct tax years for filter dropdown
      const years = [...new Set(data.documents.map(d => d.tag_tax_year).filter(Boolean))] as string[];
      if (years.length > 0) setTaxYears(prev => [...new Set([...prev, ...years])]);
    } catch {
      // silently fail
    } finally {
      setLoadingDocs(false);
    }
  }, [activeTab, selectedClient, filterDocTypes, filterClient, filterTaxYear, filterDateFrom, filterDateTo, filterStatus, search]);

  const fetchSyncStatus = useCallback(async () => {
    const res = await fetch('/api/vault/sync/status');
    if (res.ok) setSyncStatus(await res.json());
  }, []);

  const fetchClients = useCallback(async () => {
    const res = await fetch('/api/clients');
    if (res.ok) {
      const data = await res.json();
      setClients(data.clients ?? data ?? []);
    }
  }, []);

  useEffect(() => {
    fetchClients();
    fetchSyncStatus();
  }, [fetchClients, fetchSyncStatus]);

  useEffect(() => {
    fetchDocs(1);
  }, [fetchDocs]);

  // Auto-sync quietly every time the vault is opened so Drive changes show up immediately
  useEffect(() => {
    fetch('/api/vault/sync', { method: 'POST' })
      .then(() => { void fetchSyncStatus(); void fetchDocs(1); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount

  // Debounce search
  useEffect(() => {
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(searchDebounce.current);
  }, [searchInput]);

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch('/api/vault/sync', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      await fetchSyncStatus();
      await fetchDocs(1);
    } catch {
      alert('Sync failed. Please try again.');
    } finally {
      setSyncing(false);
    }
  }

  async function handleBulkTag(ids?: string[]) {
    setBulkTagging(true);
    setBulkDismissed(false);
    setBulkProgress({ completed: 0, total: 0, failed: 0 });

    try {
      const res = await fetch('/api/vault/tag/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { vault_document_ids: ids } : {}),
      });

      if (!res.body) throw new Error('No stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' || ev.type === 'done') {
                setBulkProgress({ completed: ev.completed, total: ev.total, failed: ev.failed });
              }
            } catch { /* ignore */ }
          }
        }
      }

      await fetchDocs(1);
      await fetchSyncStatus();
    } catch {
      alert('Bulk tagging failed.');
    } finally {
      setBulkTagging(false);
    }
  }

  async function handleSingleTag(id: string) {
    await fetch('/api/vault/tag/single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vault_document_id: id }),
    });
    await fetchDocs(page);
  }

  async function handleBulkManualTag(updates: Record<string, unknown>) {
    const res = await fetch('/api/vault/documents/bulk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selectedIds], updates }),
    });
    if (!res.ok) { alert('Failed to update documents.'); return; }
    setSelectedIds(new Set());
    setShowBulkTagModal(false);
    await fetchDocs(page);
  }

  async function handleBulkDelete(deleteFromDrive: boolean) {
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/vault/documents/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selectedIds], delete_from_drive: deleteFromDrive }),
      });
      if (!res.ok) throw new Error('Delete failed');
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      await fetchDocs(page);
      await fetchSyncStatus();
    } catch {
      alert('Failed to delete documents.');
    } finally {
      setBulkDeleting(false);
    }
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(docs.map(d => d.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function clearFilters() {
    setFilterDocTypes([]);
    setFilterClient('');
    setFilterTaxYear('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterStatus('');
    setSearchInput('');
  }

  const neverSynced = !syncStatus?.syncState?.last_sync_at;

  // ── Render ────────────────────────────────────────────────────────────────

  if (neverSynced && !loadingDocs) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center p-8">
        <Archive size={48} className="text-[var(--text-muted)] mb-4" />
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Your Document Vault</h1>
        <p className="text-[var(--text-secondary)] max-w-md mb-8">
          Connect your Google Drive to get started. SMITH will index your documents and use AI to tag them automatically.
        </p>
        <div className="flex gap-3">
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Connecting…' : 'Connect Google Drive'}
          </button>
          <button
            onClick={() => { setUploadPreselectedClient(null); setShowUpload(true); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] font-medium hover:bg-[var(--bg-page)]"
          >
            <Upload size={16} /> Upload a document
          </button>
        </div>
        {showUpload && (
          <UploadModal
            clients={clients}
            preselectedClientId={uploadPreselectedClient}
            onClose={() => setShowUpload(false)}
            onDone={() => { setShowUpload(false); fetchDocs(1); fetchSyncStatus(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
        <div className="flex items-center gap-2">
          <Archive size={20} className="text-[var(--accent)]" />
          <h1 className="text-lg font-bold text-[var(--text-primary)]">Document Vault</h1>
          {total > 0 && <span className="text-sm text-[var(--text-muted)]">· {total.toLocaleString()} documents</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setUploadPreselectedClient(null); setShowUpload(true); }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)]"
          >
            <Upload size={14} /> Upload
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)] disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Drive'}
          </button>
        </div>
      </div>

      {/* Sync status bar */}
      <div className="px-6 py-2 bg-[var(--bg-page)] border-b border-[var(--border)] text-xs text-[var(--text-muted)] flex items-center gap-3 shrink-0">
        {syncStatus?.syncState ? (
          <>
            <CheckCircle2 size={12} className="text-green-500" />
            <span>Last synced: {timeAgo(syncStatus.syncState.last_sync_at)}</span>
            <span>·</span>
            <span>{total.toLocaleString()} documents indexed</span>
          </>
        ) : (
          <>
            <Clock size={12} />
            <span>Never synced — click &ldquo;Sync Drive&rdquo; to index your documents</span>
          </>
        )}
      </div>

      {/* Untagged banner */}
      {!bulkDismissed && (syncStatus?.untaggedCount ?? 0) > 0 && !bulkTagging && (
        <div className="px-6 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center gap-3 text-sm text-amber-800 dark:text-amber-300 shrink-0">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="flex-1">
            You have <strong>{syncStatus!.untaggedCount}</strong> untagged documents.{' '}
            <button onClick={() => handleBulkTag()} className="underline font-medium hover:no-underline">Run bulk tagging →</button>
          </span>
          <button onClick={() => setBulkDismissed(true)} className="p-0.5 hover:text-amber-600"><X size={14} /></button>
        </div>
      )}

      {/* Bulk tagging progress */}
      {bulkTagging && (
        <div className="px-6 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 shrink-0">
          <div className="flex items-center justify-between text-sm text-blue-800 dark:text-blue-300 mb-2">
            <span className="flex items-center gap-2"><RefreshCw size={14} className="animate-spin" /> Tagging documents…</span>
            <span>{bulkProgress.completed} / {bulkProgress.total}</span>
          </div>
          <div className="h-1.5 bg-blue-200 dark:bg-blue-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: bulkProgress.total > 0 ? `${(bulkProgress.completed / bulkProgress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 border-b border-[var(--border)] flex gap-0 shrink-0">
        {(['all', 'clients'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setPage(1); }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === tab ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            {tab === 'all' ? 'All Documents' : 'Client Files'}
          </button>
        ))}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'clients' && (
          <div className="w-64 border-r border-[var(--border)] overflow-y-auto shrink-0">
            {clients.length === 0 ? (
              <p className="p-4 text-sm text-[var(--text-muted)]">No clients found.</p>
            ) : (
              <ul className="py-2">
                {clients.map(c => {
                  const isActive = selectedClient?.id === c.id;
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelectedClient(isActive ? null : c)}
                        className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 hover:bg-[var(--bg-page)] transition-colors ${isActive ? 'bg-[var(--bg-page)]' : ''}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.name}</p>
                          {c.client_ref && <p className="text-xs text-[var(--text-muted)]">{c.client_ref}</p>}
                        </div>
                        {isActive && <ChevronRight size={14} className="text-[var(--accent)] shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search + filters */}
          <div className="px-5 py-3 border-b border-[var(--border)] space-y-2 shrink-0">
            {/* Search row */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="Search documents…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-white dark:bg-[var(--bg-card-solid)] text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              {activeTab === 'clients' && selectedClient && (
                <button
                  onClick={() => { setUploadPreselectedClient(selectedClient.id); setShowUpload(true); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)] whitespace-nowrap"
                >
                  <Upload size={14} /> Upload for {selectedClient.name}
                </button>
              )}
              <div className="flex gap-1">
                <button onClick={() => setViewMode('list')} className={`p-2 rounded ${viewMode === 'list' ? 'bg-[var(--bg-page)]' : 'hover:bg-[var(--bg-page)]'}`}><List size={14} /></button>
                <button onClick={() => setViewMode('grid')} className={`p-2 rounded ${viewMode === 'grid' ? 'bg-[var(--bg-page)]' : 'hover:bg-[var(--bg-page)]'}`}><Grid3X3 size={14} /></button>
              </div>
            </div>

            {/* Filter row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Document type */}
              <FilterDropdown
                label="Document Type"
                value={filterDocTypes.join(',')}
                options={DOC_TYPES.map(t => ({ label: t.replace(/_/g, ' '), value: t }))}
                multi
                onChange={v => setFilterDocTypes(v ? v.split(',').filter(Boolean) : [])}
              />
              {/* Client */}
              <FilterDropdown
                label="Client"
                value={filterClient}
                options={clients.map(c => ({ label: c.client_ref ? `${c.client_ref} – ${c.name}` : c.name, value: c.id }))}
                onChange={setFilterClient}
                searchable
              />
              {/* Tax year */}
              <FilterDropdown
                label="Tax Year"
                value={filterTaxYear}
                options={taxYears.map(y => ({ label: y, value: y }))}
                onChange={setFilterTaxYear}
              />
              {/* Date range */}
              <div className="flex items-center gap-1">
                <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                  className="text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-white dark:bg-[var(--bg-card-solid)] text-[var(--text-secondary)]" />
                <span className="text-xs text-[var(--text-muted)]">–</span>
                <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                  className="text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-white dark:bg-[var(--bg-card-solid)] text-[var(--text-secondary)]" />
              </div>
              {/* Status */}
              <FilterDropdown
                label="Status"
                value={filterStatus}
                options={(['tagged', 'untagged', 'failed', 'manually_reviewed'] as const).map(s => ({ label: STATUS_LABELS[s], value: s }))}
                onChange={v => setFilterStatus(v as VaultTaggingStatus | '')}
              />
              {hasFilters && (
                <button onClick={clearFilters} className="text-xs text-[var(--accent)] hover:underline">Clear all filters</button>
              )}
            </div>
          </div>

          {/* Bulk actions bar */}
          {selectedIds.size > 0 && (
            <div className="px-5 py-2 bg-[var(--bg-page)] border-b border-[var(--border)] flex items-center gap-3 text-sm shrink-0 flex-wrap">
              <span className="text-[var(--text-muted)] font-medium">{selectedIds.size} selected</span>
              <button
                onClick={() => setShowBulkTagModal(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium"
              >
                <Pencil size={12} /> Manually tag
              </button>
              <button
                onClick={() => handleBulkTag([...selectedIds])}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-xs font-medium hover:bg-[var(--bg-nav-hover)]"
              >
                <Tag size={12} /> Auto-tag with AI
              </button>
              <button
                onClick={() => setShowBulkDeleteConfirm(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Trash2 size={12} /> Delete
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] ml-auto"
              >
                Clear
              </button>
            </div>
          )}

          {/* Document list / grid */}
          <div className="flex-1 overflow-y-auto">
            {loadingDocs ? (
              <div className="flex items-center justify-center h-32">
                <RefreshCw size={20} className="animate-spin text-[var(--text-muted)]" />
              </div>
            ) : docs.length === 0 ? (
              <EmptyState
                tab={activeTab}
                selectedClient={selectedClient}
                hasFilters={!!(hasFilters || search)}
                onClearFilters={clearFilters}
                onUpload={() => { setUploadPreselectedClient(selectedClient?.id ?? null); setShowUpload(true); }}
              />
            ) : viewMode === 'list' ? (
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg-page)] sticky top-0 z-10">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === docs.length && docs.length > 0}
                        onChange={e => handleSelectAll(e.target.checked)}
                        className="rounded border-[var(--border)]"
                      />
                    </th>
                    <th className="w-8 px-1" />
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">File</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Client</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Type</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Supplier</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Date</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide text-right">Amount</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Tax Year</th>
                    <th className="px-2 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide text-center">Status</th>
                    <th className="w-10 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {docs.map(doc => (
                    <DocRow
                      key={doc.id}
                      doc={doc}
                      selected={selectedIds.has(doc.id)}
                      onSelect={(id, checked) => setSelectedIds(prev => { const s = new Set(prev); checked ? s.add(id) : s.delete(id); return s; })}
                      onClick={() => setPreviewDoc(doc)}
                      onTag={handleSingleTag}
                    />
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-5 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {docs.map(doc => (
                  <DocCard key={doc.id} doc={doc} onClick={() => setPreviewDoc(doc)} />
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 px-5 py-3 border-t border-[var(--border)] shrink-0">
              <button onClick={() => fetchDocs(page - 1)} disabled={page <= 1} className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg-page)]">
                Prev
              </button>
              <span className="text-sm text-[var(--text-muted)]">Page {page} of {totalPages}</span>
              <button onClick={() => fetchDocs(page + 1)} disabled={page >= totalPages} className="px-3 py-1.5 text-sm rounded border border-[var(--border)] disabled:opacity-40 hover:bg-[var(--bg-page)]">
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Preview Drawer */}
      {previewDoc && (
        <PreviewDrawer
          doc={previewDoc}
          clients={clients}
          onClose={() => setPreviewDoc(null)}
          onUpdate={updated => {
            setDocs(prev => prev.map(d => d.id === updated.id ? updated : d));
            setPreviewDoc(updated);
          }}
          onDelete={id => {
            setDocs(prev => prev.filter(d => d.id !== id));
            setTotal(t => t - 1);
          }}
        />
      )}

      {/* Upload Modal */}
      {showUpload && (
        <UploadModal
          clients={clients}
          preselectedClientId={uploadPreselectedClient}
          onClose={() => setShowUpload(false)}
          onDone={() => { setShowUpload(false); fetchDocs(1); fetchSyncStatus(); }}
        />
      )}

      {/* Bulk Manual Tag Modal */}
      {showBulkTagModal && (
        <BulkTagModal
          count={selectedIds.size}
          clients={clients}
          onConfirm={handleBulkManualTag}
          onClose={() => setShowBulkTagModal(false)}
        />
      )}

      {/* Bulk Delete Confirm */}
      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <Trash2 size={18} className="text-red-600 dark:text-red-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">Delete {selectedIds.size} document{selectedIds.size !== 1 ? 's' : ''}?</h2>
                <p className="text-sm text-[var(--text-muted)]">This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowBulkDeleteConfirm(false)} className="btn-secondary" disabled={bulkDeleting}>Cancel</button>
              <button onClick={() => handleBulkDelete(false)} disabled={bulkDeleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
                {bulkDeleting ? 'Deleting…' : 'Delete from vault only'}
              </button>
              <button onClick={() => handleBulkDelete(true)} disabled={bulkDeleting} className="px-4 py-2 text-sm rounded-lg bg-red-800 text-white font-medium hover:bg-red-900 disabled:opacity-50">
                {bulkDeleting ? 'Deleting…' : 'Delete + Drive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Filter Dropdown ──────────────────────────────────────────────────────────

interface FilterOption { label: string; value: string; }

function FilterDropdown({
  label,
  value,
  options,
  onChange,
  multi,
  searchable,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (v: string) => void;
  multi?: boolean;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = multi ? value.split(',').filter(Boolean) : (value ? [value] : []);
  const isActive = selected.length > 0;
  const ref = useRef<HTMLDivElement>(null);

  const filteredOptions = searchable && search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSearch(''); }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(v: string) {
    if (!multi) {
      onChange(selected[0] === v ? '' : v);
      setOpen(false);
      setSearch('');
      return;
    }
    const next = selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v];
    onChange(next.join(','));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${isActive ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] bg-white dark:bg-[var(--bg-card-solid)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)]'}`}
      >
        {isActive ? `${label}: ${selected.length > 1 ? `${selected.length} selected` : options.find(o => o.value === selected[0])?.label ?? selected[0]}` : label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-20 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-lg shadow-lg min-w-[200px] max-h-72 flex flex-col overflow-hidden">
          {searchable && (
            <div className="px-2 pt-2 pb-1 border-b border-[var(--border)] shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full text-xs px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)] outline-none"
              />
            </div>
          )}
          <div className="overflow-y-auto py-1">
            {!multi && isActive && !search && (
              <button onClick={() => { onChange(''); setOpen(false); }} className="w-full text-left px-3 py-2 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-page)] flex items-center gap-1">
                <X size={10} /> Clear
              </button>
            )}
            {filteredOptions.length === 0 && (
              <p className="px-3 py-2 text-xs text-[var(--text-muted)]">No results</p>
            )}
            {filteredOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className="w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-page)] flex items-center justify-between gap-2"
              >
                {opt.label}
                {selected.includes(opt.value) && <Check size={10} className="text-[var(--accent)] shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bulk Tag Modal ───────────────────────────────────────────────────────────

interface BulkTagModalProps {
  count: number;
  clients: Client[];
  onConfirm: (updates: Record<string, unknown>) => void;
  onClose: () => void;
}

function BulkTagModal({ count, clients, onConfirm, onClose }: BulkTagModalProps) {
  const [clientId, setClientId] = useState('');
  const [docType, setDocType] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [taxYear, setTaxYear] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    const updates: Record<string, unknown> = {};
    if (clientId) updates.client_id = clientId;
    if (docType) updates.tag_document_type = docType;
    if (supplierName.trim()) updates.tag_supplier_name = supplierName.trim();
    if (taxYear.trim()) updates.tag_tax_year = taxYear.trim();

    if (Object.keys(updates).length === 0) {
      alert('Please fill in at least one field to update.');
      return;
    }

    setSaving(true);
    await onConfirm(updates);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Manually Tag Documents</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Applying to {count} selected document{count !== 1 ? 's' : ''}. Leave a field blank to keep existing values.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-page)] text-[var(--text-muted)]">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Assign client */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Assign to client</label>
            <select
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            >
              <option value="">— Keep existing —</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.client_ref ? `${c.client_ref} – ${c.name}` : c.name}</option>
              ))}
            </select>
          </div>

          {/* Document type */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Document type</label>
            <select
              value={docType}
              onChange={e => setDocType(e.target.value)}
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)]"
            >
              <option value="">— Keep existing —</option>
              {DOC_TYPES.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Supplier name */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Supplier / contact name</label>
            <input
              type="text"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              placeholder="Leave blank to keep existing"
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            />
          </div>

          {/* Tax year */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Tax year</label>
            <input
              type="text"
              value={taxYear}
              onChange={e => setTaxYear(e.target.value)}
              placeholder="e.g. 2024/25 — leave blank to keep existing"
              className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)]">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-page)] disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Apply to ${count} document${count !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  tab, selectedClient, hasFilters, onClearFilters, onUpload,
}: {
  tab: 'all' | 'clients';
  selectedClient: Client | null;
  hasFilters: boolean;
  onClearFilters: () => void;
  onUpload: () => void;
}) {
  if (tab === 'clients' && !selectedClient) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Users size={24} className="text-[var(--text-muted)] mb-2" />
        <p className="text-sm text-[var(--text-muted)]">Select a client from the left panel</p>
      </div>
    );
  }
  if (tab === 'clients' && selectedClient) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Archive size={24} className="text-[var(--text-muted)] mb-2" />
        <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">No documents for {selectedClient.name}</p>
        <p className="text-xs text-[var(--text-muted)] mb-4">Upload or sync from Google Drive</p>
        <button onClick={onUpload} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-[var(--accent)] text-white">
          <Upload size={14} /> Upload for this client
        </button>
      </div>
    );
  }
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Search size={24} className="text-[var(--text-muted)] mb-2" />
        <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">No documents match your filters</p>
        <button onClick={onClearFilters} className="text-xs text-[var(--accent)] hover:underline">Clear all filters</button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-48 text-center">
      <Archive size={24} className="text-[var(--text-muted)] mb-2" />
      <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">No documents indexed yet</p>
      <p className="text-xs text-[var(--text-muted)]">Sync your Google Drive or upload a document to get started</p>
    </div>
  );
}
