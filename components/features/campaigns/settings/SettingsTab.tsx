'use client';

import { useEffect, useState, useCallback } from 'react';
import { Mail, Check, Loader2, UserMinus, Plus, X, ShieldCheck } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import type { CampaignFirmSettings } from '@/types/campaigns';
import DeliverabilityPanel from './DeliverabilityPanel';

interface Suppression { id: string; email: string; client_id: string | null; scope: string; created_at: string }

export default function SettingsTab() {
  const [settings, setSettings] = useState<CampaignFirmSettings | null>(null);
  const [gmail, setGmail] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const [suppressions, setSuppressions] = useState<Suppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  const loadSuppressions = useCallback(async () => {
    const r = await fetch('/api/campaigns/suppressions');
    if (r.ok) setSuppressions((await r.json()).suppressions ?? []);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [sRes] = await Promise.all([fetch('/api/campaigns/settings'), loadSuppressions()]);
        if (sRes.ok && live) { const d = await sRes.json(); setSettings(d.settings); setGmail(d.gmail); }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [loadSuppressions]);

  function set<K extends keyof CampaignFirmSettings>(key: K, value: CampaignFirmSettings[K]) {
    setSettings(s => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }

  async function save() {
    if (!settings) return;
    setSaving(true); setSaved(false);
    try {
      const r = await fetch('/api/campaigns/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reply_to: settings.reply_to || null,
          include_unsubscribe: settings.include_unsubscribe,
          unsubscribe_footer: settings.unsubscribe_footer,
          default_dedupe: settings.default_dedupe,
          frequency_guard_days: settings.frequency_guard_days,
          require_approval: settings.require_approval,
          approval_min_recipients: settings.approval_min_recipients,
          allow_self_approve: settings.allow_self_approve,
        }),
      });
      if (r.ok) { setSettings((await r.json()).settings); setSaved(true); }
    } finally { setSaving(false); }
  }

  async function addSuppression() {
    if (!newEmail.trim()) return;
    await fetch('/api/campaigns/suppressions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail.trim() }),
    });
    setNewEmail('');
    loadSuppressions();
  }
  async function removeSuppression(email: string) {
    await fetch(`/api/campaigns/suppressions?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    loadSuppressions();
  }

  if (loading || !settings) return <div className="flex justify-center py-20"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;

  const inputCls = 'w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]';

  return (
    <div className="max-w-3xl space-y-5">
      {/* Sending account */}
      <section className="glass-solid rounded-2xl border border-[var(--border)] p-5">
        <div className="flex items-center gap-2 mb-3"><Mail size={16} style={{ color: 'var(--accent)' }} /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Sending account</h3></div>
        {gmail.connected ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <div className="text-[var(--text-primary)] font-medium">{gmail.email}</div>
              <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1"><Check size={12} className="text-green-600" /> Connected — campaigns send from here.</div>
            </div>
            <a href="/api/campaigns/connect" className="btn-secondary text-xs">Reconnect</a>
          </div>
        ) : (
          <a href="/api/campaigns/connect" className="btn-primary text-sm">Connect Gmail</a>
        )}
        <div className="mt-4">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Reply-to address <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
          <input type="email" value={settings.reply_to ?? ''} onChange={e => set('reply_to', e.target.value || null)} placeholder="e.g. clients@yourfirm.co.uk" className={`mt-1 ${inputCls}`} />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">Replies go here instead of the sending mailbox. Leave blank to reply to the sender.</p>
        </div>
      </section>

      {/* Deliverability */}
      <DeliverabilityPanel />

      {/* Defaults */}
      <section className="glass-solid rounded-2xl border border-[var(--border)] p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Send defaults</h3>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={settings.include_unsubscribe} onChange={e => set('include_unsubscribe', e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <span className="text-sm text-[var(--text-primary)] font-medium">Add an unsubscribe link to every campaign</span>
            <span className="block text-xs text-[var(--text-secondary)]">Strongly recommended for good deliverability and compliance.</span>
          </span>
        </label>

        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Unsubscribe footer text</label>
          <input value={settings.unsubscribe_footer} onChange={e => set('unsubscribe_footer', e.target.value)} placeholder="You're receiving this because you're a client of our firm." className={`mt-1 ${inputCls}`} />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">Shown just above the unsubscribe link. Leave blank for the default wording.</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1 block">When several clients share one email address</label>
          <div className="space-y-1.5">
            {([['per_email', 'Send one email per address', 'The shared address receives a single copy.'], ['per_client', 'Send one email per client record', 'The shared address receives a copy for each client.']] as const).map(([val, label, desc]) => (
              <button key={val} onClick={() => set('default_dedupe', val)} className={`w-full text-left flex items-start gap-2 p-2.5 rounded-lg border ${settings.default_dedupe === val ? 'border-[var(--accent)] bg-[var(--accent-light)]/20' : 'border-[var(--border)]'}`}>
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${settings.default_dedupe === val ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>{settings.default_dedupe === val && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}</div>
                <span><span className="text-[13px] font-medium text-[var(--text-primary)]">{label}</span><span className="block text-[11px] text-[var(--text-secondary)]">{desc}</span></span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Frequency guard (days)</label>
          <input type="number" min={0} value={settings.frequency_guard_days} onChange={e => set('frequency_guard_days', Number(e.target.value) || 0)} className={`mt-1 ${inputCls} w-32`} />
          <p className="text-[11px] text-[var(--text-muted)] mt-1">0 = off. Clients emailed by any campaign within this many days are held back from the send — you’ll see them counted as “emailed too recently” in the audience preview.</p>
        </div>

      </section>

      {/* Approvals */}
      <section className="glass-solid rounded-2xl border border-[var(--border)] p-5 space-y-4">
        <div className="flex items-center gap-2"><ShieldCheck size={16} style={{ color: 'var(--accent)' }} /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Approvals</h3></div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={settings.require_approval} onChange={e => set('require_approval', e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <span className="text-sm text-[var(--text-primary)] font-medium">Campaigns must be approved before they send</span>
            <span className="block text-xs text-[var(--text-secondary)]">Authors submit for review; an approver signs off before anything goes out.</span>
          </span>
        </label>

        {settings.require_approval && (
          <div className="pl-6 space-y-3">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Only require approval from this many recipients</label>
              <input type="number" min={0} value={settings.approval_min_recipients} onChange={e => set('approval_min_recipients', Number(e.target.value) || 0)} className={`mt-1 ${inputCls} w-32`} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">0 = always require approval. Set e.g. 50 to let small, targeted sends go without review.</p>
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.allow_self_approve} onChange={e => set('allow_self_approve', e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
              <span>
                <span className="text-sm text-[var(--text-primary)] font-medium">Let authors approve their own campaigns</span>
                <span className="block text-xs text-[var(--text-secondary)]">Off (recommended): only an admin can approve.</span>
              </span>
            </label>
          </div>
        )}

        <p className="text-[11px] text-[var(--text-muted)]">
          Every submission, approval, change request and send is recorded on the campaign’s audit trail. Editing an
          approved campaign’s content or audience clears its approval, so it has to be reviewed again.
        </p>
      </section>

      {/* Save (covers sending, defaults and approvals) */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} Save settings</button>
        {saved && <span className="text-xs text-green-600 flex items-center gap-1"><Check size={12} /> Saved</span>}
      </div>

      {/* Suppression list */}
      <section className="glass-solid rounded-2xl border border-[var(--border)] p-5">
        <div className="flex items-center gap-2 mb-1"><UserMinus size={16} style={{ color: 'var(--accent)' }} /><h3 className="text-sm font-semibold text-[var(--text-primary)]">Unsubscribes &amp; do-not-contact</h3></div>
        <p className="text-xs text-[var(--text-secondary)] mb-3">
          These addresses are excluded from every campaign automatically. Unsubscribes land here; you can also add or
          remove addresses by hand.
        </p>

        <div className="flex gap-2 mb-3">
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="add an address to suppress…"
            onKeyDown={e => { if (e.key === 'Enter') addSuppression(); }} className={inputCls} />
          <button onClick={addSuppression} className="btn-secondary shrink-0"><Plus size={14} /> Add</button>
        </div>

        {suppressions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-3">
            <ShieldCheck size={15} className="text-green-600" /> No one has unsubscribed — your list is clean.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-black/5 rounded-lg border border-[var(--border)]">
            {suppressions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-[var(--text-primary)] truncate">{s.email}</span>
                <button onClick={() => removeSuppression(s.email)} className="p-1 text-[var(--text-muted)] hover:text-red-600" aria-label="Re-subscribe"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
