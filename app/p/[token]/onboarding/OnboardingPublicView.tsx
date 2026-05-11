'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, Check, AlertTriangle, ClipboardList } from 'lucide-react';

interface Field {
  id: string;
  field_key: string;
  label: string;
  field_type: 'text'|'textarea'|'email'|'phone'|'date'|'number'|'select'|'checkbox'|'radio'|'file'|'section_header'|'info';
  required: boolean;
  placeholder: string | null;
  help_text: string | null;
  options: Array<{ label: string; value: string }> | null;
  show_if_field_key: string | null;
  show_if_value: string | null;
  display_order: number;
}
interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: Field[];
}

export default function OnboardingPublicView({ token }: { token: string }) {
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/p/${token}/onboarding`)
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) { setError(d.error ?? 'Could not load form'); return; }
        if (d.alreadySubmitted) { setAlreadySubmitted(true); return; }
        if (!d.form) { setError("There's no onboarding form set up for you yet — we'll be in touch directly."); return; }
        setForm(d.form);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const visibleFields = useMemo(() => {
    if (!form) return [];
    return form.fields.filter(f => {
      if (!f.show_if_field_key) return true;
      const dep = answers[f.show_if_field_key];
      return String(dep ?? '') === (f.show_if_value ?? '');
    });
  }, [form, answers]);

  function setAnswer(key: string, value: unknown) {
    setAnswers(a => ({ ...a, [key]: value }));
  }

  async function submit() {
    if (!form) return;
    if (!signerName.trim() || !signerEmail.trim()) {
      setError('Please enter your name and email.'); return;
    }
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`/api/p/${token}/onboarding/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: form.id,
          submitted_by_name: signerName,
          submitted_by_email: signerEmail,
          answers,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Submit failed');
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally { setSubmitting(false); }
  }

  if (loading) return <Page><Loader2 size={20} className="animate-spin text-[var(--accent)]" /><p className="text-sm text-[var(--text-muted)]">Loading your form…</p></Page>;
  if (alreadySubmitted || done) {
    return <Page>
      <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center"><Check size={24} className="text-emerald-700" /></div>
      <h1 className="text-lg font-semibold">Thanks — onboarding complete</h1>
      <p className="text-sm text-[var(--text-secondary)] max-w-md text-center">We'll take it from here. You'll hear from us shortly with the next steps.</p>
    </Page>;
  }
  if (error && !form) return <Page><AlertTriangle size={24} className="text-amber-500" /><p className="text-sm text-[var(--text-secondary)] max-w-md text-center">{error}</p></Page>;
  if (!form) return null;

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0"><ClipboardList size={18} className="text-[var(--accent)]" /></div>
          <div>
            <h1 className="text-xl font-semibold">{form.name}</h1>
            {form.description && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{form.description}</p>}
          </div>
        </div>

        <div className="px-8 py-6 space-y-5">
          {visibleFields.map(f => <FieldRenderer key={f.id} field={f} value={answers[f.field_key]} onChange={v => setAnswer(f.field_key, v)} />)}

          <div className="pt-4 border-t border-gray-100 space-y-3">
            <p className="text-[11px] uppercase tracking-wide font-bold text-[var(--text-muted)]">Who's submitting</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldRow label="Your name *"><input value={signerName} onChange={e => setSignerName(e.target.value)} className="input-base text-sm w-full" /></FieldRow>
              <FieldRow label="Your email *"><input type="email" value={signerEmail} onChange={e => setSignerEmail(e.target.value)} className="input-base text-sm w-full" /></FieldRow>
            </div>
            {error && <div className="text-xs text-red-700 flex items-center gap-1.5"><AlertTriangle size={12} />{error}</div>}
            <div className="flex justify-end pt-2">
              <button onClick={() => void submit()} disabled={submitting} className="btn-primary text-sm inline-flex items-center gap-1.5">
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Submit onboarding
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRenderer({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (field.field_type === 'section_header') {
    return <div className="pt-4 pb-1 border-b border-gray-200"><h2 className="text-base font-semibold">{field.label}</h2>{field.help_text && <p className="text-xs text-[var(--text-muted)] mt-0.5">{field.help_text}</p>}</div>;
  }
  if (field.field_type === 'info') {
    return <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900 whitespace-pre-wrap">{field.help_text ?? field.label}</div>;
  }
  return (
    <FieldRow label={`${field.label}${field.required ? ' *' : ''}`} help={field.help_text}>
      {field.field_type === 'text' && <input value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder ?? ''} className="input-base text-sm w-full" />}
      {field.field_type === 'email' && <input type="email" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder ?? ''} className="input-base text-sm w-full" />}
      {field.field_type === 'phone' && <input type="tel" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder ?? ''} className="input-base text-sm w-full" />}
      {field.field_type === 'date' && <input type="date" value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} className="input-base text-sm w-full" />}
      {field.field_type === 'number' && <input type="number" value={(value as number | string) ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} placeholder={field.placeholder ?? ''} className="input-base text-sm w-full" />}
      {field.field_type === 'textarea' && <textarea value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} placeholder={field.placeholder ?? ''} rows={3} className="input-base text-sm w-full" />}
      {field.field_type === 'select' && (
        <select value={(value as string) ?? ''} onChange={e => onChange(e.target.value)} className="input-base text-sm w-full">
          <option value="">— Choose —</option>
          {(field.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {field.field_type === 'radio' && (
        <div className="space-y-1.5">
          {(field.options ?? []).map(o => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name={field.field_key} checked={value === o.value} onChange={() => onChange(o.value)} />{o.label}
            </label>
          ))}
        </div>
      )}
      {field.field_type === 'checkbox' && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />{field.placeholder ?? 'Yes'}
        </label>
      )}
      {field.field_type === 'file' && <input type="file" disabled className="text-xs text-[var(--text-muted)]" /> /* v1: file upload deferred */}
    </FieldRow>
  );
}

function FieldRow({ label, help, children }: { label: string; help?: string | null; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{label}</span>
      {children}
      {help && <span className="block text-[11px] text-[var(--text-muted)] mt-1">{help}</span>}
    </label>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 bg-gray-50">{children}</div>;
}
