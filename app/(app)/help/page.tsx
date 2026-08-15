'use client';

import React, { useState } from 'react';
import {
  Key, Users, Puzzle, Sparkles, HelpCircle, CreditCard, FileSearch,
  ArrowLeftRight, Building2, ClipboardCheck, Gauge, Receipt,
  ShieldAlert, FileText, Archive, BookOpen, ChevronDown, ChevronRight,
  ExternalLink, CalendarDays, MicVocal, UserPlus, Mail, ListChecks,
  HeartHandshake,
} from 'lucide-react';

type Section = 'getting-started' | 'tools' | 'api-key' | 'team' | 'billing' | 'faq';
type FAQ = { q: string; a: React.ReactNode };

const FAQS: FAQ[] = [
  {
    q: 'Is SMITH GDPR compliant? Is our client data safe when it\'s sent to the AI?',
    a: (
      <span>
        Yes — SMITH is designed with UK GDPR in mind, and the Anthropic API provides strong data protections:
        <ul className="mt-2 space-y-1.5 list-none">
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span>Anthropic does <strong>not</strong> use API request data to train its models. This is a contractual commitment, not just a policy — it applies to all API users by default.</li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span>All data is encrypted in transit (HTTPS/TLS) and never stored by SMITH in plain text.</li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span>Your client data is scoped to your firm only — no other SMITH firm can access it.</li>
        </ul>
        <span className="block mt-3">
          For formal compliance purposes — such as answering client due diligence questionnaires or satisfying an audit — you should sign Anthropic&apos;s <strong>Data Processing Agreement (DPA)</strong>. This is a legal contract that formalises how Anthropic handles data on your behalf as a data processor under UK/EU GDPR. You can request it by emailing <a href="mailto:privacy@anthropic.com" className="text-[var(--accent)] hover:underline">privacy@anthropic.com</a> or visiting their legal pages at <a href="https://www.anthropic.com/legal" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">anthropic.com/legal <ExternalLink size={11} /></a>.
        </span>
      </span>
    ),
  },
  {
    q: 'What happens if multiple users run AI tools at the same time?',
    a: (
      <span>
        Anthropic enforces <strong>rate limits</strong> per account — these cap how many tokens and requests can be processed per minute. If several users run heavy jobs simultaneously, you may briefly hit these limits.
        <span className="block mt-2">SMITH handles this automatically: if a rate limit is hit, it retries the request up to four times using exponential backoff. Most users will not notice any delay.</span>
        <span className="block mt-2">If your firm runs a high volume of concurrent jobs regularly, upgrading your Anthropic usage tier (by increasing spend on your Anthropic account) will raise these limits. See the <strong>AI & API Key → Rate Limits</strong> section of this Help centre for the full breakdown.</span>
      </span>
    ),
  },
  {
    q: 'Why won\'t the AI tools work?',
    a: 'SMITH requires an Anthropic API key to be configured for your firm. Go to Settings → AI & API Key and add your key. If you\'re not an admin, ask your firm admin to do this.',
  },
  {
    q: 'How do I add team members?',
    a: 'Go to Settings → Account → Team Members. Click "Invite Member" and enter their email and role. They\'ll receive an invite email with a link to set up their account.',
  },
  {
    q: 'Can I have more than one admin?',
    a: 'Yes — you can promote any staff member to admin in Settings → Account → Team Members. There must always be at least one admin on the account.',
  },
  {
    q: 'Can I remove an admin?',
    a: 'Yes, but only if there is at least one other admin remaining. SMITH prevents you from removing the last admin to avoid locking the account.',
  },
  {
    q: 'What file types can I upload?',
    a: 'PDF documents, images (JPG, PNG, WebP), and CSV/Excel files for bank statements. PDFs and images are sent to the AI via base64 encoding.',
  },
  {
    q: 'How are my documents stored?',
    a: 'Documents are stored in your connected Google Drive folder. SMITH does not store file contents in its own database — only metadata (file name, date, tags) is stored in Supabase.',
  },
  {
    q: 'Is my data secure?',
    a: 'Yes. All data is scoped to your firm using Row Level Security (RLS) in Supabase. No other firm can access your data. Your API key is stored encrypted and never exposed to the browser.',
  },
  {
    q: 'What happens if I run out of Anthropic credits?',
    a: 'AI tools will stop working and return an error. You\'ll need to top up your Anthropic account at console.anthropic.com. SMITH will automatically resume working once your account has credit.',
  },
  {
    q: 'Can staff see the API key?',
    a: 'No. The API key is only visible to admins in Settings → AI & API Key. Staff cannot view or change it.',
  },
  {
    q: 'How do I switch between dark and light mode?',
    a: 'Go to Settings → Appearance and choose Light, Dark, or System (which follows your device preference).',
  },
  {
    q: 'Meeting Notes says microphone access is blocked — how do I fix it?',
    a: 'Your browser has blocked microphone access for SMITH. Click the padlock (or tune) icon in the address bar at the top of your browser, find the Microphone permission, and change it to "Allow". Then refresh the page and try again. You can also check your current permission status in Settings → Preferences → Device Permissions.',
  },
  {
    q: 'How do I revoke microphone or camera access?',
    a: 'Go to Settings → Preferences → Device Permissions. If a permission has been granted, you\'ll see a "Revoke" button next to it. Clicking it will show you step-by-step instructions for revoking access via your browser\'s address bar padlock — browser security means this must be done through the browser itself rather than within the app.',
  },
  {
    q: 'Can I share a calendar event with a client?',
    a: 'The Calendar is a shared internal team calendar — it is visible to all staff members in your firm. You can invite other team members as guests to receive in-app notifications. It is not currently designed to share events directly with clients outside the firm.',
  },
  {
    q: 'Where are my meeting notes saved?',
    a: 'Meeting notes are saved to the linked client\'s Timeline tab on the client record page. Open a client, go to the Timeline tab, and you\'ll see all saved meeting notes alongside other notes and documents for that client.',
  },
  {
    q: 'How do I connect my Gmail to Email?',
    a: 'Go to Settings → Email and click "Connect Gmail Account". You\'ll be redirected to Google to authorise SMITH. Once connected, your inbox loads automatically and refreshes every 30 seconds. Each team member connects their own individual Gmail account.',
  },
  {
    q: 'Are my emails stored in SMITH?',
    a: 'No — emails are read live from Gmail and are never stored in SMITH\'s database. Only allocation metadata (which threads are linked to which clients or tasks) is stored. Email content stays in Gmail at all times.',
  },
  {
    q: 'How do I edit my email signature in SMITH?',
    a: 'Go to Settings → Email → Email Signature. Use the built-in editor to write or update your signature (Bold, Italic, Underline, and link insertion are supported). Click "Save Signature" and it is written directly back to Gmail — it will appear on emails sent from any device, including Gmail on mobile.',
  },
  {
    q: 'What is the difference between Reply, Reply All, and Forward?',
    a: (
      <span>
        <ul className="space-y-1.5 list-none mt-1">
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>Reply</strong> — sends your response only to the person who sent the email.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>Reply All</strong> — sends your response to the original sender and all CC'd recipients. The original CC list is pre-filled automatically.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>Forward</strong> — opens a new compose window with the original message quoted and any attachments pre-loaded, so you can send it to someone new.</span></li>
        </ul>
      </span>
    ),
  },
  {
    q: 'Can I allocate an email to a client when sending or replying?',
    a: 'Yes — the compose window has an Allocate button in the footer. Click it to link the sent email to one or more client records; it will then appear on their Timeline. If you\'re replying to a thread that already has a client allocated, SMITH pre-fills that client automatically (you can change or remove it before sending).',
  },
  {
    q: 'Who can access the Staff Hire tool?',
    a: 'Admins always have access. Staff members must be explicitly granted access by an admin, because the tool contains sensitive information such as salary data and applicant records. Admins can manage access in Settings → Staff Hire.',
  },
  {
    q: 'How does the Staff Hire AI ranking work?',
    a: 'Once you have evaluated at least two applicants using their CV and/or cover letter, you can run the AI Ranking from the job\'s Ranking tab. The AI compares all evaluated applicants against the job requirements and each other, then produces a ranked list with a hire/consider/reject recommendation for each person, plus an overall hiring recommendation.',
  },
  {
    q: 'What is the difference between the Tasks views (My Tasks, My Week, All Tasks, etc.)?',
    a: (
      <span>
        The sidebar groups views into two sections:
        <ul className="mt-2 space-y-1.5 list-none">
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>My Tasks</strong> — all tasks that have at least one step assigned to you, regardless of due date.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>My Week</strong> — your tasks with steps due within the current week.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>My Month</strong> — your tasks with steps due within the current month.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>All Tasks</strong> — every task across the whole firm.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>By Client</strong> — tasks grouped by client — useful for a quick client job review.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>By Team</strong> — tasks grouped by assignee — useful for workload reviews.</span></li>
          <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>By Type</strong> — tasks grouped by task type or template.</span></li>
        </ul>
      </span>
    ),
  },
  {
    q: 'What does the "Records Here" status mean?',
    a: 'Records Here is a task status that means the client\'s records (invoices, bank statements, etc.) have arrived and the job is ready to start. It sits between "Waiting on Client" and "Review" in the workflow. Use the status filter on the task list to quickly pull up all tasks with Records Here — these are the jobs that can be picked up immediately.',
  },
  {
    q: 'How do I expand the step checklist on a task without opening the full detail panel?',
    a: 'Click the chevron (›) icon on the left of any task row in the list view. This expands an inline panel below the row showing all steps with checkboxes, a progress bar, and a task status dropdown. You can tick steps, mark the task complete, and leave notes — all without leaving the list view. Click the chevron again to collapse it.',
  },
  {
    q: 'How do step comments work? Who can see them?',
    a: 'Every step in a task has an inline notes area. Comments are visible to and postable by all firm members — they are shared across the whole firm, not private to one user. Comments load automatically when you expand a task or open the detail panel. Click the "Add a note…" ghost input to open the thread and post a comment. The most recent comment is always previewed in the collapsed row so you can see activity at a glance.',
  },
  {
    q: 'Can I edit or delete a comment someone else left?',
    a: 'No — you can only edit or delete your own comments. Hover over one of your own comments to reveal the pencil (edit) and bin (delete) icons. Other users\' notes are read-only for you.',
  },
  {
    q: 'What happens when I tick the final "Complete" step on a task?',
    a: 'Ticking the end step (labelled "Complete" or similar — it is the last node in the workflow) automatically marks every other incomplete step as complete and sets the overall task status to Complete in one action. A tooltip on the checkbox reminds you of this before you click.',
  },
  {
    q: 'Why does the "Start" node not appear in the step checklist?',
    a: '"Start" is a workflow trigger marker — it indicates when the task should be created or kicked off, not an actionable work item. It is intentionally excluded from the step count, progress bar, and checklist so that the numbers and percentage reflect only real work steps.',
  },
  {
    q: 'How does the task flowchart highlight the next step?',
    a: 'The next incomplete step in the workflow is highlighted with a pulsing indigo ring on the flowchart to guide you to what should be worked on next. If you click a step in the step list on the right, that node gets a solid indigo ring to show which step you are viewing. You can still mark steps complete in any order — the "next up" indicator is guidance, not a lock.',
  },
  {
    q: 'What is Bulk Tasks?',
    a: 'Bulk Tasks lets you create multiple tasks at once by applying a workflow template across a list of clients in a single operation. This is useful at the start of a period (e.g. year-end) when you need to create the same job for dozens of clients. Click the "Bulk Tasks" button at the top of the Tasks sidebar to open the bulk creation modal.',
  },
  {
    q: 'How do I get back to a job I ran in Full Analysis / Bank to CSV / Landlord / etc?',
    a: 'Every AI tool opens onto a history dashboard listing every previous job your firm has run. Search by client, sort by date, or filter by team member. Click any row to reopen the saved result — you can re-export the CSV, copy outputs again, or use it as a seed for a new run. The "+ New …" button (top-right of the history page) is what opens the input form for a fresh job.',
  },
  {
    q: 'How do I request a holiday?',
    a: 'Open the HR tool and click the purple "+" button in the top-right of the header (it shows "Request holiday" on hover), or go to Holidays & Absence → My Holidays and click the Request holiday button. Choose your dates, half-day options, a reason, and submit. Your assigned manager will be notified and can approve or reject from their Approvals tab.',
  },
  {
    q: 'Why don\'t bank holidays show up on the firm calendar?',
    a: 'Two reasons. First, the Phase 1 + bank-holiday migrations need to be applied to Supabase — see Settings → HR → Holiday config and use the Sync now button. Second, bank holidays are auto-created as "approved" holidays for every firm user via the gov.uk feed. If Sync now reports 0 inserted, check the region setting (England & Wales / Scotland / Northern Ireland) is right, and that the bank-holidays-enabled toggle is on.',
  },
  {
    q: 'How do I onboard a new team member in HR?',
    a: 'Open the HR tool and click the UserPlus icon in the top-right header pill (admin only). The three-step wizard creates the auth user (with either an email invite link or an initial password), captures their job title, department, manager, start date, holiday entitlement, and optional DOB, then optionally starts a probation period and applies the firm onboarding checklist. You can manage the onboarding checklist template at Settings → HR → Onboarding template.',
  },
  {
    q: 'How do I offboard someone when they leave?',
    a: 'Open the HR tool → People → Team Profiles → click the leaver → Leaver record → "Begin leaver process". Set the notice date, last working day and reason, then tick off exit interview, equipment returned, and systems offboarded as each happens. Once they\'re gone, click "Deactivate login" to ban their auth account — their HR records and history are preserved for audit. You can re-enable login later from the same panel if needed.',
  },
  {
    q: 'What are the quarterly Manager Briefings?',
    a: 'On the 1st of January, April, July and October, SMITH automatically generates a UK employment-law briefing for managers in each firm with HR active. Claude searches gov.uk, ACAS, CIPD, HMRC, legislation.gov.uk and the House of Commons Library to summarise what\'s changed in the past quarter, plus action items and training tips. Every claim is sourced. Managers and admins get an in-app notification + email. Admins can also click "Generate now" at HR → Resources → Manager Briefings to trigger one manually. It\'s reading material, not legal advice.',
  },
  {
    q: 'Why does the HR tool icon in the sidebar have a number badge?',
    a: 'The HR badge counts pending holiday approvals where you\'re the assigned manager, plus your unread HR notifications (decisions, cancellations, new briefings, new disclosures). Opening the relevant sub-tab inside HR clears that part of the count automatically. Pending approvals stay until you actually decide them.',
  },
];

