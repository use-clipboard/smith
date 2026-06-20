'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Briefcase, Package, SlidersHorizontal, AlertTriangle, Loader2, Plus, Trash2, Edit3, Check, X, Info,
  Palette, Image as ImageIcon, Upload, FileSignature, ClipboardList, GripVertical, ChevronDown, ChevronRight,
  Mail,
} from 'lucide-react';

interface Props {
  isAdmin: boolean;
  tasksModuleActive: boolean;
}

type Section = 'services' | 'packages' | 'branding' | 'onboarding' | 'email' | 'general';

interface Tier { id?: string; label: string; price: number; frequency: 'one_off' | 'monthly' | 'quarterly' | 'annual'; display_order?: number }
interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  fee_type: 'fixed' | 'tiered';
  base_price: number;
  frequency: 'one_off' | 'monthly' | 'quarterly' | 'annual';
  vat_treatment: 'firm_default' | 'inclusive' | 'exclusive' | 'exempt';
  display_order: number;
  active: boolean;
  tiers?: Tier[];
}
interface PackageItem { id?: string; service_id: string; tier_id?: string | null; custom_price?: number | null; display_order?: number }
interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  display_order: number;
  active: boolean;
  items?: PackageItem[];
}
interface ProposalSettings {
  default_vat_mode: 'inclusive' | 'exclusive';
  default_vat_rate: number;
  intro_template: string | null;
  terms_template: string | null;
  default_expiry_days: number | null;
  auto_graduate_client: boolean;
  auto_save_form_answers: boolean;
  auto_create_aml: boolean;
  auto_create_tasks: boolean;
  auto_tasks_template_id: string | null;
  auto_generate_loe: boolean;
  default_post_acceptance_action: 'none' | 'send_onboarding' | 'auto_create_client';
  collect_payment_on_accept: boolean;
  stripe_account_id: string | null;
  email_from_address: string | null;
  email_signature: string | null;
  proposal_email_sender_user_id: string | null;
  proposal_email_sender_connection_id: string | null;
  subject_proposal: string | null;
  subject_reminder: string | null;
  subject_onboarding: string | null;
  body_reminder: string | null;
  body_onboarding: string | null;
  // Branding
  brand_use_firm_logo: boolean;
  brand_logo_url: string | null;
  brand_header_image_url: string | null;
  brand_primary_color: string;
  brand_accent_color: string;
  brand_font_family: string;
  brand_footer_text: string | null;
  brand_show_firm_name: boolean;
}

export default function ProposalsSettingsTab({ isAdmin, tasksModuleActive }: Props) {
  const [section, setSection] = useState<Section>('services');

  return (
    <div className="space-y-5 max-w-5xl">
      {!isAdmin && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <div>Proposal settings are admin-only.</div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'services' as Section, label: 'Service catalogue', icon: Briefcase },
          { id: 'packages' as Section, label: 'Packages', icon: Package },
          { id: 'branding' as Section, label: 'Branding & look', icon: Palette },
          { id: 'onboarding' as Section, label: 'Onboarding forms', icon: ClipboardList },
          { id: 'email' as Section, label: 'Email', icon: Mail },
          { id: 'general' as Section, label: 'Defaults & onboarding', icon: SlidersHorizontal },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              section === id
                ? 'bg-[var(--accent)] text-white'
                : 'bg-white border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {section === 'services' && <ServicesSection isAdmin={isAdmin} />}
      {section === 'packages' && <PackagesSection isAdmin={isAdmin} />}
      {section === 'branding' && <BrandingSection isAdmin={isAdmin} />}
      {section === 'onboarding' && <OnboardingFormsSection isAdmin={isAdmin} />}
      {section === 'email' && <EmailSection isAdmin={isAdmin} />}
      {section === 'general' && <GeneralSection isAdmin={isAdmin} tasksModuleActive={tasksModuleActive} />}
    </div>
  );
}

// ── Branding section ─────────────────────────────────────────────────────
const FONT_OPTIONS: Array<{ id: string; label: string; css: string }> = [
  { id: 'system',  label: 'System UI (default)', css: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif' },
  { id: 'inter',   label: 'Inter',               css: 'Inter,-apple-system,sans-serif' },
  { id: 'serif',   label: 'Serif (Georgia)',     css: 'Georgia,"Times New Roman",serif' },
  { id: 'mono',    label: 'Monospace',           css: 'ui-monospace,SFMono-Regular,Menlo,monospace' },
  { id: 'rounded', label: 'Rounded',             css: '"Nunito",-apple-system,sans-serif' },
];

function fontCss(id: string): string {
  return FONT_OPTIONS.find(f => f.id === id)?.css ?? FONT_OPTIONS[0].css;
}

function BrandingSection({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<ProposalSettings | null>(null);
  const [firmLogoUrl, setFirmLogoUrl] = useState<string | null>(null);
  const [firmName, setFirmName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'header' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, meRes, brandRes] = await Promise.all([
      fetch('/api/proposals/settings').then(r => r.json()),
      fetch('/api/users/me').then(r => r.ok ? r.json() : null),
      fetch('/api/firm/branding').then(r => r.ok ? r.json() : null),
    ]);
    setSettings(sRes.settings ?? null);
    setFirmName(meRes?.firm_name ?? null);
    setFirmLogoUrl(brandRes?.logoUrl ?? null);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof ProposalSettings>(k: K, v: ProposalSettings[K]) {
    setSettings(s => s ? { ...s, [k]: v } : s);
  }

  async function uploadImage(kind: 'logo' | 'header', file: File) {
    setUploading(kind);
    try {
      const base64 = await fileToBase64(file);
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const res = await fetch('/api/proposals/branding/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, base64, mimeType: file.type, ext }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed');
      if (kind === 'logo') update('brand_logo_url', data.url);
      else update('brand_header_image_url', data.url);
      // Persist immediately so a quick preview reload picks it up
      await fetch('/api/proposals/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'logo' ? { brand_logo_url: data.url } : { brand_header_image_url: data.url }),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Upload failed');
    } finally { setUploading(null); }
  }

  async function save() {
    if (!isAdmin || !settings) return;
    setSaving(true);
    try {
      await fetch('/api/proposals/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_use_firm_logo: settings.brand_use_firm_logo,
          brand_logo_url: settings.brand_logo_url,
          brand_header_image_url: settings.brand_header_image_url,
          brand_primary_color: settings.brand_primary_color,
          brand_accent_color: settings.brand_accent_color,
          brand_font_family: settings.brand_font_family,
          brand_footer_text: settings.brand_footer_text,
          brand_show_firm_name: settings.brand_show_firm_name,
        }),
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (loading || !settings) return <Loader />;

  const resolvedLogo = settings.brand_use_firm_logo
    ? (firmLogoUrl ?? settings.brand_logo_url)
    : settings.brand_logo_url;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {/* ── Form ── */}
      <div className="space-y-4">
        <Card title="Logo">
          <Toggle label="Use the firm logo (Settings → Account)" value={settings.brand_use_firm_logo} onChange={v => update('brand_use_firm_logo', v)} />
          {!settings.brand_use_firm_logo && (
            <>
              <Field label="Override logo URL or upload one">
                <input value={settings.brand_logo_url ?? ''} onChange={e => update('brand_logo_url', e.target.value || null)} placeholder="https://… or upload below" className="input-base text-sm w-full" />
              </Field>
              <FileButton accept="image/*" disabled={!isAdmin || uploading !== null} onPick={f => void uploadImage('logo', f)} busy={uploading === 'logo'}>
                Upload logo
              </FileButton>
            </>
          )}
          <Toggle label="Show firm name in the header" value={settings.brand_show_firm_name} onChange={v => update('brand_show_firm_name', v)} />
        </Card>

        <Card title="Banner image (optional)">
          <p className="text-[11px] text-[var(--text-muted)] -mt-1 mb-2">Adds a wide cover image at the very top of the proposal page. Leave empty to omit.</p>
          <Field label="Image URL">
            <input value={settings.brand_header_image_url ?? ''} onChange={e => update('brand_header_image_url', e.target.value || null)} placeholder="https://…" className="input-base text-sm w-full" />
          </Field>
          <div className="flex gap-2">
            <FileButton accept="image/*" disabled={!isAdmin || uploading !== null} onPick={f => void uploadImage('header', f)} busy={uploading === 'header'}>
              Upload banner
            </FileButton>
            {settings.brand_header_image_url && (
              <button onClick={() => update('brand_header_image_url', null)} className="btn-secondary text-xs inline-flex items-center gap-1 text-red-700"><Trash2 size={11} />Remove banner</button>
            )}
          </div>
        </Card>

        <Card title="Colours">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary (header / buttons)">
              <ColorPicker value={settings.brand_primary_color} onChange={v => update('brand_primary_color', v)} />
            </Field>
            <Field label="Accent (links / hover)">
              <ColorPicker value={settings.brand_accent_color} onChange={v => update('brand_accent_color', v)} />
            </Field>
          </div>
        </Card>

        <Card title="Font">
          <Field label="Font family">
            <select value={settings.brand_font_family} onChange={e => update('brand_font_family', e.target.value)} className="input-base text-sm w-full">
              {FONT_OPTIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Field>
          <p className="text-[11px] text-[var(--text-muted)] -mt-1">Affects only the public-facing proposal page.</p>
        </Card>

        <Card title="Footer">
          <Field label="Footer text (shown at the bottom of the proposal page)">
            <textarea value={settings.brand_footer_text ?? ''} onChange={e => update('brand_footer_text', e.target.value || null)} rows={2} className="input-base text-sm w-full" placeholder="© Your Firm Ltd · Registered office: …" />
          </Field>
        </Card>

        {isAdmin && (
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} />Saved</span>}
            <button onClick={() => void save()} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Check size={13} className="inline mr-1" />}Save branding
            </button>
          </div>
        )}
      </div>

      {/* ── Live preview ── */}
      <div className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)] flex items-center gap-1.5"><FileSignature size={11} />Live preview</p>
        <BrandPreview
          logoUrl={resolvedLogo}
          headerImageUrl={settings.brand_header_image_url}
          primary={settings.brand_primary_color}
          accent={settings.brand_accent_color}
          fontFamily={fontCss(settings.brand_font_family)}
          footer={settings.brand_footer_text}
          showFirmName={settings.brand_show_firm_name}
          firmName={firmName}
        />
      </div>
    </div>
  );
}

