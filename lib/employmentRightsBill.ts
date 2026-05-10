/**
 * Employment Rights Bill 2026 — public-facing summaries for the in-app
 * knowledge base.
 *
 * Sources: gov.uk announcements & impact assessments, Parliament Bill text,
 * ACAS guidance. URLs are noted per section so users can verify the latest
 * commencement details — many provisions are phasing in across 2026 and 2027
 * via secondary legislation, and exact start dates have shifted between the
 * draft Bill and Royal Assent.
 *
 * This file is intentionally static (not stored in the DB). Reasons:
 *   1. Content quality is critical — easier to peer-review via PR.
 *   2. No firm should be entering legal text through a CMS form.
 *   3. If wording needs to change firm-specifically, fork to a per-firm
 *      override later.
 */

export type ErBillAudience = 'all' | 'managers';

export interface ErBillTopic {
  id: string;
  title: string;
  /** Who this most concerns. 'all' means worth reading for staff and managers. */
  audience: ErBillAudience;
  /** One-line teaser shown on the index. Plain English; no jargon. */
  summary: string;
  /**
   * Approximate phasing-in window. May still shift via secondary legislation.
   * Examples: '2026', 'Apr 2026', 'Phased through 2026–2027', 'Now in force'.
   */
  status: string;
  /** Bullet points covering the practical detail. Markdown-allowed. */
  keyPoints: string[];
  /** What this means for the audience tagged. */
  forStaff?: string;
  forManagers?: string;
  /** External references. */
  sources: { label: string; url: string }[];
}

