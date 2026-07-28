'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Loader2, AlertTriangle, Save, Info, BellRing, Mail, RotateCcw, Palette,
  Image as ImageIcon, FileText, Upload, X, Archive,
} from 'lucide-react';
import { TEMPLATE_VARIABLES } from '@/lib/mtdIt/emailTemplates';
import NotifyMembersPicker from '@/components/settings/NotifyMembersPicker';

interface Settings {
  approval_email_subject: string;
  approval_email_body:    string;
  preparer_approved_subject: string;
  preparer_approved_body:    string;
  preparer_changes_subject: string;
  preparer_changes_body:    string;
  reminder_enabled: boolean;
  reminder_days:    number;
  reminder_max:     number;
  reminder_subject: string;
  reminder_body:    string;
  brand_primary_color: string;
  brand_logo_path:     string | null;
  pdf_include_kpi_cards:            boolean;
  pdf_include_chart:                boolean;
  pdf_include_category_tables:      boolean;
  pdf_include_breakdown:            boolean;
  pdf_include_transaction_detail:   boolean;
  pdf_include_quarterly_comparison: boolean;
  auto_delete_source_on_complete: boolean;
  notify_user_ids: string[];
}

// Settings tab for the MTD IT tool. Admin-only — non-admins see the gated
// settings rail in SettingsClient. Renders three template editors (client
// approval request, preparer notifications x2, reminder) plus the
// auto-reminder schedule controls.
export default function MtdItSettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/mtd-it/firm-settings');
      if (!res.ok) throw new Error('Failed to load MTD IT settings');
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
      // Only ship the fields the PUT endpoint accepts. The schema is .strict()
      // so any extra key (firm_id, created_at, updated_at, brand_logo_path —
      // owned by the logo upload endpoint) trips a 400.
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
        pdf_include_kpi_cards:            settings.pdf_include_kpi_cards,
        pdf_include_chart:                settings.pdf_include_chart,
        pdf_include_category_tables:      settings.pdf_include_category_tables,
        pdf_include_breakdown:            settings.pdf_include_breakdown,
        pdf_include_transaction_detail:   settings.pdf_include_transaction_detail,
        pdf_include_quarterly_comparison: settings.pdf_include_quarterly_comparison,
        auto_delete_source_on_complete:   settings.auto_delete_source_on_complete,
        notify_user_ids:                  settings.notify_user_ids ?? [],
      };
      const res = await fetch('/api/mtd-it/firm-settings', {
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

  // ── Logo upload state ──────────────────────────────────────────────
  // The logo file lives in a private supabase bucket; we display the
  // current one as a data URL fetched from the same endpoint the PDF
  // builder uses.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  async function loadLogo() {
    setLogoError(null);
    try {
      const res = await fetch('/api/mtd-it/firm-settings/logo');
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
      const res = await fetch('/api/mtd-it/firm-settings/logo', { method: 'POST', body: form });
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
      const res = await fetch('/api/mtd-it/firm-settings/logo', { method: 'DELETE' });
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
        <Loader2 size={16} className="inline animate-spin mr-2" /> Loading MTD IT settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">MTD IT</h3>
        <p className="text-sm text-gray-500 mt-1">
          Email templates and auto-reminder settings for the Making Tax Digital for Income Tax tool.
        </p>
      </div>

      {/* ── Branding ──────────────────────────────────────────────── */}
      <Section
        icon={<Palette size={14} className="text-[var(--accent)]" />}
        title="Branding"
        hint="Header colour and logo used on the PDF report and the client approval email."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Colour picker */}
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
                onChange={e => {
                  const v = e.target.value.trim();
                  // Only commit when it's a valid #RRGGBB so the live preview stays valid
                  if (/^#[0-9a-fA-F]{6}$/.test(v)) patch('brand_primary_color', v);
                  else patch('brand_primary_color', v); // let user keep typing — backend re-validates on save
                }}
                placeholder="#8B85CF"
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg font-mono"
              />
            </div>
            {/* Preview swatch */}
            <div className="mt-3 rounded-lg overflow-hidden border border-gray-200">
              <div
                className="px-3 py-2 text-xs font-semibold text-white"
                style={{ background: settings.brand_primary_color }}
              >Header preview</div>
              <div className="px-3 py-2 text-[11px] text-gray-500 bg-white">Used at the top of the PDF cover page and the client email.</div>
            </div>
          </div>

          {/* Logo upload */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Logo (PNG, JPEG, or WebP — 2MB max)</label>
            <div className="rounded-lg border border-dashed border-gray-200 p-3 bg-gray-50/50 min-h-[120px] flex items-center justify-center">
              {logoDataUrl ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={logoDataUrl} alt="Firm logo" className="max-h-16 max-w-full" />
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={logoBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
                    ><Upload size={11} /> Replace</button>
                    <button
                      type="button"
                      onClick={() => void removeLogo()}
                      disabled={logoBusy}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                    ><X size={11} /> Remove</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={logoBusy}
                  className="flex flex-col items-center gap-2 text-xs text-gray-500 hover:text-[var(--accent)]"
                >
                  {logoBusy ? <Loader2 size={20} className="animate-spin" /> : <ImageIcon size={20} />}
                  <span>{logoBusy ? 'Uploading…' : 'Upload a logo'}</span>
                </button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }}
              />
            </div>
            {logoError && (
              <div className="mt-2 text-xs text-red-600 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {logoError}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── PDF content ───────────────────────────────────────────── */}
      <Section
        icon={<FileText size={14} className="text-[var(--accent)]" />}
        title="PDF content"
        hint="Pick which sections appear in the P&L PDF and the client approval pack. The cover page and per-stream tables are always included."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Toggle label="KPI cards (Income, Expense, Net)"          checked={settings.pdf_include_kpi_cards}            onChange={v => patch('pdf_include_kpi_cards', v)} />
          <Toggle label="Income vs expense bar chart"                checked={settings.pdf_include_chart}                onChange={v => patch('pdf_include_chart', v)} />
          <Toggle label="Per-category income & expense tables"       checked={settings.pdf_include_category_tables}      onChange={v => patch('pdf_include_category_tables', v)} />
          <Toggle label="Breakdown by trade / property"              checked={settings.pdf_include_breakdown}            onChange={v => patch('pdf_include_breakdown', v)} />
          <Toggle label="Transaction-level detail per category"      checked={settings.pdf_include_transaction_detail}   onChange={v => patch('pdf_include_transaction_detail', v)} />
          <Toggle label="Quarterly comparison table on cover page"   checked={settings.pdf_include_quarterly_comparison} onChange={v => patch('pdf_include_quarterly_comparison', v)} />
        </div>
      </Section>

      {/* ── Source documents ──────────────────────────────────────── */}
      <Section
        icon={<Archive size={14} className="text-[var(--accent)]" />}
        title="Source documents"
        hint="When SMITH cleans up the original receipts / statements stored in its private bucket. Drive / Vault copies (if you saved them) are never touched."
      >
        <div className="space-y-2">
          <Toggle
            label="Auto-delete when quarter is marked complete"
            checked={settings.auto_delete_source_on_complete}
            onChange={v => patch('auto_delete_source_on_complete', v)}
          />
          <p className="text-[11px] text-gray-500 -mt-1 ml-7">
            On by default. When you click <strong>Save &amp; complete</strong>, the Save to records modal opens with a clear warning so you can archive to Drive / Vault first; the source files are removed from SMITH&apos;s storage once you close the modal. Your firm is still responsible for HMRC&apos;s 5-year retention — archive before completing.
          </p>
        </div>
      </Section>

      {/* ── Notify team members ───────────────────────────────────── */}
      <Section
        icon={<BellRing size={14} className="text-[var(--accent)]" />}
        title="Notify team members"
        hint="When a client approves or requests changes, whoever sent it for approval is always notified. Tick anyone else who should also get the in-app notification and email."
      >
        <NotifyMembersPicker value={settings.notify_user_ids ?? []} onChange={ids => patch('notify_user_ids', ids)} />
      </Section>

      {/* Variables reference */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-2 mb-2">
          <Info size={14} className="text-blue-700 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-blue-900">Available variables</div>
            <p className="text-xs text-blue-800 mt-0.5">
              Drop these into any subject or body and they&apos;ll be filled in when the email is sent.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-3">
          {TEMPLATE_VARIABLES.map(v => (
            <div key={v.key} className="text-xs text-blue-900 flex items-baseline gap-2">
              <code className="bg-white/70 border border-blue-200 px-1.5 py-0.5 rounded font-mono text-[11px]">{`{{${v.key}}}`}</code>
              <span className="opacity-80">{v.description}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Client approval email */}
      <Section
        icon={<Mail size={14} className="text-[var(--accent)]" />}
        title="Client approval email"
        hint="Sent to the client when you click Send for approval. Their cover note (if any) appears above this body."
      >
        <TemplateEditor
          subjectLabel="Subject"
          subjectValue={settings.approval_email_subject}
          onSubjectChange={v => patch('approval_email_subject', v)}
          bodyLabel="Body"
          bodyValue={settings.approval_email_body}
          onBodyChange={v => patch('approval_email_body', v)}
        />
      </Section>

      {/* Preparer notification — approved */}
      <Section
        icon={<Mail size={14} className="text-green-700" />}
        title="Notification when client approves"
        hint="Sent to you when the client clicks Approve. Plain email — no buttons, no PDF."
      >
        <TemplateEditor
          subjectLabel="Subject"
          subjectValue={settings.preparer_approved_subject}
          onSubjectChange={v => patch('preparer_approved_subject', v)}
          bodyLabel="Body"
          bodyValue={settings.preparer_approved_body}
          onBodyChange={v => patch('preparer_approved_body', v)}
        />
      </Section>

      {/* Preparer notification — changes requested */}
      <Section
        icon={<Mail size={14} className="text-amber-700" />}
        title="Notification when client requests changes"
        hint="Sent to you when the client asks for changes. The {{changes_note}} variable holds the note they left."
      >
        <TemplateEditor
          subjectLabel="Subject"
          subjectValue={settings.preparer_changes_subject}
          onSubjectChange={v => patch('preparer_changes_subject', v)}
          bodyLabel="Body"
          bodyValue={settings.preparer_changes_body}
          onBodyChange={v => patch('preparer_changes_body', v)}
        />
      </Section>

      {/* Reminder settings */}
      <Section
        icon={<BellRing size={14} className="text-purple-700" />}
        title="Auto-reminder"
        hint="Re-sends the approval email if the client hasn't responded after a while."
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
                type="number"
                min={1} max={60}
                value={settings.reminder_days}
                disabled={!settings.reminder_enabled}
                onChange={e => patch('reminder_days', Math.max(1, Math.min(60, Number(e.target.value) || 7)))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-gray-700">Max reminders per approval</span>
              <input
                type="number"
                min={1} max={5}
                value={settings.reminder_max}
                disabled={!settings.reminder_enabled}
                onChange={e => patch('reminder_max', Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50"
              />
            </label>
          </div>

          <div className={!settings.reminder_enabled ? 'opacity-60' : ''}>
            <TemplateEditor
              subjectLabel="Reminder subject"
              subjectValue={settings.reminder_subject}
              onSubjectChange={v => patch('reminder_subject', v)}
              bodyLabel="Reminder body"
              bodyValue={settings.reminder_body}
              onBodyChange={v => patch('reminder_body', v)}
              disabled={!settings.reminder_enabled}
            />
          </div>
        </div>
      </Section>

      {/* Error inline */}
      {error && (
        <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
        </div>
      )}

      {/* Sticky save bar */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={() => { void load(); }}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50"
        ><RotateCcw size={14} /> Discard changes</button>
        {saved && (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full">
            Saved
          </span>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save settings
        </button>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="accent-[var(--accent)] w-3.5 h-3.5"
      />
      <span className="text-sm text-gray-700">{label}</span>
    </label>
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
  bodyLabel, bodyValue, onBodyChange,
  disabled,
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
