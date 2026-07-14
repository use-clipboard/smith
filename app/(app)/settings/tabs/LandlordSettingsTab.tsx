'use client';

/**
 * Settings → Landlord — the approval email the client receives, plus the two
 * notifications sent back to the preparer. Mirrors Settings → MTD IT.
 * Templates use {{handlebars}} variables, substituted at send time.
 */

import { useEffect, useState } from 'react';
import { Loader2, Check, AlertTriangle, Building2 } from 'lucide-react';

interface Settings {
  approval_email_subject: string;
  approval_email_body: string;
  preparer_approved_subject: string;
  preparer_approved_body: string;
  preparer_changes_subject: string;
  preparer_changes_body: string;
  brand_primary_color: string;
}

const VARIABLES: Array<{ key: string; description: string }> = [
  { key: 'client_name',   description: "The client's name" },
  { key: 'client_code',   description: 'The client reference (e.g. K278)' },
  { key: 'person_name',   description: 'Who the email is addressed to — the individual on a per-person report, else the client' },
  { key: 'period_from',   description: 'Start of the period (dd-mm-yyyy)' },
  { key: 'period_to',     description: 'End of the period (dd-mm-yyyy)' },
  { key: 'firm_name',     description: 'Your firm name' },
  { key: 'preparer_name', description: 'Whoever sends the request' },
  { key: 'approval_link', description: 'The approve / request-changes link' },
  { key: 'approved_at',   description: 'When the client approved (preparer notification)' },
  { key: 'responded_at',  description: 'When the client responded (preparer notification)' },
  { key: 'changes_note',  description: "The client's change request (preparer notification)" },
];

/** Defined at module scope — nesting it in the component would remount the
 *  input on every keystroke and drop focus after one character. */
function Field({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-[var(--text-secondary)]">{label}</span>
      {rows
        ? <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows} className="mt-1 input-base w-full text-sm resize-y font-mono" />
        : <input type="text" value={value} onChange={e => onChange(e.target.value)} className="mt-1 input-base w-full text-sm" />}
    </label>
  );
}

export default function LandlordSettingsTab() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true); setError('');
      try {
        const r = await fetch('/api/landlord/firm-settings');
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? 'Could not load settings');
        setS(d.settings as Settings);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function save() {
    if (!s) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      // The GET returns the whole row; the PUT schema is strict, so send only
      // the editable fields — id/firm_id/timestamps would be rejected.
      const r = await fetch('/api/landlord/firm-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_email_subject:    s.approval_email_subject,
          approval_email_body:       s.approval_email_body,
          preparer_approved_subject: s.preparer_approved_subject,
          preparer_approved_body:    s.preparer_approved_body,
          preparer_changes_subject:  s.preparer_changes_subject,
          preparer_changes_body:     s.preparer_changes_body,
          brand_primary_color:       s.brand_primary_color,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not save');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS(prev => prev ? { ...prev, [k]: v } : prev);

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)] flex items-center gap-2 py-8"><Loader2 size={14} className="animate-spin" /> Loading…</div>;
  }
  if (!s) {
    return <div className="text-sm text-red-600 flex items-center gap-2 py-8"><AlertTriangle size={14} /> {error || 'Could not load settings'}</div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-lg bg-[var(--accent-light)] text-[var(--accent)] flex items-center justify-center shrink-0"><Building2 size={17} /></span>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Landlord</h2>
          <p className="text-sm text-[var(--text-muted)]">The email your client gets when you send a property income computation for approval, and what you get back when they respond.</p>
        </div>
      </div>

      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <section className="glass-solid rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Approval request (to the client)</h3>
        <Field label="Subject" value={s.approval_email_subject} onChange={v => set('approval_email_subject', v)} />
        <Field label="Body" value={s.approval_email_body} onChange={v => set('approval_email_body', v)} rows={10} />
        <label className="flex items-center gap-3">
          <span className="text-xs font-medium text-[var(--text-secondary)]">Header colour</span>
          <input type="color" value={s.brand_primary_color} onChange={e => set('brand_primary_color', e.target.value)} className="h-8 w-14 rounded border border-[var(--border-input)] bg-transparent" />
          <span className="text-xs text-[var(--text-muted)] font-mono">{s.brand_primary_color}</span>
        </label>
        <p className="text-[11px] text-[var(--text-muted)]">Your firm logo is taken from the firm branding, so the email and the PDF match.</p>
      </section>

      <section className="glass-solid rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">When the client approves (to you)</h3>
        <Field label="Subject" value={s.preparer_approved_subject} onChange={v => set('preparer_approved_subject', v)} />
        <Field label="Body" value={s.preparer_approved_body} onChange={v => set('preparer_approved_body', v)} rows={6} />
      </section>

      <section className="glass-solid rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">When the client requests changes (to you)</h3>
        <Field label="Subject" value={s.preparer_changes_subject} onChange={v => set('preparer_changes_subject', v)} />
        <Field label="Body" value={s.preparer_changes_body} onChange={v => set('preparer_changes_body', v)} rows={6} />
      </section>

      <section className="glass-solid rounded-xl p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Variables</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {VARIABLES.map(v => (
            <div key={v.key} className="flex items-baseline gap-2 text-xs">
              <code className="font-mono text-[var(--accent)] shrink-0">{`{{${v.key}}}`}</code>
              <span className="text-[var(--text-muted)]">{v.description}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save changes
        </button>
        {saved && <span className="text-sm text-emerald-600 flex items-center gap-1"><Check size={14} /> Saved</span>}
      </div>
    </div>
  );
}
