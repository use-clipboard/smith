'use client';

import { useEffect, useState } from 'react';
import { Loader2, Check, Landmark } from 'lucide-react';
import RichTextEditor from '@/components/ui/RichTextEditor';

interface Settings {
  accountantsReport: string;
  accountantDetails: string;
  governingBody: string;
}
const EMPTY: Settings = { accountantsReport: '', accountantDetails: '', governingBody: '' };

const FIELDS: { key: keyof Settings; title: string; blurb: string; placeholder: string }[] = [
  {
    key: 'accountantsReport', title: "Accountants' Report",
    blurb: "The reporting accountants' report on the unaudited accounts, added to every new set of accounts.",
    placeholder: 'In accordance with our engagement letter…',
  },
  {
    key: 'accountantDetails', title: 'Accountant Details',
    blurb: 'Your firm name, address and regulatory details as they should appear in the accounts.',
    placeholder: 'Firm name, address, regulated by…',
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

  useEffect(() => {
    fetch('/api/accounts-studio/firm-settings')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setSettings({ ...EMPTY, ...(d.settings ?? {}) }))
      .catch(() => setError('Could not load defaults.'))
      .finally(() => setLoading(false));
  }, []);

  function patch<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(s => ({ ...s, [key]: value }));
    setSaved(false);
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
          <p className="mt-0.5 text-sm text-gray-500">Firm-wide house-style notes. These are added automatically to every new set of accounts, where you can edit or remove them per client.</p>
        </div>
      </div>

      {FIELDS.map(f => (
        <div key={f.key}>
          <label className="block text-sm font-semibold text-gray-800">{f.title}</label>
          <p className="mb-1.5 text-xs text-gray-500">{f.blurb}</p>
          <RichTextEditor content={settings[f.key]} onChange={v => patch(f.key, v)} placeholder={f.placeholder} />
        </div>
      ))}

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
