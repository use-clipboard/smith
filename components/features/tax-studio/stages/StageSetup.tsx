'use client';

import { useState } from 'react';
import { ArrowRight, Loader2, Link2, Calendar, FileText } from 'lucide-react';
import { StudioCard, SectionTitle } from '../primitives';
import { returnType, taxYearOptions, seedConnectedSources } from '../data';
import type { TaxReturn } from '../types';

export default function StageSetup({
  ret, patch, advance,
}: {
  ret: TaxReturn;
  patch: (u: (r: TaxReturn) => TaxReturn) => void;
  advance: () => void;
}) {
  const [pulling, setPulling] = useState(false);
  const rt = returnType(ret.returnType);
  const connected = ret.connected.length > 0;

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
        <SectionTitle title="Confirm the return" sub="Tax Studio adapts the workspace to the return type you choose." />
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
