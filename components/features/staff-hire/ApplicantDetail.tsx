'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Upload, Sparkles, Loader2, CheckCircle, XCircle, AlertCircle, Star, FileText, HelpCircle } from 'lucide-react';
import type { JobPosting, JobApplicant, ApplicantQuestions, ApplicantScorecard, ApplicantEvaluation, InterviewQuestion } from '@/types';
import { fileToBase64 } from '@/utils/fileUtils';

interface Props {
  job: JobPosting;
  applicant: JobApplicant;
  onBack: () => void;
  onApplicantUpdate: (updated: JobApplicant) => void;
}

type ActiveTab = 'overview' | 'questions' | 'scorecard';

const RECOMMENDATION_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  strong_yes: { label: 'Strong Yes', className: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300', icon: CheckCircle },
  yes:        { label: 'Yes', className: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400', icon: CheckCircle },
  maybe:      { label: 'Maybe', className: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300', icon: AlertCircle },
  no:         { label: 'No', className: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400', icon: XCircle },
  strong_no:  { label: 'Strong No', className: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', icon: XCircle },
};

const QUESTION_CATEGORY_COLORS: Record<InterviewQuestion['category'], string> = {
  technical: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  behavioural: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  situational: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  cultural_fit: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  experience: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300',
};

export default function ApplicantDetail({ job, applicant: initialApplicant, onBack, onApplicantUpdate }: Props) {
  const [applicant, setApplicant] = useState(initialApplicant);
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [questions, setQuestions] = useState<ApplicantQuestions | null>(null);
  const [scorecard, setScorecard] = useState<ApplicantScorecard | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  // Evaluation state
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [coverLetterFile, setCoverLetterFile] = useState<File | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);

  // Questions state
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  // Scorecard state
  const [generatingScorecard, setGeneratingScorecard] = useState(false);
  const [savingScorecard, setSavingScorecard] = useState(false);
  const [scorecardSaved, setScorecardSaved] = useState(false);
  const [localScorecard, setLocalScorecard] = useState<ApplicantScorecard | null>(null);

  const cvInputRef = useRef<HTMLInputElement | null>(null);
  const clInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    async function load() {
      setLoadingData(true);
      try {
        const res = await fetch(`/api/staff-hire/jobs/${job.id}/applicants/${applicant.id}`);
        if (!res.ok) return;
        const data = await res.json() as { applicant: JobApplicant; questions: ApplicantQuestions | null; scorecard: ApplicantScorecard | null };
        setApplicant(data.applicant);
        setQuestions(data.questions);
        setScorecard(data.scorecard);
        setLocalScorecard(data.scorecard);
      } finally {
        setLoadingData(false);
      }
    }
    load();
  }, [job.id, applicant.id]);

  const handleEvaluate = useCallback(async () => {
    if (!cvFile && !coverLetterFile) return;
    setEvaluating(true);
    setEvalError(null);
    try {
      const files = await Promise.all(
        [cvFile, coverLetterFile].filter(Boolean).map(async f => ({
          name: f!.name,
          mimeType: f!.type || 'application/pdf',
          base64: await fileToBase64(f!),
        }))
      );

      const res = await fetch('/api/staff-hire/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, applicantId: applicant.id, files }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Evaluation failed'); }
      const data = await res.json() as { evaluation: ApplicantEvaluation };
      const updated = { ...applicant, ai_evaluation: data.evaluation, ai_score: data.evaluation.overallScore, ai_summary: data.evaluation.summary };
      setApplicant(updated);
      onApplicantUpdate(updated);
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setEvaluating(false);
    }
  }, [cvFile, coverLetterFile, job.id, applicant, onApplicantUpdate]);

  const handleGenerateQuestions = useCallback(async () => {
    setGeneratingQuestions(true);
    setQuestionsError(null);
    try {
      const files = await Promise.all(
        [cvFile, coverLetterFile].filter(Boolean).map(async f => ({
          name: f!.name,
          mimeType: f!.type || 'application/pdf',
          base64: await fileToBase64(f!),
        }))
      );

      const res = await fetch('/api/staff-hire/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, applicantId: applicant.id, applicantName: applicant.full_name, files }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json() as { questions: InterviewQuestion[]; id: string };
      setQuestions({ id: data.id, applicant_id: applicant.id, job_id: job.id, firm_id: job.firm_id, questions: data.questions, generated_at: new Date().toISOString() });
      setActiveTab('questions');
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : 'Failed to generate questions');
    } finally {
      setGeneratingQuestions(false);
    }
  }, [cvFile, coverLetterFile, job.id, job.firm_id, applicant.id, applicant.full_name]);

  const handleGenerateScorecard = useCallback(async () => {
    setGeneratingScorecard(true);
    try {
      const res = await fetch('/api/staff-hire/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', jobId: job.id, applicantId: applicant.id }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { scorecard: ApplicantScorecard };
      setScorecard(data.scorecard);
      setLocalScorecard(data.scorecard);
      setActiveTab('scorecard');
    } catch {
      alert('Failed to generate scorecard');
    } finally {
      setGeneratingScorecard(false);
    }
  }, [job.id, applicant.id]);

  const handleSaveScorecard = useCallback(async (completed = false) => {
    if (!localScorecard) return;
    setSavingScorecard(true);
    try {
      const overall = computeOverallScore(localScorecard.criteria);
      const res = await fetch('/api/staff-hire/scorecard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          scorecardId: localScorecard.id,
          applicantId: applicant.id,
          criteria: localScorecard.criteria,
          overall_score: overall,
          recommendation: localScorecard.recommendation,
          interviewer_notes: localScorecard.interviewer_notes,
          completed,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as { scorecard: ApplicantScorecard };
      setScorecard(data.scorecard);
      setLocalScorecard(data.scorecard);
      setScorecardSaved(true);
      setTimeout(() => setScorecardSaved(false), 2500);
    } catch {
      alert('Failed to save scorecard');
    } finally {
      setSavingScorecard(false);
    }
  }, [localScorecard, applicant.id]);

  function updateCriterionScore(idx: number, score: number | null) {
    if (!localScorecard) return;
    const criteria = [...localScorecard.criteria];
    criteria[idx] = { ...criteria[idx], score };
    setLocalScorecard({ ...localScorecard, criteria });
  }

  function updateCriterionNotes(idx: number, notes: string) {
    if (!localScorecard) return;
    const criteria = [...localScorecard.criteria];
    criteria[idx] = { ...criteria[idx], notes };
    setLocalScorecard({ ...localScorecard, criteria });
  }

  const evalCfg = applicant.ai_evaluation?.recommendation ? RECOMMENDATION_CONFIG[applicant.ai_evaluation.recommendation] : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="btn-secondary p-2 mt-0.5">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{applicant.full_name}</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {applicant.email ?? ''}{applicant.email && applicant.phone ? ' · ' : ''}{applicant.phone ?? ''}
          </p>
        </div>
        {applicant.ai_score != null && (
          <div className={`text-sm font-semibold px-3 py-1.5 rounded-xl ${applicant.ai_score >= 70 ? 'bg-green-100 dark:bg-green-900/30 text-green-700' : applicant.ai_score >= 50 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700' : 'bg-red-100 dark:bg-red-900/30 text-red-700'}`}>
            {Math.round(applicant.ai_score)}/100
          </div>
        )}
      </div>

      {/* Document upload + AI actions */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Documents & AI Actions</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DocumentUploadSlot
            label="CV / Résumé"
            file={cvFile}
            inputRef={cvInputRef}
            onFile={setCvFile}
            storedFilename={applicant.cv_filename}
          />
          <DocumentUploadSlot
            label="Cover Letter"
            file={coverLetterFile}
            inputRef={clInputRef}
            onFile={setCoverLetterFile}
            storedFilename={applicant.cover_letter_filename}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleEvaluate}
            disabled={evaluating || (!cvFile && !coverLetterFile)}
            className="btn-primary disabled:opacity-40"
          >
            {evaluating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {evaluating ? 'Evaluating…' : applicant.ai_evaluation ? 'Re-evaluate' : 'Evaluate Applicant'}
          </button>
          <button
            onClick={handleGenerateQuestions}
            disabled={generatingQuestions}
            className="btn-secondary"
          >
            {generatingQuestions ? <Loader2 size={14} className="animate-spin" /> : <HelpCircle size={14} />}
            {generatingQuestions ? 'Generating…' : 'Generate Interview Questions'}
          </button>
          {!scorecard && (
            <button onClick={handleGenerateScorecard} disabled={generatingScorecard} className="btn-secondary">
              {generatingScorecard ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
              {generatingScorecard ? 'Generating…' : 'Generate Scorecard'}
            </button>
          )}
        </div>
        {evalError && <p className="text-xs text-red-500">{evalError}</p>}
        {questionsError && <p className="text-xs text-red-500">{questionsError}</p>}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {(['overview', 'questions', 'scorecard'] as ActiveTab[]).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all capitalize ${
              activeTab === t
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t === 'overview' ? 'AI Evaluation' : t === 'questions' ? `Interview Questions${questions ? ` (${questions.questions.length})` : ''}` : 'Scorecard'}
          </button>
        ))}
      </div>

      {loadingData && <div className="glass-solid rounded-xl p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-[var(--accent)]" /></div>}

      {/* Overview tab */}
      {!loadingData && activeTab === 'overview' && (
        <div className="space-y-4">
          {!applicant.ai_evaluation ? (
            <div className="glass-solid rounded-xl p-8 text-center">
              <Sparkles size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Upload the CV and/or cover letter, then click "Evaluate Applicant" to get an AI-powered assessment.</p>
            </div>
          ) : (
            <EvaluationView evaluation={applicant.ai_evaluation} evalCfg={evalCfg} />
          )}
        </div>
      )}

      {/* Interview Questions tab */}
      {!loadingData && activeTab === 'questions' && (
        <div className="space-y-3">
          {!questions ? (
            <div className="glass-solid rounded-xl p-8 text-center">
              <HelpCircle size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Click "Generate Interview Questions" to create tailored questions for this applicant.</p>
            </div>
          ) : (
            questions.questions.map((q, i) => (
              <div key={i} className="glass-solid rounded-xl p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="text-xs font-bold text-[var(--accent)] mt-0.5 w-5 flex-shrink-0">{i + 1}.</span>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="text-sm font-medium text-[var(--text-primary)] flex-1">{q.question}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full capitalize flex-shrink-0 ${QUESTION_CATEGORY_COLORS[q.category]}`}>
                        {q.category.replace('_', ' ')}
                      </span>
                    </div>
                    {q.rationale && <p className="text-xs text-[var(--text-muted)]">{q.rationale}</p>}
                    {q.followUp && (
                      <div className="p-2 rounded-lg bg-[var(--bg-nav-hover)] text-xs text-[var(--text-secondary)]">
                        <span className="font-medium">Follow-up: </span>{q.followUp}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Scorecard tab */}
      {!loadingData && activeTab === 'scorecard' && (
        <div className="space-y-4">
          {!localScorecard ? (
            <div className="glass-solid rounded-xl p-8 text-center">
              <Star size={24} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-muted)]">Click "Generate Scorecard" to create a structured interview scoring sheet for this role.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">Interview Scorecard</p>
                  {localScorecard.completed_at && (
                    <p className="text-xs text-green-500 mt-0.5">Completed {new Date(localScorecard.completed_at).toLocaleDateString('en-GB')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {scorecardSaved && <span className="text-xs text-green-500 font-medium">Saved!</span>}
                  <button onClick={() => handleSaveScorecard(false)} disabled={savingScorecard} className="btn-secondary text-xs">
                    {savingScorecard ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                    Save Progress
                  </button>
                  <button onClick={() => handleSaveScorecard(true)} disabled={savingScorecard} className="btn-primary text-xs">
                    {savingScorecard ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                    Mark Complete
                  </button>
                </div>
              </div>

              {/* Score summary */}
              {computeOverallScore(localScorecard.criteria) !== null && (
                <div className="glass-solid rounded-xl p-4 flex items-center gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-[var(--accent)]">{Math.round(computeOverallScore(localScorecard.criteria) ?? 0)}</p>
                    <p className="text-xs text-[var(--text-muted)]">/ 100</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Weighted Score</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {localScorecard.criteria.filter(c => c.score != null).length} / {localScorecard.criteria.length} criteria scored
                    </p>
                  </div>
                </div>
              )}

              {/* Criteria */}
              <div className="space-y-3">
                {localScorecard.criteria.map((criterion, i) => (
                  <div key={i} className="glass-solid rounded-xl p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--text-primary)]">{criterion.criterion}</p>
                          <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-1.5 py-0.5 rounded">{criterion.category}</span>
                          <span className="text-xs text-[var(--text-muted)]">Weight: {criterion.weight}/5</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">{criterion.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-[var(--text-secondary)] w-12">Score:</p>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(score => (
                          <button
                            key={score}
                            onClick={() => updateCriterionScore(i, criterion.score === score ? null : score)}
                            className={`w-8 h-8 rounded-lg text-sm font-semibold transition-colors ${
                              criterion.score === score
                                ? 'bg-[var(--accent)] text-white'
                                : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]'
                            }`}
                          >
                            {score}
                          </button>
                        ))}
                        {criterion.score != null && (
                          <button onClick={() => updateCriterionScore(i, null)} className="w-8 h-8 rounded-lg text-xs text-[var(--text-muted)] hover:text-red-500 transition-colors">
                            <XCircle size={14} className="mx-auto" />
                          </button>
                        )}
                      </div>
                    </div>
                    <input
                      type="text"
                      value={criterion.notes}
                      onChange={e => updateCriterionNotes(i, e.target.value)}
                      placeholder="Notes…"
                      className="input-base w-full text-xs"
                    />
                  </div>
                ))}
              </div>

              {/* Interviewer notes */}
              <div className="glass-solid rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-[var(--text-secondary)]">Overall Notes & Recommendation</p>
                <textarea
                  value={localScorecard.interviewer_notes ?? ''}
                  onChange={e => setLocalScorecard(s => s ? { ...s, interviewer_notes: e.target.value } : s)}
                  rows={4}
                  placeholder="Overall impressions, additional notes, final recommendation…"
                  className="input-base w-full resize-none text-sm"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EvaluationView({ evaluation, evalCfg }: { evaluation: ApplicantEvaluation; evalCfg: typeof RECOMMENDATION_CONFIG[string] | null }) {
  const RecommendationIcon = evalCfg?.icon ?? CheckCircle;
  return (
    <div className="space-y-4">
      {/* Recommendation banner */}
      {evalCfg && (
        <div className={`flex items-center gap-3 p-4 rounded-xl ${evalCfg.className}`}>
          <RecommendationIcon size={18} />
          <div>
            <p className="text-sm font-semibold">{evalCfg.label}</p>
            <p className="text-xs mt-0.5">{evaluation.recommendationReason}</p>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="glass-solid rounded-xl p-4">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Summary</p>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">{evaluation.summary}</p>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {evaluation.strengths.length > 0 && (
          <div className="glass-solid rounded-xl p-4">
            <p className="text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wide mb-2">Strengths</p>
            <ul className="space-y-1">
              {evaluation.strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                  <CheckCircle size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {evaluation.weaknesses.length > 0 && (
          <div className="glass-solid rounded-xl p-4">
            <p className="text-xs font-medium text-red-600 dark:text-red-400 uppercase tracking-wide mb-2">Weaknesses</p>
            <ul className="space-y-1">
              {evaluation.weaknesses.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                  <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Requirements */}
      {(evaluation.mandatoryRequirementsMet.length > 0 || evaluation.preferredRequirementsMet.length > 0) && (
        <div className="glass-solid rounded-xl p-4 space-y-3">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Requirements Check</p>
          {[
            { items: evaluation.mandatoryRequirementsMet, label: 'Mandatory', badgeClass: 'text-red-600 dark:text-red-400' },
            { items: evaluation.preferredRequirementsMet, label: 'Preferred', badgeClass: 'text-blue-600 dark:text-blue-400' },
          ].map(({ items, label, badgeClass }) => items.length > 0 && (
            <div key={label}>
              <p className={`text-xs font-medium mb-1.5 ${badgeClass}`}>{label}</p>
              <div className="space-y-1.5">
                {items.map((req, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {req.met
                      ? <CheckCircle size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                      : <XCircle size={13} className="text-red-400 mt-0.5 flex-shrink-0" />}
                    <div>
                      <span className="text-xs font-medium text-[var(--text-primary)]">{req.requirement}</span>
                      {req.notes && <span className="text-xs text-[var(--text-muted)] ml-1.5">{req.notes}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Experience assessment */}
      <div className="glass-solid rounded-xl p-4">
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">Experience Assessment</p>
        <p className="text-sm text-[var(--text-primary)] leading-relaxed">{evaluation.experienceAssessment}</p>
      </div>
    </div>
  );
}

function DocumentUploadSlot({ label, file, inputRef, onFile, storedFilename }: {
  label: string;
  file: File | null;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  onFile: (f: File | null) => void;
  storedFilename: string | null | undefined;
}) {
  return (
    <div
      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors hover:border-[var(--accent)] ${file ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)]'}`}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={e => onFile(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className="flex items-center gap-2 justify-center">
          <FileText size={16} className="text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--accent)] truncate max-w-[140px]">{file.name}</span>
          <button onClick={e => { e.stopPropagation(); onFile(null); }} className="text-[var(--accent)] hover:text-red-500">
            <XCircle size={14} />
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <Upload size={16} className="text-[var(--text-muted)] mx-auto" />
          <p className="text-xs font-medium text-[var(--text-secondary)]">{label}</p>
          {storedFilename && <p className="text-xs text-[var(--text-muted)] truncate">Stored: {storedFilename}</p>}
          <p className="text-xs text-[var(--text-muted)]">PDF or image</p>
        </div>
      )}
    </div>
  );
}

function computeOverallScore(criteria: ApplicantScorecard['criteria']): number | null {
  const scored = criteria.filter(c => c.score != null);
  if (scored.length === 0) return null;
  const totalWeight = scored.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = scored.reduce((sum, c) => sum + (c.score! * c.weight), 0);
  return totalWeight > 0 ? (weightedSum / totalWeight) * 20 : null;
}
