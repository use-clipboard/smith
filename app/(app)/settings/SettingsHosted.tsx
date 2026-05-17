'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import SettingsClient from './SettingsClient';

interface Bootstrap {
  userId: string;
  userEmail: string;
  userName: string;
  avatarUrl: string | null;
  userRole: string;
  firmId: string | null;
  firmName: string;
  firmLogoUrl: string | null;
  subscriptionTier: string;
  activeModules: string[];
  seatCount: number;
  emailSenderName: string | null;
  emailSenderAddress: string | null;
}

// Client-side wrapper used by TabPanels so the Settings page stays mounted
// across tab switches. Fetches the bootstrap data once on mount.
export default function SettingsHosted() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/bootstrap')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <div className="p-6 text-sm text-red-700">Failed to load settings: {error}</div>;
  if (!data) return <div className="p-12 text-center text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading settings…</div>;

  return (
    <SettingsClient
      userId={data.userId}
      firmId={data.firmId}
      userEmail={data.userEmail}
      userName={data.userName}
      avatarUrl={data.avatarUrl}
      userRole={data.userRole}
      firmName={data.firmName}
      firmLogoUrl={data.firmLogoUrl}
      subscriptionTier={data.subscriptionTier}
      activeModules={data.activeModules}
      seatCount={data.seatCount}
      calendarModuleActive={data.activeModules.includes('google-calendar')}
      staffHireModuleActive={data.activeModules.includes('staff-hire')}
      tasksModuleActive={data.activeModules.includes('tasks')}
      emailTriageModuleActive={data.activeModules.includes('email-triage')}
      hrModuleActive={data.activeModules.includes('hr')}
      proposalsModuleActive={data.activeModules.includes('proposals')}
      mtdItModuleActive={data.activeModules.includes('mtd-it')}
      emailSenderName={data.emailSenderName}
      emailSenderAddress={data.emailSenderAddress}
    />
  );
}
