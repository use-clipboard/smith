'use client';

import { useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Plus, X, Check, Loader2, Copy, Sparkles, Info } from 'lucide-react';
import type { JobPosting, JobRequirement, EmploymentType, LocationType } from '@/types';

interface WizardData {
  title: string;
  employment_type: EmploymentType;
  location_type: LocationType;
  location: string;
  salary_from: string;
  salary_to: string;
  benefits: string;
  experience_years_min: string;
  requirements: JobRequirement[];
  description: string;
  generated_posting: string;
}

interface Props {
  onBack: () => void;
  onCreated: (job: JobPosting) => void;
}

const STEPS = [
  { title: 'Job Basics', description: 'Title, type, and location' },
  { title: 'Compensation', description: 'Salary and benefits' },
  { title: 'Requirements', description: 'Skills and experience' },
  { title: 'Description', description: 'Role overview' },
  { title: 'Review & Generate', description: 'AI-written job posting' },
];

const REQUIREMENT_CATEGORIES = ['Software', 'Qualification', 'Experience', 'Skill', 'Language', 'Other'];

const INITIAL_DATA: WizardData = {
  title: '',
  employment_type: 'full_time',
  location_type: 'in_office',
  location: '',
  salary_from: '',
  salary_to: '',
  benefits: '',
  experience_years_min: '',
  requirements: [],
  description: '',
  generated_posting: '',
};

