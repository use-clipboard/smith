'use client';

/**
 * Settings → Landlord — the approval email the client receives, the two
 * notifications sent back to the preparer, the chase reminder, and branding.
 * Deliberately mirrors Settings → MTD IT (same Section/TemplateEditor shape),
 * because the two tools run the same approval cycle and should not look like
 * they were built by different people. The one thing MTD IT has that this
 * doesn't is PDF-content toggles — the Landlord pack has no optional sections.
 *
 * Templates use {{handlebars}} variables, substituted at send time.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Loader2, AlertTriangle, Save, Info, BellRing, Mail, Palette, House,
  Image as ImageIcon, Upload, X, CheckCircle2, MessageSquareWarning,
} from 'lucide-react';

interface Settings {
  approval_email_subject: string;
  approval_email_body: string;
  preparer_approved_subject: string;
  preparer_approved_body: string;
  preparer_changes_subject: string;
  preparer_changes_body: string;
  reminder_enabled: boolean;
  reminder_days: number;
  reminder_max: number;
  reminder_subject: string;
  reminder_body: string;
  brand_primary_color: string;
  brand_logo_path: string | null;
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

export default function LandlordSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/landlord/firm-settings');
      if (!res.ok) throw new Error('Failed to load Landlord settings');
      const j = await res.json();
      setSettings(j.settings as Settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function save() {
    if (!settings) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      // The PUT schema is .strict(): firm_id / timestamps / brand_logo_path
      // (owned by the logo endpoint) would all trip a 400.
      const payload = {
        approval_email_subject:    settings.approval_email_subject,
        approval_email_body:       settings.approval_email_body,
        preparer_approved_subject: settings.preparer_approved_subject,
        preparer_approved_body:    settings.preparer_approved_body,
        preparer_changes_subject:  settings.preparer_changes_subject,
        preparer_changes_body:     settings.preparer_changes_body,
        reminder_enabled:          settings.reminder_enabled,
        reminder_days:             settings.reminder_days,
        reminder_max:              settings.reminder_max,
        reminder_subject:          settings.reminder_subject,
        reminder_body:             settings.reminder_body,
        brand_primary_color:       settings.brand_primary_color,
      };
      const res = await fetch('/api/landlord/firm-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to save');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(s => s ? { ...s, [key]: value } : s);
  }

  // ── Logo ────────────────────────────────────────────────────────────
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function loadLogo() {
    setLogoError(null);
    try {
      const res = await fetch('/api/landlord/firm-settings/logo');
      if (!res.ok) throw new Error('Failed to load logo');
      const j = await res.json();
      setLogoDataUrl(typeof j.logo === 'string' ? j.logo : null);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Failed to load logo');
    }
  }
  useEffect(() => { void loadLogo(); }, []);

  async function uploadLogo(file: File) {
    setLogoBusy(true); setLogoError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/landlord/firm-settings/logo', { method: 'POST', body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Upload failed');
      await loadLogo();
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  }

  async function removeLogo() {
    setLogoBusy(true); setLogoError(null);
    try {
      const res = await fetch('/api/landlord/firm-settings/logo', { method: 'DELETE' });
      if (!res.ok) throw new Error('Remove failed');
      setLogoDataUrl(null);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setLogoBusy(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        <Loader2 size={16} className="inline animate-spin mr-2" /> Loading Landlord settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <House size={17} className="text-[#D97706]" /> Landlord
        </h3>
        <p className="text-sm text-gray-500 mt-1">
          Email templates, branding and auto-reminder settings for the property income computations your clients approve.
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* ── Branding ──────────────────────────────────────────────── */}
      <Section
        icon={<Palette size={14} className="text-[var(--accent)]" />}
        title="Branding"
        hint="Header colour and logo used on the client approval email."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Primary colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={settings.brand_primary_color}
                onChange={e => patch('brand_primary_color', e.target.value)}
                className="w-12 h-9 rounded-lg border border-gray-200 cursor-pointer"
                aria-label="Brand primary colour"
              />
              <input
                type="text"
                value={settings.brand_primary_color}
                onChange={e => patch('brand_primary_color', e.target.value.trim())}
                placeholder="#8B85CF"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
            </div>
            <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
              <div className="px-3 py-2 text-xs font-semibold text-white" style={{ background: settings.brand_primary_color }}>
                Header preview
              </div>
              <div className="px-3 py-2 text-[11px] text-gray-500 bg-white">Used at the top of the client approval email.</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Logo (PNG, JPEG, or WebP — 2MB max)</label>
            <div className="rounded-lg border border-dashed border-gray-200 p-3 bg-gray-50/50 min-h-[120px] flex items-center justify-center">
              {logoDataUrl ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoDataUrl} alt="Landlord logo" className="max-h-16 max-w-full" />
                  <div className="flex gap-2 text-xs">
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                      <Upload size={11} /> Replace
                    </button>
                    <button type="button" onClick={() => void removeLogo()} disabled={logoBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
                      <X size={11} /> Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoBusy}
                  className="flex flex-col items-center gap-2 text-xs text-gray-500 hover:text-[var(--accent)]">
                  {logoBusy ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                  <span>{logoBusy ? 'Uploading…' : 'Upload a logo'}</span>
                </button>
              )}
            </div>
            <input
              ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }}
            />
            <p className="text-[11px] text-gray-500 mt-1.5">
              Leave this empty to use your firm-wide logo — most firms won&apos;t need a separate one here.
            </p>
            {logoError && <p className="text-[11px] text-red-600 mt-1 flex items-center gap-1"><AlertTriangle size={10} /> {logoError}</p>}
          </div>
        </div>
      </Section>

      {/* ── Approval request ──────────────────────────────────────── */}
      <Section
        icon={<Mail size={14} className="text-[var(--accent)]" />}
        title="Approval request (to the client)"
        hint="Sent with the property income computation attached as a PDF."
      >
        <TemplateEditor
          subjectLabel="Subject" subjectValue={settings.approval_email_subject}
          onSubjectChange={v => patch('approval_email_subject', v)}
          bodyLabel="Body" bodyValue={settings.approval_email_body}
          onBodyChange={v => patch('approval_email_body', v)}
        />
      </Section>

      {/* ── Auto-reminder ─────────────────────────────────────────── */}
      <Section
        icon={<BellRing size={14} className="text-purple-700" />}
        title="Auto-reminder"
        hint="Chases the client if they haven't responded after a while."
      >
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.reminder_enabled}
              onChange={e => patch('reminder_enabled', e.target.checked)}
              className="accent-[var(--accent)] w-3.5 h-3.5"
            />
            <span className="text-sm font-medium text-gray-700">Auto-send a reminder if the client hasn&apos;t responded</span>
          </label>

          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${!settings.reminder_enabled ? 'opacity-60' : ''}`}>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700">Days before first reminder</span>
              <input
                type="number" min={1} max={60}
                value={settings.reminder_days}
                disabled={!settings.reminder_enabled}
                onChange={e => patch('reminder_days', Math.max(1, Math.min(60, Number(e.target.value) || 7)))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700">Maximum reminders</span>
              <input
                type="number" min={1} max={5}
                value={settings.reminder_max}
                disabled={!settings.reminder_enabled}
                onChange={e => patch('reminder_max', Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
              />
            </label>
          </div>

          <div className={!settings.reminder_enabled ? 'opacity-60' : ''}>
            <TemplateEditor
              subjectLabel="Reminder subject" subjectValue={settings.reminder_subject}
              onSubjectChange={v => patch('reminder_subject', v)}
              bodyLabel="Reminder body" bodyValue={settings.reminder_body}
              onBodyChange={v => patch('reminder_body', v)}
              disabled={!settings.reminder_enabled}
            />
          </div>

          <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <Info size={12} className="shrink-0 mt-0.5" />
            <span>
              Reminders go from the same mailbox that sent the original, and never re-attach the PDF.
              Drafts that were never actually sent are never chased. To stop chasing one specific client —
              because they&apos;re signing a paper copy, say — use <strong>Chasing</strong> on that analysis&apos;s
              approval row rather than switching this off for the whole firm.
            </span>
          </div>
        </div>
      </Section>

      {/* ── Preparer notifications ────────────────────────────────── */}
      <Section
        icon={<CheckCircle2 size={14} className="text-emerald-600" />}
        title="When the client approves (to you)"
        hint="Sent to whoever pushed the approval out."
      >
        <TemplateEditor
          subjectLabel="Subject" subjectValue={settings.preparer_approved_subject}
          onSubjectChange={v => patch('preparer_approved_subject', v)}
          bodyLabel="Body" bodyValue={settings.preparer_approved_body}
          onBodyChange={v => patch('preparer_approved_body', v)}
        />
      </Section>

      <Section
        icon={<MessageSquareWarning size={14} className="text-amber-600" />}
        title="When the client requests changes (to you)"
        hint="Includes their note, so you know what to amend."
      >
        <TemplateEditor
          subjectLabel="Subject" subjectValue={settings.preparer_changes_subject}
          onSubjectChange={v => patch('preparer_changes_subject', v)}
          bodyLabel="Body" bodyValue={settings.preparer_changes_body}
          onBodyChange={v => patch('preparer_changes_body', v)}
        />
      </Section>

      {/* ── Variables ─────────────────────────────────────────────── */}
      <Section
        icon={<Info size={14} className="text-[var(--accent)]" />}
        title="Available variables"
        hint="Type these into any template above — they're filled in when the email is sent."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
          {VARIABLES.map(v => (
            <div key={v.key} className="flex items-baseline gap-2 text-xs">
              <code className="font-mono text-[var(--accent)] shrink-0">{`{{${v.key}}}`}</code>
              <span className="text-gray-500">{v.description}</span>
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button onClick={() => void save()} disabled={saving}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save changes
        </button>
        {saved && <span className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> Saved</span>}
      </div>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        {icon}
        <div>
          <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function TemplateEditor({
  subjectLabel, subjectValue, onSubjectChange,
  bodyLabel, bodyValue, onBodyChange, disabled,
}: {
  subjectLabel: string;
  subjectValue: string;
  onSubjectChange: (v: string) => void;
  bodyLabel: string;
  bodyValue: string;
  onBodyChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">{subjectLabel}</span>
        <input
          type="text"
          value={subjectValue}
          onChange={e => onSubjectChange(e.target.value)}
          disabled={disabled}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:bg-gray-50"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-medium text-gray-700">{bodyLabel}</span>
        <textarea
          value={bodyValue}
          onChange={e => onBodyChange(e.target.value)}
          rows={8}
          disabled={disabled}
          className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 font-mono text-[12px] disabled:bg-gray-50"
        />
      </label>
    </div>
  );
}
