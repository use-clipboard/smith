'use client';

import { X, Zap, GitBranch, CheckCircle2 } from 'lucide-react';

interface Props {
  onQuickTask: () => void;
  onFullTask: () => void;
  onClose: () => void;
}

const QUICK_BULLETS = [
  'Title, due date, and a simple step checklist',
  'Assign everything to one person',
  'No flowchart or complex branching',
  'Optional recurrence',
];

const FULL_BULLETS = [
  'Visual flowchart with branching & merging',
  'Assign individual steps to different people',
  'Start from a template or build from scratch',
  'Full recurrence scheduling',
];

export default function TaskTypeSelector({ onQuickTask, onFullTask, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Create New Task</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose how you'd like to create this task</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Two cards */}
        <div className="p-6 grid grid-cols-2 gap-4">

          {/* Quick Task */}
          <button
            onClick={onQuickTask}
            className="group text-left border-2 border-gray-200 hover:border-indigo-400 rounded-xl p-5 transition-all hover:shadow-md hover:shadow-indigo-100/50"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="h-11 w-11 rounded-xl bg-indigo-100 flex items-center justify-center group-hover:bg-indigo-200 transition-colors flex-shrink-0">
                <Zap className="h-5 w-5 text-indigo-600" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">Quick Task</p>
                <p className="text-xs font-semibold text-indigo-500">Simple &amp; fast</p>
              </div>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              Perfect for simple, one-off tasks. Everything in one screen — no steps required.
            </p>

            <ul className="space-y-2 mb-5">
              {QUICK_BULLETS.map(b => (
                <li key={b} className="flex items-start gap-2 text-xs text-gray-500">
                  <CheckCircle2 className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-end">
              <span className="text-sm font-semibold text-indigo-600 group-hover:text-indigo-700 transition-colors">
                Get started →
              </span>
            </div>
          </button>

          {/* Full Task */}
          <button
            onClick={onFullTask}
            className="group text-left border-2 border-gray-200 hover:border-violet-400 rounded-xl p-5 transition-all hover:shadow-md hover:shadow-violet-100/50"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="h-11 w-11 rounded-xl bg-violet-100 flex items-center justify-center group-hover:bg-violet-200 transition-colors flex-shrink-0">
                <GitBranch className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-base font-bold text-gray-900">Full Task</p>
                <p className="text-xs font-semibold text-violet-500">Powerful &amp; flexible</p>
              </div>
            </div>

            <p className="text-sm text-gray-500 leading-relaxed mb-4">
              For complex workflows. Choose from your firm's templates or build from scratch with a visual flowchart.
            </p>

            <ul className="space-y-2 mb-5">
              {FULL_BULLETS.map(b => (
                <li key={b} className="flex items-start gap-2 text-xs text-gray-500">
                  <CheckCircle2 className="h-3.5 w-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                  {b}
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-end">
              <span className="text-sm font-semibold text-violet-600 group-hover:text-violet-700 transition-colors">
                Choose a template →
              </span>
            </div>
          </button>

        </div>
      </div>
    </div>
  );
}
