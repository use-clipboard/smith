'use client';

import { useEffect, useState, useRef } from 'react';
import { Loader2, Check, Landmark, Sparkles, Upload, Trash2, Image as ImageIcon } from 'lucide-react';
import RichTextEditor from '@/components/ui/RichTextEditor';

interface Settings {
  accountantsReport: string;
  accountantDetails: string;   // legacy free-text — preserved, superseded by name+address
  accountantName: string;
  accountantAddress: string;
  governingBody: string;
  approvalEmailSubject: string;
  approvalEmailBody: string;
  brandPrimaryColor: string;
}
const DEFAULT_SUBJECT = 'Please approve the accounts for {{company_name}} — year ended {{period_end}}';
const DEFAULT_BODY = `Hi {{client_name}},

{{preparer_name}} has prepared the statutory accounts for {{company_name}} for the year ended {{period_end}}. The accounts are attached as a PDF.

When you're happy with them, please click the button below to approve them for submission. If anything needs changing, click "Request changes" and let us know what to amend.

Many thanks,
{{preparer_name}}
{{firm_name}}`;
const EMPTY: Settings = {
  accountantsReport: '', accountantDetails: '', accountantName: '', accountantAddress: '', governingBody: '',
  approvalEmailSubject: DEFAULT_SUBJECT, approvalEmailBody: DEFAULT_BODY, brandPrimaryColor: '#4F46E5',
};

const EMAIL_VARS: { key: string; desc: string }[] = [
  { key: 'client_name',   desc: 'The client / company name' },
  { key: 'company_name',  desc: 'The company name' },
  { key: 'client_code',   desc: 'The client reference' },
  { key: 'period_end',    desc: 'Year-end date (dd-mm-yyyy)' },
  { key: 'framework',     desc: 'Accounting framework' },
  { key: 'firm_name',     desc: 'Your firm name' },
  { key: 'preparer_name', desc: 'The preparer (you)' },
];

// Rich-text (HTML) fields — the AI-drafted note wording.
type RichKey = 'accountantsReport' | 'governingBody';
const RICH_FIELDS: { key: RichKey; title: string; blurb: string; placeholder: string }[] = [
  {
    key: 'accountantsReport', title: "Accountants' Report",
    blurb: "The reporting accountants' report on the unaudited accounts, added to every new set of accounts.",
    placeholder: 'In accordance with our engagement letter…',
  },
  {
    key: 'governingBody', title: 'Governing Body',
    blurb: 'Standard wording describing the board / members / trustees, if you use one.',
    placeholder: 'The company is governed by its board of directors…',
  },
];

