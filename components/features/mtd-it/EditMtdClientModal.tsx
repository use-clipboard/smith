'use client';

import { useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import type { MtdItClientRow as Row, MtdItStreams, MtdItQuarterType } from '@/types';

interface Props {
  client: Row;
  onClose: () => void;
  onSaved: () => void;
}

type DraftStreams = MtdItStreams;

export default function EditMtdClientModal({ client, onClose, onSaved }: Props) {
  const [name,    setName]    = useState(client.name);
  const [code,    setCode]    = useState(client.client_ref ?? '');
  const [status,  setStatus]  = useState<Row['status']>(client.status);
  const [address, setAddress] = useState(client.address ?? '');
  const [utr,     setUtr]     = useState(client.utr_number ?? '');
  const [ni,      setNi]      = useState(client.national_insurance_number ?? '');
  const [dob,     setDob]     = useState(client.date_of_birth ?? '');
  const [email,   setEmail]   = useState(client.contact_email ?? '');
  const [quarterType, setQuarterType] = useState<MtdItQuarterType>(client.mtd_it_quarter_type);
  const [streams, setStreams] = useState<DraftStreams>({ ...client.mtd_it_streams });
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/mtd-it/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          client_ref: code,
          status,
          address: address || null,
          utr_number: utr || null,
          national_insurance_number: ni || null,
          date_of_birth: dob || null,
          contact_email: email || null,
          mtd_it_quarter_type: quarterType,
          mtd_it_streams: streams,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to save');
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">Edit client &mdash; {client.name}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Client info */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Client details</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input value={name} onChange={e => setName(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Client code">
                <input value={code} onChange={e => setCode(e.target.value)} className={`${inputCls} font-mono`} />
              </Field>
              <Field label="Status">
                <select value={status} onChange={e => setStatus(e.target.value as Row['status'])} className={inputCls}>
                  <option value="active">Active</option>
                  <option value="hold">On Hold</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
              <Field label="Contact email">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} />
              </Field>
              <Field label="UTR">
                <input value={utr} onChange={e => setUtr(e.target.value)} className={inputCls} />
              </Field>
              <Field label="NI Number">
                <input value={ni} onChange={e => setNi(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Date of birth (YYYY-MM-DD)">
                <input value={dob} onChange={e => setDob(e.target.value)} placeholder="1980-01-15" className={inputCls} />
              </Field>
              <Field label="Address" full>
                <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className={inputCls} />
              </Field>
            </div>
          </section>

          {/* MTD IT settings */}
          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">MTD IT settings</h4>

            <div>
              <p className="text-xs text-gray-500 mb-1.5">Income streams (these become the default for new quarters)</p>
              <div className="flex flex-wrap gap-2">
                <StreamToggle label="Sole Trader"     active={streams.sole}           onClick={() => setStreams(s => ({ ...s, sole: !s.sole }))} />
                <StreamToggle label="UK Rental"       active={streams.uk_rental}      onClick={() => setStreams(s => ({ ...s, uk_rental: !s.uk_rental }))} />
                <StreamToggle label="Foreign Rental"  active={streams.foreign_rental} onClick={() => setStreams(s => ({ ...s, foreign_rental: !s.foreign_rental }))} />
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-1.5">Quarter type</p>
              <div className="flex gap-2">
                <RadioPill label="Calendar (1 Apr – 30 Jun, etc.)" active={quarterType === 'calendar'} onClick={() => setQuarterType('calendar')} />
                <RadioPill label="Standard HMRC (6 Apr – 5 Jul, etc.)" active={quarterType === 'standard'} onClick={() => setQuarterType('standard')} />
              </div>
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              <AlertTriangle size={14} className="shrink-0 mt-px" /> {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !name.trim() || !code.trim()}
            className="px-3 py-1.5 text-sm bg-[var(--accent)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30';

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`${full ? 'col-span-2' : ''} block`}>
      <span className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function StreamToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/40'
          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}

function RadioPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
        active
          ? 'bg-[var(--accent-light)] text-[var(--accent)] border-[var(--accent)]/40'
          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}
