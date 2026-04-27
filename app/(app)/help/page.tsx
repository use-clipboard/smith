'use client';

import { useState } from 'react';
import {
  Key, Users, Puzzle, Sparkles, HelpCircle, CreditCard, FileSearch,
  ArrowLeftRight, Building2, ClipboardCheck, TrendingUp, Receipt,
  ShieldAlert, FileText, Archive, BookOpen, ChevronDown, ChevronRight,
  ExternalLink, CalendarDays, MicVocal, UserPlus,
} from 'lucide-react';

type Section = 'getting-started' | 'tools' | 'api-key' | 'team' | 'billing' | 'faq';

const FAQS = [
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
    q: 'Who can access the Staff Hire tool?',
    a: 'Admins always have access. Staff members must be explicitly granted access by an admin, because the tool contains sensitive information such as salary data and applicant records. Admins can manage access in Settings → Staff Hire.',
  },
  {
    q: 'How does the Staff Hire AI ranking work?',
    a: 'Once you have evaluated at least two applicants using their CV and/or cover letter, you can run the AI Ranking from the job\'s Ranking tab. The AI compares all evaluated applicants against the job requirements and each other, then produces a ranked list with a hire/consider/reject recommendation for each person, plus an overall hiring recommendation.',
  },
];

const TOOLS = [
  { icon: FileSearch, name: 'Full Analysis', desc: 'Analyses invoices and receipts, produces bookkeeping entries formatted for VT, Capium, Xero, QuickBooks, FreeAgent, Sage, or a general CSV.' },
  { icon: ArrowLeftRight, name: 'Bank to CSV', desc: 'Extracts transactions from a bank statement (PDF, CSV, or Excel) and produces a clean, editable CSV.' },
  { icon: Building2, name: 'Landlord', desc: 'Analyses rental income and expense documents and produces a UK property income computation.' },
  { icon: ClipboardCheck, name: 'Accounts Review', desc: 'Reviews P&L, Balance Sheet, and Trial Balance against UK GAAP. Produces review points with suggested journals and generates working papers for Sole Traders, Partnerships, and Limited Companies.' },
  { icon: TrendingUp, name: 'Performance Analysis', desc: 'Analyses management accounts and produces a business performance report with KPI ratios and commentary.' },
  { icon: Receipt, name: 'P32 Summary', desc: 'Reads a P32 payroll document and produces a client-ready email body summarising the figures.' },
  { icon: ShieldAlert, name: 'Risk Assessment', desc: 'Conducts a structured AML/client risk assessment and produces a rated risk report (Low/Medium/High).' },
  { icon: FileText, name: 'Summarise', desc: 'Summarises documents that are out of date range or not relevant to the current job, for file note purposes.' },
  { icon: Archive, name: 'Document Vault', desc: 'A searchable archive of documents synced from Google Drive, tagged automatically by AI.' },
  { icon: CalendarDays, name: 'Calendar', desc: 'A shared firm calendar for scheduling events, meetings, and deadlines. Invite team members as guests and receive in-app notifications for calendar invites.' },
  { icon: MicVocal, name: 'Meeting Notes', desc: 'Records and transcribes client meetings using your device microphone, then uses AI to produce a structured summary with action items and decisions. Notes are saved to the client\'s Timeline.' },
  { icon: BookOpen, name: 'Policies & Procedures', desc: 'A static reference section for the firm\'s internal policies and procedures.' },
  { icon: UserPlus, name: 'Staff Hire', desc: 'AI-powered recruitment tool. Write professional job postings in a guided step-by-step wizard, upload CVs and cover letters for AI evaluation, generate tailored interview questions, build and complete scorecards during interviews, and rank all applicants with a final AI hiring recommendation. Access is controlled per-user by admins in Settings → Staff Hire.' },
];

function FAQItem({ q, a }: { q: string; a: string }) {
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
