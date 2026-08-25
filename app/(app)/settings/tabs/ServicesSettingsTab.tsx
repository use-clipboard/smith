'use client';

/**
 * ServicesSettingsTab — manage the firm's service CATALOGUE (the master list of
 * services that can be added to a client from the client Services tab). Admin
 * only. Templates (service bundles) and proposal integration come in Phase 2.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Archive, ArchiveRestore, X, Check, Layers, Package, Trash2 } from 'lucide-react';
import { serviceIcon, SERVICE_ICON_KEYS } from '@/components/features/clients/services/serviceIcons';
import { SERVICE_FREQUENCIES, FREQUENCY_LABEL, type CatalogueItem, type ServiceFrequency } from '@/lib/services/serviceTypes';
import type { ServiceTemplate } from '@/app/api/services/settings/route';

function fmtMoney(pence: number | null): string {
  if (pence == null) return '—';
  return `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ServicesSettingsTab() {
  const [items, setItems] = useState<CatalogueItem[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ mode: 'add' | 'edit'; item?: CatalogueItem } | null>(null);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<ServiceTemplate | 'new' | null>(null);

  const load = () => fetch('/api/services/catalogue').then(r => r.ok ? r.json() : { items: [] }).then(d => setItems(d.items ?? [])).catch(() => setItems([]));
  const loadTemplates = () => fetch('/api/services/settings').then(r => r.ok ? r.json() : { templates: [] }).then(d => setTemplates(d.templates ?? [])).catch(() => {});
  useEffect(() => { load(); loadTemplates(); }, []);

  async function saveTemplates(next: ServiceTemplate[]) {
    setTemplates(next);
    await fetch('/api/services/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templates: next }) }).catch(() => {});
  }

  async function archive(item: CatalogueItem, archived: boolean) {
    if (archived) {
      await fetch(`/api/services/catalogue/${item.id}`, { method: 'DELETE' }).catch(() => {});
    } else {
      await fetch(`/api/services/catalogue/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) }).catch(() => {});
    }
    load();
  }

  const visible = (items ?? []).filter(i => showArchived ? true : !i.archived);

  return (
    <div className="max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Services</h2>
          <p className="text-sm text-[var(--text-muted)]">The catalogue of services your firm offers. Add these to any client from their Services tab.</p>
        </div>
        <button onClick={() => setEditing({ mode: 'add' })} className="btn-primary inline-flex items-center gap-1.5 text-sm shrink-0"><Plus size={15} /> Add service</button>
      </div>

      <div className="glass rounded-xl mt-4 overflow-hidden">
        {items === null ? (
          <div className="py-12 text-center text-sm text-[var(--text-muted)]">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <Layers size={24} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
            <p className="text-sm text-[var(--text-muted)]">No services in the catalogue yet.</p>
            <button onClick={() => setEditing({ mode: 'add' })} className="mt-3 text-sm text-[var(--accent)] font-medium hover:underline">Add the first service</button>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-card)]">
            {visible.map(item => {
              const Icon = serviceIcon(item.icon);
              return (
                <li key={item.id} className={`flex items-center gap-3 px-4 py-3 ${item.archived ? 'opacity-50' : ''}`}>
                  <span className="grid place-items-center h-9 w-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] shrink-0"><Icon size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--text-primary)] truncate">{item.name}{item.archived && <span className="ml-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Archived</span>}</p>
                    {item.description && <p className="text-xs text-[var(--text-muted)] truncate">{item.description}</p>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)] shrink-0 text-right">
                    {item.defaultFrequency && <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{FREQUENCY_LABEL[item.defaultFrequency as ServiceFrequency] ?? item.defaultFrequency}</span>}
                    <span className="block mt-0.5 tabular-nums">{fmtMoney(item.defaultPricePence)}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => setEditing({ mode: 'edit', item })} aria-label="Edit" className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-slate-100"><Pencil size={14} /></button>
                    <button onClick={() => void archive(item, !item.archived)} aria-label={item.archived ? 'Restore' : 'Archive'} className="p-1.5 rounded text-[var(--text-muted)] hover:text-slate-700 hover:bg-slate-100">{item.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(items ?? []).some(i => i.archived) && (
        <button onClick={() => setShowArchived(v => !v)} className="mt-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">{showArchived ? 'Hide' : 'Show'} archived</button>
      )}

      {/* ── Templates (bundles) ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mt-8 mb-1">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Service Templates</h2>
          <p className="text-sm text-[var(--text-muted)]">Bundle common services together to add them all to a client in one click.</p>
        </div>
        <button onClick={() => setEditingTemplate('new')} className="btn-secondary inline-flex items-center gap-1.5 text-sm shrink-0"><Plus size={15} /> Add template</button>
      </div>
      <div className="glass rounded-xl mt-3 overflow-hidden">
        {templates.length === 0 ? (
          <div className="py-10 text-center">
            <Package size={22} className="mx-auto text-[var(--text-muted)] opacity-40 mb-2" />
            <p className="text-sm text-[var(--text-muted)]">No templates yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-card)]">
            {templates.map(t => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid place-items-center h-9 w-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] shrink-0"><Package size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--text-primary)] truncate">{t.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{t.catalogueIds.length} service{t.catalogueIds.length === 1 ? '' : 's'}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => setEditingTemplate(t)} aria-label="Edit" className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-slate-100"><Pencil size={14} /></button>
                  <button onClick={() => void saveTemplates(templates.filter(x => x.id !== t.id))} aria-label="Delete" className="p-1.5 rounded text-[var(--text-muted)] hover:text-red-600 hover:bg-slate-100"><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs text-[var(--text-muted)]">Proposal integration is coming soon.</p>

      {editing && <CatalogueItemModal mode={editing.mode} item={editing.item} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {editingTemplate && (
        <TemplateModal
          template={editingTemplate === 'new' ? null : editingTemplate}
          catalogue={(items ?? []).filter(i => !i.archived)}
          onClose={() => setEditingTemplate(null)}
          onSave={tpl => {
            const next = editingTemplate === 'new'
              ? [...templates, tpl]
              : templates.map(x => x.id === tpl.id ? tpl : x);
            void saveTemplates(next);
            setEditingTemplate(null);
          }}
        />
      )}
    </div>
  );
}

function TemplateModal({ template, catalogue, onClose, onSave }: { template: ServiceTemplate | null; catalogue: CatalogueItem[]; onClose: () => void; onSave: (t: ServiceTemplate) => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(template?.catalogueIds ?? []));
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (!name.trim()) { setError('A template name is required.'); return; }
    if (selected.size === 0) { setError('Pick at least one service.'); return; }
    onSave({ id: template?.id ?? (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}`), name: name.trim(), catalogueIds: [...selected] });
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{template ? 'Edit template' : 'New template'}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Template name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-base w-full text-sm" placeholder="e.g. Limited Company package" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Services in this template</label>
            {catalogue.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">Add services to the catalogue above first.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--border-card)] divide-y divide-[var(--border-card)]">
                {catalogue.map(c => {
                  const Icon = serviceIcon(c.icon);
                  const checked = selected.has(c.id);
                  return (
                    <button key={c.id} type="button" onClick={() => setSelected(prev => { const n = new Set(prev); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className={`grid place-items-center h-4 w-4 rounded border ${checked ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-slate-300'}`}>{checked && <Check size={11} />}</span>
                      <span className="grid place-items-center h-6 w-6 rounded bg-slate-100 text-slate-500 shrink-0"><Icon size={12} /></span>
                      <span className="truncate flex-1">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
          <button onClick={save} className="btn-primary text-xs">Save template</button>
        </div>
      </div>
    </div>, document.body);
}

function CatalogueItemModal({ mode, item, onClose, onSaved }: { mode: 'add' | 'edit'; item?: CatalogueItem; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [icon, setIcon] = useState(item?.icon ?? 'briefcase');
  const [frequency, setFrequency] = useState<ServiceFrequency>((item?.defaultFrequency as ServiceFrequency) ?? 'monthly');
  const [priceText, setPriceText] = useState(item?.defaultPricePence != null ? (item.defaultPricePence / 100).toFixed(2) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) { setError('A name is required.'); return; }
    setSaving(true); setError(null);
    const pence = priceText.trim() ? Math.round(parseFloat(priceText) * 100) : null;
    const payload = { name: name.trim(), description: description.trim() || null, icon, default_frequency: frequency, default_price_pence: Number.isFinite(pence as number) ? pence : null };
    try {
      const res = await fetch(mode === 'add' ? '/api/services/catalogue' : `/api/services/catalogue/${item!.id}`, {
        method: mode === 'add' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save.'); return; }
      onSaved();
    } catch { setError('Could not save.'); } finally { setSaving(false); }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--border)]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{mode === 'add' ? 'Add a service' : 'Edit service'}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-base w-full text-sm" placeholder="e.g. VAT Return" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="input-base w-full text-sm" placeholder="Optional" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_ICON_KEYS.map(key => {
                const Icon = serviceIcon(key);
                const active = icon === key;
                return (
                  <button key={key} type="button" onClick={() => setIcon(key)} aria-label={key} className={`grid place-items-center h-8 w-8 rounded-lg border ${active ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-white text-[var(--text-muted)] border-[var(--border-card)] hover:border-[var(--accent)]'}`}><Icon size={15} /></button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Default frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value as ServiceFrequency)} className="input-base w-full text-sm">
                {SERVICE_FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Default price</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">£</span>
                <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="decimal" className="input-base w-full text-sm pl-6" placeholder="0.00" />
              </div>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="btn-primary text-xs disabled:opacity-50 inline-flex items-center gap-1">{saving ? 'Saving…' : (<><Check size={13} /> Save</>)}</button>
        </div>
      </div>
    </div>, document.body);
}
