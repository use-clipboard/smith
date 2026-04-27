'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, Lock } from 'lucide-react';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import { useModules } from '@/components/ui/ModulesProvider';
import ToolLayout from '@/components/ui/ToolLayout';
import StaffHireDashboard from '@/components/features/staff-hire/StaffHireDashboard';
import JobCreationWizard from '@/components/features/staff-hire/JobCreationWizard';
import JobDetail from '@/components/features/staff-hire/JobDetail';
import ApplicantDetail from '@/components/features/staff-hire/ApplicantDetail';
import type { JobPosting, JobApplicant, JobStatus, AppState } from '@/types';

type View =
  | { type: 'dashboard' }
  | { type: 'new-job' }
  | { type: 'job-detail'; job: JobPosting }
  | { type: 'applicant-detail'; job: JobPosting; applicant: JobApplicant };

export default function StaffHirePage() {
  const [view, setView] = useState<View>({ type: 'dashboard' });
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [appState] = useState<AppState>('idle');

  const { isModuleActive } = useModules();
  useTabActivitySync('/staff-hire', appState);

  // Check per-user access
  useEffect(() => {
    fetch('/api/staff-hire/access', { method: 'HEAD' })
      .then(r => setHasAccess(r.ok))
      .catch(() => setHasAccess(false));
  }, []);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch('/api/staff-hire/jobs');
      if (!res.ok) return;
      const data = await res.json() as { jobs: JobPosting[] };
      setJobs(data.jobs);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) loadJobs();
  }, [hasAccess, loadJobs]);

  const handleJobCreated = useCallback((job: JobPosting) => {
    setJobs(prev => [job, ...prev]);
    setView({ type: 'job-detail', job });
  }, []);

  const handleStatusChange = useCallback(async (jobId: string, status: JobStatus) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status } : j));
    await fetch(`/api/staff-hire/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
  }, []);

  const handleApplicantUpdate = useCallback((updated: JobApplicant) => {
    if (view.type === 'applicant-detail') {
      setView(v => v.type === 'applicant-detail' ? { ...v, applicant: updated } : v);
    }
  }, [view.type]);

  if (!isModuleActive('staff-hire')) {
    return (
      <ToolLayout title="Staff Hire" icon={UserPlus} iconColor="#7C3AED">
        <div className="glass-solid rounded-xl p-8 text-center">
          <Lock size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">The Staff Hire module is not enabled. Ask your admin to enable it in Settings → Tools.</p>
        </div>
      </ToolLayout>
    );
  }

  if (hasAccess === null) {
    return (
      <ToolLayout title="Staff Hire" icon={UserPlus} iconColor="#7C3AED">
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      </ToolLayout>
    );
  }

  if (hasAccess === false) {
    return (
      <ToolLayout title="Staff Hire" icon={UserPlus} iconColor="#7C3AED">
        <div className="glass-solid rounded-xl p-8 text-center">
          <Lock size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
          <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Access Restricted</p>
          <p className="text-sm text-[var(--text-muted)]">You don&apos;t have access to Staff Hire. Contact your firm admin to request access — this tool contains sensitive information such as salary data.</p>
        </div>
      </ToolLayout>
    );
  }

  return (
    <ToolLayout
      title="Staff Hire"
      description="Manage recruitment — write job postings, evaluate applicants, run interviews, and make AI-powered hiring decisions."
      icon={UserPlus}
      iconColor="#7C3AED"
    >
      {view.type === 'dashboard' && (
        <StaffHireDashboard
          jobs={jobs}
          loading={loadingJobs}
          onOpenJob={job => setView({ type: 'job-detail', job })}
          onNewJob={() => setView({ type: 'new-job' })}
          onStatusChange={handleStatusChange}
        />
      )}

      {view.type === 'new-job' && (
        <JobCreationWizard
          onBack={() => setView({ type: 'dashboard' })}
          onCreated={handleJobCreated}
        />
      )}

      {view.type === 'job-detail' && (
        <JobDetail
          job={view.job}
          onBack={() => { setView({ type: 'dashboard' }); void loadJobs(); }}
          onOpenApplicant={applicant => setView({ type: 'applicant-detail', job: view.job, applicant })}
        />
      )}

      {view.type === 'applicant-detail' && (
        <ApplicantDetail
          job={view.job}
          applicant={view.applicant}
          onBack={() => setView({ type: 'job-detail', job: view.job })}
          onApplicantUpdate={handleApplicantUpdate}
        />
      )}
    </ToolLayout>
  );
}
