'use client';

import { Sparkles, Clock, CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

export interface ProgressFile {
  name: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
}

interface ProcessingViewProps {
  progress?: number;
  fileCount?: number;
  title?: string;
  messages?: string[];
  scanProgress?: { current: number; total: number; fileName: string } | null;
  files?: ProgressFile[];
  steps?: string[];
}

const DEFAULT_MESSAGES = [
  'Reading documents…',
  'Extracting key information…',
  'Running AI analysis…',
  'Validating transactions…',
  'Compiling results…',
];

function estimateSeconds(fileCount = 1) {
  return 12 + fileCount * 10;
}

function FileStatusIcon({ status }: { status: ProgressFile['status'] }) {
  if (status === 'complete') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (status === 'error')    return <XCircle      size={14} className="text-red-400 shrink-0" />;
  if (status === 'processing') return <Loader2   size={14} className="text-[var(--accent)] animate-spin shrink-0" />;
  return <Circle size={14} className="text-[var(--text-muted)] opacity-30 shrink-0" />;
}

function StepIcon({ status }: { status: 'pending' | 'active' | 'complete' }) {
  if (status === 'complete') return <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />;
  if (status === 'active')   return <Loader2      size={14} className="text-[var(--accent)] animate-spin shrink-0" />;
  return <Circle size={14} className="text-[var(--text-muted)] opacity-30 shrink-0" />;
}

export default function ProcessingView({
  progress,
  fileCount = 1,
  title,
  messages,
  scanProgress,
  files,
  steps,
}: ProcessingViewProps) {
  const isComplete = progress === 100;
  const estimated = estimateSeconds(scanProgress ? scanProgress.total : fileCount);

  const [displayPct, setDisplayPct] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(estimated);
  const [overtime, setOvertime] = useState(false);
  const [messageIndex, setMessageIndex] = useState(0);

  const startRef = useRef(Date.now());
  const statusMessages = messages ?? DEFAULT_MESSAGES;

  // Drive the progress bar
  useEffect(() => {
    if (isComplete) { setDisplayPct(100); return; }

    if (scanProgress) {
      const completedFraction = (scanProgress.current - 1) / scanProgress.total;
      const pct = Math.round(completedFraction * 100);
      setDisplayPct(Math.min(pct, 95));
      return;
    }

    const tick = () => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const t = Math.min(elapsed / estimated, 1);
      const eased = 1 - Math.pow(1 - t, 2.5);
      setDisplayPct(Math.round(eased * 95));
    };

    const raf = setInterval(tick, 250);
    return () => clearInterval(raf);
  }, [isComplete, estimated, scanProgress]);

  // Countdown timer
  useEffect(() => {
    if (isComplete) return;
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
      const remaining = estimated - elapsed;
      if (remaining > 0) {
        setSecondsLeft(remaining);
        setOvertime(false);
      } else {
        setSecondsLeft(0);
        setOvertime(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isComplete, estimated]);

  // Cycle status messages (simple mode only)
  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(i => (i + 1) % statusMessages.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [statusMessages.length]);

  const countdownLabel = isComplete
    ? 'Done!'
    : overtime
    ? 'Still working — please wait…'
    : secondsLeft <= 5
    ? 'Just a moment…'
    : `~${secondsLeft}s remaining`;

  // Compute per-step status from displayPct
  const stepStatuses: Array<'pending' | 'active' | 'complete'> = (steps ?? []).map((_, i) => {
    const completePct = ((i + 1) / steps!.length) * 100;
    const activePct   = (i       / steps!.length) * 100;
    if (displayPct >= completePct) return 'complete';
    if (displayPct >= activePct)   return 'active';
    return 'pending';
  });

  const hasRichContent = (files && files.length > 0) || (steps && steps.length > 0);

  // ─── Simple fallback view ──────────────────────────────────────────────────
  if (!hasRichContent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-6">
        <div className="glass-solid rounded-2xl p-10 text-center max-w-md w-full">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
              <Sparkles size={28} className="text-[var(--accent)] animate-pulse" />
            </div>
          </div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
            {title ?? 'Analysing Documents'}
          </h2>
          <p className="text-sm text-[var(--text-muted)] mb-1">
            {scanProgress
              ? `Scanning document ${scanProgress.current} of ${scanProgress.total}…`
              : fileCount > 1
              ? `Processing ${fileCount} documents with AI…`
              : 'Processing document with AI…'}
          </p>
          <p className="text-xs text-[var(--accent)] mb-5 h-4 transition-all duration-500 truncate max-w-xs mx-auto">
            {isComplete ? 'Complete!' : scanProgress ? scanProgress.fileName : statusMessages[messageIndex]}
          </p>
          <div className="w-full bg-[var(--border)] rounded-full h-2 overflow-hidden mb-3">
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{ width: `${displayPct}%`, background: 'linear-gradient(90deg, var(--accent) 0%, #818CF8 100%)' }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
            <span className="font-medium tabular-nums">{displayPct}%</span>
            <span className="flex items-center gap-1">
              {!isComplete && <Clock size={11} className="shrink-0" />}
              {countdownLabel}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Rich view: file list + steps checklist ────────────────────────────────
  const docCountLabel = files && files.length > 0
    ? files.length === 1
      ? 'Processing 1 document with AI…'
      : `Processing ${files.length} documents with AI…`
    : 'Running AI analysis…';

  const subtitleLabel = scanProgress
    ? `Scanning document ${scanProgress.current} of ${scanProgress.total}…`
    : docCountLabel;

  return (
    <div className="flex flex-col items-center justify-center py-16 px-6">
      <div className="glass-solid rounded-2xl p-8 max-w-2xl w-full">

        {/* Header */}
        <div className="flex items-center gap-4 mb-7">
          <div className="w-11 h-11 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Sparkles size={20} className="text-[var(--accent)] animate-pulse" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] leading-tight">
              {title ?? 'Analysing Documents'}
            </h2>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">{subtitleLabel}</p>
          </div>
        </div>

        {/* Two-column body: documents left, steps right */}
        <div className={`grid gap-6 mb-7 ${files && files.length > 0 && steps && steps.length > 0 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>

          {/* Documents panel */}
          {files && files.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                Documents
              </p>
              <ul className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5 min-w-0">
                    <FileStatusIcon status={f.status} />
                    <span
                      className={`text-sm truncate leading-tight ${
                        f.status === 'processing'
                          ? 'text-[var(--text-primary)] font-medium'
                          : f.status === 'complete'
                          ? 'text-[var(--text-secondary)]'
                          : f.status === 'error'
                          ? 'text-red-400'
                          : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {f.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Steps panel */}
          {steps && steps.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                Progress
              </p>
              <ul className="space-y-2.5">
                {steps.map((step, i) => {
                  const status = stepStatuses[i];
                  return (
                    <li key={i} className="flex items-center gap-2.5">
                      <StepIcon status={status} />
                      <span
                        className={`text-sm leading-tight ${
                          status === 'active'
                            ? 'text-[var(--text-primary)] font-medium'
                            : status === 'complete'
                            ? 'text-[var(--text-muted)]'
                            : 'text-[var(--text-muted)] opacity-50'
                        }`}
                      >
                        {step}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-[var(--border)] rounded-full h-1.5 overflow-hidden mb-2">
          <div
            className="h-1.5 rounded-full transition-all duration-700"
            style={{
              width: `${displayPct}%`,
              background: 'linear-gradient(90deg, var(--accent) 0%, #818CF8 100%)',
            }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span className="font-medium tabular-nums">{displayPct}%</span>
          <span className="flex items-center gap-1">
            {!isComplete && <Clock size={11} className="shrink-0" />}
            {countdownLabel}
          </span>
        </div>

      </div>
    </div>
  );
}
