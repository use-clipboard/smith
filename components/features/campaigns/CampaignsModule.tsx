'use client';

import { useState, useEffect } from 'react';
import {
  Megaphone, LayoutDashboard, Users, Send, Workflow, LayoutTemplate,
  BarChart3, Settings as SettingsIcon, Plus,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import Spinner from '@/components/ui/Spinner';
import { canAccessCampaigns } from '@/lib/campaigns/access';
import CampaignsComingSoon from './CampaignsComingSoon';
import ConnectGmailGate from './ConnectGmailGate';
import CampaignsOverview from './overview/CampaignsOverview';
import AudiencesTab from './audiences/AudiencesTab';
import CampaignsTab from './campaigns/CampaignsTab';
import AutomationsTab from './automations/AutomationsTab';
import TemplatesTab from './templates/TemplatesTab';
import ReportsTab from './reports/ReportsTab';
import SettingsTab from './settings/SettingsTab';
import CampaignWizard from './campaigns/CampaignWizard';

type CampaignsTabId =
  | 'overview' | 'audiences' | 'campaigns' | 'automations' | 'templates' | 'reports' | 'settings';

const TABS: { id: CampaignsTabId; label: string; icon: typeof Megaphone }[] = [
  { id: 'overview',    label: 'Overview',    icon: LayoutDashboard },
  { id: 'audiences',   label: 'Audiences',   icon: Users },
  { id: 'campaigns',   label: 'Campaigns',   icon: Send },
  { id: 'automations', label: 'Automations', icon: Workflow },
  { id: 'templates',   label: 'Templates',   icon: LayoutTemplate },
  { id: 'reports',     label: 'Reports',     icon: BarChart3 },
  { id: 'settings',    label: 'Settings',    icon: SettingsIcon },
];

export default function CampaignsModule({ userEmail }: { userEmail: string | null }) {
  const [tab, setTab] = useState<CampaignsTabId>('overview');
  // null = tab view; 'new' or an id = the wizard is open on that campaign.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // null = still checking Gmail connection status.
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  const allowed = canAccessCampaigns(userEmail);
  useEffect(() => {
    if (!allowed) return;
    let live = true;
    (async () => {
      try {
        const r = await fetch('/api/campaigns/meta');
        if (r.ok && live) setGmailConnected(!!(await r.json()).gmail?.connected);
        else if (live) setGmailConnected(false);
      } catch { if (live) setGmailConnected(false); }
    })();
    return () => { live = false; };
  }, [allowed]);

  if (!allowed) return <CampaignsComingSoon />;
  if (gmailConnected === null) {
    return <div className="flex items-center justify-center h-full py-24"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;
  }
  if (!gmailConnected) return <ConnectGmailGate />;

  function openWizard(id: string | 'new') { setEditing(id); }
  function closeWizard(opts?: { sent?: boolean }) {
    setEditing(null);
    setRefreshKey(k => k + 1);
    if (opts?.sent) setTab('reports');
    else setTab('campaigns');
  }

  // Jump straight into a new campaign, optionally pre-filled. The wizard reads
  // these from a one-shot prefill store on window.
  function startCampaign(prefill: { audienceId?: string; name?: string; subject?: string; preview_text?: string; body_html?: string }) {
    setEditing('new');
    (window as unknown as { __campaignPrefill?: unknown }).__campaignPrefill = prefill;
  }
  function startCampaignFor(audienceId?: string, name?: string) {
    startCampaign({ audienceId, name });
  }

  if (editing) {
    return (
      <CampaignWizard
        campaignId={editing === 'new' ? null : editing}
        onClose={closeWizard}
      />
    );
  }

  const headerRight = (
    <button onClick={() => openWizard('new')} className="btn-primary">
      <Plus size={15} /> New campaign
    </button>
  );

  return (
    <ToolLayout
      title="Campaigns"
      description="Intelligent client communications, built for accounting firms."
      icon={Megaphone}
      iconColor="#7C3AED"
      wide
      headerRight={headerRight}
    >
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
        <CampaignsOverview
          key={refreshKey}
          onNewCampaign={() => openWizard('new')}
          onStartCampaignFor={startCampaignFor}
          onGoToTab={id => setTab(id as CampaignsTabId)}
        />
      )}
      {tab === 'audiences' && <AudiencesTab key={refreshKey} onUseInCampaign={(id) => startCampaignFor(id)} />}
      {tab === 'campaigns' && <CampaignsTab key={refreshKey} onOpen={openWizard} />}
      {tab === 'reports' && <ReportsTab key={refreshKey} />}
      {tab === 'automations' && <AutomationsTab key={refreshKey} />}
      {tab === 'templates' && (
        <TemplatesTab
          key={refreshKey}
          onUseInCampaign={(t) => startCampaign({ name: t.name, subject: t.subject, preview_text: t.preview_text, body_html: t.body_html })}
        />
      )}
      {tab === 'settings' && <SettingsTab key={refreshKey} />}
    </ToolLayout>
  );
}