export default function JobCreationWizard({ onBack, onCreated }: Props) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [newReq, setNewReq] = useState<Partial<JobRequirement>>({ label: '', category: 'Software', mandatory: true, notes: '' });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const update = useCallback((field: keyof WizardData, value: unknown) => {
    setData(d => ({ ...d, [field]: value }));
  }, []);

  function addRequirement() {
    if (!newReq.label?.trim()) return;
    update('requirements', [...data.requirements, {
      label: newReq.label.trim(),
      category: newReq.category ?? 'Skill',
      mandatory: newReq.mandatory ?? true,
      notes: newReq.notes?.trim() ?? '',
    }]);
    setNewReq({ label: '', category: newReq.category, mandatory: true, notes: '' });
  }

  function removeRequirement(i: number) {
    update('requirements', data.requirements.filter((_, idx) => idx !== i));
  }

  function toggleMandatory(i: number) {
    const reqs = [...data.requirements];
    reqs[i] = { ...reqs[i], mandatory: !reqs[i].mandatory };
    update('requirements', reqs);
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch('/api/staff-hire/generate-posting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job: {
            title: data.title,
            employment_type: data.employment_type,
            location_type: data.location_type,
            location: data.location || null,
            salary_from: data.salary_from ? parseInt(data.salary_from) : null,
            salary_to: data.salary_to ? parseInt(data.salary_to) : null,
            salary_display: buildSalaryDisplay(data),
            benefits: data.benefits || null,
            experience_years_min: data.experience_years_min ? parseInt(data.experience_years_min) : null,
            requirements: data.requirements,
            description: data.description || null,
          },
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const result = await res.json() as { posting: string };
      update('generated_posting', result.posting);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate posting');
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(asDraft = false) {
    setSaving(true);
    try {
      const res = await fetch('/api/staff-hire/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          employment_type: data.employment_type,
          location_type: data.location_type,
          location: data.location || null,
          salary_from: data.salary_from ? parseInt(data.salary_from) : null,
          salary_to: data.salary_to ? parseInt(data.salary_to) : null,
          salary_display: buildSalaryDisplay(data),
          benefits: data.benefits || null,
          experience_years_min: data.experience_years_min ? parseInt(data.experience_years_min) : null,
          requirements: data.requirements,
          description: data.description || null,
          generated_posting: data.generated_posting || null,
          status: asDraft ? 'draft' : 'active',
        }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const result = await res.json() as { job: JobPosting };
      onCreated(result.job);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(data.generated_posting);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canAdvance = () => {
    if (step === 0) return data.title.trim().length > 0;
    if (step === 1) return true;
    if (step === 2) return true;
    if (step === 3) return true;
    return true;
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="btn-secondary p-2">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">New Job Posting</h2>
          <p className="text-xs text-[var(--text-muted)]">{STEPS[step].description}</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-0">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex flex-col items-center gap-1 ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                i < step ? 'bg-[var(--accent)] text-white' :
                i === step ? 'bg-[var(--accent)] text-white ring-4 ring-[var(--accent-light)]' :
                'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'
              }`}>
                {i < step ? <Check size={13} /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium hidden sm:block ${i === step ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
                {s.title}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 transition-colors ${i < step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="glass-solid rounded-xl p-6">
        {/* Step 0: Basics */}
        {step === 0 && (
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Job Basics</h3>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Job Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={data.title}
                onChange={e => update('title', e.target.value)}
                placeholder="e.g. Senior Bookkeeper"
                className="input-base w-full"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Employment Type</label>
                <select value={data.employment_type} onChange={e => update('employment_type', e.target.value)} className="input-base w-full">
                  <option value="full_time">Full-Time</option>
                  <option value="part_time">Part-Time</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Work Location</label>
                <select value={data.location_type} onChange={e => update('location_type', e.target.value)} className="input-base w-full">
                  <option value="in_office">In Office</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Office Location</label>
              <input
                type="text"
                value={data.location}
                onChange={e => update('location', e.target.value)}
                placeholder="e.g. London, UK"
                className="input-base w-full"
              />
              <p className="text-xs text-[var(--text-muted)] mt-1">Optional — shown on the job posting.</p>
            </div>
          </div>
        )}

        {/* Step 1: Compensation */}
        {step === 1 && (
          <div className="space-y-5">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Compensation & Benefits</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Salary From (£/yr)</label>
                <input
                  type="number"
                  value={data.salary_from}
                  onChange={e => update('salary_from', e.target.value)}
                  placeholder="e.g. 30000"
                  className="input-base w-full"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Salary To (£/yr)</label>
                <input
                  type="number"
                  value={data.salary_to}
                  onChange={e => update('salary_to', e.target.value)}
                  placeholder="e.g. 38000"
                  className="input-base w-full"
                  min={0}
                />
              </div>
            </div>
            {(data.salary_from || data.salary_to) && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--accent-light)] text-xs text-[var(--accent)]">
                <Info size={13} />
                Preview: {buildSalaryDisplay(data)}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">Benefits</label>
              <textarea
                value={data.benefits}
                onChange={e => update('benefits', e.target.value)}
                rows={4}
                placeholder="e.g. 28 days holiday, company pension, flexible hours, professional development support..."
                className="input-base w-full resize-none"
              />
            </div>
          </div>
        )}

        {/* Step 2: Requirements */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Requirements</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Mark each requirement as mandatory or preferred. Mandatory requirements must be met for consideration.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                Minimum Experience
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={data.experience_years_min}
                  onChange={e => update('experience_years_min', e.target.value)}
                  placeholder="0"
                  min={0}
                  className="input-base w-24"
                />
                <span className="text-sm text-[var(--text-secondary)]">years</span>
              </div>
            </div>

            {/* Requirements list */}
            {data.requirements.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--text-secondary)]">Added Requirements</p>
                {data.requirements.map((req, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--bg-nav-hover)] group">
                    <button
                      onClick={() => toggleMandatory(i)}
                      className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        req.mandatory
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200'
                          : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200'
                      }`}
                    >
                      {req.mandatory ? 'Mandatory' : 'Preferred'}
                    </button>
                    <span className="text-xs text-[var(--text-muted)] bg-[var(--border)] px-1.5 py-0.5 rounded">
                      {req.category}
                    </span>
                    <span className="text-sm text-[var(--text-primary)] flex-1 min-w-0 truncate">{req.label}</span>
                    {req.notes && <span className="text-xs text-[var(--text-muted)] hidden sm:block truncate max-w-[120px]">{req.notes}</span>}
                    <button onClick={() => removeRequirement(i)} className="text-[var(--text-muted)] hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add requirement form */}
            <div className="border border-dashed border-[var(--border)] rounded-xl p-4 space-y-3">
              <p className="text-xs font-medium text-[var(--text-secondary)]">Add Requirement</p>
              <div className="grid grid-cols-[1fr_120px] gap-2">
                <input
                  type="text"
                  value={newReq.label ?? ''}
                  onChange={e => setNewReq(r => ({ ...r, label: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addRequirement()}
                  placeholder="e.g. Xero, AAT Level 3, Payroll experience"
                  className="input-base"
                />
                <select
                  value={newReq.category ?? 'Software'}
                  onChange={e => setNewReq(r => ({ ...r, category: e.target.value }))}
                  className="input-base"
                >
                  {REQUIREMENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={newReq.mandatory === true}
                    onChange={() => setNewReq(r => ({ ...r, mandatory: true }))}
                    className="text-red-500"
                  />
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">Mandatory</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={newReq.mandatory === false}
                    onChange={() => setNewReq(r => ({ ...r, mandatory: false }))}
                  />
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Preferred</span>
                </label>
                <input
                  type="text"
                  value={newReq.notes ?? ''}
                  onChange={e => setNewReq(r => ({ ...r, notes: e.target.value }))}
                  placeholder="Notes (optional)"
                  className="input-base flex-1"
                />
                <button onClick={addRequirement} disabled={!newReq.label?.trim()} className="btn-primary disabled:opacity-40">
                  <Plus size={14} />
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Description */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Job Description</h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Describe the role in your own words. The AI will use this — along with your other details — to write the full job posting.
              </p>
            </div>
            <textarea
              value={data.description}
              onChange={e => update('description', e.target.value)}
              rows={12}
              placeholder="Describe the day-to-day responsibilities, the type of clients the role will work with, what the team looks like, and anything else that would help a candidate understand the role..."
              className="input-base w-full resize-y"
            />
            <p className="text-xs text-[var(--text-muted)]">
              You can leave this blank — the AI will generate a description based on the title and requirements. But the more context you provide, the better the output.
            </p>
          </div>
        )}

        {/* Step 4: Review & Generate */}
        {step === 4 && (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Job Posting</h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">AI-generated posting ready to publish on Indeed, LinkedIn, or your website.</p>
              </div>
              {data.generated_posting && (
                <button onClick={handleCopy} className="btn-secondary text-xs">
                  <Copy size={13} />
                  {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>
              )}
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl bg-[var(--bg-nav-hover)]">
              <div>
                <p className="text-xs text-[var(--text-muted)]">Title</p>
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{data.title || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)]">Type</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {data.employment_type === 'full_time' ? 'Full-Time' : data.employment_type === 'part_time' ? 'Part-Time' : 'Contract'}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)]">Salary</p>
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">{buildSalaryDisplay(data) || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)]">Requirements</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">{data.requirements.length} ({data.requirements.filter(r => r.mandatory).length} mandatory)</p>
              </div>
            </div>

            {!data.generated_posting && (
              <button onClick={handleGenerate} disabled={generating} className="btn-primary w-full justify-center py-3">
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {generating ? 'Generating Job Posting…' : 'Generate Job Posting with AI'}
              </button>
            )}

            {genError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-sm text-red-600 dark:text-red-400">
                {genError}
              </div>
            )}

            {data.generated_posting && (
              <>
                <textarea
                  value={data.generated_posting}
                  onChange={e => update('generated_posting', e.target.value)}
                  rows={18}
                  className="input-base w-full resize-y font-mono text-xs"
                />
                <div className="flex items-center gap-3 justify-between flex-wrap">
                  <button onClick={handleGenerate} disabled={generating} className="btn-secondary text-xs">
                    {generating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                    Regenerate
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleSave(true)} disabled={saving} className="btn-secondary">
                      {saving ? 'Saving…' : 'Save as Draft'}
                    </button>
                    <button onClick={() => handleSave(false)} disabled={saving} className="btn-primary">
                      {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      {saving ? 'Saving…' : 'Publish Job'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {!data.generated_posting && (
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => handleSave(true)} disabled={saving} className="btn-secondary">
                  {saving ? 'Saving…' : 'Save as Draft (no posting)'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      {step < 4 && (
        <div className="flex items-center justify-between">
          <button onClick={() => step > 0 ? setStep(s => s - 1) : onBack()} className="btn-secondary">
            <ArrowLeft size={14} />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          <button onClick={() => setStep(s => s + 1)} disabled={!canAdvance()} className="btn-primary disabled:opacity-40">
            Next
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function buildSalaryDisplay(data: WizardData): string {
  const from = data.salary_from ? parseInt(data.salary_from) : null;
  const to = data.salary_to ? parseInt(data.salary_to) : null;
  if (!from && !to) return '';
  if (from && to) return `£${from.toLocaleString()} – £${to.toLocaleString()} per annum`;
  if (from) return `£${from.toLocaleString()}+ per annum`;
  return `Up to £${to!.toLocaleString()} per annum`;
}
