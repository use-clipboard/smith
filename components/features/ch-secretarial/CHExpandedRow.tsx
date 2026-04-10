'use client';
import { ExternalLink, UserCheck, Shield, MapPin, Calendar, AlertTriangle, CheckCircle, Clock } from 'lucide-react';
import type { CHCompanyData, CHOfficer, CHPSC } from '@/types/ch';
import { formatCHAddress } from '@/types/ch';

interface Props {
  company: CHCompanyData;
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function DueBadge({ dateStr, overdue }: { dateStr: string | null; overdue?: boolean }) {
  if (!dateStr) return <span className="text-xs text-[var(--text-muted)]">—</span>;
  const days = daysUntil(dateStr);
  if (days === null) return <span className="text-xs text-[var(--text-muted)]">{dateStr}</span>;

  let cls = 'text-xs font-medium px-2 py-0.5 rounded-full ';
  let label = dateStr;
  if (days < 0 || overdue) {
    cls += 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
    label = `${dateStr} (${Math.abs(days)}d overdue)`;
  } else if (days <= 30) {
    cls += 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
    label = `${dateStr} (${days}d)`;
  } else if (days <= 60) {
    cls += 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
    label = `${dateStr} (${days}d)`;
  } else {
    cls += 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
    label = `${dateStr} (${days}d)`;
  }
  return <span className={cls}>{label}</span>;
}

function IdvStatusIcon({ overdue, verified }: { overdue: boolean; verified: boolean }) {
  if (verified) return <span title="IDV verified"><CheckCircle size={13} className="text-emerald-500 shrink-0" /></span>;
  if (overdue) return <span title="IDV overdue"><AlertTriangle size={13} className="text-red-500 shrink-0" /></span>;
  return <span title="IDV not yet due"><CheckCircle size={13} className="text-[var(--text-muted)] shrink-0" /></span>;
}

function OfficerCard({ officer }: { officer: CHOfficer }) {
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${officer.idvExempt ? 'border-[var(--border)] bg-[var(--bg-nav-hover)]' : officer.idvVerified ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800' : officer.idvOverdue ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800' : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{officer.name}</p>
          <p className="text-xs text-[var(--accent)] capitalize mt-0.5">{officer.role.replace(/-/g, ' ')}</p>
        </div>
        {!officer.idvExempt && <IdvStatusIcon overdue={officer.idvOverdue} verified={officer.idvVerified} />}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-1.5">
          <Calendar size={11} className="shrink-0 text-[var(--text-muted)]" />
          <span>Appointed: <strong>{officer.appointedOn || '—'}</strong></span>
        </div>
        {officer.dateOfBirth && (
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="shrink-0 text-[var(--text-muted)]" />
            <span>DOB: {String(officer.dateOfBirth.month).padStart(2, '0')}/{officer.dateOfBirth.year}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 sm:col-span-2">
          <MapPin size={11} className="shrink-0 text-[var(--text-muted)]" />
          <span className="truncate">{formatCHAddress(officer.address) || '—'}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-[var(--text-muted)]">IDV:</span>
        {officer.idvExempt
          ? <span className="text-xs text-[var(--text-muted)] italic">Not required</span>
          : officer.idvVerified
            ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle size={11} /> Verified</span>
            : <DueBadge dateStr={officer.idvDueDate} overdue={officer.idvOverdue} />
        }
      </div>
    </div>
  );
}

function PSCCard({ psc }: { psc: CHPSC }) {
  const kindLabel = psc.kind.replace(/^individual-|^corporate-|^legal-|-with-significant-control$/g, '').replace(/-/g, ' ');
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${psc.idvVerified ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800' : psc.idvOverdue ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800' : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{psc.name}</p>
          <p className="text-xs text-purple-500 capitalize mt-0.5">{kindLabel}</p>
        </div>
        <IdvStatusIcon overdue={psc.idvOverdue} verified={psc.idvVerified} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]">
        <div className="flex items-center gap-1.5">
          <Calendar size={11} className="shrink-0 text-[var(--text-muted)]" />
          <span>Notified: <strong>{psc.notifiedOn || '—'}</strong></span>
        </div>
        {psc.dateOfBirth && (
          <div className="flex items-center gap-1.5">
            <Clock size={11} className="shrink-0 text-[var(--text-muted)]" />
            <span>DOB: {String(psc.dateOfBirth.month).padStart(2, '0')}/{psc.dateOfBirth.year}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 sm:col-span-2">
          <MapPin size={11} className="shrink-0 text-[var(--text-muted)]" />
          <span className="truncate">{formatCHAddress(psc.address) || '—'}</span>
        </div>
      </div>
      {psc.naturesOfControl.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {psc.naturesOfControl.map(n => (
            <span key={n} className="text-xs px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400">
              {n.replace(/-/g, ' ')}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-[var(--text-muted)]">IDV:</span>
        {psc.idvVerified
          ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle size={11} /> Verified</span>
          : <DueBadge dateStr={psc.idvDueDate} overdue={psc.idvOverdue} />
        }
      </div>
    </div>
  );
}

export default function CHExpandedRow({ company }: Props) {
  const address = formatCHAddress(company.registeredOffice);

  return (
    <div className="px-4 pb-4 pt-2 space-y-5 border-t border-[var(--border)] bg-[var(--bg-app)]">

      {/* Top bar — registered office + CH link */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
        <div className="flex items-start gap-2 min-w-0">
          <MapPin size={14} className="text-[var(--accent)] shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Registered Office</p>
            <p className="text-sm text-[var(--text-secondary)]">{address || 'Not available'}</p>
          </div>
        </div>
        <a
          href={company.chUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline shrink-0"
        >
          <ExternalLink size={12} /> View on Companies House
        </a>
      </div>

      {/* Filing dates summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Accounts Due', date: company.accountsNextDue, overdue: company.accountsOverdue, color: 'red' as const },
          { label: 'Confirmation Statement Due', date: company.csNextDue, overdue: company.csOverdue, color: 'red' as const },
          { label: 'Nearest Officer IDV', date: company.nearestOfficerIdvDue, overdue: company.officersIdvOverdueCount > 0 },
          { label: 'Nearest PSC IDV', date: company.nearestPscIdvDue, overdue: company.pscIdvOverdueCount > 0 },
        ].map(({ label, date, overdue }) => (
          <div key={label} className={`rounded-xl p-3 border ${overdue ? 'border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800' : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'}`}>
            <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
            <DueBadge dateStr={date} overdue={overdue} />
          </div>
        ))}
      </div>

      {/* Officers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <UserCheck size={14} className="text-[var(--accent)]" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Officers <span className="text-[var(--text-muted)] font-normal">({company.officers.length} active)</span></p>
          {company.officersIdvOverdueCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
              {company.officersIdvOverdueCount} IDV overdue
            </span>
          )}
        </div>
        {company.officers.length === 0
          ? <p className="text-sm text-[var(--text-muted)] italic">No active officers found.</p>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{company.officers.map((o, i) => <OfficerCard key={i} officer={o} />)}</div>
        }
      </div>

      {/* PSCs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Shield size={14} className="text-purple-500" />
          <p className="text-sm font-semibold text-[var(--text-primary)]">Persons with Significant Control <span className="text-[var(--text-muted)] font-normal">({company.pscs.length} active)</span></p>
          {company.pscIdvOverdueCount > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium">
              {company.pscIdvOverdueCount} IDV overdue
            </span>
          )}
        </div>
        {company.pscs.length === 0
          ? <p className="text-sm text-[var(--text-muted)] italic">No active PSCs found.</p>
          : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{company.pscs.map((p, i) => <PSCCard key={i} psc={p} />)}</div>
        }
      </div>
    </div>
  );
}