const TOOLS = [
  { icon: FileSearch, name: 'Full Analysis', desc: 'Analyses invoices and receipts, produces bookkeeping entries formatted for VT, Capium, Xero, QuickBooks, FreeAgent, Sage, or a general CSV.' },
  { icon: ArrowLeftRight, name: 'Bank to CSV', desc: 'Extracts transactions from a bank statement (PDF, CSV, or Excel) and produces a clean, editable CSV.' },
  { icon: Building2, name: 'Landlord', desc: 'Analyses rental income and expense documents and produces a UK property income computation.' },
  { icon: ClipboardCheck, name: 'Accounts Review', desc: 'Reviews P&L, Balance Sheet, and Trial Balance against UK GAAP. Produces review points with suggested journals and generates working papers for Sole Traders, Partnerships, and Limited Companies.' },
  { icon: Gauge, name: 'Performance Analysis', desc: 'Analyses management accounts and produces a business performance report with KPI ratios and commentary.' },
  { icon: Receipt, name: 'P32 Summary', desc: 'Reads a P32 payroll document and produces a client-ready email body summarising the figures.' },
  { icon: ShieldAlert, name: 'Risk Assessment', desc: 'Conducts a structured AML/client risk assessment and produces a rated risk report (Low/Medium/High).' },
  { icon: FileText, name: 'Summarise', desc: 'Summarises documents that are out of date range or not relevant to the current job, for file note purposes.' },
  { icon: Archive, name: 'Document Vault', desc: 'A searchable archive of documents synced from Google Drive, tagged automatically by AI.' },
  { icon: CalendarDays, name: 'Calendar', desc: 'A shared firm calendar for scheduling events, meetings, and deadlines. Invite team members as guests and receive in-app notifications for calendar invites.' },
  { icon: MicVocal, name: 'Meeting Notes', desc: 'Records and transcribes client meetings using your device microphone, then uses AI to produce a structured summary with action items and decisions. Notes are saved to the client\'s Timeline.' },
  { icon: BookOpen, name: 'Policies & Procedures', desc: 'A static reference section for the firm\'s internal policies and procedures.' },
  { icon: UserPlus, name: 'Staff Hire', desc: 'AI-powered recruitment tool. Write professional job postings in a guided step-by-step wizard, upload CVs and cover letters for AI evaluation, generate tailored interview questions, build and complete scorecards during interviews, and rank all applicants with a final AI hiring recommendation. Access is controlled per-user by admins in Settings → Staff Hire.' },
  { icon: Mail, name: 'Email', desc: 'A full Gmail-connected email client built into SMITH. Read, send, reply, reply all, and forward emails. Allocate emails to client timelines and tasks. AI features include Suggest Reply, Rewrite, and AI Draft Reply. BCC support, file attachments, label management, and an in-app signature editor that syncs directly to Gmail. Each team member connects their own Gmail account.' },
  { icon: ListChecks, name: 'Tasks', desc: 'A full workflow and task management tool. Create tasks from templates, assign steps to team members, track progress with a live flowchart and checklist, log time, and leave step-level notes visible to the whole team. Includes personal views (My Tasks, My Week, My Month) and firm-wide views (All Tasks, By Client, By Team, By Type). A "Records Here" status lets the team instantly see which jobs are ready to start.' },
  { icon: HeartHandshake, name: 'HR', desc: 'In-house HR module for the firm: holiday requests with manager approval, a shared firm holiday calendar, spreadsheet-style absence tracker, sickness/absence recording with return-to-work, org chart with birthday and work-anniversary markers, personnel files (right-to-work, probation, training/CPD, 1:1s, appraisals, DSE, TOIL, salary, leaver workflow), AI HR adviser, confidential disclosures with anonymity, auto-generated quarterly UK employment-law briefings for managers, and a guided joiner wizard. Bank holidays auto-sync from gov.uk and optionally push to each user\'s Google Calendar.' },
];

function FAQItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--border)] last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-4 hover:bg-[var(--bg-nav-hover)] transition-colors"
      >
        <span className="text-sm font-medium text-[var(--text-primary)]">{q}</span>
        {open ? <ChevronDown size={16} className="shrink-0 text-[var(--text-muted)]" /> : <ChevronRight size={16} className="shrink-0 text-[var(--text-muted)]" />}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState<Section>('getting-started');

  const NAV: { id: Section; label: string; icon: React.ElementType }[] = [
    { id: 'getting-started', label: 'Getting Started', icon: Sparkles },
    { id: 'api-key', label: 'AI & API Key', icon: Key },
    { id: 'team', label: 'Team & Roles', icon: Users },
    { id: 'tools', label: 'Tools Guide', icon: Puzzle },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'faq', label: 'FAQs', icon: HelpCircle },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* Left nav */}
      <aside className="w-52 shrink-0 border-r border-[var(--border)] py-6 px-3 space-y-0.5">
        <p className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Help Centre</p>
        {NAV.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 h-10 rounded-lg text-sm font-medium transition-all duration-150 text-left
                ${activeSection === item.id
                  ? 'bg-[var(--bg-nav-active)] text-[var(--text-nav-active)]'
                  : 'text-[var(--text-nav-inactive)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
                }`}
            >
              <Icon size={16} className="shrink-0" />
              {item.label}
            </button>
          );
        })}
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin p-8 max-w-3xl">

        {activeSection === 'getting-started' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Getting Started with SMITH</h1>
              <p className="text-sm text-[var(--text-muted)]">Three things to set up before you begin.</p>
            </div>

            {[
              {
                step: '1',
                icon: Key,
                title: 'Connect your AI API key',
                body: 'SMITH uses Anthropic Claude to power all AI features. You\'ll need to add your firm\'s Anthropic API key before any tools will work.',
                action: 'Go to Settings → AI & API Key',
              },
              {
                step: '2',
                icon: Users,
                title: 'Invite your team',
                body: 'Add staff members so they can use SMITH\'s tools. You can set each person as Admin or Staff.',
                action: 'Go to Settings → Account → Team Members',
              },
              {
                step: '3',
                icon: Puzzle,
                title: 'Enable your tools',
                body: 'SMITH comes with a suite of tools. Enable the ones your firm needs — unused modules are hidden from the sidebar.',
                action: 'Go to Settings → Modules',
              },
            ].map(item => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="glass-solid rounded-xl p-5 flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-sm font-bold shrink-0">
                    {item.step}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Icon size={16} className="text-[var(--accent)]" />
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</h3>
                    </div>
                    <p className="text-sm text-[var(--text-secondary)] mb-2">{item.body}</p>
                    <p className="text-xs font-medium text-[var(--accent)]">→ {item.action}</p>
                  </div>
                </div>
              );
            })}

            <div className="glass-solid rounded-xl p-5 border-l-4 border-[var(--accent)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Need help at any time?</h3>
              <p className="text-sm text-[var(--text-secondary)]">Click the <strong>Ask Smith</strong> button (bottom-right) to chat with the AI assistant. It knows how every feature works and can answer UK accounting and bookkeeping questions.</p>
            </div>
          </div>
        )}

        {activeSection === 'api-key' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">AI & API Key</h1>
              <p className="text-sm text-[var(--text-muted)]">SMITH uses Anthropic Claude. Your firm provides its own API key.</p>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Why does SMITH need an API key?</h3>
              <p className="text-sm text-[var(--text-secondary)]">SMITH is a platform built on top of Anthropic&apos;s Claude AI. Rather than bundling AI costs into the subscription price, each firm connects their own Anthropic account. This means:</p>
              <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                {[
                  'You pay Anthropic directly for what you use — no AI usage markups from SMITH',
                  'Your usage is visible in your Anthropic dashboard',
                  'You can set your own spending limits and billing alerts',
                  'SMITH\'s subscription price reflects only the platform, not AI costs',
                ].map(point => (
                  <li key={point} className="flex gap-2">
                    <span className="text-[var(--accent)] shrink-0">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">How to create an API key</h3>
              <ol className="space-y-3 text-sm text-[var(--text-secondary)]">
                {[
                  <>Visit <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">console.anthropic.com <ExternalLink size={11} /></a> and create or log in to your account.</>,
                  'In the left sidebar, go to "API Keys".',
                  'Click "Create Key". Give it a name like "SMITH" so you can identify it later.',
                  <>Copy the key — it starts with <code className="text-xs bg-[var(--bg-page)] px-1 py-0.5 rounded border border-[var(--border)]">sk-ant-api03-</code>. You won&apos;t be able to see it again after closing the dialog.</>,
                  'In SMITH, go to Settings → AI & API Key and paste the key in.',
                ].map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-[var(--accent-light)] text-[var(--accent)] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Security</h3>
              <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                {[
                  'The API key is stored securely server-side — it never reaches your browser',
                  'Only admins can view, update, or remove the key',
                  'Staff members cannot see the key',
                  'The key is only ever used to make AI calls on behalf of your firm',
                ].map(point => (
                  <li key={point} className="flex gap-2">
                    <span className="text-[var(--accent)] shrink-0">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rate Limits — how fast can you run AI jobs?</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                Anthropic enforces two types of limit per account. These are not errors in SMITH — they are guardrails applied by Anthropic to all API users:
              </p>
              <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>TPM (Tokens Per Minute)</strong> — the total volume of text (input + output) that can be processed per minute. A token is roughly ¾ of a word. A typical Full Analysis job uses 5,000–20,000 tokens.</span></li>
                <li className="flex gap-2"><span className="text-[var(--accent)] shrink-0">•</span><span><strong>RPM (Requests Per Minute)</strong> — the number of individual AI calls allowed per minute. SMITH batches documents into groups of three, so each job run may use multiple requests.</span></li>
              </ul>
              <p className="text-sm text-[var(--text-secondary)]">Limits increase automatically as your cumulative Anthropic spend grows:</p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-[var(--text-secondary)] border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left py-2 pr-4 font-semibold text-[var(--text-primary)]">Tier</th>
                      <th className="text-left py-2 pr-4 font-semibold text-[var(--text-primary)]">Cumulative spend</th>
                      <th className="text-left py-2 pr-4 font-semibold text-[var(--text-primary)]">TPM (Claude Sonnet)</th>
                      <th className="text-left py-2 font-semibold text-[var(--text-primary)]">RPM</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {[
                      ['1', '$100+', '40,000', '50'],
                      ['2', '$500+', '80,000', '1,000'],
                      ['3', '$5,000+', '160,000', '2,000'],
                      ['4', '$15,000+', '400,000', '4,000'],
                    ].map(([tier, spend, tpm, rpm]) => (
                      <tr key={tier}>
                        <td className="py-2 pr-4">Tier {tier}</td>
                        <td className="py-2 pr-4">{spend}</td>
                        <td className="py-2 pr-4">{tpm}</td>
                        <td className="py-2">{rpm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                <strong>SMITH handles rate limit errors automatically</strong> — if a limit is hit, requests are retried up to four times with exponential backoff. For most firms, this is invisible. If your team runs many large jobs simultaneously and you notice delays, check your current tier at{' '}
                <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">console.anthropic.com <ExternalLink size={11} /></a>.
              </p>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">GDPR & Data Privacy</h3>
              <p className="text-sm text-[var(--text-secondary)]">
                As a UK accountancy firm handling personal financial data, GDPR compliance is essential. Here is what you need to know:
              </p>
              <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                <li className="flex gap-2"><span className="text-emerald-500 shrink-0">✓</span><span><strong>Anthropic does not train its models on API data.</strong> This is a contractual commitment that applies to all API users. Your client documents are processed and discarded — they are never used to improve Anthropic&apos;s models.</span></li>
                <li className="flex gap-2"><span className="text-emerald-500 shrink-0">✓</span><span><strong>All data is encrypted in transit</strong> using TLS. No client data is ever transmitted unencrypted.</span></li>
                <li className="flex gap-2"><span className="text-emerald-500 shrink-0">✓</span><span><strong>SMITH never stores document contents</strong> in its own database. Only metadata (file name, date, tags) is stored. Document files live in your connected Google Drive.</span></li>
                <li className="flex gap-2"><span className="text-emerald-500 shrink-0">✓</span><span><strong>Your data is firm-scoped.</strong> Row Level Security (RLS) in the database ensures no other firm on SMITH can access your data.</span></li>
              </ul>
              <div className="mt-1 p-4 rounded-lg bg-[var(--accent-light)] border border-[var(--border)] text-sm text-[var(--text-secondary)] space-y-2">
                <p className="font-semibold text-[var(--text-primary)]">Data Processing Agreement (DPA)</p>
                <p>For formal compliance — such as client due diligence questionnaires or ICO audit requirements — your firm should sign Anthropic&apos;s <strong>Data Processing Agreement</strong>. This is a legal contract that designates Anthropic as a data processor acting on your behalf under UK/EU GDPR, with defined obligations around security, sub-processors, and breach notification.</p>
                <p>To request the DPA, email <a href="mailto:privacy@anthropic.com" className="text-[var(--accent)] hover:underline">privacy@anthropic.com</a> or find it under the legal section at <a href="https://www.anthropic.com/legal" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">anthropic.com/legal <ExternalLink size={11} /></a>.</p>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'team' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Team & Roles</h1>
              <p className="text-sm text-[var(--text-muted)]">Manage who has access to SMITH and what they can do.</p>
            </div>

            <div className="glass-solid rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--border)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Roles</h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {[
                  {
                    role: 'Admin',
                    badge: 'bg-[var(--accent-light)] text-[var(--accent)]',
                    perms: [
                      'Access all tools and clients',
                      'Invite, manage, and remove team members',
                      'Change user roles (admin/staff)',
                      'Add or update the AI API key',
                      'Enable/disable modules',
                      'View billing and subscription details',
                    ],
                  },
                  {
                    role: 'Staff',
                    badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
                    perms: [
                      'Access all active tools',
                      'View and work on all shared clients',
                      'Cannot access admin settings',
                      'Cannot see the AI API key',
                    ],
                  },
                ].map(item => (
                  <div key={item.role} className="px-5 py-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${item.badge}`}>{item.role}</span>
                    </div>
                    <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
                      {item.perms.map(p => (
                        <li key={p} className="flex gap-2">
                          <span className="text-[var(--accent)] shrink-0">•</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Rules</h3>
              <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                {[
                  'There must always be at least one admin on the account',
                  'You cannot demote the last remaining admin',
                  'You cannot remove the last remaining admin',
                  'Admins can invite users, change roles, and remove team members',
                  'Removed users immediately lose access to SMITH',
                ].map(point => (
                  <li key={point} className="flex gap-2">
                    <span className="text-[var(--accent)] shrink-0">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-solid rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">How to invite a team member</h3>
              <p className="text-sm text-[var(--text-secondary)]">Go to <strong>Settings → Account → Team Members</strong> and click <strong>Invite Member</strong>. Enter their email address and choose their role. They&apos;ll receive an email with a link to set up their account and log in.</p>
            </div>
          </div>
        )}

        {activeSection === 'tools' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Tools Guide</h1>
              <p className="text-sm text-[var(--text-muted)]">An overview of each tool and what it does.</p>
            </div>

            <div className="space-y-3">
              {TOOLS.map(tool => {
                const Icon = tool.icon;
                return (
                  <div key={tool.name} className="glass-solid rounded-xl p-5 flex gap-4">
                    <div className="w-9 h-9 rounded-lg bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-[var(--accent)]" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{tool.name}</h3>
                      <p className="text-sm text-[var(--text-secondary)]">{tool.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="glass-solid rounded-xl p-5 border-l-4 border-[var(--accent)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Enabling & disabling tools</h3>
              <p className="text-sm text-[var(--text-secondary)]">Admins can turn tools on or off in <strong>Settings → Modules</strong>. Disabled tools are hidden from the sidebar. This is useful if you only subscribe to certain modules or want to keep the interface focused.</p>
            </div>
          </div>
        )}

        {activeSection === 'billing' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Billing</h1>
              <p className="text-sm text-[var(--text-muted)]">How SMITH billing works.</p>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Two separate costs</h3>
              <div className="space-y-3 text-sm text-[var(--text-secondary)]">
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                    <CreditCard size={13} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <p className="font-medium text-[var(--text-primary)]">SMITH Platform Subscription</p>
                    <p>Billed by SMITH for access to the platform, tools, and support. Managed in Settings → Billing.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded bg-[var(--accent-light)] flex items-center justify-center shrink-0">
                    <Key size={13} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <p className="font-medium text-[var(--text-primary)]">Anthropic AI Usage</p>
                    <p>Billed directly by Anthropic based on how much AI your firm uses (input and output tokens). Managed at console.anthropic.com.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-solid rounded-xl p-5 space-y-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Controlling AI costs</h3>
              <ul className="space-y-1.5 text-sm text-[var(--text-secondary)]">
                {[
                  'Each AI job logs its token usage in your account (visible in future reporting)',
                  'Set spending limits on your Anthropic account at console.anthropic.com',
                  'Compressing images before upload reduces tokens and improves speed',
                  'Uploading fewer files per run reduces token usage',
                ].map(point => (
                  <li key={point} className="flex gap-2">
                    <span className="text-[var(--accent)] shrink-0">•</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-solid rounded-xl p-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Current subscription</h3>
              <p className="text-sm text-[var(--text-secondary)]">View and manage your SMITH subscription in <strong>Settings → Billing</strong>.</p>
            </div>
          </div>
        )}

        {activeSection === 'faq' && (
          <div className="space-y-5">
            <div>
              <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Frequently Asked Questions</h1>
              <p className="text-sm text-[var(--text-muted)]">Common questions about using SMITH.</p>
            </div>

            <div className="glass-solid rounded-xl overflow-hidden divide-y divide-[var(--border)]">
              {FAQS.map(faq => (
                <FAQItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>

            <div className="glass-solid rounded-xl p-5 text-center">
              <p className="text-sm text-[var(--text-secondary)] mb-2">Still have questions?</p>
              <p className="text-sm text-[var(--text-secondary)]">Use the <strong>Ask Smith</strong> button (bottom-right) to chat with the AI assistant — it can answer questions about the app, UK accounting, and more.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
