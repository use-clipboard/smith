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
  Zap, Plus, Upload, Sparkles, HelpCircle,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';

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

interface Props {
  /** Opens the quick add-account modal. */
  onAddAccount?: () => void;
  /** Switches the workspace to the Import & Migrate tab. Defined here on the
   *  home page (rather than the side rail) because bulk imports are an
   *  occasional, deliberate action — not something the user wants taking
   *  up rail real estate next to the day-to-day reports. */
  onImport?: () => void;
  /** Opens the Help & how-to overlay (Getting Started topics). */
  onHelp?: () => void;
}

const TONE_CLASSES: Record<ActionDef['tone'], { bg: string; text: string }> = {
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600'  },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600'   },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600'  },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-600'    },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600'     },
};

export default function QuickActionsCard({ onAddAccount, onImport, onHelp }: Props) {
  const [comingHint, setComingHint] = useState<string | null>(null);

  const actions: ActionDef[] = [
    {
      id: 'add_account',
      label: 'Add Account',
      description: 'Create a new account in an existing ledger',
      icon: Plus,
      tone: 'emerald',
      onClick: onAddAccount,
    },
    {
      id: 'import_data',
      label: 'Import & Migrate',
      description: 'Bring a client’s books into SMITH — opening balances or full history from another tool (admin only)',
      icon: Upload,
      tone: 'sky',
      onClick: onImport,
    },
    {
      id: 'help',
      label: 'Help & how-to',
      description: 'How the bookkeeping tool works and how to navigate it',
      icon: HelpCircle,
      tone: 'violet',
      onClick: onHelp,
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-2 border-b border-slate-100">
        <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Zap size={12} />
        </div>
        <h3 className="text-xs font-semibold text-slate-900">Quick Actions</h3>
      </div>

      {/* Compact 3-column grid — single line per button with icon + label.
          The "Soon" hint moves into the tooltip so the layout stays clean. */}
      <div className="p-2 grid grid-cols-3 gap-1.5">
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
                className={`w-full flex flex-col items-center gap-1 px-2 py-1.5 rounded-md border border-slate-200 bg-white transition-colors hover:border-slate-300 ${
                  isComing ? 'hover:bg-slate-50/50' : 'hover:bg-slate-50'
                }`}
              >
                <span className={`w-6 h-6 rounded-md ${tone.bg} ${tone.text} flex items-center justify-center shrink-0 ${isComing ? 'opacity-50' : ''}`}>
                  <Icon size={12} />
                </span>
                <span className={`text-[10px] font-medium leading-tight text-center ${isComing ? 'text-slate-400' : 'text-slate-700'}`}>
                  {a.label}
                  {isComing && (
                    <Sparkles size={8} className="inline-block ml-0.5 -mt-0.5 opacity-60" />
                  )}
                </span>
              </button>
            </Tooltip>
          );
        })}
      </div>

      {comingHint && (
        <div className="px-2 pb-2">
          <div className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-2 py-1.5">
            <span className="font-medium text-slate-700">{comingHint}</span> isn&apos;t wired up yet — it&apos;ll arrive in a later phase.
          </div>
        </div>
      )}
    </div>
  );
}
