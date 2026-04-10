'use client';

import { useState } from 'react';
import {
  X, ChevronRight, ChevronLeft, Key, Users, Puzzle,
  Sparkles, HelpCircle, CheckCircle2, ExternalLink,
} from 'lucide-react';

interface Props {
  onDismiss: () => void;
}

const STEPS = [
  {
    id: 'welcome',
    icon: Sparkles,
    title: 'Welcome to SMITH',
    subtitle: "You're the first admin of this account. Here's a quick overview of what to set up.",
  },
  {
    id: 'api-key',
    icon: Key,
    title: 'Connect Your AI Brain',
    subtitle: 'SMITH uses Anthropic Claude to power all AI features. Your firm provides its own API key — you pay Anthropic directly for usage.',
  },
  {
    id: 'team',
    icon: Users,
    title: 'Invite Your Team',
    subtitle: 'Add staff members to your account. You control their roles — admins can manage settings, staff can use the tools.',
  },
  {
    id: 'tools',
    icon: Puzzle,
    title: 'Enable Your Tools',
    subtitle: 'SMITH includes a suite of accounting tools. Activate the ones your firm needs in Settings → Modules.',
  },
  {
    id: 'help',
    icon: HelpCircle,
    title: 'Help & Support',
    subtitle: 'Everything you need to know is in the Help section of the sidebar — FAQs, how-to guides, and billing info.',
  },
];

export default function OnboardingModal({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  function handleNext() {
    if (isLast) {
      onDismiss();
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="relative w-full max-w-lg glass-solid rounded-2xl border border-[var(--border-card)] shadow-dropdown overflow-hidden">

        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-[var(--border)]">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* Skip button */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
          title="Skip setup guide"
        >
          <X size={16} />
        </button>

        <div className="px-8 pt-10 pb-8">
          {/* Step indicator */}
          <div className="flex gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-200 ${
                  i <= step ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                } ${i === step ? 'flex-[2]' : 'flex-1'}`}
              />
            ))}
          </div>

          {/* Icon */}
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-light)] flex items-center justify-center mb-5">
            <Icon size={24} className="text-[var(--accent)]" />
          </div>

          {/* Content */}
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{current.title}</h2>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-6">{current.subtitle}</p>

          {/* Step-specific detail */}
          {current.id === 'api-key' && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 space-y-3 mb-6 text-sm">
              <p className="font-medium text-[var(--text-primary)]">How to get your API key:</p>
              <ol className="space-y-2 text-[var(--text-secondary)] list-none">
                <li className="flex gap-2"><span className="font-semibold text-[var(--accent)] shrink-0">1.</span> Go to <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">console.anthropic.com <ExternalLink size={11} /></a></li>
                <li className="flex gap-2"><span className="font-semibold text-[var(--accent)] shrink-0">2.</span> Sign up or log in to your Anthropic account</li>
                <li className="flex gap-2"><span className="font-semibold text-[var(--accent)] shrink-0">3.</span> Click &ldquo;Create Key&rdquo; — copy the key (starts with <code className="text-xs bg-[var(--bg-page)] px-1 py-0.5 rounded">sk-ant-</code>)</li>
                <li className="flex gap-2"><span className="font-semibold text-[var(--accent)] shrink-0">4.</span> Go to <strong>Settings → AI & API Key</strong> and paste it in</li>
              </ol>
              <p className="text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                Usage is billed directly by Anthropic to your account. SMITH does not charge for AI usage — only for the platform subscription.
              </p>
            </div>
          )}

          {current.id === 'team' && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 space-y-2 mb-6 text-sm text-[var(--text-secondary)]">
              <p><strong className="text-[var(--text-primary)]">Admin</strong> — can manage settings, team, modules, and the AI API key.</p>
              <p><strong className="text-[var(--text-primary)]">Staff</strong> — can use all active tools and access shared clients.</p>
              <p className="text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">At least one admin must always remain active. Go to <strong>Settings → Account</strong> to invite team members.</p>
            </div>
          )}

          {current.id === 'tools' && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 space-y-1.5 mb-6 text-sm text-[var(--text-secondary)]">
              {[
                'Full Analysis — invoice & receipt bookkeeping',
                'Bank to CSV — extract bank statement transactions',
                'Landlord — property income & expense analysis',
                'Final Accounts Review — review points & suggested journals',
                'Performance Analysis — management accounts reporting',
                'P32 Summary — payroll client email',
                'Risk Assessment — AML client risk reports',
                'Summarise — document summaries for file notes',
                'Document Vault — searchable document archive',
              ].map(tool => (
                <div key={tool} className="flex items-center gap-2">
                  <CheckCircle2 size={13} className="text-[var(--accent)] shrink-0" />
                  <span>{tool}</span>
                </div>
              ))}
            </div>
          )}

          {current.id === 'help' && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 space-y-2 mb-6 text-sm text-[var(--text-secondary)]">
              <p>The <strong className="text-[var(--text-primary)]">Help</strong> section in the sidebar contains:</p>
              <ul className="space-y-1 list-none">
                {['How each tool works', 'Setting up your API key', 'Managing your team', 'Frequently asked questions', 'How billing works'].map(item => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-[var(--accent)] shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[var(--text-muted)] pt-1 border-t border-[var(--border)]">
                You can also use <strong>Ask Smith</strong> (the button at the bottom-right) to get help at any time.
              </p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep(s => s - 1)}
              disabled={step === 0}
              className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-0"
            >
              <ChevronLeft size={16} />
              Back
            </button>

            <button
              onClick={handleNext}
              className="btn-primary flex items-center gap-1.5"
            >
              {isLast ? (
                <>Get Started</>
              ) : (
                <>Next <ChevronRight size={16} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
