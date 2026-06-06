'use client';

import { Upload, Sparkles, ClipboardList, Save, Mail, ShieldCheck, Check } from 'lucide-react';

// The MTD IT lifecycle, top-to-bottom in the order the user moves through it.
// The first four steps are driven by the per-quarter page; the last two are
// post-prep states (Stage C and the future HMRC submission integration).
export type WizardStep = 'setup' | 'analyse' | 'review' | 'save' | 'send';

interface StepDef { key: WizardStep; label: string; sub: string; Icon: typeof Upload }

const STEPS: StepDef[] = [
  { key: 'setup',    label: 'Set up',          sub: 'Streams, properties, trades, files',  Icon: Upload         },
  { key: 'analyse',  label: 'Analyse',          sub: 'AI scans each document',              Icon: Sparkles       },
  { key: 'review',   label: 'Review & adjust',  sub: 'Edit entries, flag, categorise',      Icon: ClipboardList  },
  { key: 'send',     label: 'Send to client',   sub: 'PDF approval pack + email',           Icon: Mail           },
  { key: 'save',     label: 'Save & Submit',    sub: 'Save the quarter and file it to HMRC', Icon: ShieldCheck    },
];

interface Props {
  current: WizardStep;
  /** Which steps are not yet implemented — rendered greyed out. */
  notYetAvailable?: WizardStep[];
  /** Click handler — fires only for steps the user is allowed to jump to. */
  onStepClick?: (step: WizardStep) => void;
  /** Steps the user is allowed to jump to. By default the current + any
      completed steps before it. */
  navigable?: WizardStep[];
}

export default function MtdItWizardStepper({ current, notYetAvailable = ['review', 'send'], onStepClick, navigable }: Props) {
  const currentIdx = STEPS.findIndex(s => s.key === current);
  // If navigable is omitted, default to every step that's before-or-equal to
  // the current step (so "back" navigation is always allowed).
  const navigableSet = new Set<WizardStep>(navigable ?? STEPS.slice(0, currentIdx + 1).map(s => s.key));
  return (
    <ol className="px-1 pt-2 pb-1">
      {/* No overflow-x-auto here — when one axis is auto, browsers clip the
          other axis too, which cut off the top of the current step's icon
          ring. Six steps with min-w-[110px] fit comfortably on every viewport
          this app supports. */}
      <div className="flex items-start gap-1">
        {STEPS.map((s, i) => {
          const isCurrent = i === currentIdx;
          const isDone    = i < currentIdx;
          const isLocked  = notYetAvailable.includes(s.key) && !isCurrent && !isDone;
          const Icon      = isDone ? Check : s.Icon;
          const clickable = !!onStepClick && navigableSet.has(s.key) && !isCurrent;

          // Colour scheme is applied to the icon ring + (current only) the
          // title pill below it. The step's surrounding box stays neutral so
          // the icon-on-top stack reads as the focal point.
          const iconRing =
            isCurrent ? 'bg-[var(--accent-light)] text-[var(--accent)] ring-2 ring-[var(--accent)]/30 shadow-sm' :
            isDone    ? 'bg-[var(--accent)] text-white' :
            isLocked  ? 'bg-gray-50 text-gray-400 border border-dashed border-gray-200' :
                        'bg-gray-100 text-gray-500';
          const titlePill =
            isCurrent ? 'bg-[var(--accent)] text-white shadow-sm' :
            isDone    ? 'text-[var(--accent)]' :
            isLocked  ? 'text-gray-400' :
                        'text-gray-600';

          // Steps that are reachable get rendered as <button> so they're
          // keyboard-focusable + announce as clickable. Everything else is a
          // plain <div> so it doesn't hint at interactivity.
          const Wrapper: 'button' | 'div' = clickable ? 'button' : 'div';
          const wrapperProps = clickable
            ? {
                type: 'button' as const,
                onClick: () => onStepClick?.(s.key),
                'aria-label': `Go back to step ${i + 1}: ${s.label}`,
                className: `flex-1 flex flex-col items-center text-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-50 transition-colors ${isLocked ? 'opacity-70' : ''}`,
              }
            : { className: `flex-1 flex flex-col items-center text-center gap-1.5 px-2 ${isLocked ? 'opacity-70' : ''}` };
          return (
            <li key={s.key} className="flex-1 min-w-[110px] flex items-start">
              {/* Step block — icon stacked above title + sub, all centred */}
              <Wrapper {...wrapperProps}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${iconRing}`}>
                  <Icon size={16} strokeWidth={isDone ? 3 : 2} />
                </div>
                <div className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide font-semibold leading-tight px-2 py-0.5 rounded-full transition-all ${titlePill}`}>
                  <span>{i + 1}. {s.label}</span>
                  {isLocked && <span className="text-[9px] opacity-80 font-normal normal-case">(soon)</span>}
                </div>
                <div className="text-[10px] text-gray-500 leading-tight max-w-[14ch]">{s.sub}</div>
              </Wrapper>
              {i < STEPS.length - 1 && (
                <span aria-hidden className={`w-3 h-px self-center mt-5 ${isDone ? 'bg-[var(--accent)]' : 'bg-gray-200'}`} />
              )}
            </li>
          );
        })}
      </div>
    </ol>
  );
}
