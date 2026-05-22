'use client';

/**
 * QuickActionsCard — six secondary buttons on the Home tab.
 *
 * VT equivalent: the inline "Quick Actions" panel that lets the user jump
 * to the most common book-level tasks without hunting through menus.
 *
 * Wired now:
 *   • Add Transaction → parent switches to the Input tab.
 *
 * Stubbed (clickable, show a "Coming soon" hint):
 *   • Set Up Assistants  — opening-balances wizard (later)
 *   • Customise View      — Home-page personalisation (later)
 *   • Add Account         — quick-add account dialog (will reuse AccountPicker's
 *                            inline create form in a dedicated modal)
 *   • Add Ledger          — admin-only ledger management (later)
 *   • Import Data         — CSV/Excel import (Phase 7)
 */

import { useState } from 'react';
import {
  Zap, Sliders, Plus, Layers, Pencil, Upload, Sparkles,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

interface Props {
  /** Switch to the Input tab. Set by BookView so the action drives the workspace. */
  onAddTransaction: () => void;
}

interface ActionDef {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Tailwind colour for the icon tile. Static so JIT keeps the classes. */
  tone: 'indigo' | 'emerald' | 'amber' | 'violet' | 'rose' | 'sky';
  /** When undefined, the button is "coming soon" and shows the hint. */
  onClick?: () => void;
}

const TONE_CLASSES: Record<ActionDef['tone'], { bg: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600'  },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600'   },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600'  },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-600'    },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600'     },
};

export default function QuickActionsCard({ onAddTransaction }: Props) {
  const [comingHint, setComingHint] = useState<string | null>(null);

  const actions: ActionDef[] = [
    {
      id: 'set_up_assistants',
      label: 'Set Up Assistants',
      description: 'Guided opening balances + initial setup wizards',
      icon: Zap,
      tone: 'amber',
    },
    {
      id: 'customise_view',
      label: 'Customise View',
      description: 'Choose what shows on the Home page Key items panel',
      icon: Sliders,
      tone: 'violet',
    },
    {
      id: 'add_account',
      label: 'Add Account',
      description: 'Create a new account in an existing ledger',
      icon: Plus,
      tone: 'emerald',
    },
    {
      id: 'add_ledger',
      label: 'Add Ledger',
      description: 'Create a new ledger (admin only)',
      icon: Layers,
      tone: 'rose',
    },
    {
      id: 'add_transaction',
      label: 'Add Transaction',
      description: 'Open the input sheet ready to post',
      icon: Pencil,
      tone: 'indigo',
      onClick: onAddTransaction,
    },
    {
      id: 'import_data',
      label: 'Import Data',
      description: 'Bring in transactions from CSV / Excel / VT',
      icon: Upload,
      tone: 'sky',
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Zap size={14} />
        </div>
        <h3 className="text-sm font-semibold text-slate-900">Quick Actions</h3>
      </div>

      <div className="p-3 grid grid-cols-2 gap-2">
        {actions.map(a => {
          const Icon = a.icon;
          const tone = TONE_CLASSES[a.tone];
          const isComing = !a.onClick;
          return (
            <Tooltip key={a.id} label={isComing ? `${a.description} · Coming soon` : a.description}>
              <button
                type="button"
                onClick={() => {
                  if (a.onClick) { a.onClick(); return; }
                  setComingHint(a.label);
                  setTimeout(() => setComingHint(null), 2500);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white text-left transition-colors hover:border-slate-300 ${
                  isComing ? 'hover:bg-slate-50/50' : 'hover:bg-slate-50'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg ${tone.bg} ${tone.text} flex items-center justify-center shrink-0 ${isComing ? 'opacity-60' : ''}`}>
                  <Icon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-xs font-medium truncate ${isComing ? 'text-slate-500' : 'text-slate-900'}`}>
                    {a.label}
                  </span>
                  {isComing && (
                    <span className="block text-[10px] text-slate-400 inline-flex items-center gap-1">
                      <Sparkles size={9} /> Soon
                    </span>
                  )}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {comingHint && (
        <div className="px-3 pb-3">
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <span className="font-medium text-slate-700">{comingHint}</span> isn&apos;t wired up yet — it&apos;ll arrive in a later phase.
          </div>
        </div>
      )}
    </div>
  );
}
