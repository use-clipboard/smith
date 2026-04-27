'use client';

import { Plus, Briefcase, Calendar, Users, ChevronRight, MoreHorizontal, CheckCircle, Clock, XCircle } from 'lucide-react';
import type { JobPosting, EmploymentType, LocationType, JobStatus } from '@/types';

interface Props {
  jobs: JobPosting[];
  loading: boolean;
  onOpenJob: (job: JobPosting) => void;
  onNewJob: () => void;
  onStatusChange: (jobId: string, status: JobStatus) => void;
}

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-Time',
  part_time: 'Part-Time',
  contract: 'Contract',
};

const LOCATION_LABELS: Record<LocationType, string> = {
  in_office: 'In Office',
  remote: 'Remote',
  hybrid: 'Hybrid',
};

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string; icon: React.ElementType }> = {
  active: { label: 'Active', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400', icon: CheckCircle },
  draft: { label: 'Draft', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400', icon: Clock },
  closed: { label: 'Closed', className: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400', icon: XCircle },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function StaffHireDashboard({ jobs, loading, onOpenJob, onNewJob, onStatusChange }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="glass-solid rounded-xl p-5 animate-pulse">
            <div className="flex items-start justify-between">
              <div className="space-y-2 flex-1">
                <div className="h-4 bg-[var(--bg-nav-hover)] rounded w-48" />
                <div className="h-3 bg-[var(--bg-nav-hover)] rounded w-32" />
              </div>
              <div className="h-6 bg-[var(--bg-nav-hover)] rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Job Postings</h2>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {jobs.length === 0 ? 'No positions created yet.' : `${jobs.length} position${jobs.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button onClick={onNewJob} className="btn-primary">
          <Plus size={15} />
          New Job
        </button>
      </div>

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="glass-solid rounded-xl p-12 text-center">
          <div className="w-12 h-12 rounded-full bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-4">
            <Briefcase size={22} className="text-[var(--accent)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">No jobs yet</h3>
          <p className="text-sm text-[var(--text-muted)] mb-5 max-w-xs mx-auto">
            Create your first job posting and start evaluating applicants with AI assistance.
          </p>
          <button onClick={onNewJob} className="btn-primary">
            <Plus size={14} />
            Create First Job
          </button>
        </div>
      )}

      {/* Job list */}
      {jobs.length > 0 && (
        <div className="space-y-3">
          {/* Table header */}
          <div className="hidden lg:grid grid-cols-[1fr_160px_140px_100px_80px_40px] gap-4 px-5 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">
            <span>Role</span>
            <span>Date Created</span>
            <span>Salary</span>
            <span>Applicants</span>
            <span>Status</span>
            <span />
          </div>

          {jobs.map(job => {
            const statusCfg = STATUS_CONFIG[job.status];
            const StatusIcon = statusCfg.icon;
            return (
              <div
                key={job.id}
                className="glass-solid rounded-xl p-5 hover:bg-[var(--bg-nav-hover)] transition-colors cursor-pointer group"
                onClick={() => onOpenJob(job)}
              >
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_160px_140px_100px_80px_40px] gap-3 lg:gap-4 items-center">
                  {/* Title + meta */}
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">
                      {job.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-xs text-[var(--text-muted)]">{EMPLOYMENT_LABELS[job.employment_type]}</span>
                      <span className="text-[var(--border)]">·</span>
                      <span className="text-xs text-[var(--text-muted)]">{LOCATION_LABELS[job.location_type]}</span>
                      {job.location && (
                        <>
                          <span className="text-[var(--border)]">·</span>
                          <span className="text-xs text-[var(--text-muted)]">{job.location}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Date */}
                  <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                    <Calendar size={13} className="text-[var(--text-muted)] flex-shrink-0" />
                    <span className="text-xs">{formatDate(job.created_at)}</span>
                  </div>

                  {/* Salary */}
                  <div className="text-xs text-[var(--text-secondary)]">
                    {job.salary_display ?? (job.salary_from ? `£${job.salary_from.toLocaleString()}${job.salary_to ? ` – £${job.salary_to.toLocaleString()}` : '+'}` : '—')}
                  </div>

                  {/* Applicants */}
                  <div className="flex items-center gap-1.5">
                    <Users size={13} className="text-[var(--text-muted)] flex-shrink-0" />
                    <span className="text-sm font-medium text-[var(--text-primary)]">{job.applicant_count}</span>
                  </div>

                  {/* Status badge */}
                  <div onClick={e => e.stopPropagation()}>
                    <StatusDropdown job={job} onStatusChange={onStatusChange} statusCfg={statusCfg} StatusIcon={StatusIcon} />
                  </div>

                  {/* Arrow */}
                  <div className="hidden lg:flex justify-end">
                    <ChevronRight size={16} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDropdown({
  job,
  onStatusChange,
  statusCfg,
  StatusIcon,
}: {
  job: JobPosting;
  onStatusChange: (jobId: string, status: JobStatus) => void;
  statusCfg: typeof STATUS_CONFIG[JobStatus];
  StatusIcon: React.ElementType;
}) {
  return (
    <div className="relative group/status">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer ${statusCfg.className}`}>
        <StatusIcon size={10} />
        {statusCfg.label}
        <MoreHorizontal size={10} className="opacity-0 group-hover/status:opacity-60 transition-opacity" />
      </span>
      <div className="absolute left-0 top-full mt-1 z-10 hidden group-hover/status:block">
        <div className="glass-solid rounded-lg shadow-lg border border-[var(--border)] py-1 min-w-[110px]">
          {(Object.keys(STATUS_CONFIG) as JobStatus[]).filter(s => s !== job.status).map(s => {
            const cfg = STATUS_CONFIG[s];
            const Icon = cfg.icon;
            return (
              <button
                key={s}
                onClick={() => onStatusChange(job.id, s)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
              >
                <Icon size={12} />
                {cfg.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
