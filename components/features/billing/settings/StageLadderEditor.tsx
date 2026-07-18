'use client';

import { useEffect, useState } from 'react';
import { Save, Plus, Trash2, Check, ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { GlassCard, SectionHeader } from '@/components/features/timesheets/shared/ui';
import type { CreditControlStage, ChaserTone } from '@/lib/billing/types';

// Local copy (can't import the server chaser lib into a client component).
// Keep in sync with CHASER_TAGS in lib/billing/creditControl.ts.
const MERGE_TAGS = [
  '{{client_name}}', '{{client_code}}', '{{invoice_number}}', '{{amount_due}}',
  '{{due_date}}', '{{days_overdue}}', '{{firm_name}}',
];
const TONES: { id: ChaserTone; label: string }[] = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'reminder', label: 'Reminder' },
  { id: 'firm', label: 'Firm' },
  { id: 'final', label: 'Final' },
  { id: 'legal', label: 'Legal' },
];

type Draft = Omit<CreditControlStage, 'id'> & { id?: string };

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'stage';
}

export default function StageLadderEditor({ canEdit }: { canEdit: boolean }) {
  const [stages, setStages] = useState<Draft[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing/credit-control/stages')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.stages) setStages(d.stages); })
      .catch(() => {});
  }, []);

  function update(i: number, patch: Partial<Draft>) {
    setStages(s => s ? s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)) : s);
    setSaved(false);
  }
  function addStage() {
    setStages(s => {
      const next = s ? [...s] : [];
      const key = `${slug('stage')}-${next.length + 1}`;
      next.push({ stageKey: key, name: 'New stage', tone: 'reminder', offsetDays: 21, subject: 'Overdue invoice {{invoice_number}}', body: 'Dear {{client_name}},\n\nInvoice {{invoice_number}} for {{amount_due}} is now {{days_overdue}} days overdue.\n\nRegards,\n{{firm_name}}', enabled: true, position: next.length });
      return next;
    });
    setOpen((stages?.length ?? 0));
  }
  function removeStage(i: number) {
    setStages(s => s ? s.filter((_, idx) => idx !== i) : s);
  }

  async function save() {
    if (!stages) return;
    setSaving(true); setError(null);
    // Order by trigger day so the ladder reads as an escalation.
    const ordered = [...stages].sort((a, b) => a.offsetDays - b.offsetDays);
    const r = await fetch('/api/billing/credit-control/stages', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stages: ordered.map(s => ({ stageKey: s.stageKey, name: s.name, tone: s.tone, offsetDays: s.offsetDays, subject: s.subject, body: s.body, enabled: s.enabled })) }),
    });
    setSaving(false);
    if (r.ok) { setStages(ordered); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    else { const d = await r.json().catch(() => null); setError(d?.error ?? 'Could not save the ladder.'); }
  }

  if (!stages) return <div className="h-40 animate-pulse rounded-[20px] bg-white/50" />;

  const sorted = [...stages].sort((a, b) => a.offsetDays - b.offsetDays);

  return (
    <GlassCard>
      <SectionHeader
        title="Reminder ladder"
        subtitle="The escalating chaser emails. Each stage fires once, when the invoice reaches its trigger day."
        right={<span className="text-[11px] text-[var(--text-muted)]">{stages.filter(s => s.enabled).length} active</span>}
      />

      {/* Merge tag reference */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {MERGE_TAGS.map(t => <span key={t} className="rounded-md bg-black/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text-muted)]">{t}</span>)}
      </div>
      <p className="mb-3 text-[11px] text-[var(--text-muted)]">A &ldquo;View &amp; pay invoice&rdquo; button linking to the client&rsquo;s secure statement is added to every reminder automatically — no need to write one into the text.</p>

      <div className="space-y-2">
        {sorted.map((st) => {
          const i = stages.indexOf(st);
          const isOpen = open === i;
          return (
            <div key={st.id ?? st.stageKey} className={`rounded-xl border ${st.enabled ? 'border-black/8' : 'border-dashed border-black/10 opacity-70'} bg-white/60`}>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <GripVertical size={14} className="text-[var(--text-muted)]/50" />
                <span className="inline-flex h-6 min-w-[52px] items-center justify-center rounded-md bg-[var(--accent)]/10 px-2 text-[11px] font-bold text-[var(--accent)]">
                  {st.offsetDays >= 0 ? `+${st.offsetDays}d` : `${st.offsetDays}d`}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--text-primary)]">{st.name}</p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">{st.subject}</p>
                </div>
                <label className="flex items-center" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={st.enabled} onChange={e => update(i, { enabled: e.target.checked })} disabled={!canEdit} className="h-4 w-4 accent-[var(--accent)]" />
                </label>
                <button onClick={() => setOpen(isOpen ? null : i)} className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-black/5">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
              </div>

              {isOpen && (
                <div className="space-y-3 border-t border-black/5 px-3 py-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-1">
                      <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">Stage name</label>
                      <input value={st.name} onChange={e => update(i, { name: e.target.value })} disabled={!canEdit} className={inp} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">Trigger (days from due)</label>
                      <input type="number" value={st.offsetDays} onChange={e => update(i, { offsetDays: parseInt(e.target.value, 10) || 0 })} disabled={!canEdit} className={inp} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">Tone</label>
                      <select value={st.tone} onChange={e => update(i, { tone: e.target.value as ChaserTone })} disabled={!canEdit} className={inp}>
                        {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">Subject</label>
                    <input value={st.subject} onChange={e => update(i, { subject: e.target.value })} disabled={!canEdit} className={inp} />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">Email body</label>
                    <textarea value={st.body} onChange={e => update(i, { body: e.target.value })} disabled={!canEdit} rows={7} className={`${inp} resize-y font-[inherit]`} />
                  </div>
                  {canEdit && (
                    <div className="flex justify-end">
                      <button onClick={() => removeStage(i)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--danger)] hover:underline"><Trash2 size={13} /> Remove stage</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && (
        <div className="mt-3 flex items-center justify-between">
          <button onClick={addStage} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)] hover:underline"><Plus size={14} /> Add stage</button>
          <div className="flex items-center gap-3">
            {error && <span className="text-[12px] text-[var(--danger)]">{error}</span>}
            {saved && <span className="flex items-center gap-1 text-[13px] font-medium text-emerald-600"><Check size={14} /> Saved</span>}
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50"><Save size={15} /> {saving ? 'Saving…' : 'Save ladder'}</button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}

const inp = 'w-full rounded-lg border border-black/10 bg-white/70 px-2.5 py-1.5 text-[13px] outline-none transition focus:border-[var(--accent)]';
