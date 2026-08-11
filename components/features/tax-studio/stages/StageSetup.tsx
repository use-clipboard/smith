'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, Link2, Calendar, FileText, RefreshCw, MapPin } from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { returnType, taxYearOptions, seedConnectedSources, fmtDateUK } from '../data';
import type { TaxReturn } from '../types';

export default function StageSetup({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}) {
  const [pulling, setPulling] = useState(false);
  const [pullingClient, setPullingClient] = useState(false);
  const rt = returnType(ret.returnType);
  const connected = ret.connected.length > 0;

  const patchTaxpayer = (u: Partial<NonNullable<TaxReturn['taxpayer']>>) =>
    patch(r => ({ ...r, taxpayer: { ...r.taxpayer, ...u } }));

  // Pull the taxpayer's details from the linked client record.
  async function pullFromClient() {
    if (!ret.clientId) return;
    setPullingClient(true);
    try {
      const res = await fetch(`/api/clients/${ret.clientId}`, { cache: 'no-store' });
      if (res.ok) {
        const { client } = await res.json();
        patch(r => ({
          ...r,
          utr: client.utr_number ?? r.utr ?? null,
          taxpayer: {
            address: client.address ?? '',
            dateOfBirth: client.date_of_birth ? fmtDateUK(new Date(client.date_of_birth)) : '',
            nino: client.national_insurance_number ?? '',
          },
        }));
      }
    } finally {
      setPullingClient(false);
    }
  }

  function pullData() {
    setPulling(true);
    // Phase 1: seed the connected-source rows (links resolve to real reads later).
    setTimeout(() => {
      patch(r => ({
        ...r,
        connected: r.connected.length ? r.connected : seedConnectedSources(),
        timeline: [...r.timeline, { id: `t-${r.timeline.length}`, at: new Date().toISOString(), kind: 'imported', label: 'Connected client data' }],
      }));
      setPulling(false);
    }, 700);
  }

  return (
    <div className="space-y-4">
      <StudioCard className="p-5">
        <div className="flex items-start justify-between gap-4">
          <SectionTitle title="Confirm the return" sub="Tax Studio adapts the workspace to the return type you choose. Personal details flow onto the return." />
          {ret.clientId && (
            <button onClick={pullFromClient} disabled={pullingClient} className="btn-secondary shrink-0">
              {pullingClient ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Pull from client
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field icon={FileText} label="Return type" value={`${rt.form} · ${rt.label}`} />
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Calendar size={12} /> Tax year</label>
            <select
              value={ret.taxYear}
              onChange={e => patch(r => ({ ...r, taxYear: e.target.value }))}
              className="input-base py-1.5 text-sm"
            >
              {taxYearOptions().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">UTR</label>
            <input
              value={ret.utr ?? ''}
              onChange={e => patch(r => ({ ...r, utr: e.target.value }))}
              placeholder="10-digit UTR"
              className="input-base py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Taxpayer details (pulled from the client record, editable) */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Date of birth</label>
            <input
              value={ret.taxpayer?.dateOfBirth ?? ''}
              onChange={e => patchTaxpayer({ dateOfBirth: e.target.value })}
              placeholder="dd-mm-yyyy"
              className="input-base py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">National Insurance no.</label>
            <input
              value={ret.taxpayer?.nino ?? ''}
              onChange={e => patchTaxpayer({ nino: e.target.value.toUpperCase() })}
              placeholder="e.g. AB123456C"
              className="input-base py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Amendment</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[var(--border)] bg-white/60 px-3 py-1.5 text-sm text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={ret.amended ?? false}
                onChange={e => patch(r => ({ ...r, amended: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-[var(--accent)]"
              />
              This is an amended return
            </label>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><MapPin size={12} /> Address</label>
          <textarea
            value={ret.taxpayer?.address ?? ''}
            onChange={e => patchTaxpayer({ address: e.target.value })}
            rows={2}
            placeholder="Client's address"
            className="input-base resize-none py-2 text-sm"
          />
        </div>

        {/* Name / address change during the year — flows onto SA100 box 2 (TR1). */}
        <div className="mt-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={ret.taxpayer?.changedInYear ?? false}
              onChange={e => patchTaxpayer({ changedInYear: e.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent)]"
            />
            The client’s name or address changed during the year
          </label>
          {ret.taxpayer?.changedInYear && (
            <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted,#f8fafc)] p-3 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Changed from (old name / address)</label>
                <textarea value={ret.taxpayer?.changeFrom ?? ''} onChange={e => patchTaxpayer({ changeFrom: e.target.value })} rows={3} placeholder="The name / address as previously held" className="input-base resize-none py-2 text-sm" />
              </div>
              <div className="sm:col-span-1">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Changed to (new name / address)</label>
                <textarea value={ret.taxpayer?.changeTo ?? ''} onChange={e => patchTaxpayer({ changeTo: e.target.value })} rows={3} placeholder="The corrected name / address" className="input-base resize-none py-2 text-sm" />
              </div>
              <div className="sm:col-span-2 sm:w-1/2">
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Date of change</label>
                <input value={ret.taxpayer?.changeDate ?? ''} onChange={e => patchTaxpayer({ changeDate: e.target.value })} placeholder="dd-mm-yyyy" className="input-base py-1.5 text-sm" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Relevant context (optional)</label>
          <textarea
            value={ret.context ?? ''}
            onChange={e => patch(r => ({ ...r, context: e.target.value }))}
            rows={2}
            placeholder="Anything SMITH should know — e.g. property sold in year, new employment, one-off events."
            className="input-base resize-none py-2 text-sm"
          />
        </div>
      </StudioCard>

      <StudioCard className="p-5">
        <div className="flex items-start justify-between gap-4">
          <SectionTitle title="Connect the client's data" sub="SMITH pulls figures from every connected module so nothing is keyed twice." />
          <button onClick={pullData} disabled={pulling} className="btn-secondary shrink-0">
            {pulling ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            {connected ? 'Refresh' : 'Connect data'}
          </button>
        </div>
        {connected ? (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ret.connected.map(s => (
              <div key={s.id} className="rounded-xl border border-[var(--border)] bg-white/60 px-3 py-2">
                <p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{s.label}</p>
                <p className="truncate text-[11px] text-[var(--text-muted)]">{s.linked ? s.value : 'Not linked yet'}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">No data connected yet — SMITH will look across Accounts Studio, Payroll, Capture, Landlord Analysis and more.</p>
        )}
      </StudioCard>

      <div className="flex justify-end">
        <button onClick={advance} className="btn-primary">
          Continue to analysis <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"><Icon size={12} /> {label}</p>
      <p className="rounded-lg border border-[var(--border)] bg-white/60 px-3 py-1.5 text-sm font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
