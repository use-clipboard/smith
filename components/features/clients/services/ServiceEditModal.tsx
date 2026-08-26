'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Check } from 'lucide-react';
import { serviceIcon, SERVICE_ICON_KEYS } from './serviceIcons';
import {
  SERVICE_FREQUENCIES, FREQUENCY_LABEL, VAT_TREATMENTS, VAT_TREATMENT_LABEL,
  type ClientService, type ServiceFrequency, type ServiceStatus, type ServiceVatTreatment,
} from '@/lib/services/serviceTypes';

interface ClientTask { id: string; title: string; status: string; service_id: string | null; }
interface CatalogueTier { label: string; price: number; frequency: string; }
// The shared catalogue = the Proposals module's proposal_services.
interface CatalogueSvc {
  id: string; name: string; description: string | null; icon: string | null;
  base_price: number; frequency: string; vat_treatment: string; active: boolean;
  fee_type: 'fixed' | 'tiered'; tiers?: CatalogueTier[];
}

export default function ServiceEditModal({
  clientId, mode, service, onClose, onSaved,
}: {
  clientId: string;
  mode: 'add' | 'edit';
  service?: ClientService;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalogue, setCatalogue] = useState<CatalogueSvc[]>([]);
  const [tasks, setTasks] = useState<ClientTask[]>([]);

  const [catalogueId, setCatalogueId] = useState<string | null>(service?.catalogueId ?? null);
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [icon, setIcon] = useState<string>(service?.icon ?? 'briefcase');
  const [frequency, setFrequency] = useState<ServiceFrequency | ''>((service?.frequency as ServiceFrequency) ?? 'monthly');
  const [priceText, setPriceText] = useState(service?.pricePence != null ? (service.pricePence / 100).toFixed(2) : '');
  const [vatTreatment, setVatTreatment] = useState<ServiceVatTreatment>((service?.vatTreatment as ServiceVatTreatment) ?? 'exclusive');
  const [tierLabel, setTierLabel] = useState<string | null>(service?.tierLabel ?? null);
  const [status, setStatus] = useState<ServiceStatus>(service?.status ?? 'active');
  const [nextDue, setNextDue] = useState(service?.manualNextDue ?? '');
  const [notes, setNotes] = useState(service?.notes ?? '');
  const [linkedTaskIds, setLinkedTaskIds] = useState<Set<string>>(
    new Set((service?.tasks ?? []).map(t => t.id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proposals/services').then(r => r.ok ? r.json() : { services: [] }).then(d => setCatalogue((d.services ?? []).filter((i: CatalogueSvc) => i.active))).catch(() => {});
    fetch(`/api/tasks?client_id=${clientId}`).then(r => r.ok ? r.json() : { tasks: [] })
      .then(d => setTasks((d.tasks ?? []).map((t: { id: string; title: string; status: string; service_id?: string | null }) => ({ id: t.id, title: t.title, status: t.status, service_id: t.service_id ?? null }))))
      .catch(() => {});
  }, [clientId]);

  // Only offer tasks that are unlinked or already linked to THIS service.
  const linkableTasks = useMemo(
    () => tasks.filter(t => !t.service_id || t.service_id === service?.id || linkedTaskIds.has(t.id)),
    [tasks, service?.id, linkedTaskIds],
  );

  // The catalogue service backing the current selection (for the tier picker).
  const selectedCatalogueItem = useMemo(
    () => catalogue.find(c => c.id === catalogueId) ?? null,
    [catalogue, catalogueId],
  );
  const catalogueTiers = selectedCatalogueItem?.fee_type === 'tiered' ? (selectedCatalogueItem.tiers ?? []) : [];

  function applyCatalogue(id: string) {
    setCatalogueId(id || null);
    const item = catalogue.find(c => c.id === id);
    if (!item) { setTierLabel(null); return; }
    setName(item.name);
    setDescription(item.description ?? '');
    if (item.icon) setIcon(item.icon);
    if (item.vat_treatment) setVatTreatment(item.vat_treatment as ServiceVatTreatment);
    if (item.fee_type === 'tiered' && (item.tiers ?? []).length > 0) {
      // Default to the first tier and pull its price/frequency across.
      pickTier(item, item.tiers![0].label);
    } else {
      setTierLabel(null);
      if (item.frequency) setFrequency(item.frequency as ServiceFrequency);
      if (item.base_price != null) setPriceText(Number(item.base_price).toFixed(2));
    }
  }

  // Choose a tier of a tiered catalogue service → pull its cost + frequency over.
  function pickTier(item: CatalogueSvc, label: string) {
    const tier = (item.tiers ?? []).find(t => t.label === label);
    setTierLabel(label);
    if (!tier) return;
    if (tier.price != null) setPriceText(Number(tier.price).toFixed(2));
    if (tier.frequency) setFrequency(tier.frequency as ServiceFrequency);
  }

  async function save() {
    if (!name.trim()) { setError('A service name is required.'); return; }
    setSaving(true); setError(null);
    const pricePence = priceText.trim() ? Math.round(parseFloat(priceText) * 100) : null;
    const payload = {
      catalogue_id: catalogueId,
      name: name.trim(),
      description: description.trim() || null,
      icon,
      frequency: frequency || null,
      price_pence: Number.isFinite(pricePence as number) ? pricePence : null,
      vat_treatment: vatTreatment,
      tier_label: tierLabel,
      status,
      next_due: nextDue || null,
      notes: notes.trim() || null,
      task_ids: [...linkedTaskIds],
    };
    try {
      const url = mode === 'add' ? `/api/clients/${clientId}/services` : `/api/clients/${clientId}/services/${service!.id}`;
      const res = await fetch(url, { method: mode === 'add' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save.'); return; }
      onSaved();
    } catch { setError('Could not save. Please try again.'); }
    finally { setSaving(false); }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[var(--border)] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{mode === 'add' ? 'Add a service' : 'Edit service'}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)]"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {mode === 'add' && catalogue.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Start from catalogue</label>
              <select value={catalogueId ?? ''} onChange={e => applyCatalogue(e.target.value)} className="input-base w-full text-sm">
                <option value="">Custom service…</option>
                {catalogue.map(c => <option key={c.id} value={c.id}>{c.name}{c.fee_type === 'tiered' ? ' (tiered)' : ''}</option>)}
              </select>
            </div>
          )}

          {catalogueTiers.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Tier</label>
              <select
                value={tierLabel ?? ''}
                onChange={e => selectedCatalogueItem && pickTier(selectedCatalogueItem, e.target.value)}
                className="input-base w-full text-sm"
              >
                {catalogueTiers.map(t => (
                  <option key={t.label} value={t.label}>{t.label} — £{Number(t.price).toFixed(2)}</option>
                ))}
              </select>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">The chosen tier&rsquo;s price is pulled into the fee below.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Service name</label>
            <input value={name} onChange={e => setName(e.target.value)} className="input-base w-full text-sm" placeholder="e.g. VAT Return" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} className="input-base w-full text-sm" placeholder="Short description (optional)" />
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {SERVICE_ICON_KEYS.map(key => {
                const Icon = serviceIcon(key);
                const active = icon === key;
                return (
                  <button key={key} type="button" onClick={() => setIcon(key)} aria-label={key}
                    className={`grid place-items-center h-8 w-8 rounded-lg border transition-colors ${active ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-white text-[var(--text-muted)] border-[var(--border-card)] hover:border-[var(--accent)]'}`}>
                    <Icon size={15} />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value as ServiceFrequency)} className="input-base w-full text-sm">
                {SERVICE_FREQUENCIES.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Price</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-[var(--text-muted)]">£</span>
                <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="decimal" className="input-base w-full text-sm pl-6" placeholder="0.00" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">VAT</label>
            <select value={vatTreatment} onChange={e => setVatTreatment(e.target.value as ServiceVatTreatment)} className="input-base w-full text-sm">
              {VAT_TREATMENTS.map(v => <option key={v} value={v}>{VAT_TREATMENT_LABEL[v]}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as ServiceStatus)} className="input-base w-full text-sm">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Next due <span className="text-[var(--text-muted)] font-normal">(if no linked task)</span></label>
              <input type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} className="input-base w-full text-sm" />
            </div>
          </div>

          {linkableTasks.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Link tasks</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--border-card)] divide-y divide-[var(--border-card)]">
                {linkableTasks.map(t => {
                  const checked = linkedTaskIds.has(t.id);
                  return (
                    <button key={t.id} type="button" onClick={() => setLinkedTaskIds(prev => { const n = new Set(prev); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                      <span className={`grid place-items-center h-4 w-4 rounded border ${checked ? 'bg-[var(--accent)] border-[var(--accent)] text-white' : 'border-slate-300'}`}>{checked && <Check size={11} />}</span>
                      <span className="truncate flex-1">{t.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base w-full text-sm resize-none" placeholder="Notes about this service (optional)" />
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)]">
          <button onClick={onClose} className="btn-ghost text-xs">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="btn-primary text-xs disabled:opacity-50">{saving ? 'Saving…' : mode === 'add' ? 'Add service' : 'Save'}</button>
        </div>
      </div>
    </div>, document.body);
}
