'use client';

import { useState } from 'react';
import {
  ReceiptText, LayoutDashboard, FileText, RefreshCw, CreditCard,
  Landmark, Users, BarChart3, SlidersHorizontal, Plus, Sparkles,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import { GlassCard } from '@/components/features/timesheets/shared/ui';
import BillingOverview from './overview/BillingOverview';
import InvoicesTab from './invoices/InvoicesTab';
import NewInvoiceDrawer from './invoices/NewInvoiceDrawer';
import BillingSettingsTab from './settings/BillingSettingsTab';
import RecurringTab from './recurring/RecurringTab';
import CreditControlTab from './credit/CreditControlTab';

type BillingTab =
  | 'overview' | 'invoices' | 'recurring' | 'credit_control'
  | 'payments' | 'direct_debits' | 'clients' | 'reports' | 'settings';

const TABS: { id: BillingTab; label: string; icon: typeof ReceiptText }[] = [
  { id: 'overview',       label: 'Overview',       icon: LayoutDashboard },
  { id: 'invoices',       label: 'Invoices',       icon: FileText },
  { id: 'recurring',      label: 'Recurring',      icon: RefreshCw },
  { id: 'credit_control', label: 'Credit Control', icon: Sparkles },
  { id: 'payments',       label: 'Payments',       icon: CreditCard },
  { id: 'direct_debits',  label: 'Direct Debits',  icon: Landmark },
  { id: 'clients',        label: 'Clients',        icon: Users },
  { id: 'reports',        label: 'Reports',        icon: BarChart3 },
  { id: 'settings',       label: 'Settings',       icon: SlidersHorizontal },
];

/** Which phase each not-yet-built tab is scheduled for (see docs/billing-module.md). */
const PHASE_NOTES: Partial<Record<BillingTab, { phase: string; blurb: string }>> = {
  payments:       { phase: 'Phase D', blurb: 'Stripe card + Bacs Direct Debit collection, plus CSV bank import with AI reconciliation.' },
  direct_debits:  { phase: 'Phase D', blurb: 'Stripe Bacs Direct Debit mandates — sent on proposal acceptance, then collected automatically.' },
  clients:        { phase: 'Phase B', blurb: 'Per-client billing view — statements, balances, payment history and recurring lines in one place.' },
  reports:        { phase: 'Phase E', blurb: 'MRR / ARR, aged debtors, debtor days, revenue by client / manager / service, and real recovery from Timesheets.' },
};

export default function BillingModule() {
  const [tab, setTab] = useState<BillingTab>('overview');
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSaved() {
    setNewInvoiceOpen(false);
    setRefreshKey(k => k + 1);
    setTab('invoices');
  }

  const headerRight = (
    <button onClick={() => setNewInvoiceOpen(true)} className="btn-primary">
      <Plus size={15} /> New invoice
    </button>
  );

  return (
    <ToolLayout
      title="Billing"
      description="Invoicing, recurring billing and credit control — the firm's commercial engine."
      icon={ReceiptText}
      iconColor="#7C3AED"
      wide
      headerRight={headerRight}
    >
      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-black/5">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-semibold transition-colors ${active ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
            >
              <Icon size={15} /> {t.label}
              {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--accent)]" />}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && (
        <BillingOverview key={refreshKey} onNewInvoice={() => setNewInvoiceOpen(true)} onGoToTab={id => setTab(id as BillingTab)} />
      )}
      {tab === 'invoices' && (
        <InvoicesTab key={refreshKey} onNewInvoice={() => setNewInvoiceOpen(true)} />
      )}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'credit_control' && <CreditControlTab onGoToSettings={() => setTab('settings')} />}
      {tab === 'settings' && <BillingSettingsTab />}
      {tab !== 'overview' && tab !== 'invoices' && tab !== 'settings' && tab !== 'recurring' && tab !== 'credit_control' && (
        <PhasePlaceholder tab={tab} />
      )}

      {newInvoiceOpen && (
        <NewInvoiceDrawer onClose={() => setNewInvoiceOpen(false)} onSaved={handleSaved} />
      )}
    </ToolLayout>
  );
}

function PhasePlaceholder({ tab }: { tab: BillingTab }) {
  const note = PHASE_NOTES[tab];
  const meta = TABS.find(t => t.id === tab);
  const Icon = meta?.icon ?? ReceiptText;
  return (
    <GlassCard className="mx-auto max-w-xl text-center">
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[var(--accent)]">
          <Icon size={26} />
        </div>
        <h3 className="text-lg font-bold text-[var(--text-primary)]">{meta?.label}</h3>
        {note && (
          <>
            <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 border border-amber-200">
              {note.phase}
            </span>
            <p className="max-w-md text-sm text-[var(--text-muted)]">{note.blurb}</p>
          </>
        )}
      </div>
    </GlassCard>
  );
}
