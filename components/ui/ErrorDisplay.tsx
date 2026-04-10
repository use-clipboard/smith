'use client';

import { AlertTriangle, RefreshCw, FileX, Wifi, Clock, Key, FileWarning, HelpCircle } from 'lucide-react';

interface ErrorDisplayProps {
  error: string;
  code?: string;
  onRetry: () => void;
}

const ERROR_CONFIG: Record<string, {
  icon: React.ElementType;
  iconClass: string;
  title: string;
  tips: string[];
}> = {
  FILE_UNREADABLE: {
    icon: FileX,
    iconClass: 'text-orange-500',
    title: 'File Could Not Be Read',
    tips: [
      'Check that no file is password-protected or encrypted',
      'Make sure all PDFs are not corrupted (try opening them locally first)',
      'Only PDF, JPG, PNG, GIF, and WEBP files are supported',
      'Try re-exporting or re-scanning the problem document',
    ],
  },
  FILES_TOO_LARGE: {
    icon: FileWarning,
    iconClass: 'text-orange-500',
    title: 'Too Many or Too Large Files',
    tips: [
      'Upload fewer documents at a time — aim for 5–10 max per run',
      'Split large multi-page PDFs into smaller files',
      'Remove any files that are not needed for this analysis',
      'High-resolution scans can be very large — try compressing images first',
    ],
  },
  RATE_LIMIT: {
    icon: Clock,
    iconClass: 'text-yellow-500',
    title: 'AI Service Busy',
    tips: [
      'Wait 30 seconds then click Try Again',
      'Avoid running multiple analyses at the same time',
    ],
  },
  AI_OVERLOADED: {
    icon: Wifi,
    iconClass: 'text-yellow-500',
    title: 'AI Service Temporarily Unavailable',
    tips: [
      'Wait 60 seconds then click Try Again',
      'This is a temporary issue with the AI provider — your files are fine',
    ],
  },
  AUTH_ERROR: {
    icon: Key,
    iconClass: 'text-red-500',
    title: 'API Configuration Error',
    tips: [
      'The ANTHROPIC_API_KEY environment variable may be missing or invalid',
      'Contact your system administrator to check the API key in your deployment settings',
    ],
  },
  PARSE_ERROR: {
    icon: FileWarning,
    iconClass: 'text-orange-500',
    title: 'Could Not Read AI Response',
    tips: [
      'This can happen with very complex or unusual document layouts',
      'Try removing documents one at a time to identify which one is causing the issue',
      'Handwritten or very low quality scans may not be processable',
      'Try re-running — occasionally this resolves itself',
    ],
  },
};

const DEFAULT_CONFIG = {
  icon: AlertTriangle,
  iconClass: 'text-red-500',
  title: 'Processing Failed',
  tips: [
    'Try uploading fewer files and running again',
    'Make sure your files are valid PDFs or images',
    'Check your internet connection and try again',
    'If the problem persists, contact support',
  ],
};

export default function ErrorDisplay({ error, code, onRetry }: ErrorDisplayProps) {
  const config = (code && ERROR_CONFIG[code]) ? ERROR_CONFIG[code] : DEFAULT_CONFIG;
  const Icon = config.icon;

  return (
    <div className="glass-solid rounded-xl p-8 max-w-2xl mx-auto border border-red-200 dark:border-red-900/30">
      {/* Header */}
      <div className="flex items-start gap-4 mb-5">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
          config.iconClass.includes('orange') ? 'bg-orange-50 dark:bg-orange-900/20' :
          config.iconClass.includes('yellow') ? 'bg-yellow-50 dark:bg-yellow-900/20' :
          'bg-red-50 dark:bg-red-900/20'
        }`}>
          <Icon size={20} className={config.iconClass} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{config.title}</h3>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">{error}</p>
        </div>
      </div>

      {/* Tips */}
      <div className="bg-[var(--bg-page)] rounded-lg p-4 mb-5 border border-[var(--border)]">
        <div className="flex items-center gap-2 mb-2.5">
          <HelpCircle size={13} className="text-[var(--accent)] shrink-0" />
          <span className="text-xs font-semibold text-[var(--text-primary)]">How to fix this</span>
        </div>
        <ul className="space-y-1.5">
          {config.tips.map((tip, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
              <span className="text-[var(--accent)] mt-0.5 shrink-0">•</span>
              {tip}
            </li>
          ))}
        </ul>
      </div>

      <button onClick={onRetry} className="btn-primary w-full justify-center">
        <RefreshCw size={14} />
        Try Again
      </button>
    </div>
  );
}