function BrandPreview({ logoUrl, headerImageUrl, primary, accent, fontFamily, footer, showFirmName, firmName }: {
  logoUrl: string | null;
  headerImageUrl: string | null;
  primary: string;
  accent: string;
  fontFamily: string;
  footer: string | null;
  showFirmName: boolean;
  firmName: string | null;
}) {
  return (
    <div className="sticky top-2 border border-[var(--border)] rounded-xl overflow-hidden bg-gray-50">
      <div className="bg-white text-[11px] text-[var(--text-muted)] px-3 py-1.5 border-b border-gray-100">Preview — public proposal page</div>
      <div style={{ fontFamily, background: '#f9fafb', padding: 16 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #e5e7eb' }}>
          {headerImageUrl && (
            <div style={{ height: 80, backgroundImage: `url(${headerImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          )}
          <div style={{ background: primary, color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            {logoUrl && <img src={logoUrl} alt="" style={{ height: 28, width: 'auto', background: '#fff', padding: 2, borderRadius: 4 }} />}
            <div>
              {showFirmName && <p style={{ fontSize: 11, opacity: 0.85, margin: 0 }}>{firmName ?? 'Your Firm'}</p>}
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: '2px 0 0' }}>Proposal — Q2 bookkeeping</h2>
            </div>
          </div>
          <div style={{ padding: 16, fontSize: 12, color: '#374151' }}>
            <p style={{ margin: '0 0 10px' }}>Hi Sample Prospect,</p>
            <p style={{ margin: '0 0 12px' }}>Thanks for the chat last week. Here's the proposal we discussed — pick a package below.</p>
            <div style={{ border: `2px solid ${primary}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Silver package</p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280' }}>Monthly bookkeeping + VAT returns</p>
              <p style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 700, color: primary }}>£295 / month</p>
            </div>
            <p style={{ margin: '12px 0 6px', fontSize: 11, color: '#6b7280' }}>By typing your name below you accept this proposal.</p>
            <button style={{ background: primary, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontWeight: 600, fontSize: 12 }}>Accept proposal</button>
            <a style={{ display: 'inline-block', marginLeft: 8, color: accent, fontSize: 12 }}>Decline</a>
          </div>
          {footer && (
            <div style={{ padding: '10px 20px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', fontSize: 10, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)} className="h-9 w-12 rounded border border-[var(--border)] cursor-pointer" />
      <input type="text" value={value} onChange={e => onChange(e.target.value)} className="input-base text-sm font-mono w-28" />
    </div>
  );
}

function FileButton({ accept, disabled, onPick, busy, children }: {
  accept: string;
  disabled?: boolean;
  onPick: (file: File) => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`btn-secondary text-xs inline-flex items-center gap-1.5 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
      {busy ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
      {children}
      <input type="file" accept={accept} disabled={disabled} className="hidden" onChange={e => {
        const f = e.target.files?.[0];
        if (f) onPick(f);
        e.currentTarget.value = '';
      }} />
    </label>
  );
}

// ── Proposal sender picker (Gmail account that signs proposal emails) ──
interface ProposalGmailConnection { id: string; google_email: string; display_name: string | null; connected_by: string | null }

function ProposalSenderPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [connections, setConnections] = useState<ProposalGmailConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<'connected' | 'cancelled' | 'error' | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/proposals/settings/email-senders')
      .then(r => r.ok ? r.json() : { connections: [] })
      .then(d => setConnections(d.connections ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const url = new URL(window.location.href);
    const status = url.searchParams.get('email');
    if (status === 'connected' || status === 'cancelled' || status === 'error') {
      setBanner(status as 'connected' | 'cancelled' | 'error');
      url.searchParams.delete('email');
      window.history.replaceState(null, '', url.toString());
    }
  }, [load]);

  function connectGmail() {
    window.location.href = '/api/proposals/gmail/connect';
  }

  async function disconnect(id: string) {
    if (!confirm('Disconnect this Gmail account from proposals?')) return;
    await fetch(`/api/proposals/settings/email-senders?id=${id}`, { method: 'DELETE' });
    if (value === id) onChange(null);
    load();
  }

  return (
    <Field label="Send proposal emails from a linked Gmail account">
      {banner === 'connected' && (
        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 mb-2 inline-flex items-center gap-1.5"><Check size={11} />Gmail connected. Pick it from the dropdown below.</div>
      )}
      {banner === 'cancelled' && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2 inline-flex items-center gap-1.5"><AlertTriangle size={11} />Gmail connection was cancelled.</div>
      )}
      {banner === 'error' && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-2 inline-flex items-center gap-1.5"><AlertTriangle size={11} />Gmail connection failed. Try again — Google needs prompt=consent so a refresh token is returned.</div>
      )}
      {loading ? (
        <span className="text-xs text-[var(--text-muted)]"><Loader2 size={11} className="animate-spin inline mr-1" />Looking up linked Gmail accounts…</span>
      ) : (
        <>
          {connections.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic mb-2">No Gmail account linked for proposals yet. This is independent of Email Triage — you can use a different mailbox (e.g. a shared <code className="bg-gray-100 px-1 rounded">hello@firm.co.uk</code>) for proposals.</p>
          ) : (
            <>
              <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className="input-base text-sm w-full">
                <option value="">— Use Resend fallback —</option>
                {connections.map(c => <option key={c.id} value={c.id}>{c.google_email}{c.connected_by ? ` · connected by ${c.connected_by}` : ''}</option>)}
              </select>
              <ul className="mt-2 space-y-1 text-xs">
                {connections.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-2 text-[var(--text-muted)]">
                    <span>{c.google_email}{c.connected_by ? ` · ${c.connected_by}` : ''}</span>
                    <button type="button" onClick={() => void disconnect(c.id)} className="text-red-600 hover:underline">Disconnect</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <button type="button" onClick={connectGmail} className="btn-secondary text-xs inline-flex items-center gap-1.5">
              <Mail size={11} />{connections.length === 0 ? 'Connect a Gmail account' : 'Connect another Gmail account'}
            </button>
            <p className="text-[11px] text-[var(--text-muted)]">Sign in with the email address you want proposals to come from. Replies land in that inbox. Falls back to Resend if Google access lapses.</p>
          </div>
        </>
      )}
    </Field>
  );
}

// ── Email preview + test panel ─────────────────────────────────────────
function EmailPreviewTestPanel() {
  const [previewKind, setPreviewKind] = useState<'proposal' | 'reminder' | 'onboarding' | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; previewUrl?: string } | null>(null);

  async function openPreview(kind: 'proposal' | 'reminder' | 'onboarding') {
    setPreviewKind(kind);
    setLoadingPreview(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/proposals/settings/email-preview?kind=${kind}`);
      const data = await res.json();
      if (res.ok) setPreview({ subject: data.subject, html: data.html });
    } finally { setLoadingPreview(false); }
  }

  async function sendTest() {
    if (!testEmail.trim()) return;
    setTestSending(true); setTestResult(null);
    try {
      const res = await fetch('/api/proposals/settings/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: `Sent to ${testEmail}. Open your inbox.`, previewUrl: data.previewUrl });
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Send failed' });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Send failed' });
    } finally { setTestSending(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Preview & test</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void openPreview('proposal')} className="btn-secondary text-xs">Preview proposal email</button>
        <button type="button" onClick={() => void openPreview('reminder')} className="btn-secondary text-xs">Preview reminder</button>
        <button type="button" onClick={() => void openPreview('onboarding')} className="btn-secondary text-xs">Preview onboarding</button>
        <button type="button" onClick={() => setTestOpen(o => !o)} className="btn-secondary text-xs inline-flex items-center gap-1"><Mail size={11} />Send test email…</button>
      </div>
      {testOpen && (
        <div className="border border-[var(--border)] rounded-lg p-3 bg-gray-50/50 space-y-2">
          <div className="flex items-center gap-2">
            <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your.email@example.com" className="input-base text-sm flex-1" />
            <button type="button" onClick={() => void sendTest()} disabled={testSending || !testEmail.trim()} className="btn-primary text-xs">
              {testSending ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}Send
            </button>
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">A real proposal email is sent via your configured Gmail or Resend fallback. The recipient gets a link to a fully-branded sample proposal.</p>
          {testResult && (
            <div className={`text-xs px-2 py-1.5 rounded ${testResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
              {testResult.ok ? <Check size={11} className="inline mr-1" /> : <AlertTriangle size={11} className="inline mr-1" />}
              {testResult.message}
              {testResult.previewUrl && (
                <> · <a href={testResult.previewUrl} target="_blank" rel="noopener noreferrer" className="underline">Open sample proposal</a></>
              )}
            </div>
          )}
        </div>
      )}
      {previewKind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewKind(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold">Preview · {previewKind} email</h3>
              <button onClick={() => setPreviewKind(null)} className="p-1.5 rounded hover:bg-[var(--bg-nav-hover)]"><X size={14} /></button>
            </div>
            <div className="px-5 py-3 border-b border-gray-100 text-xs">
              <span className="font-semibold text-[var(--text-muted)]">Subject:</span> {loadingPreview ? '…' : preview?.subject}
            </div>
            <div className="flex-1 overflow-auto bg-gray-50 p-4">
              {loadingPreview || !preview ? (
                <p className="text-sm text-[var(--text-muted)]"><Loader2 size={12} className="animate-spin inline mr-1" />Rendering…</p>
              ) : (
                <iframe sandbox="" srcDoc={preview.html} className="w-full h-[60vh] rounded-lg bg-white border border-gray-200" title="Email preview" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Task template picker (used in the General section) ─────────────────
interface TaskTemplate { id: string; name: string; description: string | null }

function TaskTemplatePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/tasks/templates')
      .then(r => r.ok ? r.json() : { templates: [] })
      .then(d => setTemplates(d.templates ?? d ?? []))
      .finally(() => setLoading(false));
  }, []);
  return (
    <Field label="Template to instantiate">
      {loading ? (
        <span className="text-xs text-[var(--text-muted)]"><Loader2 size={11} className="animate-spin inline mr-1" />Loading templates…</span>
      ) : templates.length === 0 ? (
        <span className="text-xs text-[var(--text-muted)] italic">No task templates yet — create one in the Tasks tool first.</span>
      ) : (
        <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} className="input-base text-sm w-full">
          <option value="">— Pick a template —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
    </Field>
  );
}

// ── Onboarding forms (builder) ──────────────────────────────────────────
interface FormFieldDraft {
  id?: string;
  field_key: string;
  label: string;
  field_type: 'text'|'textarea'|'email'|'phone'|'date'|'number'|'select'|'checkbox'|'radio'|'file'|'section_header'|'info';
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: Array<{ label: string; value: string }> | null;
  show_if_field_key: string | null;
  show_if_value: string | null;
  client_field_mapping: string | null;
  display_order: number;
}
interface OnboardingForm {
  id: string;
  name: string;
  description: string | null;
  client_type: string | null;
  service_filter: string[] | null;
  is_default: boolean;
  active: boolean;
  fields: FormFieldDraft[];
}

const CLIENT_FIELD_OPTIONS = [
  { value: '',                              label: '— Not mapped —' },
  { value: 'name',                           label: 'clients.name' },
  { value: 'client_ref',                     label: 'clients.client_ref' },
  { value: 'business_type',                  label: 'clients.business_type' },
  { value: 'contact_email',                  label: 'clients.contact_email' },
  { value: 'contact_number',                 label: 'clients.contact_number' },
  { value: 'paye_reference',                 label: 'clients.paye_reference' },
  { value: 'paye_accounts_office_reference', label: 'clients.paye_accounts_office_reference' },
  { value: 'vat_submit_type',                label: 'clients.vat_submit_type' },
  { value: 'vat_scheme',                     label: 'clients.vat_scheme' },
  { value: 'year_end',                       label: 'clients.year_end' },
  { value: 'mtd_it',                         label: 'clients.mtd_it' },
];

function OnboardingFormsSection({ isAdmin }: { isAdmin: boolean }) {
  const [forms, setForms] = useState<OnboardingForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OnboardingForm | 'new' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/proposals/onboarding-forms');
    setForms((await res.json()).forms ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function remove(f: OnboardingForm) {
    if (!confirm(`Delete the form "${f.name}"? Any submitted responses will keep their data but be unlinked.`)) return;
    await fetch(`/api/proposals/onboarding-forms/${f.id}`, { method: 'DELETE' });
    void load();
  }

  if (editing) {
    return (
      <OnboardingFormEditor
        initial={editing === 'new' ? null : editing}
        isAdmin={isAdmin}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); }}
      />
    );
  }

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-xs text-[var(--accent)]">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>When a prospect accepts a proposal, they get an email with a link to whichever onboarding form best matches them. Forms can target a client type, a specific service, or be a firm-wide default. Each field can be mapped to a column on the <strong>clients</strong> record so the answer is saved automatically when the prospect submits.</p>
      </div>
      {loading ? <Loader /> : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {forms.length === 0 && <p className="text-xs text-[var(--text-muted)] italic px-4 py-6 text-center">No onboarding forms yet.</p>}
          {forms.map(f => (
            <div key={f.id} className="px-4 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{f.name} {f.is_default && <span className="ml-1 text-[10px] uppercase text-[var(--accent)]">default</span>} {!f.active && <span className="ml-1 text-[10px] uppercase text-[var(--text-muted)]">inactive</span>}</p>
                {f.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{f.description}</p>}
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {(f.fields ?? []).length} field{(f.fields ?? []).length === 1 ? '' : 's'}
                  {f.client_type ? ` · for ${f.client_type.replace('_', ' ')}` : ''}
                  {f.service_filter && f.service_filter.length > 0 ? ` · scoped to ${f.service_filter.length} service${f.service_filter.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing(f)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                  <button onClick={() => void remove(f)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {isAdmin && (
        <button onClick={() => setEditing('new')} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Plus size={13} />Add a form</button>
      )}
    </div>
  );
}

function OnboardingFormEditor({ initial, isAdmin, onCancel, onSaved }: {
  initial: OnboardingForm | null;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<OnboardingForm>(() => initial ?? {
    id: '', name: '', description: null, client_type: null, service_filter: null,
    is_default: false, active: true, fields: [],
  });
  const [services, setServices] = useState<Service[]>([]);
  const [saving, setSaving] = useState(false);
  const [openFieldId, setOpenFieldId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/proposals/services').then(r => r.json()).then(d => setServices(d.services ?? []));
  }, []);

  function update<K extends keyof OnboardingForm>(k: K, v: OnboardingForm[K]) {
    setForm(s => ({ ...s, [k]: v }));
  }
  function addField() {
    const newField: FormFieldDraft = {
      field_key: `field_${form.fields.length + 1}`, label: '', field_type: 'text', required: false,
      placeholder: null, help_text: null, options: null, show_if_field_key: null, show_if_value: null,
      client_field_mapping: null, display_order: form.fields.length,
    };
    update('fields', [...form.fields, newField]);
    setOpenFieldId(newField.field_key);
  }
  function updateField(idx: number, patch: Partial<FormFieldDraft>) {
    const next = [...form.fields];
    next[idx] = { ...next[idx], ...patch };
    update('fields', next);
  }
  function removeField(idx: number) {
    update('fields', form.fields.filter((_, i) => i !== idx));
  }
  function moveField(idx: number, delta: number) {
    const next = [...form.fields];
    const j = idx + delta;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    next.forEach((f, i) => f.display_order = i);
    update('fields', next);
  }

  async function save() {
    if (!isAdmin) return;
    if (!form.name.trim()) return alert('Form name is required.');
    if (form.fields.some(f => !f.field_key.trim() || !/^[a-z0-9_]+$/.test(f.field_key))) {
      return alert('Every field needs a key using lowercase letters, numbers, and underscores only.');
    }
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        client_type: form.client_type,
        service_filter: form.service_filter,
        is_default: form.is_default,
        active: form.active,
        fields: form.fields.map((f, i) => ({ ...f, display_order: i })),
      };
      if (initial?.id) {
        await fetch(`/api/proposals/onboarding-forms/${initial.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/proposals/onboarding-forms', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={onCancel} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline">← Back to forms list</button>

      <Card title={initial ? 'Edit form' : 'New onboarding form'}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Form name *"><input value={form.name} onChange={e => update('name', e.target.value)} className="input-base text-sm w-full" placeholder="Limited company onboarding" /></Field>
          <Field label="Apply to client type">
            <select value={form.client_type ?? ''} onChange={e => update('client_type', e.target.value || null)} className="input-base text-sm w-full">
              <option value="">Any client type</option>
              <option value="sole_trader">Sole trader</option>
              <option value="limited_company">Limited company</option>
              <option value="llp">LLP</option>
              <option value="partnership">Partnership</option>
              <option value="charity">Charity</option>
              <option value="trust">Trust</option>
              <option value="individual">Individual</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>
        <Field label="Description (internal)"><textarea value={form.description ?? ''} onChange={e => update('description', e.target.value || null)} rows={2} className="input-base text-sm w-full" /></Field>
        <Field label="Only show when the proposal includes one of these services (optional)">
          <div className="flex flex-wrap gap-1.5">
            {services.map(s => {
              const checked = (form.service_filter ?? []).includes(s.id);
              return (
                <label key={s.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full border ${checked ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)]'} cursor-pointer`}>
                  <input type="checkbox" checked={checked} onChange={e => {
                    const next = e.target.checked
                      ? [...(form.service_filter ?? []), s.id]
                      : (form.service_filter ?? []).filter(id => id !== s.id);
                    update('service_filter', next.length > 0 ? next : null);
                  }} className="hidden" />
                  {s.name}
                </label>
              );
            })}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Toggle label="Use as the firm's default form" value={form.is_default} onChange={v => update('is_default', v)} />
          <Toggle label="Active" value={form.active} onChange={v => update('active', v)} />
        </div>
      </Card>

      <Card title="Fields">
        <p className="text-[11px] text-[var(--text-muted)] -mt-1">Build up the form one field at a time. Map any field to a clients column to save the answer automatically.</p>
        {form.fields.length === 0 && <p className="text-xs text-[var(--text-muted)] italic">No fields yet.</p>}
        <div className="space-y-2">
          {form.fields.map((f, i) => {
            const isOpen = openFieldId === f.field_key;
            return (
              <div key={i} className="border border-[var(--border)] rounded-lg">
                <div className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50">
                  <button onClick={() => moveField(i, -1)} disabled={i === 0} aria-label="Move up" className="text-gray-400 hover:text-gray-700 disabled:opacity-30"><GripVertical size={12} /></button>
                  <button onClick={() => setOpenFieldId(isOpen ? null : f.field_key)} className="flex-1 flex items-center gap-2 text-left text-sm">
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    <span className="font-medium">{f.label || <span className="italic text-[var(--text-muted)]">Untitled field</span>}</span>
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">{f.field_type}</span>
                    {f.required && <span className="text-[10px] text-red-600">*required</span>}
                  </button>
                  <button onClick={() => removeField(i)} className="p-1 rounded text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100 bg-gray-50/40">
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Label *"><input value={f.label} onChange={e => updateField(i, { label: e.target.value })} className="input-base text-sm w-full" /></Field>
                      <Field label="Field key *">
                        <input value={f.field_key} onChange={e => updateField(i, { field_key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} className="input-base text-sm w-full font-mono" />
                      </Field>
                      <Field label="Type">
                        <select value={f.field_type} onChange={e => updateField(i, { field_type: e.target.value as FormFieldDraft['field_type'] })} className="input-base text-sm w-full">
                          <option value="text">Single-line text</option>
                          <option value="textarea">Paragraph</option>
                          <option value="email">Email</option>
                          <option value="phone">Phone</option>
                          <option value="date">Date</option>
                          <option value="number">Number</option>
                          <option value="select">Dropdown</option>
                          <option value="radio">Radio buttons</option>
                          <option value="checkbox">Checkbox (yes/no)</option>
                          <option value="file">File upload</option>
                          <option value="section_header">Section header</option>
                          <option value="info">Info block (no input)</option>
                        </select>
                      </Field>
                      <Field label="Save to clients column">
                        <select value={f.client_field_mapping ?? ''} onChange={e => updateField(i, { client_field_mapping: e.target.value || null })} className="input-base text-sm w-full">
                          {CLIENT_FIELD_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                      </Field>
                    </div>
                    <Field label="Placeholder"><input value={f.placeholder ?? ''} onChange={e => updateField(i, { placeholder: e.target.value || null })} className="input-base text-sm w-full" /></Field>
                    <Field label="Help text"><input value={f.help_text ?? ''} onChange={e => updateField(i, { help_text: e.target.value || null })} className="input-base text-sm w-full" /></Field>
                    {(f.field_type === 'select' || f.field_type === 'radio') && (
                      <Field label="Options (one per line, format: Label|value)">
                        <textarea
                          value={(f.options ?? []).map(o => o.label === o.value ? o.label : `${o.label}|${o.value}`).join('\n')}
                          onChange={e => {
                            const lines = e.target.value.split('\n').filter(Boolean);
                            const opts = lines.map(l => { const [lbl, val] = l.split('|'); return { label: lbl.trim(), value: (val ?? lbl).trim() }; });
                            updateField(i, { options: opts.length > 0 ? opts : null });
                          }}
                          rows={3}
                          className="input-base text-sm w-full"
                          placeholder="Yes|yes&#10;No|no"
                        />
                      </Field>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Show only if field…">
                        <select value={f.show_if_field_key ?? ''} onChange={e => updateField(i, { show_if_field_key: e.target.value || null })} className="input-base text-sm w-full">
                          <option value="">— always show —</option>
                          {form.fields.filter((_, j) => j !== i).map(other => <option key={other.field_key} value={other.field_key}>{other.label || other.field_key}</option>)}
                        </select>
                      </Field>
                      <Field label="… equals this value">
                        <input value={f.show_if_value ?? ''} onChange={e => updateField(i, { show_if_value: e.target.value || null })} className="input-base text-sm w-full" disabled={!f.show_if_field_key} />
                      </Field>
                    </div>
                    <label className="inline-flex items-center gap-2 text-xs"><input type="checkbox" checked={f.required} onChange={e => updateField(i, { required: e.target.checked })} />Required</label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button onClick={addField} className="btn-secondary text-sm inline-flex items-center gap-1.5 mt-2"><Plus size={13} />Add field</button>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button onClick={() => void save()} disabled={saving || !isAdmin} className="btn-primary text-sm">
          {saving ? <Loader2 size={12} className="animate-spin inline mr-1" /> : <Check size={12} className="inline mr-1" />}Save form
        </button>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // data URL prefix → strip it
      const comma = result.indexOf(',');
      resolve(comma > -1 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ── Services ──────────────────────────────────────────────────────────────
function ServicesSection({ isAdmin }: { isAdmin: boolean }) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/proposals/services');
    setServices((await res.json()).services ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-xs text-[var(--accent)]">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>The service catalogue is the firm-wide library of services you can pull into a proposal. Use <strong>Fixed</strong> for a single flat price, or <strong>Tiered</strong> when the price depends on volume (e.g. bookkeeping bands).</p>
      </div>
      {loading ? <Loader /> : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {services.length === 0 && <p className="text-xs text-[var(--text-muted)] italic px-4 py-6 text-center">No services in the catalogue yet.</p>}
          {services.map(svc => (
            editingId === svc.id ? (
              <ServiceForm
                key={svc.id}
                initial={svc}
                isAdmin={isAdmin}
                onCancel={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); void load(); }}
              />
            ) : (
              <div key={svc.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{svc.name} {!svc.active && <span className="text-[10px] uppercase ml-1 text-[var(--text-muted)]">inactive</span>}</p>
                  {svc.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{svc.description}</p>}
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    {svc.fee_type === 'tiered'
                      ? `Tiered (${(svc.tiers ?? []).length} tier${(svc.tiers ?? []).length === 1 ? '' : 's'})`
                      : `£${Number(svc.base_price).toFixed(2)} / ${frequencyLabel(svc.frequency)}`}
                    {svc.vat_treatment !== 'firm_default' && ` · VAT ${svc.vat_treatment}`}
                    {svc.category && ` · ${svc.category}`}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditingId(svc.id)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                    <button onClick={() => void deleteService(svc.id, load)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
      {isAdmin && !adding && (
        <button onClick={() => setAdding(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Plus size={13} />Add service</button>
      )}
      {isAdmin && adding && (
        <ServiceForm
          isAdmin={isAdmin}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load(); }}
        />
      )}
    </div>
  );
}

async function deleteService(id: string, reload: () => void) {
  if (!confirm('Delete this service from the catalogue?')) return;
  await fetch(`/api/proposals/services/${id}`, { method: 'DELETE' });
  reload();
}

function ServiceForm({ initial, isAdmin, onCancel, onSaved }: {
  initial?: Service;
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Service>(() => initial ?? {
    id: '', name: '', description: null, category: null,
    fee_type: 'fixed', base_price: 0, frequency: 'monthly',
    vat_treatment: 'firm_default', display_order: 0, active: true, tiers: [],
  });
  const [saving, setSaving] = useState(false);

  function update<K extends keyof Service>(k: K, v: Service[K]) { setForm(s => ({ ...s, [k]: v })); }
  function addTier() {
    update('tiers', [...(form.tiers ?? []), { label: '', price: 0, frequency: 'monthly' }]);
  }
  function updateTier(i: number, patch: Partial<Tier>) {
    const next = [...(form.tiers ?? [])];
    next[i] = { ...next[i], ...patch };
    update('tiers', next);
  }
  function removeTier(i: number) {
    update('tiers', (form.tiers ?? []).filter((_, idx) => idx !== i));
  }

  async function save() {
    if (!isAdmin) return;
    if (!form.name.trim()) return alert('Name is required');
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        category: form.category,
        fee_type: form.fee_type,
        base_price: Number(form.base_price ?? 0),
        frequency: form.frequency,
        vat_treatment: form.vat_treatment,
        display_order: Number(form.display_order ?? 0),
        active: form.active,
        tiers: form.fee_type === 'tiered' ? (form.tiers ?? []).map(t => ({
          label: t.label,
          price: Number(t.price),
          frequency: t.frequency,
        })) : [],
      };
      if (initial?.id) {
        await fetch(`/api/proposals/services/${initial.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await fetch('/api/proposals/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="border border-[var(--border)] rounded-xl p-4 space-y-3 bg-white">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Service name *"><input value={form.name} onChange={e => update('name', e.target.value)} className="input-base text-sm w-full" /></Field>
        <Field label="Category"><input value={form.category ?? ''} onChange={e => update('category', e.target.value || null)} className="input-base text-sm w-full" placeholder="Compliance / Bookkeeping / Advisory" /></Field>
      </div>
      <Field label="Description"><textarea value={form.description ?? ''} onChange={e => update('description', e.target.value || null)} rows={2} className="input-base text-sm w-full" /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Fee type">
          <select value={form.fee_type} onChange={e => update('fee_type', e.target.value as Service['fee_type'])} className="input-base text-sm w-full">
            <option value="fixed">Fixed</option>
            <option value="tiered">Tiered</option>
          </select>
        </Field>
        {form.fee_type === 'fixed' && (
          <>
            <Field label="Price (£)"><input type="number" step="0.01" value={form.base_price} onChange={e => update('base_price', Number(e.target.value))} className="input-base text-sm w-full" /></Field>
            <Field label="Frequency">
              <select value={form.frequency} onChange={e => update('frequency', e.target.value as Service['frequency'])} className="input-base text-sm w-full">
                <option value="one_off">One-off</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </Field>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="VAT">
          <select value={form.vat_treatment} onChange={e => update('vat_treatment', e.target.value as Service['vat_treatment'])} className="input-base text-sm w-full">
            <option value="firm_default">Firm default</option>
            <option value="exclusive">Exclusive</option>
            <option value="inclusive">Inclusive</option>
            <option value="exempt">Exempt</option>
          </select>
        </Field>
        <Field label="Display order"><input type="number" value={form.display_order} onChange={e => update('display_order', Number(e.target.value))} className="input-base text-sm w-full" /></Field>
        <label className="flex items-end gap-2 pb-1 text-xs"><input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)} />Active in catalogue</label>
      </div>

      {form.fee_type === 'tiered' && (
        <div className="border border-gray-100 rounded-lg p-3 space-y-2">
          <p className="text-[11px] font-semibold uppercase text-[var(--text-muted)]">Tiers</p>
          {(form.tiers ?? []).length === 0 && <p className="text-xs text-[var(--text-muted)] italic">No tiers yet.</p>}
          {(form.tiers ?? []).map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input value={t.label} onChange={e => updateTier(i, { label: e.target.value })} placeholder="Label e.g. Up to 50 txns/mo" className="input-base text-xs col-span-6" />
              <input type="number" step="0.01" value={t.price} onChange={e => updateTier(i, { price: Number(e.target.value) })} placeholder="£" className="input-base text-xs col-span-2" />
              <select value={t.frequency} onChange={e => updateTier(i, { frequency: e.target.value as Tier['frequency'] })} className="input-base text-xs col-span-3">
                <option value="one_off">One-off</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
              <button onClick={() => removeTier(i)} className="p-1.5 rounded text-red-600 hover:bg-red-50 col-span-1"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={addTier} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={11} />Add tier</button>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 size={12} className="animate-spin inline" /> : <Check size={12} className="inline mr-1" />}Save</button>
      </div>
    </div>
  );
}

// ── Packages ──────────────────────────────────────────────────────────────
function PackagesSection({ isAdmin }: { isAdmin: boolean }) {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, sRes] = await Promise.all([
      fetch('/api/proposals/packages').then(r => r.json()),
      fetch('/api/proposals/services').then(r => r.json()),
    ]);
    setPackages(pRes.packages ?? []);
    setServices(sRes.services ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-xs text-[var(--accent)]">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>Packages bundle multiple services into a named tier (e.g. Bronze / Silver / Gold). When you build a proposal you can offer one or more packages and the prospect picks one.</p>
      </div>
      {loading ? <Loader /> : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {packages.length === 0 && <p className="text-xs text-[var(--text-muted)] italic px-4 py-6 text-center">No packages yet.</p>}
          {packages.map(pkg => (
            editingId === pkg.id ? (
              <PackageForm
                key={pkg.id}
                initial={pkg}
                services={services}
                isAdmin={isAdmin}
                onCancel={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); void load(); }}
              />
            ) : (
              <div key={pkg.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{pkg.name} {!pkg.active && <span className="text-[10px] uppercase ml-1 text-[var(--text-muted)]">inactive</span>}</p>
                  {pkg.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{pkg.description}</p>}
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">{(pkg.items ?? []).length} service{(pkg.items ?? []).length === 1 ? '' : 's'}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditingId(pkg.id)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Edit3 size={13} /></button>
                    <button onClick={() => void deletePackage(pkg.id, load)} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
      {isAdmin && !adding && (
        <button onClick={() => setAdding(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5"><Plus size={13} />Add package</button>
      )}
      {isAdmin && adding && (
        <PackageForm
          services={services}
          isAdmin={isAdmin}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load(); }}
        />
      )}
    </div>
  );
}

async function deletePackage(id: string, reload: () => void) {
  if (!confirm('Delete this package?')) return;
  await fetch(`/api/proposals/packages/${id}`, { method: 'DELETE' });
  reload();
}

function PackageForm({ initial, services, isAdmin, onCancel, onSaved }: {
  initial?: PackageRow;
  services: Service[];
  isAdmin: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PackageRow>(() => initial ?? {
    id: '', name: '', description: null, display_order: 0, active: true, items: [],
  });
  const [saving, setSaving] = useState(false);

  function update<K extends keyof PackageRow>(k: K, v: PackageRow[K]) { setForm(s => ({ ...s, [k]: v })); }
  function addItem() { update('items', [...(form.items ?? []), { service_id: '', tier_id: null, custom_price: null }]); }
  function updateItem(i: number, patch: Partial<PackageItem>) {
    const next = [...(form.items ?? [])];
    next[i] = { ...next[i], ...patch };
    update('items', next);
  }
  function removeItem(i: number) { update('items', (form.items ?? []).filter((_, idx) => idx !== i)); }

  async function save() {
    if (!isAdmin) return;
    if (!form.name.trim()) return alert('Name required');
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        display_order: Number(form.display_order),
        active: form.active,
        items: (form.items ?? []).filter(it => it.service_id),
      };
      if (initial?.id) {
        await fetch(`/api/proposals/packages/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        await fetch('/api/proposals/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div className="border border-[var(--border)] rounded-xl p-4 space-y-3 bg-white">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Package name *"><input value={form.name} onChange={e => update('name', e.target.value)} className="input-base text-sm w-full" placeholder="Bronze / Silver / Gold" /></Field>
        <Field label="Display order"><input type="number" value={form.display_order} onChange={e => update('display_order', Number(e.target.value))} className="input-base text-sm w-full" /></Field>
      </div>
      <Field label="Description"><textarea value={form.description ?? ''} onChange={e => update('description', e.target.value || null)} rows={2} className="input-base text-sm w-full" /></Field>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.active} onChange={e => update('active', e.target.checked)} />Active</label>

      <div className="border border-gray-100 rounded-lg p-3 space-y-2">
        <p className="text-[11px] font-semibold uppercase text-[var(--text-muted)]">Included services</p>
        {(form.items ?? []).length === 0 && <p className="text-xs text-[var(--text-muted)] italic">No services in this package yet.</p>}
        {(form.items ?? []).map((it, i) => {
          const svc = services.find(s => s.id === it.service_id);
          return (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <select value={it.service_id} onChange={e => updateItem(i, { service_id: e.target.value, tier_id: null })} className="input-base text-xs col-span-6">
                <option value="">— Pick a service —</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {svc?.fee_type === 'tiered' && (
                <select value={it.tier_id ?? ''} onChange={e => updateItem(i, { tier_id: e.target.value || null })} className="input-base text-xs col-span-3">
                  <option value="">— Choose a tier —</option>
                  {(svc.tiers ?? []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              )}
              {svc?.fee_type !== 'tiered' && (
                <input type="number" step="0.01" value={it.custom_price ?? ''} onChange={e => updateItem(i, { custom_price: e.target.value === '' ? null : Number(e.target.value) })} placeholder={svc ? `£${Number(svc.base_price).toFixed(2)} default` : 'Override £'} className="input-base text-xs col-span-3" />
              )}
              <button onClick={() => removeItem(i)} className="p-1.5 rounded text-red-600 hover:bg-red-50 col-span-1"><Trash2 size={12} /></button>
            </div>
          );
        })}
        <button onClick={addItem} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={11} />Add service</button>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
        <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 size={12} className="animate-spin inline" /> : <Check size={12} className="inline mr-1" />}Save package</button>
      </div>
    </div>
  );
}

// ── General defaults + onboarding ────────────────────────────────────────
function GeneralSection({ isAdmin, tasksModuleActive }: { isAdmin: boolean; tasksModuleActive: boolean }) {
  const [settings, setSettings] = useState<ProposalSettings | null>(null);
  const [activeFormCount, setActiveFormCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, fRes] = await Promise.all([
      fetch('/api/proposals/settings').then(r => r.json()),
      fetch('/api/proposals/onboarding-forms').then(r => r.ok ? r.json() : { forms: [] }),
    ]);
    setSettings(sRes.settings ?? null);
    setActiveFormCount(((fRes.forms ?? []) as Array<{ active: boolean }>).filter(f => f.active).length);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof ProposalSettings>(k: K, v: ProposalSettings[K]) {
    setSettings(s => s ? { ...s, [k]: v } : s);
  }

  async function save() {
    if (!isAdmin || !settings) return;
    setSaving(true);
    try {
      await fetch('/api/proposals/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (loading || !settings) return <Loader />;

  return (
    <div className="space-y-4 max-w-3xl">
      <Card title="Pricing defaults">
        <div className="grid grid-cols-2 gap-3">
          <Field label="VAT mode default">
            <select value={settings.default_vat_mode} onChange={e => update('default_vat_mode', e.target.value as 'inclusive' | 'exclusive')} className="input-base text-sm w-full">
              <option value="exclusive">Prices shown VAT-exclusive</option>
              <option value="inclusive">Prices shown VAT-inclusive</option>
            </select>
          </Field>
          <Field label="VAT rate %"><input type="number" step="0.01" value={settings.default_vat_rate} onChange={e => update('default_vat_rate', Number(e.target.value))} className="input-base text-sm w-full" /></Field>
          <Field label="Default expiry (days)"><input type="number" value={settings.default_expiry_days ?? 30} onChange={e => update('default_expiry_days', Number(e.target.value))} className="input-base text-sm w-full" /></Field>
        </div>
      </Card>

      <Card title="Terms & conditions">
        <Field label="Terms shown to the prospect">
          <textarea value={settings.terms_template ?? ''} onChange={e => update('terms_template', e.target.value || null)} rows={4} className="input-base text-sm w-full" placeholder="Our standard terms and conditions…" />
        </Field>
        <p className="text-[11px] text-[var(--text-muted)] -mt-1">Appears on the proposal page itself. Email body copy lives under the Email tab.</p>
      </Card>

      <Card title="Auto-onboarding on acceptance">
        <p className="text-[11px] text-[var(--text-muted)] mb-2">When a prospect accepts a proposal, choose which of these should happen automatically.</p>

        <Field label="Default action when a proposal is accepted">
          <select
            value={settings.default_post_acceptance_action}
            onChange={e => update('default_post_acceptance_action', e.target.value as ProposalSettings['default_post_acceptance_action'])}
            className="input-base text-sm w-full"
          >
            <option value="send_onboarding">Send the prospect an onboarding form</option>
            <option value="none">Just notify me — no onboarding form (skip it)</option>
            <option value="auto_create_client">Auto-create the client record — no onboarding form</option>
          </select>
          <p className="text-[11px] text-[var(--text-muted)] mt-1">
            New proposals start with this choice. If your firm doesn&apos;t use onboarding forms, pick one of the &ldquo;no onboarding form&rdquo; options. Each proposal can still override this under <strong>When this proposal is accepted</strong> in the builder.
          </p>
          {settings.default_post_acceptance_action === 'send_onboarding' && activeFormCount === 0 && (
            <p className="text-[11px] text-amber-700 mt-1 flex items-start gap-1">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>You don&apos;t have any active onboarding forms yet, so nothing will be sent on acceptance. Build one under the <strong>Onboarding forms</strong> tab, or switch this to a &ldquo;no onboarding form&rdquo; option.</span>
            </p>
          )}
        </Field>

        <Toggle label="Graduate the prospect to a client record" value={settings.auto_graduate_client} onChange={v => update('auto_graduate_client', v)} />
        <Toggle label="Save onboarding form answers to the client" value={settings.auto_save_form_answers} onChange={v => update('auto_save_form_answers', v)} />
        <Toggle label="Create a Risk Assessment (AML) record" value={settings.auto_create_aml} onChange={v => update('auto_create_aml', v)} />
        <Toggle
          label={tasksModuleActive ? 'Create onboarding tasks from a template' : 'Create onboarding tasks (requires Tasks module)'}
          value={settings.auto_create_tasks}
          onChange={v => update('auto_create_tasks', v)}
          disabled={!tasksModuleActive}
        />
        {settings.auto_create_tasks && tasksModuleActive && (
          <TaskTemplatePicker
            value={settings.auto_tasks_template_id}
            onChange={v => update('auto_tasks_template_id', v)}
          />
        )}
        <Toggle label="Generate a Letter of Engagement (PDF)" value={settings.auto_generate_loe} onChange={v => update('auto_generate_loe', v)} />
        <p className="text-[11px] text-[var(--text-muted)] mt-2 italic">Letter of Engagement PDF generation lands in Phase C.</p>
      </Card>

      <Card title="Payment on acceptance (Stripe)">
        <Toggle label="Collect payment / Direct Debit when the prospect accepts" value={settings.collect_payment_on_accept} onChange={v => update('collect_payment_on_accept', v)} />
        <Field label="Stripe account ID (if connected)">
          <input value={settings.stripe_account_id ?? ''} onChange={e => update('stripe_account_id', e.target.value || null)} className="input-base text-sm w-full font-mono" placeholder="acct_…" />
        </Field>
        <p className="text-[11px] text-[var(--text-muted)] italic">Phase C: a full Stripe Connect flow will replace the manual account-ID field.</p>
      </Card>

      {isAdmin && (
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} />Saved</span>}
          <button onClick={() => void save()} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Check size={13} className="inline mr-1" />}Save settings
          </button>
        </div>
      )}
    </div>
  );
}

// ── Email section (own sub-tab) ────────────────────────────────────────
function EmailSection({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<ProposalSettings | null>(null);
  const [connections, setConnections] = useState<ProposalGmailConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [sRes, cRes] = await Promise.all([
      fetch('/api/proposals/settings').then(r => r.json()),
      fetch('/api/proposals/settings/email-senders').then(r => r.ok ? r.json() : { connections: [] }),
    ]);
    setSettings(sRes.settings ?? null);
    setConnections(cRes.connections ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function update<K extends keyof ProposalSettings>(k: K, v: ProposalSettings[K]) {
    setSettings(s => s ? { ...s, [k]: v } : s);
  }

  async function save() {
    if (!isAdmin || !settings) return;
    setSaving(true);
    try {
      await fetch('/api/proposals/settings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposal_email_sender_connection_id: settings.proposal_email_sender_connection_id,
          subject_proposal: settings.subject_proposal,
          subject_reminder: settings.subject_reminder,
          subject_onboarding: settings.subject_onboarding,
          intro_template: settings.intro_template,
          body_reminder: settings.body_reminder,
          body_onboarding: settings.body_onboarding,
          brand_primary_color: settings.brand_primary_color,
          email_from_address: settings.email_from_address,
          email_signature: settings.email_signature,
        }),
      });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  }

  if (loading || !settings) return <Loader />;

  // Resolve "what is currently being used" for the status banner
  const activeConn = connections.find(c => c.id === settings.proposal_email_sender_connection_id);
  const fallbackAddr = settings.email_from_address ?? null;
  const status: { kind: 'gmail' | 'resend' | 'none'; label: string } = activeConn
    ? { kind: 'gmail', label: activeConn.google_email }
    : fallbackAddr
      ? { kind: 'resend', label: fallbackAddr }
      : { kind: 'none', label: 'No sender configured — emails will fall back to the system default.' };

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Status banner */}
      <StatusBanner status={status} />

      {/* Sender */}
      <SenderCard
        connections={connections}
        value={settings.proposal_email_sender_connection_id}
        onChange={v => update('proposal_email_sender_connection_id', v)}
        onReload={load}
      />

      {/* Email content — tabbed subject + body + preview */}
      <EmailContentCard
        settings={settings}
        onChangeSubject={(kind, v) => update(
          kind === 'proposal' ? 'subject_proposal' : kind === 'reminder' ? 'subject_reminder' : 'subject_onboarding',
          v,
        )}
        onChangeBody={(kind, v) => update(
          kind === 'proposal' ? 'intro_template' : kind === 'reminder' ? 'body_reminder' : 'body_onboarding',
          v,
        )}
        onChangeColor={v => update('brand_primary_color', v)}
      />

      {/* Advanced (Resend fallback) — collapsible */}
      <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--bg-nav-hover)] transition-colors"
        >
          <div className="flex items-center gap-2">
            <ChevronRight size={14} className={`text-[var(--text-muted)] transition-transform ${advancedOpen ? 'rotate-90' : ''}`} />
            <span className="text-sm font-medium">Advanced — Resend fallback</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Used only when no Gmail is linked or Google access lapses</span>
        </button>
        {advancedOpen && (
          <div className="px-4 pb-4 pt-1 border-t border-gray-100 grid grid-cols-2 gap-3">
            <Field label="From address">
              <input value={settings.email_from_address ?? ''} onChange={e => update('email_from_address', e.target.value || null)} className="input-base text-sm w-full" placeholder="proposals@yourfirm.co.uk" />
            </Field>
            <Field label="Email signature">
              <textarea value={settings.email_signature ?? ''} onChange={e => update('email_signature', e.target.value || null)} rows={2} className="input-base text-sm w-full" />
            </Field>
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      {isAdmin && (
        <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-[var(--border)] -mx-6 px-6 py-3 flex items-center justify-end gap-3 z-10">
          {saved && <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} />Saved</span>}
          <button onClick={() => void save()} disabled={saving} className="btn-primary disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin inline mr-1" /> : <Check size={13} className="inline mr-1" />}Save email settings
          </button>
        </div>
      )}
    </div>
  );
}

// ── Status banner showing the live sender ──────────────────────────────
function StatusBanner({ status }: { status: { kind: 'gmail' | 'resend' | 'none'; label: string } }) {
  const map = {
    gmail:  { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500',  text: 'text-emerald-900', icon: Check,         heading: 'Currently sending via Gmail' },
    resend: { bg: 'bg-amber-50 border-amber-200',     dot: 'bg-amber-500',    text: 'text-amber-900',   icon: AlertTriangle, heading: 'Currently sending via Resend fallback' },
    none:   { bg: 'bg-gray-50 border-gray-200',       dot: 'bg-gray-400',     text: 'text-gray-700',    icon: AlertTriangle, heading: 'No email sender configured' },
  } as const;
  const s = map[status.kind];
  const Icon = s.icon;
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${s.bg} ${s.text}`}>
      <div className="relative shrink-0">
        <span className={`block h-2.5 w-2.5 rounded-full ${s.dot}`} />
        <span className={`absolute inset-0 rounded-full ${s.dot} animate-ping opacity-50`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">{s.heading}</p>
        <p className="text-xs opacity-80 mt-0.5 truncate font-mono">{status.label}</p>
      </div>
      <Icon size={16} className="shrink-0 opacity-60" />
    </div>
  );
}

// ── Sender card (replaces ProposalSenderPicker in this section) ────────
function SenderCard({
  connections, value, onChange, onReload,
}: {
  connections: ProposalGmailConnection[];
  value: string | null;
  onChange: (v: string | null) => void;
  onReload: () => void;
}) {
  const [banner, setBanner] = useState<'connected' | 'cancelled' | 'error' | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('email');
    if (status === 'connected' || status === 'cancelled' || status === 'error') {
      setBanner(status as 'connected' | 'cancelled' | 'error');
      url.searchParams.delete('email');
      window.history.replaceState(null, '', url.toString());
    }
  }, []);

  function connectGmail() { window.location.href = '/api/proposals/gmail/connect'; }

  async function disconnect(id: string) {
    if (!confirm('Disconnect this Gmail account from proposals?')) return;
    await fetch(`/api/proposals/settings/email-senders?id=${id}`, { method: 'DELETE' });
    if (value === id) onChange(null);
    onReload();
  }

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Sender accounts</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Independent of Email Triage. Replies land in the linked inbox.</p>
        </div>
        <button onClick={connectGmail} className="btn-primary text-xs inline-flex items-center gap-1.5">
          <Mail size={11} />{connections.length === 0 ? 'Connect Gmail' : 'Connect another'}
        </button>
      </div>

      {banner === 'connected' && (
        <div className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 mb-3 inline-flex items-center gap-1.5"><Check size={11} />Gmail connected.</div>
      )}
      {banner === 'cancelled' && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3 inline-flex items-center gap-1.5"><AlertTriangle size={11} />Gmail connection was cancelled.</div>
      )}
      {banner === 'error' && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5 mb-3 inline-flex items-center gap-1.5"><AlertTriangle size={11} />Gmail connection failed. Try again.</div>
      )}

      {connections.length === 0 ? (
        <div className="text-center py-8 rounded-lg bg-gray-50 border border-dashed border-gray-200">
          <Mail size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-[var(--text-secondary)]">No Gmail account linked yet</p>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">Link a shared mailbox like <code className="bg-gray-100 px-1 rounded">hello@firm.co.uk</code> so prospect replies go somewhere your team monitors.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map(c => {
            const isActive = value === c.id;
            return (
              <div
                key={c.id}
                onClick={() => onChange(c.id)}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all
                  ${isActive ? 'border-[var(--accent)] bg-[var(--accent-light)]/40' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
              >
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate font-mono">{c.google_email}</p>
                  {c.connected_by && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Connected by {c.connected_by}</p>}
                </div>
                {isActive && <span className="text-[10px] uppercase tracking-wide font-bold text-[var(--accent)] shrink-0">Active sender</span>}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); void disconnect(c.id); }}
                  className="text-red-600 hover:bg-red-50 p-1.5 rounded shrink-0"
                  aria-label="Disconnect"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => onChange(null)}
            className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all text-left
              ${value === null ? 'border-[var(--accent)] bg-[var(--accent-light)]/40' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
          >
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${value === null ? 'bg-amber-500' : 'bg-gray-300'}`} />
            <div className="flex-1">
              <p className="text-sm font-medium">Use Resend fallback</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Emails sent from the address in Advanced below.</p>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Email content card (subject + preview, tabbed by email type) ───────
type EmailKind = 'proposal' | 'reminder' | 'onboarding';

function EmailContentCard({
  settings, onChangeSubject, onChangeBody, onChangeColor,
}: {
  settings: ProposalSettings;
  onChangeSubject: (kind: EmailKind, v: string | null) => void;
  onChangeBody: (kind: EmailKind, v: string | null) => void;
  onChangeColor: (v: string) => void;
}) {
  const [active, setActive] = useState<EmailKind>('proposal');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; previewUrl?: string } | null>(null);

  const subjectField = active === 'proposal' ? 'subject_proposal'
    : active === 'reminder' ? 'subject_reminder' : 'subject_onboarding';
  const bodyField: keyof ProposalSettings = active === 'proposal' ? 'intro_template'
    : active === 'reminder' ? 'body_reminder' : 'body_onboarding';
  const placeholder = active === 'proposal' ? 'Proposal from {firm} — {proposal}'
    : active === 'reminder' ? 'Reminder: {proposal}'
    : 'Welcome to {firm} — onboarding form';
  const bodyPlaceholder = active === 'proposal'
    ? "Thanks for taking the time to talk to us. We've put together a proposal based on what we discussed…"
    : active === 'reminder'
      ? "Just a quick nudge in case our earlier email got buried — the proposal is still open and we'd love your decision when you've had a chance to review it."
      : "Thanks for accepting our proposal. To get you set up properly, please fill in our short onboarding form using the link below.";

  const refreshPreview = useCallback(async (kind: EmailKind, subj: string, body: string, color: string) => {
    setLoadingPreview(true);
    try {
      const qs = new URLSearchParams({ kind });
      if (subj) qs.set('subject', subj);
      if (body) qs.set('body', body);
      if (color) qs.set('color', color);
      const res = await fetch(`/api/proposals/settings/email-preview?${qs.toString()}`);
      const data = await res.json();
      if (res.ok) setPreview({ subject: data.subject, html: data.html });
    } finally { setLoadingPreview(false); }
  }, []);

  // Debounced live preview — re-renders whenever the user edits subject/body/colour or switches tab
  useEffect(() => {
    const subj = (settings[(active === 'proposal' ? 'subject_proposal' : active === 'reminder' ? 'subject_reminder' : 'subject_onboarding') as keyof ProposalSettings] as string | null) ?? '';
    const body = (settings[(active === 'proposal' ? 'intro_template' : active === 'reminder' ? 'body_reminder' : 'body_onboarding') as keyof ProposalSettings] as string | null) ?? '';
    const color = settings.brand_primary_color ?? '';
    const t = setTimeout(() => { void refreshPreview(active, subj, body, color); }, 300);
    return () => clearTimeout(t);
  }, [active, settings.subject_proposal, settings.subject_reminder, settings.subject_onboarding, settings.intro_template, settings.body_reminder, settings.body_onboarding, settings.brand_primary_color, refreshPreview]);

  async function sendTest() {
    if (!testEmail.trim()) return;
    setTestSending(true); setTestResult(null);
    try {
      const res = await fetch('/api/proposals/settings/email-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ ok: true, message: `Sent to ${testEmail}. Open your inbox.`, previewUrl: data.previewUrl });
      else setTestResult({ ok: false, message: data.error ?? 'Send failed' });
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : 'Send failed' });
    } finally { setTestSending(false); }
  }

  const subjectValue = (settings[subjectField as keyof ProposalSettings] as string | null | undefined) ?? '';
  const bodyValue = (settings[bodyField] as string | null | undefined) ?? '';

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
      {/* Header colour — shared across all three emails. Mirrors brand_primary_color. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50/60">
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">Header & button colour</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Applies to all proposal emails. Also editable on the Branding tab.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={settings.brand_primary_color ?? '#0ea5e9'}
            onChange={e => onChangeColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-gray-200 bg-white p-0.5"
            aria-label="Email header colour"
          />
          <input
            type="text"
            value={settings.brand_primary_color ?? ''}
            onChange={e => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChangeColor(e.target.value)}
            placeholder="#0ea5e9"
            className="input-base text-xs w-[88px] font-mono"
          />
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex border-b border-gray-100 bg-gray-50/60">
        {(['proposal', 'reminder', 'onboarding'] as const).map(kind => (
          <button
            key={kind}
            type="button"
            onClick={() => setActive(kind)}
            className={`flex-1 px-4 py-3 text-sm font-medium border-b-2 transition-colors capitalize
              ${active === kind
                ? 'border-[var(--accent)] text-[var(--accent)] bg-white'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]'
              }`}
          >
            {kind === 'proposal' ? 'Proposal delivery' : kind === 'reminder' ? 'Reminder nudge' : 'Onboarding'}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 divide-x divide-gray-100">
        {/* Left: editor */}
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Subject line</label>
            <input
              value={subjectValue}
              onChange={e => onChangeSubject(active, e.target.value || null)}
              placeholder={placeholder}
              className="input-base text-sm w-full font-mono"
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              Placeholders: <code className="bg-gray-100 px-1 rounded">{'{firm}'}</code> <code className="bg-gray-100 px-1 rounded">{'{prospect}'}</code> <code className="bg-gray-100 px-1 rounded">{'{proposal}'}</code>
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">Email body</label>
            <textarea
              value={bodyValue}
              onChange={e => onChangeBody(active, e.target.value || null)}
              placeholder={bodyPlaceholder}
              rows={6}
              className="input-base text-sm w-full"
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              The main paragraph in the {active === 'proposal' ? 'proposal delivery' : active === 'reminder' ? 'reminder nudge' : 'onboarding'} email. Leave blank to use the SMITH default.
            </p>
          </div>

          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={() => setTestOpen(o => !o)}
              className="btn-secondary text-xs inline-flex items-center gap-1.5 w-full justify-center"
            >
              <Mail size={11} />{testOpen ? 'Close test panel' : 'Send a test email'}
            </button>
            {testOpen && (
              <div className="rounded-lg border border-gray-200 p-3 space-y-2 bg-gray-50/50">
                <div className="flex gap-2">
                  <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="your.email@example.com" className="input-base text-sm flex-1" />
                  <button type="button" onClick={() => void sendTest()} disabled={testSending || !testEmail.trim()} className="btn-primary text-xs">
                    {testSending ? <Loader2 size={11} className="animate-spin inline mr-1" /> : null}Send
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">A real proposal email is sent via your configured Gmail or Resend fallback. The link points to a fully-branded sample proposal.</p>
                {testResult && (
                  <div className={`text-xs px-2 py-1.5 rounded ${testResult.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    {testResult.ok ? <Check size={11} className="inline mr-1" /> : <AlertTriangle size={11} className="inline mr-1" />}
                    {testResult.message}
                    {testResult.previewUrl && (
                      <> · <a href={testResult.previewUrl} target="_blank" rel="noopener noreferrer" className="underline">Open sample proposal</a></>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: live preview */}
        <div className="bg-gray-50">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-white flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-wide text-[var(--text-muted)]">Live preview</span>
            <span className="text-[11px] text-[var(--text-secondary)] truncate ml-2 max-w-[60%] font-medium">{preview?.subject ?? '—'}</span>
          </div>
          <div className="p-3 h-[360px] overflow-hidden">
            {loadingPreview || !preview ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">
                <Loader2 size={12} className="animate-spin mr-1.5" />Rendering…
              </div>
            ) : (
              <iframe
                sandbox=""
                srcDoc={preview.html}
                title="Email preview"
                className="w-full h-full rounded-lg bg-white border border-gray-200"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tiny shared bits ─────────────────────────────────────────────────────
function Loader() { return <div className="text-center py-8 text-sm text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin inline mr-1.5" />Loading…</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-1">{label}</span>{children}</label>;
}
function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-sm">{label}</span>
      <button type="button" disabled={disabled} onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${value ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${value ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function frequencyLabel(f: string): string {
  switch (f) {
    case 'one_off': return 'one-off';
    case 'monthly': return 'month';
    case 'quarterly': return 'quarter';
    case 'annual': return 'year';
    default: return f;
  }
}
