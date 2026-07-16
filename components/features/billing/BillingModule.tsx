'use client';

import { useState } from 'react';
import {
  ReceiptText, LayoutDashboard, FileText, RefreshCw, CreditCard,
  Landmark, Users, BarChart3, Plus, Sparkles, Upload,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import BillingOverview from './overview/BillingOverview';
import InvoicesTab from './invoices/InvoicesTab';
import NewInvoiceDrawer from './invoices/NewInvoiceDrawer';
import ImportInvoicesModal from './import/ImportInvoicesModal';
import RecurringTab from './recurring/RecurringTab';
import CreditControlTab from './credit/CreditControlTab';
import PaymentsTab from './payments/PaymentsTab';
import DirectDebitsTab from './directdebits/DirectDebitsTab';
import ReportsTab from './reports/ReportsTab';
import ClientsBillingTab from './clients/ClientsBillingTab';

// Billing's settings now live in the app's own Settings → Billing tab, like
// every other tool — hence no 'settings' tab here.
type BillingTab =
  | 'overview' | 'invoices' | 'recurring' | 'credit_control'
  | 'payments' | 'direct_debits' | 'clients' | 'reports';

const TABS: { id: BillingTab; label: string; icon: typeof ReceiptText }[] = [
  { id: 'overview',       label: 'Overview',       icon: LayoutDashboard },
  { id: 'invoices',       label: 'Invoices',       icon: FileText },
  { id: 'recurring',      label: 'Recurring',      icon: RefreshCw },
  { id: 'credit_control', label: 'Credit Control', icon: Sparkles },
  { id: 'payments',       label: 'Payments',       icon: CreditCard },
  { id: 'direct_debits',  label: 'Direct Debits',  icon: Landmark },
  { id: 'clients',        label: 'Clients',        icon: Users },
  { id: 'reports',        label: 'Reports',        icon: BarChart3 },
];

export default function BillingModule() {
  const [tab, setTab] = useState<BillingTab>('overview');
  const [newInvoiceOpen, setNewInvoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSaved() {
    setNewInvoiceOpen(false);
    setRefreshKey(k => k + 1);
    setTab('invoices');
  }
  function handleImported() {
    setImportOpen(false);
    setRefreshKey(k => k + 1);
    setTab('invoices');
  }

  const headerRight = (
    <div className="flex items-center gap-2">
      <button onClick={() => setImportOpen(true)} className="btn-secondary"><Upload size={15} /> Import</button>
      <button onClick={() => setNewInvoiceOpen(true)} className="btn-primary"><Plus size={15} /> New invoice</button>
    </div>
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
        <BillingOverview key={refreshKey} onNewInvoice={() => setNewInvoiceOpen(true)} onImport={() => setImportOpen(true)} onGoToTab={id => setTab(id as BillingTab)} />
      )}
      {tab === 'invoices' && (
        <InvoicesTab key={refreshKey} onNewInvoice={() => setNewInvoiceOpen(true)} onImport={() => setImportOpen(true)} />
      )}
      {tab === 'recurring' && <RecurringTab />}
      {tab === 'credit_control' && <CreditControlTab />}
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'direct_debits' && <DirectDebitsTab />}
      {tab === 'clients' && <ClientsBillingTab />}
      {tab === 'reports' && <ReportsTab />}

      {newInvoiceOpen && (
        <NewInvoiceDrawer onClose={() => setNewInvoiceOpen(false)} onSaved={handleSaved} />
      )}
      {importOpen && (
        <ImportInvoicesModal onClose={() => setImportOpen(false)} onImported={handleImported} />
      )}
    </ToolLayout>
  );
}
