'use client';

import { useState } from 'react';
import { X, Sparkles, Loader2, Eye, LayoutTemplate } from 'lucide-react';
import type { CampaignTemplate } from '@/types/campaigns';

interface Props {
  template?: CampaignTemplate | null;
  /** Pre-fill for "save a copy" of a starter template. */
  initial?: { name?: string; category?: string; description?: string; subject?: string; preview_text?: string; body_html?: string };
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES = ['Newsletter', 'Reminder', 'Operational', 'Onboarding', 'General'];

export default function TemplateEditorModal({ template, initial, onClose, onSaved }: Props) {
  const base = template ?? initial ?? {};
  const [name, setName] = useState(base.name ?? '');
  const [category, setCategory] = useState(base.category ?? 'General');
  const [description, setDescription] = useState(base.description ?? '');
  const [subject, setSubject] = useState(base.subject ?? '');
  const [previewText, setPreviewText] = useState(base.preview_text ?? '');
  const [body, setBody] = useState(base.body_html ?? '');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true); setError(null);
    try {
      const r = await fetch('/api/campaigns/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full', prompt: aiPrompt, tone: 'professional' }),
      });
      if (!r.ok) { setError('Generation failed.'); return; }
      const d = await r.json();
      if (d.subject) setSubject(d.subject);
      if (d.previewText) setPreviewText(d.previewText);
      if (d.bodyHtml) setBody(d.bodyHtml);
    } finally { setAiBusy(false); }
  }

  async function save() {
    if (!name.trim()) { setError('Give the template a name.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = { name: name.trim(), category, description, subject, preview_text: previewText, body_html: body };
      const url = template ? `/api/campaigns/templates/${template.id}` : '/api/campaigns/templates';
      const method = template ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) { setError('Could not save the template.'); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  const inputCls = 'w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><LayoutTemplate size={16} style={{ color: 'var(--accent)' }} /> {template ? 'Edit template' : 'New template'}</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Name</label>
                <input value={name} onChange={e => setName(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="e.g. Records checklist" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className={`mt-1 ${inputCls}`}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Description</label>
              <input value={description} onChange={e => setDescription(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="What's this template for?" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Subject line</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Preview text</label>
              <input value={previewText} onChange={e => setPreviewText(e.target.value)} className={`mt-1 ${inputCls}`} />
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Body (HTML)</label>
              <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} className={`mt-1 ${inputCls} font-mono text-[13px] resize-y`} />
            </div>
            <div className="glass-solid rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center gap-2 mb-2"><Sparkles size={14} style={{ color: 'var(--accent)' }} /><span className="text-xs font-semibold text-[var(--text-primary)]">Write with SMITH</span></div>
              <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2} className={`${inputCls} text-[13px] resize-y`} placeholder="Describe the template…" />
              <button onClick={generate} disabled={aiBusy || !aiPrompt.trim()} className="btn-primary text-xs mt-2 ml-auto">
                {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate
              </button>
            </div>
          </div>

          <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
            <div className="flex items-center gap-2 mb-2"><Eye size={15} style={{ color: 'var(--accent)' }} /><h4 className="text-sm font-semibold text-[var(--text-primary)]">Preview</h4></div>
            <div className="text-xs text-[var(--text-muted)] mb-1">{subject || '(no subject)'}</div>
            <div className="rounded-lg border border-[var(--border)] p-3 bg-white max-h-[460px] overflow-y-auto scrollbar-thin text-sm"
              dangerouslySetInnerHTML={{ __html: body || '<p style="color:#9ca3af">Your template preview appears here.</p>' }} />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-black/5">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save template'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
