'use client';

import { useEffect, useState } from 'react';
import {
  Sparkles, ArrowRight, Link2, CheckCircle2, Circle, Activity,
  Mail,
} from 'lucide-react';
import ClientEmailLink from '@/components/features/email/ClientEmailLink';
import { StudioCard, StatusBadge } from './primitives';
import { healthScore, nextBestAction, returnType, fmtDateUK } from './data';
import type { TaxReturn, StageId, ConnectedSource } from './types';

// ─── Return header ───────────────────────────────────────────────────────────
export function ReturnHeader({ ret }: { ret: TaxReturn }) {
  const rt = returnType(ret.returnType);
  const initials = ret.clientName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const Icon = rt.icon;
  // Companies show their accounting period rather than a tax year.
  const periodLabel = ret.returnType === 'ct600' && ret.periodStart && ret.periodEnd
    ? `${fmtDateUK(ret.periodStart)} – ${fmtDateUK(ret.periodEnd)}`
    : ret.taxYear;
  return (
    <StudioCard className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[15px] font-bold text-[var(--accent)]">{initials}</div>
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-[var(--text-primary)]">{ret.clientName}</h3>
          <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
            <Icon size={12} /> {rt.form} · {rt.label} · {periodLabel}
            {ret.amended && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">Amended</span>}
            {ret.late && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Late</span>}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
          <HeaderField label="Entity" value={ret.entityLabel} />
          <HeaderField label="UTR" value={ret.utr || '—'} />
          <HeaderField label="Client ref" value={ret.clientRef || '—'} />
          <ClientEmailField ret={ret} />
          <HeaderField label="Prepared by" value={ret.preparedBy || '—'} />
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">Status</p>
            <span className="mt-0.5 inline-block"><StatusBadge status={ret.status} /></span>
          </div>
        </div>
      </div>
    </StudioCard>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{value || '—'}</p>
    </div>
  );
}

function ClientEmailField({ ret }: { ret: TaxReturn }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!ret.clientId) { setEmail(null); setLoaded(true); return; }
    setLoaded(false);
    fetch(`/api/clients/${ret.clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setEmail(d?.client?.contact_email ?? null); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [ret.clientId]);
  return (
    <div className="min-w-0 max-w-[220px]">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">Client email</p>
      {email && ret.clientId ? (
        <ClientEmailLink
          email={email}
          client={{ id: ret.clientId, name: ret.clientName, client_ref: ret.clientRef, contact_email: email }}
          className="flex max-w-full items-center gap-1 text-[13px] font-semibold text-[var(--accent)] hover:underline"
        >
          <Mail size={12} className="shrink-0" />
          <span className="truncate">{email}</span>
        </ClientEmailLink>
      ) : (
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{loaded ? '—' : '…'}</p>
      )}
    </div>
  );
}

// ─── Tax Health Score ────────────────────────────────────────────────────────
const BAND_RING: Record<'green' | 'amber' | 'red', string> = {
  green: 'text-emerald-500', amber: 'text-amber-500', red: 'text-rose-500',
};
const BAND_LABEL: Record<'green' | 'amber' | 'red', string> = {
  green: 'Healthy', amber: 'Needs attention', red: 'At risk',
};

export function HealthScoreCard({ ret }: { ret: TaxReturn }) {
  const h = healthScore(ret);
  const circ = 2 * Math.PI * 26;
  return (
    <StudioCard className="p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-[68px] w-[68px] shrink-0">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r="26" fill="none" strokeWidth="7" className="stroke-slate-200/70" />
            <circle cx="32" cy="32" r="26" fill="none" strokeWidth="7" strokeLinecap="round"
              className={BAND_RING[h.band]}
              strokeDasharray={circ} strokeDashoffset={circ * (1 - h.score / 100)} />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[17px] font-extrabold text-[var(--text-primary)]">{h.score}%</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">
            <Activity size={14} className={BAND_RING[h.band]} /> Tax Health Score
          </p>
          <p className="text-[12px] text-[var(--text-muted)]">{BAND_LABEL[h.band]}</p>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {h.factors.map(f => (
          <div key={f.key} className="flex items-center gap-2">
            <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-200/70">
              <div className={`h-full rounded-full ${f.score >= 85 ? 'bg-emerald-400' : f.score >= 60 ? 'bg-amber-400' : 'bg-rose-400'}`} style={{ width: `${f.score}%` }} />
            </div>
            <span className="flex-1 truncate text-[11.5px] text-[var(--text-secondary)]">{f.label}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{f.note}</span>
          </div>
        ))}
      </div>
    </StudioCard>
  );
}

// ─── Next Best Action ────────────────────────────────────────────────────────
export function NextBestActionCard({ ret, onGo }: { ret: TaxReturn; onGo: (s: StageId) => void }) {
  const a = nextBestAction(ret);
  return (
    <StudioCard className="overflow-hidden">
      <div className="relative px-4 py-4" style={{ background: 'linear-gradient(135deg,#4F46E5 0%,#7C3AED 100%)' }}>
        <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/15 blur-2xl" />
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-white/80">
          <Sparkles size={13} /> Next best action
        </p>
        <p className="mt-1.5 text-[15px] font-bold text-white">{a.label}</p>
        <p className="mt-0.5 text-[12px] text-white/85">{a.detail}</p>
        <button onClick={() => onGo(a.stage)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur transition-colors hover:bg-white/30">
          Go there <ArrowRight size={13} />
        </button>
      </div>
    </StudioCard>
  );
}

// ─── Connected Data panel ────────────────────────────────────────────────────
export function ConnectedDataCard({ sources }: { sources: ConnectedSource[] }) {
  return (
    <StudioCard className="p-4">
      <p className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-[var(--text-primary)]">
        <Link2 size={14} className="text-[var(--accent)]" /> Connected data
      </p>
      <div className="space-y-2">
        {sources.map(s => (
          <div key={s.id} className="flex items-center gap-2.5">
            {s.linked
              ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
              : <Circle size={13} className="shrink-0 text-slate-300" />}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{s.label}</p>
              <p className="truncate text-[11px] text-[var(--text-muted)]">{s.detail}</p>
            </div>
            <span className={`shrink-0 text-[11.5px] font-medium ${s.linked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>{s.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 border-t border-black/5 pt-2 text-[10.5px] text-[var(--text-muted)]">
        Live cross-module reads arrive in a later increment — links shown reflect what SMITH can currently see.
      </p>
    </StudioCard>
  );
}

// ─── Timeline (compact) ──────────────────────────────────────────────────────
export function TimelineCard({ ret }: { ret: TaxReturn }) {
  if (!ret.timeline.length) {
    return (
      <StudioCard className="p-4">
        <p className="mb-1 text-[13px] font-bold text-[var(--text-primary)]">Timeline</p>
        <p className="text-[12px] text-[var(--text-muted)]">Activity on this return will appear here.</p>
      </StudioCard>
    );
  }
  const events = [...ret.timeline].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
  return (
    <StudioCard className="p-4">
      <p className="mb-3 text-[13px] font-bold text-[var(--text-primary)]">Timeline</p>
      <div className="space-y-2.5">
        {events.map(e => (
          <div key={e.id} className="flex gap-2.5">
            <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />
            <div className="min-w-0">
              <p className="text-[12px] text-[var(--text-secondary)]">{e.label}</p>
              <p className="text-[10.5px] text-[var(--text-muted)]">{fmtDateUK(e.at)}{e.actor ? ` · ${e.actor}` : ''}</p>
            </div>
          </div>
        ))}
      </div>
    </StudioCard>
  );
}
