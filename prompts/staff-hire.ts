import type { JobPosting, JobApplicant } from '@/types';

/** Build a readable requirements list for prompts */
function formatRequirements(requirements: JobPosting['requirements']): string {
  if (!requirements.length) return 'None specified.';
  const mandatory = requirements.filter(r => r.mandatory);
  const preferred = requirements.filter(r => !r.mandatory);
  const lines: string[] = [];
  if (mandatory.length) {
    lines.push('MANDATORY:');
    mandatory.forEach(r => lines.push(`  - ${r.label} [${r.category}]${r.notes ? ` — ${r.notes}` : ''}`));
  }
  if (preferred.length) {
    lines.push('PREFERRED:');
    preferred.forEach(r => lines.push(`  - ${r.label} [${r.category}]${r.notes ? ` — ${r.notes}` : ''}`));
  }
  return lines.join('\n');
}

function employmentTypeLabel(t: JobPosting['employment_type']): string {
  return t === 'full_time' ? 'Full-Time' : t === 'part_time' ? 'Part-Time' : 'Contract';
}

function locationTypeLabel(t: JobPosting['location_type']): string {
  return t === 'in_office' ? 'In Office' : t === 'remote' ? 'Remote' : 'Hybrid';
}

// ─── Generate Job Posting ─────────────────────────────────────────────────────

export function buildGeneratePostingPrompt(job: Partial<JobPosting> & { title: string }): string {
  return `You are an expert HR copywriter specialising in accountancy and professional services recruitment.
Write a compelling, professional job posting for the following role. The posting should be suitable for uploading directly to Indeed, LinkedIn, or a firm's careers page.

JOB DETAILS:
- Title: ${job.title}
- Employment Type: ${employmentTypeLabel(job.employment_type ?? 'full_time')}
- Location Type: ${locationTypeLabel(job.location_type ?? 'in_office')}${job.location ? `\n- Location: ${job.location}` : ''}
- Salary: ${job.salary_display ?? (job.salary_from ? `£${job.salary_from.toLocaleString()}${job.salary_to ? ` – £${job.salary_to.toLocaleString()}` : ''} per annum` : 'Competitive')}
- Minimum Experience: ${job.experience_years_min ? `${job.experience_years_min} year${job.experience_years_min !== 1 ? 's' : ''}` : 'Not specified'}

REQUIREMENTS:
${formatRequirements(job.requirements ?? [])}

JOB DESCRIPTION:
${job.description ?? '(No description provided — generate a suitable description based on the role title and requirements.)'}

BENEFITS:
${job.benefits ?? 'Standard benefits package.'}

FORMAT YOUR RESPONSE AS VALID JSON with a single key "posting" containing the full job posting as a string.
Use plain text with double newlines between paragraphs and "\\n\\n" for new lines. Include: a compelling opening paragraph, a "About the Role" section, a "Key Responsibilities" section (bullet points using • character), a "Requirements" section (separating mandatory from preferred), a "What We Offer" section with benefits, and a closing call-to-action paragraph.
Do not include a salary line unless salary_display is provided. Do not invent specific company names — use "our firm" or "the firm".`;
}

// ─── Evaluate Applicant ───────────────────────────────────────────────────────

export function buildEvaluateApplicantPrompt(job: JobPosting): string {
  return `You are a senior HR professional and accountancy practice manager evaluating a job applicant.

Review the attached CV and cover letter (if provided) for the following role and produce a structured evaluation.

ROLE: ${job.title}
Employment Type: ${employmentTypeLabel(job.employment_type)}
Location: ${locationTypeLabel(job.location_type)}${job.location ? ` — ${job.location}` : ''}
Minimum Experience Required: ${job.experience_years_min ? `${job.experience_years_min} years` : 'Not specified'}

REQUIREMENTS:
${formatRequirements(job.requirements)}

JOB DESCRIPTION:
${job.description ?? 'See requirements above.'}

Respond with ONLY valid JSON matching this exact schema:
{
  "overallScore": <number 0-100>,
  "summary": "<2-3 sentence summary of the candidate>",
  "strengths": ["<strength 1>", "<strength 2>", ...],
  "weaknesses": ["<weakness 1>", "<weakness 2>", ...],
  "mandatoryRequirementsMet": [
    { "requirement": "<requirement label>", "met": <true|false>, "notes": "<brief evidence or gap>" }
  ],
  "preferredRequirementsMet": [
    { "requirement": "<requirement label>", "met": <true|false>, "notes": "<brief evidence or gap>" }
  ],
  "experienceAssessment": "<paragraph assessing whether their experience level matches the role>",
  "recommendation": "<strong_yes|yes|maybe|no|strong_no>",
  "recommendationReason": "<1-2 sentences explaining the recommendation>"
}`;
}

