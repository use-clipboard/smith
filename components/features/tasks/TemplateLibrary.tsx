'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Download, Loader2, Sparkles, PenLine, X, Copy, AlertCircle, Link2 } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { DEFAULT_TASK_TEMPLATES, TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { TaskTemplate, DefaultTemplate } from '@/types';

const CH_DEADLINE_LABELS: Record<string, string> = {
  accounts_due: 'Accounts Due',
  cs_due: 'Confirmation Statement',
  officer_idv_due: 'Officer IDV',
  psc_idv_due: 'PSC IDV',
};

interface Props {
  firmTemplates: TaskTemplate[];
  onCreateFromDefault: (t: DefaultTemplate, nameOverride?: string) => Promise<void>;
  onEdit: (t: TaskTemplate) => void;
  onCreateBlank: () => void;
  onCreateAI: () => void;
  onDelete: (id: string) => Promise<void>;
  onCopy: (t: TaskTemplate, newName: string) => Promise<void>;
  /** When false, hides Edit/Delete/Copy/Create affordances. Non-admins can
   *  still browse the library but not change anything. */
  isAdmin?: boolean;
}

export default function TemplateLibrary({ firmTemplates, onCreateFromDefault, onEdit, onCreateBlank, onCreateAI, onDelete, onCopy, isAdmin = true }: Props) {
  const [importing, setImporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const [copyTarget, setCopyTarget] = useState<TaskTemplate | null>(null);
  const [copyName, setCopyName] = useState('');
  // Import rename modal — shown when the default template name already exists
  const [importRenameTarget, setImportRenameTarget] = useState<DefaultTemplate | null>(null);
  const [importRenameName, setImportRenameName] = useState('');
  const [search, setSearch] = useState('');
  const [showChoice, setShowChoice] = useState(false);
  const copyInputRef = useRef<HTMLInputElement>(null);
  const importRenameInputRef = useRef<HTMLInputElement>(null);

  async function handleImport(t: DefaultTemplate) {
    const nameInUse = firmTemplates.some(ft => ft.name.toLowerCase() === t.name.toLowerCase());
    if (nameInUse) {
      // Show rename modal instead of importing directly
      setImportRenameTarget(t);
      setImportRenameName(t.name);
      return;
    }
    setImporting(t.id);
    try { await onCreateFromDefault(t); }
    finally { setImporting(null); }
  }

  async function handleImportRenameConfirm() {
    if (!importRenameTarget || !importRenameName.trim()) return;
    setImporting(importRenameTarget.id);
    try {
      await onCreateFromDefault(importRenameTarget, importRenameName.trim());
      setImportRenameTarget(null);
      setImportRenameName('');
    } finally {
      setImporting(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template? Tasks created from it will not be affected.')) return;
    setDeleting(id);
    try { await onDelete(id); }
    finally { setDeleting(null); }
  }

  function openCopyModal(t: TaskTemplate) {
    setCopyTarget(t);
    setCopyName(`COPY_${t.name}`);
  }

  async function handleCopyConfirm() {
    if (!copyTarget || !copyName.trim()) return;
    setCopying(copyTarget.id);
    try {
      await onCopy(copyTarget, copyName.trim());
      setCopyTarget(null);
      setCopyName('');
    } finally {
      setCopying(null);
    }
  }

  // Auto-focus name inputs when modals open
  useEffect(() => {
    if (copyTarget) setTimeout(() => copyInputRef.current?.select(), 50);
  }, [copyTarget]);

  useEffect(() => {
    if (importRenameTarget) setTimeout(() => importRenameInputRef.current?.select(), 50);
  }, [importRenameTarget]);

  const filteredDefaults = DEFAULT_TASK_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || t.category.includes(search.toLowerCase())
  );

  const filteredFirm = firmTemplates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  // Group helpers
  function groupByCategory<T extends { category: string }>(items: T[]): [string, T[]][] {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const cat = item.category ?? 'general';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    // Sort groups by the order they appear in TEMPLATE_CATEGORY_LABELS
    const labelKeys = Object.keys(TEMPLATE_CATEGORY_LABELS);
    return [...map.entries()].sort(([a], [b]) => {
      const ai = labelKeys.indexOf(a);
      const bi = labelKeys.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }

  const firmGroups   = groupByCategory(filteredFirm);
  const defaultGroups = groupByCategory(filteredDefaults);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          placeholder="Search templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-sm font-medium rounded-lg px-3 py-2 w-60 bg-white border border-[var(--border)] shadow-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] placeholder:font-medium outline-none transition focus:border-[var(--accent)] focus:bg-white"
        />
        {isAdmin && (
          <button
            onClick={() => setShowChoice(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium"
          >
            <Plus className="h-4 w-4" /> New Template
          </button>
        )}
      </div>

      {/* Firm templates */}
      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-3">Your Firm&apos;s Templates ({filteredFirm.length})</h3>
        {filteredFirm.length === 0 ? (
          <div className="border-2 border-dashed border-[var(--border)] rounded-xl p-8 text-center">
            <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">No custom templates yet.</p>
            <p className="text-xs text-[var(--text-secondary)]">Import a built-in template below or create one from scratch.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {firmGroups.map(([cat, items]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider drop-shadow-sm">
                    {TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
                  </span>
                  <div className="flex-1 h-px bg-white/20" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(t => (
                    <div key={t.id} className="bg-white/[0.78] backdrop-blur-md border border-[var(--border)] shadow-sm rounded-lg p-4 hover:border-indigo-300 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold text-sm text-gray-900">{t.name}</h4>
                        {isAdmin && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Tooltip label="Edit">
                              <button onClick={() => onEdit(t)} aria-label="Edit" className="p-1 text-gray-400 hover:text-indigo-600 rounded">
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                            <Tooltip label="Copy">
                              <button
                                onClick={() => openCopyModal(t)}
                                disabled={copying === t.id}
                                aria-label="Copy"
                                className="p-1 text-gray-400 hover:text-indigo-600 rounded"
                              >
                                {copying === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button
                                onClick={() => handleDelete(t.id)}
                                disabled={deleting === t.id}
                                aria-label="Delete"
                                className="p-1 text-gray-400 hover:text-red-500 rounded"
                              >
                                {deleting === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                      {t.description && <p className="text-xs text-gray-500 mb-2">{t.description}</p>}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">{t.steps?.length ?? 0} steps</span>
                        {t.recurrence_type && (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <RefreshCw className="h-3 w-3" /> {t.recurrence_type}
                          </span>
                        )}
                        {(t as { ch_deadline_type?: string | null }).ch_deadline_type && (
                          <Tooltip label="Linked to CH Secretarial — due date auto-syncs with Companies House">
                            <span className="flex items-center gap-1 text-xs text-[var(--accent)]">
                              <Link2 className="h-3 w-3" /> {CH_DEADLINE_LABELS[(t as { ch_deadline_type: string }).ch_deadline_type] ?? 'CH-linked'}
                            </span>
                          </Tooltip>
                        )}
                        {!t.is_firm_wide && (
                          <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">Personal</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SMITH built-in templates */}
      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1">SMITH Built-in Templates</h3>
        <p className="text-xs font-medium text-[var(--text-secondary)] mb-4">Import any of these into your firm&apos;s library to customise them.</p>
        <div className="space-y-5">
          {defaultGroups.map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider drop-shadow-sm">
                  {TEMPLATE_CATEGORY_LABELS[cat] ?? cat}
                </span>
                <div className="flex-1 h-px bg-white/20" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map(t => (
                  <div key={t.id} className="bg-white/[0.6] backdrop-blur-md border border-[var(--border)] shadow-sm rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-sm text-gray-800">{t.name}</h4>
                      {isAdmin && (
                        <Tooltip label="Import to your library" className="flex-shrink-0">
                          <button
                            onClick={() => handleImport(t)}
                            disabled={importing === t.id}
                            aria-label="Import to your library"
                            className="flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-700 px-2 py-1 rounded disabled:opacity-50"
                          >
                            {importing === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                            Import
                          </button>
                        </Tooltip>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{t.description}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400">{t.steps.length} steps</span>
                      {t.recurrence_type && (
                        <span className="flex items-center gap-1 text-xs text-gray-400">
                          <RefreshCw className="h-3 w-3" /> {t.recurrence_type}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Import Rename modal ─────────────────────────────────────────── */}
      {importRenameTarget && (
        <div className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </div>
                <h2 className="text-base font-bold text-gray-900">Name Already In Use</h2>
              </div>
              <button onClick={() => setImportRenameTarget(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              You already have a template named <span className="font-semibold text-gray-700">{importRenameTarget.name}</span>. Please choose a different name for this import:
            </p>
            <input
              ref={importRenameInputRef}
              value={importRenameName}
              onChange={e => setImportRenameName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleImportRenameConfirm(); if (e.key === 'Escape') setImportRenameTarget(null); }}
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 mb-1 ${
                firmTemplates.some(ft => ft.name.toLowerCase() === importRenameName.trim().toLowerCase())
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:ring-indigo-500'
              }`}
              placeholder="Template name…"
            />
            {firmTemplates.some(ft => ft.name.toLowerCase() === importRenameName.trim().toLowerCase()) && (
              <p className="text-xs text-red-500 mb-3 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 flex-shrink-0" /> A template with this name already exists.
              </p>
            )}
            {!firmTemplates.some(ft => ft.name.toLowerCase() === importRenameName.trim().toLowerCase()) && <div className="mb-3" />}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setImportRenameTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportRenameConfirm}
                disabled={!importRenameName.trim() || importing === importRenameTarget.id || firmTemplates.some(ft => ft.name.toLowerCase() === importRenameName.trim().toLowerCase())}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {importing === importRenameTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Copy Template modal ─────────────────────────────────────────── */}
      {copyTarget && (
        <div className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                  <Copy className="h-4 w-4 text-indigo-600" />
                </div>
                <h2 className="text-base font-bold text-gray-900">Copy Template</h2>
              </div>
              <button onClick={() => setCopyTarget(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Copying <span className="font-semibold text-gray-700">{copyTarget.name}</span>. Give the copy a name:
            </p>
            <input
              ref={copyInputRef}
              value={copyName}
              onChange={e => setCopyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCopyConfirm(); if (e.key === 'Escape') setCopyTarget(null); }}
              className={`w-full text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 mb-1 ${
                firmTemplates.some(ft => ft.name.toLowerCase() === copyName.trim().toLowerCase())
                  ? 'border-red-400 focus:ring-red-400'
                  : 'border-gray-300 focus:ring-indigo-500'
              }`}
              placeholder="Template name…"
            />
            {firmTemplates.some(ft => ft.name.toLowerCase() === copyName.trim().toLowerCase()) && (
              <p className="text-xs text-red-500 mb-3 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 flex-shrink-0" /> A template with this name already exists.
              </p>
            )}
            {!firmTemplates.some(ft => ft.name.toLowerCase() === copyName.trim().toLowerCase()) && <div className="mb-3" />}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCopyTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCopyConfirm}
                disabled={!copyName.trim() || copying === copyTarget.id || firmTemplates.some(ft => ft.name.toLowerCase() === copyName.trim().toLowerCase())}
                className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {copying === copyTarget.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                Create Copy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Template choice modal ────────────────────────────────────── */}
      {showChoice && (
        <div className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-bold text-gray-900">Create a new template</h2>
              <button onClick={() => setShowChoice(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { setShowChoice(false); onCreateBlank(); }}
                className="group flex flex-col items-start gap-3 border-2 border-gray-200 hover:border-indigo-400 rounded-xl p-5 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-indigo-50 flex items-center justify-center transition-colors">
                  <PenLine className="h-5 w-5 text-gray-500 group-hover:text-indigo-600 transition-colors" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">From scratch</p>
                  <p className="text-xs text-gray-500 mt-0.5">Start with a blank canvas and build your workflow manually.</p>
                </div>
              </button>
              <button
                onClick={() => { setShowChoice(false); onCreateAI(); }}
                className="group flex flex-col items-start gap-3 border-2 border-gray-200 hover:border-indigo-400 rounded-xl p-5 text-left transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center transition-colors">
                  <Sparkles className="h-5 w-5 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">AI Assisted</p>
                  <p className="text-xs text-gray-500 mt-0.5">Chat with the AI assistant to build your template automatically.</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