export default function AccountsStudioDefaultsTab() {
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [suggesting, setSuggesting] = useState<RichKey | null>(null);
  const [editorKeys, setEditorKeys] = useState<Record<RichKey, number>>({ accountantsReport: 0, governingBody: 0 });

  // Brand logo (separate upload flow, like MTD IT).
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/accounts-studio/firm-settings')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setSettings({ ...EMPTY, ...(d.settings ?? {}) }))
      .catch(() => setError('Could not load defaults.'))
      .finally(() => setLoading(false));
    fetch('/api/accounts-studio/firm-settings/logo')
      .then(r => r.ok ? r.json() : null).then(d => setLogoDataUrl(d?.logo ?? null)).catch(() => {});
  }, []);

  async function uploadLogo(file: File) {
    setLogoBusy(true); setError('');
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await fetch('/api/accounts-studio/firm-settings/logo', { method: 'POST', body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Logo upload failed.');
      setLogoDataUrl(d.logo ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Logo upload failed.'); }
    finally { setLogoBusy(false); if (logoInput.current) logoInput.current.value = ''; }
  }
  async function removeLogo() {
    setLogoBusy(true); setError('');
    try {
      const r = await fetch('/api/accounts-studio/firm-settings/logo', { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not remove the logo.');
      setLogoDataUrl(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove the logo.'); }
    finally { setLogoBusy(false); }
  }

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(s => ({ ...s, [key]: value }));
    setSaved(false);
  }

  async function aiSuggest(key: RichKey) {
    setSuggesting(key); setError('');
    try {
      const r = await fetch('/api/accounts-studio/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'suggest-default', field: key, context: {} }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Could not draft a suggestion.');
      const d = await r.json();
      const html = (d.html || d.reply || '').trim();
      if (!html) throw new Error('No suggestion returned.');
      setSettings(s => ({ ...s, [key]: html }));
      setEditorKeys(k => ({ ...k, [key]: k[key] + 1 }));
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft a suggestion.');
    } finally {
      setSuggesting(null);
    }
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const r = await fetch('/api/accounts-studio/firm-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Save failed.');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 py-10 text-sm text-gray-400"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Landmark size={18} /></div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Accounts Studio defaults</h2>
          <p className="mt-0.5 text-sm text-gray-500">Firm-wide details and house-style notes used on every set of accounts. Use <span className="font-medium text-indigo-600">AI Suggest</span> for a first draft of the wording, then tailor it to your firm.</p>
        </div>
      </div>

      {/* Accountant name + address — used on the Company Information page and the
          Accountants' Report. */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Accountant details</h3>
        <p className="mb-3 text-xs text-gray-500">Your firm&apos;s name and address exactly as they should appear on the accounts. If left blank, the firm name is used.</p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Accountant / firm name</label>
            <input
              type="text" value={settings.accountantName}
              onChange={e => patch('accountantName', e.target.value)}
              placeholder="ABC Accountants Limited"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Address</label>
            <textarea
              rows={4} value={settings.accountantAddress}
              onChange={e => patch('accountantAddress', e.target.value)}
              placeholder={'1 Example Street\nSample Business Park\nLondon\nEC1A 1AA'}
              className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 outline-none focus:border-indigo-500"
            />
            <p className="mt-1 text-[11px] text-gray-400">One line per row — each line prints on its own line.</p>
          </div>
        </div>
      </div>

      {RICH_FIELDS.map(f => (
        <div key={f.key}>
          <div className="mb-1.5 flex items-start justify-between gap-3">
            <div>
              <label className="block text-sm font-semibold text-gray-800">{f.title}</label>
              <p className="text-xs text-gray-500">{f.blurb}</p>
            </div>
            <button
              type="button"
              onClick={() => aiSuggest(f.key)}
              disabled={suggesting !== null}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-600 transition-colors hover:bg-indigo-100 disabled:opacity-50"
            >
              {suggesting === f.key ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {suggesting === f.key ? 'Drafting…' : 'AI Suggest'}
            </button>
          </div>
          <RichTextEditor key={`${f.key}-${editorKeys[f.key]}`} content={settings[f.key]} onChange={v => patch(f.key, v)} placeholder={f.placeholder} />
        </div>
      ))}

      {/* ── Client approval email ────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <h3 className="text-sm font-semibold text-gray-800">Client approval email</h3>
        <p className="mb-3 text-xs text-gray-500">The email sent to clients when you send accounts for approval. The firm logo is taken from your firm branding, and your Gmail signature is added automatically.</p>

        {/* Brand colour + preview */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Brand colour</label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.brandPrimaryColor || '#4F46E5'} onChange={e => patch('brandPrimaryColor', e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-gray-300 bg-white p-1" aria-label="Brand colour" />
            <input type="text" value={settings.brandPrimaryColor} onChange={e => patch('brandPrimaryColor', e.target.value)} placeholder="#4F46E5" className="w-32 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 outline-none focus:border-indigo-500" />
          </div>
          <div className="mt-2 flex items-center justify-center rounded-lg px-4 py-3 text-sm font-semibold text-white" style={{ background: settings.brandPrimaryColor || '#4F46E5' }}>
            {logoDataUrl ? <img src={logoDataUrl} alt="Logo" className="max-h-8 max-w-[160px] object-contain" /> : 'Header & button preview'}
          </div>
        </div>

        {/* Logo upload */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-700">Logo <span className="font-normal text-gray-400">(PNG, JPEG or WebP — 2 MB max)</span></label>
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white">
              {logoDataUrl ? <img src={logoDataUrl} alt="Logo" className="max-h-12 max-w-[104px] object-contain" /> : <ImageIcon size={20} className="text-gray-300" />}
            </div>
            <div className="flex items-center gap-2">
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
              <button type="button" onClick={() => logoInput.current?.click()} disabled={logoBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {logoBusy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} {logoDataUrl ? 'Replace' : 'Upload'}
              </button>
              {logoDataUrl && (
                <button type="button" onClick={removeLogo} disabled={logoBusy} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
          </div>
          <p className="mt-1 text-[11px] text-gray-400">Used on the approval email header and the accounts PDF cover. Saved immediately.</p>
        </div>

        {/* Subject + body templates */}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Subject line</label>
            <input type="text" value={settings.approvalEmailSubject} onChange={e => patch('approvalEmailSubject', e.target.value)} placeholder={DEFAULT_SUBJECT} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Email body</label>
            <textarea rows={8} value={settings.approvalEmailBody} onChange={e => patch('approvalEmailBody', e.target.value)} placeholder={DEFAULT_BODY} className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-gray-900 outline-none focus:border-indigo-500" />
          </div>
        </div>

        {/* Variables */}
        <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-blue-700">Available variables — drop these into the subject or body</p>
          <div className="flex flex-wrap gap-1.5">
            {EMAIL_VARS.map(v => (
              <span key={v.key} title={v.desc} className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-1.5 py-0.5">
                <code className="text-[11px] font-semibold text-blue-700">{`{{${v.key}}}`}</code>
                <span className="text-[10.5px] text-gray-500">{v.desc}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save defaults
        </button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-emerald-700"><Check size={14} /> Saved</span>}
      </div>
    </div>
  );
}