// ─── Generate Interview Questions ─────────────────────────────────────────────

export function buildInterviewQuestionsPrompt(job: JobPosting, applicantName: string): string {
  return `You are a senior accountancy practice manager preparing for a job interview.

Generate 12–15 targeted interview questions for ${applicantName}, who is being interviewed for the following role.
The questions should be personalised to both the job requirements and this specific candidate's background as described in their attached CV.

ROLE: ${job.title}
Employment Type: ${employmentTypeLabel(job.employment_type)}
Minimum Experience: ${job.experience_years_min ? `${job.experience_years_min} years` : 'Not specified'}

REQUIREMENTS:
${formatRequirements(job.requirements)}

JOB DESCRIPTION:
${job.description ?? 'See requirements above.'}

Include a mix of: technical questions (testing specific skills/software), behavioural questions (past experience/STAR format), situational questions (hypothetical scenarios), cultural fit questions, and experience verification questions.

Respond with ONLY valid JSON:
{
  "questions": [
    {
      "question": "<the interview question>",
      "category": "<technical|behavioural|situational|cultural_fit|experience>",
      "rationale": "<why this question is relevant to the role or candidate>",
      "followUp": "<optional follow-up question>"
    }
  ]
}`;
}

// ─── Generate Scorecard ───────────────────────────────────────────────────────

export function buildScorecardPrompt(job: JobPosting): string {
  return `You are an HR professional creating a structured interview scorecard for the following role.

Generate a comprehensive scorecard with 8–12 criteria that an interviewer should assess during and after the interview.
Each criterion should have a weight (1 = low importance, 5 = critical) reflecting its importance to this specific role.

ROLE: ${job.title}
Employment Type: ${employmentTypeLabel(job.employment_type)}
Minimum Experience: ${job.experience_years_min ? `${job.experience_years_min} years` : 'Not specified'}

REQUIREMENTS:
${formatRequirements(job.requirements)}

JOB DESCRIPTION:
${job.description ?? 'See requirements above.'}

Respond with ONLY valid JSON:
{
  "criteria": [
    {
      "category": "<e.g. Technical Skills, Communication, Cultural Fit, Experience>",
      "criterion": "<short criterion name, e.g. 'Xero Proficiency'>",
      "description": "<what to assess and look for>",
      "weight": <1-5>,
      "score": null,
      "notes": ""
    }
  ],
  "recommendation": ""
}`;
}

// ─── Rank Applicants ──────────────────────────────────────────────────────────

export function buildRankApplicantsPrompt(
  job: JobPosting,
  applicants: Array<{ id: string; name: string; score: number | null; summary: string | null; evaluation: JobApplicant['ai_evaluation'] }>
): string {
  const applicantList = applicants
    .map((a, i) => `APPLICANT ${i + 1}: ${a.name} (ID: ${a.id})
  Score: ${a.score ?? 'Not evaluated'}
  Summary: ${a.summary ?? 'No evaluation available'}
  Recommendation: ${a.evaluation?.recommendation ?? 'N/A'}`)
    .join('\n\n');

  return `You are a senior HR director making final hiring recommendations for the following role.

ROLE: ${job.title}
${job.description ? `Description: ${job.description}` : ''}

REQUIREMENTS:
${formatRequirements(job.requirements)}

You have ${applicants.length} applicant${applicants.length !== 1 ? 's' : ''} to rank:

${applicantList}

Rank all applicants from best to worst for this role. For each, provide a hiring recommendation (hire/consider/reject) and a brief comparative summary explaining where they stand relative to others.

Respond with ONLY valid JSON:
{
  "rankings": [
    {
      "applicantId": "<id>",
      "rank": <number starting at 1>,
      "overallScore": <number 0-100>,
      "hiringRecommendation": "<hire|consider|reject>",
      "comparativeSummary": "<2-3 sentences comparing this applicant to others and justifying their ranking>"
    }
  ],
  "overallRecommendation": "<paragraph with your overall hiring recommendation — who to hire, who to keep in reserve, and who to decline>"
}`;
}
