'use client';

import { useEffect, useState, useCallback } from 'react';
import { Plus, LayoutTemplate, Pencil, Trash2, Send, Copy } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import type { CampaignTemplate } from '@/types/campaigns';
import { STARTER_TEMPLATES } from '@/lib/campaigns/starterTemplates';
import TemplateEditorModal from './TemplateEditorModal';

import type { NewsletterDesign } from '@/types/campaigns';

export interface UsableTemplate {
  name: string; subject: string; preview_text: string; body_html: string;
  /** Present when the template was built in the newsletter designer. */
  design?: NewsletterDesign | null;
}

interface EditorState {
  template?: CampaignTemplate | null;
  initial?: { name?: string; category?: string; description?: string; subject?: string; preview_text?: string; body_html?: string };
}

const CAT_STYLE: Record<string, string> = {
  Newsletter:  'bg-blue-100 text-blue-700',
  Reminder:    'bg-amber-100 text-amber-700',
  Operational: 'bg-green-100 text-green-700',
  Onboarding:  'bg-purple-100 text-purple-700',
};

function TemplateCard({ name, category, description, bodyHtml, onUse, actions }: {
  name: string; category: string; description: string; bodyHtml: string;
  onUse: () => void; actions?: React.ReactNode;
}) {
  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] overflow-hidden flex flex-col">
      {/* Mini preview */}
      <div className="h-32 bg-white border-b border-black/5 overflow-hidden relative">
        <div className="absolute inset-0 p-3 text-[9px] leading-tight text-[var(--text-secondary)] pointer-events-none scale-[0.85] origin-top-left"
          dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/90" />
      </div>
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">{name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${CAT_STYLE[category] ?? 'bg-gray-100 text-gray-600'}`}>{category}</span>
        </div>
        <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-3">{description}</p>
        <div className="flex items-center gap-1 mt-auto pt-2 border-t border-black/5">
          <button onClick={onUse} className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent)] hover:underline mr-auto">
            <Send size={12} /> Use in campaign
          </button>
          {actions}
        </div>
      </div>
    </div>
  );
}

export default function TemplatesTab({ onUseInCampaign }: { onUseInCampaign: (t: UsableTemplate) => void }) {
  const [saved, setSaved] = useState<CampaignTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/campaigns/templates');
      if (r.ok) setSaved((await r.json()).templates ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function remove(id: string) {
    if (!confirm('Delete this template?')) return;
    await fetch(`/api/campaigns/templates/${id}`, { method: 'DELETE' });
    load();
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
          Start a campaign from a ready-made template, or save your own for the whole team to reuse.
        </p>
        <button onClick={() => setEditor({})} className="btn-primary shrink-0"><Plus size={15} /> New template</button>
      </div>

      {/* Your templates */}
      {saved.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">Your templates</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {saved.map(t => (
              <TemplateCard
                key={t.id} name={t.name} category={t.category} description={t.description} bodyHtml={t.body_html}
                onUse={() => onUseInCampaign({ name: t.name, subject: t.subject, preview_text: t.preview_text, body_html: t.body_html, design: t.design ?? null })}
                actions={
                  <>
                    <button onClick={() => setEditor({ template: t })} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                    <button onClick={() => remove(t.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                  </>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Starter templates */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-3">Starter templates</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {STARTER_TEMPLATES.map(t => (
            <TemplateCard
              key={t.id} name={t.name} category={t.category} description={t.description} bodyHtml={t.body_html}
              onUse={() => onUseInCampaign({ name: t.name, subject: t.subject, preview_text: t.preview_text, body_html: t.body_html })}
              actions={
                <button
                  onClick={() => setEditor({ initial: { name: t.name, category: t.category, description: t.description, subject: t.subject, preview_text: t.preview_text, body_html: t.body_html } })}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Save a copy">
                  <Copy size={14} />
                </button>
              }
            />
          ))}
        </div>
      </div>

      {saved.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <LayoutTemplate size={14} /> Save any campaign wording you reuse as a template — press “New template”, or copy a starter to tweak.
        </div>
      )}

      {editor && (
        <TemplateEditorModal
          template={editor.template ?? null}
          initial={editor.initial}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); load(); }}
        />
      )}
    </div>
  );
}
