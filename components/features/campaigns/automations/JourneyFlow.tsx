'use client';

import { Mail, Clock, Target, CornerDownRight, Flag } from 'lucide-react';
import type { JourneyStep, JourneyBranchAction, JourneyGoal } from '@/types/campaigns';

// A read-only picture of the journey: what runs, in what order, and where each
// branch sends the client. Journeys are linear with jumps rather than a free
// graph, so a vertical flow with labelled branch chips shows the whole shape
// without pretending to be a canvas.

const GOAL_TEXT: Record<JourneyGoal, string> = {
  opened: 'opened the last email',
  clicked: 'clicked a link',
  uploaded_document: 'uploaded a document',
  paid_invoice: 'paid an invoice',
  completed_task: 'completed a task',
};

function branchLabel(b: JourneyBranchAction | undefined, fallback: 'finish' | 'continue', steps: JourneyStep[]): string {
  // Annotated so the discriminated union narrows; without it the fallback
  // widens to { action: 'finish' | 'continue' } and blocks narrowing.
  const action: JourneyBranchAction = b ?? { action: fallback };
  if (action.action === 'finish') return 'Finish journey';
  if (action.action === 'continue') return 'Next step';
  const idx = steps.findIndex(s => s.id === action.toStepId);
  return idx >= 0 ? `Go to step ${idx + 1}` : 'Next step (target removed)';
}

export default function JourneyFlow({ steps }: { steps: JourneyStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-black/[0.015] p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Flow</div>
      <div className="space-y-0">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <div key={s.id}>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[var(--accent-light)] text-[var(--accent)] text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  {s.type === 'email' && (
                    <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-primary)]">
                      <Mail size={12} style={{ color: 'var(--accent)' }} />
                      <span className="font-medium">Send</span>
                      <span className="text-[var(--text-secondary)] truncate">{s.subject || '(no subject yet)'}</span>
                    </div>
                  )}
                  {s.type === 'wait' && (
                    <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-primary)]">
                      <Clock size={12} style={{ color: 'var(--accent)' }} />
                      <span className="font-medium">Wait</span>
                      <span className="text-[var(--text-secondary)]">{s.days} day{s.days === 1 ? '' : 's'}</span>
                    </div>
                  )}
                  {s.type === 'check' && (
                    <div>
                      <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--text-primary)]">
                        <Target size={12} style={{ color: 'var(--accent)' }} />
                        <span className="font-medium">Check</span>
                        <span className="text-[var(--text-secondary)] truncate">{GOAL_TEXT[s.goal]}</span>
                      </div>
                      <div className="mt-1 ml-1 space-y-0.5">
                        <div className="flex items-center gap-1 text-[11px] text-green-700">
                          <CornerDownRight size={11} /> yes → {branchLabel(s.onMet, 'finish', steps)}
                        </div>
                        <div className="flex items-center gap-1 text-[11px] text-amber-700">
                          <CornerDownRight size={11} /> no → {branchLabel(s.onNotMet, 'continue', steps)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {!isLast && <div className="ml-[9px] w-px h-3 bg-[var(--border)]" />}
            </div>
          );
        })}
        <div className="flex items-center gap-2 mt-1">
          <span className="w-5 h-5 rounded-full bg-black/5 text-[var(--text-muted)] flex items-center justify-center shrink-0"><Flag size={11} /></span>
          <span className="text-[11px] text-[var(--text-muted)]">Journey ends</span>
        </div>
      </div>
    </div>
  );
}
