'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, UserPlus, Users, Trophy, Copy, Check, ChevronRight, Loader2, Sparkles, Trash2 } from 'lucide-react';
import type { JobPosting, JobApplicant, ApplicantStage, ApplicantRankResult } from '@/types';

interface Props {
  job: JobPosting;
  onBack: () => void;
  onOpenApplicant: (applicant: JobApplicant) => void;
}

const STAGES: { id: ApplicantStage; label: string; color: string }[] = [
  { id: 'applied',              label: 'Applied',              color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300' },
  { id: 'shortlisted',          label: 'Shortlisted',          color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' },
  { id: 'interview_scheduled',  label: 'Interview Scheduled',  color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' },
  { id: 'interviewed',          label: 'Interviewed',          color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' },
  { id: 'offered',              label: 'Offered',              color: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' },
  { id: 'hired',                label: 'Hired',                color: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' },
  { id: 'rejected',             label: 'Rejected',             color: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' },
];

const STAGE_MAP = new Map(STAGES.map(s => [s.id, s]));

const RECOMMENDATION_COLORS: Record<string, string> = {
  hire: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  consider: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  reject: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
};

type ActiveView = 'pipeline' | 'posting' | 'ranking';

export default function JobDetail({ job, onBack, onOpenApplicant }: Props) {
  const [applicants, setApplicants] = useState<JobApplicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<ActiveView>('pipeline');
  const [stageFilter, setStageFilter] = useState<ApplicantStage | 'all'>('all');
  const [addingApplicant, setAddingApplicant] = useState(false);
  const [ranking, setRanking] = useState<{ rankings: ApplicantRankResult[]; overallRecommendation: string } | null>(null);
  const [rankLoading, setRankLoading] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);
  const [postingCopied, setPostingCopied] = useState(false);

  const loadApplicants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff-hire/jobs/${job.id}/applicants`);
      if (!res.ok) return;
      const data = await res.json() as { applicants: JobApplicant[] };
      setApplicants(data.applicants);
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => { loadApplicants(); }, [loadApplicants]);

  const handleStageChange = useCallback(async (applicantId: string, stage: ApplicantStage) => {
    setApplicants(prev => prev.map(a => a.id === applicantId ? { ...a, stage } : a));
    await fetch(`/api/staff-hire/jobs/${job.id}/applicants/${applicantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage }),
    });
  }, [job.id]);

  const handleDelete = useCallback(async (applicantId: string) => {
    if (!confirm('Delete this applicant? This cannot be undone.')) return;
    setApplicants(prev => prev.filter(a => a.id !== applicantId));
    await fetch(`/api/staff-hire/jobs/${job.id}/applicants/${applicantId}`, { method: 'DELETE' });
  }, [job.id]);

  const handleRank = useCallback(async () => {
    setRankLoading(true);
    setRankError(null);
    try {
      const res = await fetch(`/api/staff-hire/jobs/${job.id}/rank`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ranking failed');
      setRanking(data);
      // Reload applicants to reflect updated ranking_position
      await loadApplicants();
      setActiveView('ranking');
    } catch (err) {
      setRankError(err instanceof Error ? err.message : 'Ranking failed');
    } finally {
      setRankLoading(false);
    }
  }, [job.id, loadApplicants]);

  async function handleCopyPosting() {
    await navigator.clipboard.writeText(job.generated_posting ?? '');
    setPostingCopied(true);
    setTimeout(() => setPostingCopied(false), 2000);
  }

  const filtered = stageFilter === 'all' ? applicants : applicants.filter(a => a.stage === stageFilter);
  const evaluatedCount = applicants.filter(a => a.ai_evaluation).length;
  const rankedApplicants = [...applicants].filter(a => a.ranking_position != null).sort((a, b) => (a.ranking_position ?? 999) - (b.ranking_position ?? 999));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="btn-secondary p-2 mt-0.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">{job.title}</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {job.salary_display ?? '—'} · {job.employment_type === 'full_time' ? 'Full-Time' : job.employment_type === 'part_time' ? 'Part-Time' : 'Contract'} · {job.location_type === 'in_office' ? 'In Office' : job.location_type === 'remote' ? 'Remote' : 'Hybrid'}
            {job.location ? ` · ${job.location}` : ''}
          </p>
        </div>
        <button onClick={() => setAddingApplicant(true)} className="btn-primary flex-shrink-0">
          <UserPlus size={15} />
          Add Applicant
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {(['pipeline', 'posting', 'ranking'] as ActiveView[]).map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all capitalize ${
              activeView === v
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {v === 'pipeline' ? `Pipeline (${applicants.length})` : v === 'posting' ? 'Job Posting' : 'AI Ranking'}
          </button>
        ))}
      </div>

      {/* Pipeline tab */}
      {activeView === 'pipeline' && (
        <div className="space-y-4">
          {/* Stage filter */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStageFilter('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === 'all' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              All ({applicants.length})
            </button>
            {STAGES.map(s => {
              const count = applicants.filter(a => a.stage === s.id).length;
              if (count === 0 && stageFilter !== s.id) return null;
              return (
                <button
                  key={s.id}
                  onClick={() => setStageFilter(s.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${stageFilter === s.id ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                >
                  {s.label} ({count})
                </button>
              );
            })}
          </div>

          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="glass-solid rounded-xl p-4 animate-pulse h-16" />
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="glass-solid rounded-xl p-8 text-center">
              <Users size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-muted)]">
                {applicants.length === 0 ? 'No applicants yet. Click "Add Applicant" to get started.' : 'No applicants in this stage.'}
              </p>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="space-y-2">
              {filtered.map(applicant => {
                const stageCfg = STAGE_MAP.get(applicant.stage)!;
                return (
                  <div key={applicant.id} className="glass-solid rounded-xl p-4 hover:bg-[var(--bg-nav-hover)] group transition-colors">
                    <div className="flex items-center gap-3">
                      {/* Rank badge */}
                      {applicant.ranking_position && (
                        <div className="w-7 h-7 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                          #{applicant.ranking_position}
                        </div>
                      )}

                      {/* Name + score */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{applicant.full_name}</p>
                          {applicant.ai_score != null && (
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${applicant.ai_score >= 70 ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' : applicant.ai_score >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                              {Math.round(applicant.ai_score)}/100
                            </span>
                          )}
                        </div>
                        {applicant.ai_summary && (
                          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{applicant.ai_summary}</p>
                        )}
                      </div>

                      {/* Stage selector */}
                      <select
                        value={applicant.stage}
                        onChange={e => handleStageChange(applicant.id, e.target.value as ApplicantStage)}
                        className={`text-xs font-medium px-2 py-1 rounded-full border-0 cursor-pointer ${stageCfg.color}`}
                        onClick={e => e.stopPropagation()}
                      >
                        {STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>

                      {/* View button */}
                      <button
                        onClick={() => onOpenApplicant(applicant)}
                        className="btn-secondary py-1 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        View
                        <ChevronRight size={12} />
                      </button>

                      {/* Delete */}
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(applicant.id); }}
                        className="text-[var(--text-muted)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Posting tab */}
      {activeView === 'posting' && (
        <div className="space-y-4">
          {job.generated_posting ? (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm text-[var(--text-muted)]">Copy this text and paste it directly into Indeed, LinkedIn, or your website.</p>
                <button onClick={handleCopyPosting} className="btn-primary">
                  {postingCopied ? <Check size={14} /> : <Copy size={14} />}
                  {postingCopied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              </div>
              <div className="glass-solid rounded-xl p-5">
                <pre className="text-sm text-[var(--text-primary)] whitespace-pre-wrap font-sans leading-relaxed">
                  {job.generated_posting}
                </pre>
              </div>
            </>
          ) : (
            <div className="glass-solid rounded-xl p-8 text-center">
              <p className="text-sm text-[var(--text-muted)]">No job posting was generated for this role. Edit the job to add one.</p>
            </div>
          )}
        </div>
      )}

      {/* Ranking tab */}
      {activeView === 'ranking' && (
        <div className="space-y-4">
          {evaluatedCount < applicants.length && applicants.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-400">
              {evaluatedCount}/{applicants.length} applicants have been AI evaluated. Evaluate all applicants before generating a ranking.
            </div>
          )}

          {applicants.length < 2 ? (
            <div className="glass-solid rounded-xl p-8 text-center">
              <Trophy size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Add at least 2 applicants to generate an AI ranking.</p>
            </div>
          ) : (
            <>
              <button
                onClick={handleRank}
                disabled={rankLoading || evaluatedCount < applicants.filter(a => a.stage !== 'rejected').length}
                className="btn-primary"
              >
                {rankLoading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {rankLoading ? 'Ranking Applicants…' : rankedApplicants.length > 0 ? 'Re-run AI Ranking' : 'Generate AI Ranking'}
              </button>

              {rankError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
                  {rankError}
                </div>
              )}

              {(ranking ?? rankedApplicants.length > 0) && (
                <div className="space-y-3">
                  {ranking?.overallRecommendation && (
                    <div className="glass-solid rounded-xl p-4">
                      <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">Overall Recommendation</p>
                      <p className="text-sm text-[var(--text-primary)] leading-relaxed">{ranking.overallRecommendation}</p>
                    </div>
                  )}

                  {(ranking?.rankings ?? rankedApplicants.map(a => ({
                    applicantId: a.id,
                    rank: a.ranking_position!,
                    overallScore: a.ai_score ?? 0,
                    hiringRecommendation: a.ai_evaluation?.recommendation === 'strong_yes' || a.ai_evaluation?.recommendation === 'yes' ? 'hire' : a.ai_evaluation?.recommendation === 'maybe' ? 'consider' : 'reject',
                    comparativeSummary: a.ai_summary ?? '',
                  }))).map((r) => {
                    const applicant = applicants.find(a => a.id === r.applicantId);
                    if (!applicant) return null;
                    return (
                      <div key={r.applicantId} className="glass-solid rounded-xl p-4 flex items-start gap-4">
                        <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                          #{r.rank}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{applicant.full_name}</p>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${RECOMMENDATION_COLORS[r.hiringRecommendation] ?? ''}`}>
                              {r.hiringRecommendation === 'hire' ? 'Recommend Hire' : r.hiringRecommendation === 'consider' ? 'Consider' : 'Do Not Hire'}
                            </span>
                            <span className="text-xs text-[var(--text-muted)]">Score: {Math.round(r.overallScore)}/100</span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{r.comparativeSummary}</p>
                        </div>
                        <button onClick={() => onOpenApplicant(applicant)} className="btn-secondary py-1 px-2 text-xs flex-shrink-0">
                          View
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Add Applicant Modal */}
      {addingApplicant && (
        <AddApplicantModal
          jobId={job.id}
          onClose={() => setAddingApplicant(false)}
          onAdded={applicant => {
            setApplicants(prev => [applicant, ...prev]);
            setAddingApplicant(false);
          }}
        />
      )}
    </div>
  );
}

function AddApplicantModal({ jobId, onClose, onAdded }: {
  jobId: string;
  onClose: () => void;
  onAdded: (a: JobApplicant) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/staff-hire/jobs/${jobId}/applicants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name.trim(), email: email.trim() || null, phone: phone.trim() || null }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { applicant: JobApplicant };
      onAdded(data.applicant);
    } catch {
      alert('Failed to add applicant');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="glass-solid rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-5">Add Applicant</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Full Name <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sarah Johnson" className="input-base w-full" autoFocus required />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="sarah@example.com" className="input-base w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="07700 900 000" className="input-base w-full" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={!name.trim() || saving} className="btn-primary disabled:opacity-40">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {saving ? 'Adding…' : 'Add Applicant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
