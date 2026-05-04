'use client';

import { useState } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Download, Loader2 } from 'lucide-react';
import { DEFAULT_TASK_TEMPLATES, TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import type { TaskTemplate, DefaultTemplate } from '@/types';

interface Props {
  firmTemplates: TaskTemplate[];
  onCreateFromDefault: (t: DefaultTemplate) => Promise<void>;
  onEdit: (t: TaskTemplate) => void;
  onCreateBlank: () => void;
  onDelete: (id: string) => Promise<void>;
}

export default function TemplateLibrary({ firmTemplates, onCreateFromDefault, onEdit, onCreateBlank, onDelete }: Props) {
  const [importing, setImporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function handleImport(t: DefaultTemplate) {
    setImporting(t.id);
    try { await onCreateFromDefault(t); }
    finally { setImporting(null); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this template? Tasks created from it will not be affected.')) return;
    setDeleting(id);
    try { await onDelete(id); }
    finally { setDeleting(null); }
  }

  const filteredDefaults = DEFAULT_TASK_TEMPLATES.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) || t.category.includes(search.toLowerCase())
  );

  const filteredFirm = firmTemplates.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <input
          placeholder="Search templates…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 w-60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <button
          onClick={onCreateBlank}
          className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 font-medium"
        >
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>

      {/* Firm templates */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Your Firm's Templates ({filteredFirm.length})</h3>
        {filteredFirm.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400 mb-3">No custom templates yet.</p>
            <p className="text-xs text-gray-400">Import a built-in template below or create one from scratch.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredFirm.map(t => (
              <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-4 hover:border-indigo-300 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm text-gray-900">{t.name}</h4>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => onEdit(t)} className="p-1 text-gray-400 hover:text-indigo-600 rounded" title="Edit">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                      title="Delete"
                    >
                      {deleting === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                {t.description && <p className="text-xs text-gray-500 mb-2">{t.description}</p>}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded">
                    {TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  <span className="text-xs text-gray-400">{t.steps?.length ?? 0} steps</span>
                  {t.recurrence_type && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <RefreshCw className="h-3 w-3" /> {t.recurrence_type}
                    </span>
                  )}
                  {!t.is_firm_wide && (
                    <span className="text-xs bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded">Personal</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SMITH built-in templates */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-1">SMITH Built-in Templates</h3>
        <p className="text-xs text-gray-400 mb-3">Import any of these into your firm's library to customise them.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredDefaults.map(t => {
            const alreadyImported = firmTemplates.some(ft => ft.name === t.name);
            return (
              <div key={t.id} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm text-gray-800">{t.name}</h4>
                  <button
                    onClick={() => handleImport(t)}
                    disabled={importing === t.id || alreadyImported}
                    className="flex items-center gap-1 text-xs bg-white border border-gray-300 text-gray-600 hover:border-indigo-400 hover:text-indigo-700 px-2 py-1 rounded disabled:opacity-40 flex-shrink-0"
                    title={alreadyImported ? 'Already imported' : 'Import to your library'}
                  >
                    {importing === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                    {alreadyImported ? 'Imported' : 'Import'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">{t.description}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded">
                    {TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  <span className="text-xs text-gray-400">{t.steps.length} steps</span>
                  {t.recurrence_type && (
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <RefreshCw className="h-3 w-3" /> {t.recurrence_type}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