export const EMPLOYMENT_RIGHTS_BILL_TOPICS: ErBillTopic[] = [
  // ── Day-one rights ─────────────────────────────────────────────────────
  {
    id: 'day-one-unfair-dismissal',
    title: 'Day-one protection from unfair dismissal',
    audience: 'all',
    summary: 'Removes the historic two-year qualifying period for unfair dismissal claims. Protection starts from day one of employment.',
    status: 'Phased in 2026; statutory probation framework applies during the early period.',
    keyPoints: [
      'Currently, employees can only claim ordinary unfair dismissal after two years of continuous service. The Bill removes that gate.',
      'A statutory probation period (length still being finalised — expected around nine months) applies a lighter dismissal standard during the early months of employment.',
      'Some categories (automatically unfair reasons, e.g. whistleblowing, pregnancy, trade union activity) were already day-one rights and remain so.',
      'Practical effect: firms need a defensible reason and a fair process for dismissing any employee, including new joiners.',
    ],
    forStaff: 'You are protected from unfair dismissal from your first day. During an initial probation period the firm has more latitude on capability dismissals, but they still need a fair process.',
    forManagers: 'Tighten onboarding, regular probation reviews, and performance documentation. Don\'t treat new joiners as "easier to let go" — the bar is no longer "have they been here two years?" but "is the dismissal fair on its merits?".',
    sources: [
      { label: 'gov.uk — Employment Rights Bill: making work pay', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
      { label: 'ACAS — Dismissals', url: 'https://www.acas.org.uk/dismissals' },
    ],
  },
  {
    id: 'statutory-probation',
    title: 'Statutory probation period',
    audience: 'managers',
    summary: 'A new statutory probation framework gives employers a structured early period during which capability dismissals are easier — but still must be fair.',
    status: 'Phased in 2026 alongside day-one unfair dismissal protection.',
    keyPoints: [
      'Length is being finalised by secondary legislation — government has indicated around nine months.',
      'During the statutory probation, the test for a fair dismissal on capability grounds is lower than it is post-probation.',
      'Process still matters: written probation objectives, regular reviews, an opportunity to improve, and a meeting before any dismissal decision.',
      'Doesn\'t apply to automatically-unfair reasons (whistleblowing, pregnancy, trade union activity, etc.) — those remain protected from day one.',
    ],
    forManagers: 'Treat probation as a structured framework, not a free dismissal window. Document objectives at the start, review monthly, and if things aren\'t working out, hold a fair conversation before any decision.',
    sources: [
      { label: 'gov.uk — Employment Rights Bill', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
    ],
  },

  // ── Sexual harassment duty ─────────────────────────────────────────────
  {
    id: 'sexual-harassment-duty',
    title: 'Strengthened duty to prevent sexual harassment',
    audience: 'all',
    summary: 'Builds on the Worker Protection Act 2023 — employers must take "all reasonable steps" (an upgrade from "reasonable steps") to prevent sexual harassment, including by third parties (clients, suppliers).',
    status: 'Worker Protection Act 2023 in force from October 2024; ER Bill 2026 strengthens further.',
    keyPoints: [
      'Employers were already required to take "reasonable steps" to prevent sexual harassment from October 2024.',
      'The ER Bill 2026 raises this to "all reasonable steps" — a higher bar that requires proactive risk assessment, training, and clear reporting routes.',
      'Liability for third-party harassment (clients, suppliers, members of the public) is restored — meaning employers can be liable if they fail to prevent harassment by non-employees.',
      'Anti-harassment training, clear policies, and an accessible disclosure channel are central to demonstrating "all reasonable steps".',
    ],
    forStaff: 'You can raise concerns through the Confidential channel in this app, talk to your manager, or contact ACAS / Citizens Advice. If you\'re in immediate danger, call 999.',
    forManagers: 'Run regular anti-harassment training (annually at minimum). Make sure staff know multiple reporting routes, including ones that bypass their direct manager. Risk-assess situations involving external parties (e.g. client visits, conferences).',
    sources: [
      { label: 'gov.uk — Worker Protection Act guidance', url: 'https://www.gov.uk/government/publications/worker-protection-amendment-of-equality-act-2010-act-2023' },
      { label: 'EHRC — Sexual harassment guidance', url: 'https://www.equalityhumanrights.com/guidance/employers' },
    ],
  },

  // ── Zero hours / predictable working ──────────────────────────────────
  {
    id: 'zero-hours-guaranteed',
    title: 'Right to guaranteed hours after 12 weeks',
    audience: 'all',
    summary: 'Workers on zero-hours or low-hours contracts can request guaranteed contracted hours after 12 weeks of consistent working pattern.',
    status: 'Phased in 2026.',
    keyPoints: [
      'Applies to zero-hours, casual, agency, and low-hours contracts.',
      'After 12 weeks of working a regular pattern, the worker can request a contract that reflects those hours.',
      'Right to reasonable notice of shifts — and compensation if shifts are cancelled or curtailed at short notice.',
      'For most professional accountancy firms, this is unlikely to bite directly — but does apply to seasonal hires, contractors switched to zero-hours, etc.',
    ],
    forManagers: 'Audit any zero-hours or casual workers you have. If they\'re actually working a regular pattern, plan to offer a contract that reflects it — or document why their hours genuinely vary.',
    sources: [
      { label: 'gov.uk — Workers\' Rights factsheets', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
    ],
  },

  // ── Fire and rehire ───────────────────────────────────────────────────
  {
    id: 'fire-and-rehire',
    title: 'Fire and rehire restrictions',
    audience: 'managers',
    summary: 'Dismissing employees and re-engaging them on worse terms ("fire and rehire") is automatically unfair unless the employer can show genuine financial distress and that other options were exhausted.',
    status: 'Phased in 2026.',
    keyPoints: [
      'Dismissal for refusing variations to terms (e.g. pay cut, longer hours) is now automatically unfair, with narrow exceptions.',
      'Exception: where the employer faces genuine financial difficulties affecting the business\'s ability to carry on, AND alternatives have been considered.',
      'Statutory Code of Practice already in force (July 2024) — Bill makes it more enforceable with uplifted compensation for breaches.',
      'Practical impact: terms-and-conditions changes need genuine consultation and consent, not unilateral imposition.',
    ],
    forManagers: 'Don\'t use dismissal as a lever to push contractual changes through. If terms genuinely need to change, document the business reason, consult, and seek consent. Engage employment-law support before contemplating fire-and-rehire.',
    sources: [
      { label: 'gov.uk — Code of Practice on dismissal and re-engagement', url: 'https://www.gov.uk/government/publications/code-of-practice-on-dismissal-and-re-engagement' },
    ],
  },

  // ── SSP ────────────────────────────────────────────────────────────────
  {
    id: 'statutory-sick-pay',
    title: 'Statutory Sick Pay reforms',
    audience: 'all',
    summary: 'SSP becomes a day-one right; the lower earnings limit (~£123/week) is removed; the three-day waiting period is abolished — SSP payable from day one of sickness.',
    status: 'Phased in 2026.',
    keyPoints: [
      'No more 3-day "waiting days" before SSP becomes payable — employees who are off sick get SSP from day one.',
      'Lower Earnings Limit removed — staff earning less than the LEL still qualify for SSP (paid at a percentage of normal earnings, capped).',
      'SSP becomes a day-one right — no qualifying period.',
      'Employer cost impact is real but modest for most professional firms; bigger impact in sectors with frequent short-term absences.',
    ],
    forStaff: 'You\'re entitled to sick pay from day one of any sickness absence (subject to evidence requirements — usually a fit note from day 8).',
    forManagers: 'Update payroll setup and sickness procedures. Run a return-to-work conversation after every absence (the Absence tab in this app tracks this).',
    sources: [
      { label: 'gov.uk — Statutory Sick Pay', url: 'https://www.gov.uk/statutory-sick-pay' },
    ],
  },

  // ── Bereavement leave ──────────────────────────────────────────────────
  {
    id: 'bereavement-leave',
    title: 'Bereavement leave for all staff',
    audience: 'all',
    summary: 'Statutory bereavement leave extended beyond just parental bereavement (which has been law since 2020) to cover any close family bereavement.',
    status: 'Phased in 2026.',
    keyPoints: [
      'Parental Bereavement Leave (2 weeks) has been a day-one right since 2020 for parents losing a child under 18 (or stillbirth from 24 weeks).',
      'The ER Bill extends statutory bereavement leave to all employees losing a close family member.',
      'Length and pay rate of the extended leave are being set by secondary legislation — likely 1-2 weeks unpaid as a baseline, with employers free to enhance.',
      'Cultural / religious mourning practices should be accommodated as part of bereavement leave where reasonable.',
    ],
    forStaff: 'You\'re entitled to time off when someone close to you dies. Speak to your manager — most firms enhance the statutory minimum.',
    forManagers: 'Have a clear bereavement policy that goes beyond the statutory minimum. Be flexible on the timing and length, especially for funerals abroad or extended mourning periods.',
    sources: [
      { label: 'gov.uk — Time off for bereavement', url: 'https://www.gov.uk/parental-bereavement-pay-leave' },
    ],
  },

  // ── Maternity protection ───────────────────────────────────────────────
  {
    id: 'maternity-protection',
    title: 'Extended protection from dismissal — pregnancy, maternity, return-to-work',
    audience: 'all',
    summary: 'Employees are protected from dismissal during pregnancy, maternity leave, and (importantly) for an extended period after return — the protected period extends to 6 months after returning from maternity, adoption, or shared parental leave.',
    status: 'Some elements in force from October 2024 (Protection from Redundancy regs); ER Bill formalises further.',
    keyPoints: [
      'During pregnancy and on family leave, employees on protected leave have priority for any suitable alternative employment in a redundancy situation.',
      'This protection now extends for 18 months from the start of pregnancy (so up to 6 months after return).',
      'Dismissals of pregnant or returning employees on grounds connected to the pregnancy / leave are automatically unfair.',
      'Tribunal compensation for dismissal connected to pregnancy / family leave is uncapped.',
    ],
    forStaff: 'You\'re protected from dismissal because of pregnancy, maternity, or having recently returned. If you suspect a redundancy is connected, raise it (Confidential channel or ACAS) — the bar is high for employers to justify it.',
    forManagers: 'Any redundancy that touches an employee in the 18-month protected window needs careful, documented justification — and they get priority for any suitable alternative role. Get HR / legal sign-off before progressing.',
    sources: [
      { label: 'gov.uk — Protection from Redundancy 2024 regulations', url: 'https://www.legislation.gov.uk/uksi/2024/305' },
      { label: 'ACAS — Pregnancy and maternity', url: 'https://www.acas.org.uk/pregnancy-and-maternity' },
    ],
  },

  // ── Flexible working ──────────────────────────────────────────────────
  {
    id: 'flexible-working',
    title: 'Flexible working as a day-one right',
    audience: 'all',
    summary: 'Right to request flexible working from day one (already in force from April 2024). The ER Bill 2026 strengthens employer obligations around how requests are handled.',
    status: 'Day-one right since April 2024; ER Bill 2026 strengthens process.',
    keyPoints: [
      'Employees can make a flexible-working request from day one of employment (changed from a 26-week qualifying period in April 2024).',
      'Up to 2 statutory requests per 12-month period.',
      'Employer must respond within 2 months and can only refuse on one of eight statutory business grounds (e.g. cost, customer demand, restructuring).',
      'ER Bill 2026 raises the bar: refusal must be "reasonable" and the employer must consult the employee before refusing.',
    ],
    forStaff: 'You can ask to change your hours, working pattern, or location at any time. The firm needs a sound business reason to refuse — and must talk to you first.',
    forManagers: 'When a flexible-working request lands, set up a conversation before deciding. Refusing without consulting risks an automatically unfair process. Document the business reason if you do refuse.',
    sources: [
      { label: 'gov.uk — Flexible working', url: 'https://www.gov.uk/flexible-working' },
      { label: 'ACAS — Flexible working code of practice', url: 'https://www.acas.org.uk/code-of-practice-flexible-working' },
    ],
  },

  // ── Trade union rights ────────────────────────────────────────────────
  {
    id: 'trade-union-rights',
    title: 'Trade union rights and recognition',
    audience: 'managers',
    summary: 'Simplified trade union recognition; right to access the workplace; e-balloting; protections against detriment for union activity.',
    status: 'Phased in 2026–2027.',
    keyPoints: [
      'Lower threshold for trade union recognition (changes to the CAC application process).',
      'Statutory right of access for trade unions to engage with workforce in workplaces.',
      'Electronic balloting permitted for industrial action ballots (currently postal-only).',
      'Repeal of restrictions introduced by the Trade Union Act 2016 (turnout thresholds for ballots, etc.).',
    ],
    forManagers: 'For most professional firms this is low-impact — but if you employ unionised staff or are in a sector with active organising, brief yourself on the new recognition routes.',
    sources: [
      { label: 'gov.uk — Trade union law changes', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
    ],
  },

  // ── Tipping (Allocation of Tips) ──────────────────────────────────────
  {
    id: 'tipping',
    title: 'Allocation of Tips',
    audience: 'all',
    summary: 'All tips, gratuities and service charges must be paid to workers in full, fairly distributed, with a written tipping policy in place.',
    status: 'Now in force — Allocation of Tips Act 2023 commenced October 2024.',
    keyPoints: [
      'Employers must pass on 100% of tips, gratuities, and service charges to workers — they can\'t deduct fees, charges, or admin costs.',
      'Allocation must be "fair and transparent" — and a written policy must be available to staff.',
      'Workers can request a record of how tips were allocated; tribunal can order compensation up to £5k for breaches.',
      'Mainly affects hospitality / customer-facing sectors — minimal direct impact on most accountancy firms.',
    ],
    sources: [
      { label: 'gov.uk — Tipping Act guidance', url: 'https://www.gov.uk/government/publications/distributing-tips-fairly-statutory-code-of-practice' },
    ],
  },

  // ── Fair Work Agency ──────────────────────────────────────────────────
  {
    id: 'fair-work-agency',
    title: 'Fair Work Agency — single enforcement body',
    audience: 'managers',
    summary: 'Consolidates HMRC\'s NMW enforcement, the Gangmasters and Labour Abuse Authority, and the Employment Agency Standards Inspectorate into a single enforcement body.',
    status: 'Phased in 2026.',
    keyPoints: [
      'One body for enforcement of: National Minimum Wage, holiday pay, statutory sick pay, agency worker rights, modern slavery, recruitment standards.',
      'Greater enforcement powers — entry to workplaces, document inspection, civil penalties.',
      'Employers should expect more proactive enforcement on holiday-pay accuracy and NMW compliance.',
    ],
    forManagers: 'Make sure your holiday pay calculations are right (especially for irregular hours / commission / overtime) and that your NMW compliance is documented. Don\'t wait for an investigation — audit annually.',
    sources: [
      { label: 'gov.uk — Fair Work Agency', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
    ],
  },

  // ── Neonatal care leave ────────────────────────────────────────────────
  {
    id: 'neonatal-care',
    title: 'Neonatal Care Leave',
    audience: 'all',
    summary: 'Up to 12 weeks paid leave for parents whose newborn requires neonatal care.',
    status: 'In force from April 2025.',
    keyPoints: [
      'Day-one right — no qualifying period.',
      'Available to parents (mother, father, partner) of a baby admitted to neonatal care within 28 days of birth, for at least 7 continuous days.',
      'Up to 12 weeks paid at the statutory rate — taken in addition to maternity / paternity / shared parental leave.',
      'Notification flexible — given the unpredictable nature of neonatal admissions.',
    ],
    forStaff: 'If your newborn is in neonatal care, you can take up to 12 weeks of paid leave on top of any maternity / paternity leave. Speak to your manager as soon as you can.',
    forManagers: 'Be flexible on notice and process — parents in this situation are dealing with a medical emergency. Get the leave administered through payroll and check in with the family supportively.',
    sources: [
      { label: 'gov.uk — Neonatal Care Leave', url: 'https://www.gov.uk/employers-neonatal-care-leave-pay' },
    ],
  },

  // ── Carer's leave ──────────────────────────────────────────────────────
  {
    id: 'carers-leave',
    title: "Carer's Leave",
    audience: 'all',
    summary: 'One week of unpaid leave per year to care for a dependant with a long-term care need. Day-one right.',
    status: 'In force since April 2024.',
    keyPoints: [
      'Up to 5 working days (one week) of unpaid leave per 12-month period.',
      'Day-one right — no qualifying period.',
      'Covers dependants with long-term care needs (illness, injury, old age, disability) — including spouses, children, parents, or anyone reasonably reliant on the employee.',
      'Can be taken in half-day or single-day chunks; reasonable notice required.',
      'Government has consulted on making it paid — change pending.',
    ],
    forStaff: 'You can take up to 5 days unpaid leave a year to care for a dependant. Plan ahead where possible but emergencies are catered for.',
    forManagers: 'Have a clear policy. Track carer\'s leave separately from sickness or holiday. Be aware paid carer\'s leave is on the policy roadmap.',
    sources: [
      { label: 'gov.uk — Carer\'s Leave', url: 'https://www.gov.uk/carers-leave' },
    ],
  },

  // ── Whistleblowing ─────────────────────────────────────────────────────
  {
    id: 'whistleblowing',
    title: 'Strengthened whistleblowing protections',
    audience: 'all',
    summary: 'The ER Bill expands the categories of "protected disclosure" and increases protection from detriment for whistleblowers, building on the Public Interest Disclosure Act 1998.',
    status: 'Phased in 2026.',
    keyPoints: [
      'Whistleblowing (a "protected disclosure" of wrongdoing in the public interest) is already day-one protected from dismissal under PIDA 1998.',
      'The ER Bill expands the list of protected wrongdoing categories and clarifies the threshold of "reasonable belief" required.',
      'Employer has a strengthened duty not to subject whistleblowers to detriment.',
      'In this app, the Confidential channel can be used to raise whistleblowing concerns — to your manager, a different manager, or the firm\'s Confidential HR Recipient.',
    ],
    forStaff: 'If you\'ve seen wrongdoing — financial impropriety, breaches of regulation, danger to safety, miscarriages of justice — and you reasonably believe it\'s in the public interest to raise, you\'re protected. Use the Confidential channel here, or contact your regulator (ICAEW / ACCA / Public Concern at Work).',
    forManagers: 'A whistleblower must not be dismissed, disciplined, or otherwise detrimentally treated for raising a protected disclosure. Even if the disclosure turns out to be wrong, the protection holds if it was made in good faith.',
    sources: [
      { label: 'gov.uk — Whistleblowing for employees', url: 'https://www.gov.uk/whistleblowing' },
      { label: 'Public Concern at Work (Protect)', url: 'https://protect-advice.org.uk/' },
    ],
  },

  // ── Worker status ──────────────────────────────────────────────────────
  {
    id: 'worker-status',
    title: 'Single worker status (consultation)',
    audience: 'managers',
    summary: 'A proposal to merge "employee" and "worker" into a single status, with self-employed treated as a third distinct category. Still under consultation.',
    status: 'Consultation ongoing — not yet in force.',
    keyPoints: [
      'Currently UK employment law has three statuses: employee, worker, self-employed contractor — each with different rights.',
      'The proposal would simplify to two statuses: a single "worker" category covering current employees and limb-(b) workers, plus genuinely self-employed.',
      'Practical impact: workers (gig economy, casual staff) would gain more employment rights; firms\' classification of contractors becomes more important.',
      'Don\'t plan for this yet — wait for consultation outcome and primary legislation.',
    ],
    forManagers: 'For now: nothing to do beyond making sure your contractor classifications are genuinely correct (i.e. not "disguised employment"). HMRC IR35 rules already test this for tax purposes.',
    sources: [
      { label: 'gov.uk — Single worker status consultation', url: 'https://www.gov.uk/government/publications/employment-rights-bill' },
    ],
  },
];

/** Topic ID → topic, for fast lookup. */
export const ER_BILL_BY_ID = new Map<string, ErBillTopic>(
  EMPLOYMENT_RIGHTS_BILL_TOPICS.map(t => [t.id, t])
);
