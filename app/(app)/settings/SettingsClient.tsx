'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal, User, Building2, Lock, Puzzle, CreditCard, Key, UsersRound, CalendarDays, UserPlus } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import GoogleDriveSettings from '@/components/features/settings/GoogleDriveSettings';
import PreferencesTab from './tabs/PreferencesTab';
import ModulesTab from './tabs/ModulesTab';
import BillingTab from './tabs/BillingTab';
import TeamTab from './tabs/TeamTab';
import ApiKeySettings from '@/components/features/settings/ApiKeySettings';
import CalendarSettingsTab from './tabs/CalendarSettingsTab';
import StaffHireSettingsTab from './tabs/StaffHireSettingsTab';
import { createClient } from '@/lib/supabase';

type Tab = 'preferences' | 'profile' | 'account' | 'team' | 'api-key' | 'modules' | 'billing' | 'calendar' | 'staff-hire';

interface Props {
  userId: string;
  firmId: string | null;
  userEmail: string;
  userName: string;
  avatarUrl: string | null;
  userRole: string;
  firmName: string;
  firmLogoUrl: string | null;
  subscriptionTier: string;
  activeModules: string[];
  seatCount: number;
  calendarModuleActive?: boolean;
  staffHireModuleActive?: boolean;
}

const TIER_LABELS: Record<string, string> = {
  internal: 'Internal (Phase 1)',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export default function SettingsClient({
  userId, firmId, userEmail, userName, avatarUrl, userRole,
  firmName, firmLogoUrl, subscriptionTier, activeModules, seatCount, calendarModuleActive, staffHireModuleActive,
}: Props) {
  const isAdmin = userRole === 'admin';
  const searchParams = useSearchParams();

  // Allow deep-linking to a specific tab via ?tab=modules (map legacy 'appearance' → 'preferences')
  const rawTab = searchParams.get('tab');
  const resolvedTab = (rawTab === 'appearance' ? 'preferences' : rawTab) as Tab | null;
  const initialTab: Tab = resolvedTab ?? 'preferences';
  const [activeTab, setActiveTab] = useState<Tab>(
    isAdmin ? initialTab : (initialTab === 'modules' || initialTab === 'billing' ? 'preferences' : initialTab)
  );

  const [displayName, setDisplayName] = useState(userName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [currentAvatar, setCurrentAvatar] = useState(avatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [currentLogo, setCurrentLogo] = useState(firmLogoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editFirmName, setEditFirmName] = useState(firmName);
  const [savingFirmName, setSavingFirmName] = useState(false);
  const [firmNameSaved, setFirmNameSaved] = useState(false);
  const supabase = createClient();

  const ALL_TABS = [
    { id: 'preferences' as Tab, label: 'Preferences', icon: SlidersHorizontal, adminOnly: false, hidden: false },
    { id: 'profile' as Tab,     label: 'Profile',     icon: User,              adminOnly: false, hidden: false },
    { id: 'account' as Tab,     label: 'Account',     icon: Building2,         adminOnly: false, hidden: false },
    { id: 'team' as Tab,        label: 'Team',        icon: UsersRound,        adminOnly: true,  hidden: false },
    { id: 'api-key' as Tab,     label: 'AI & API Key',icon: Key,               adminOnly: true,  hidden: false },
    { id: 'modules' as Tab,     label: 'Tools',       icon: Puzzle,            adminOnly: true,  hidden: false },
    { id: 'billing' as Tab,     label: 'Billing',     icon: CreditCard,        adminOnly: true,  hidden: false },
    { id: 'calendar' as Tab,    label: 'Calendar',    icon: CalendarDays,      adminOnly: false, hidden: !calendarModuleActive },
    { id: 'staff-hire' as Tab, label: 'Staff Hire',  icon: UserPlus,          adminOnly: true,  hidden: !staffHireModuleActive },
  ];

  // Non-admins see all tabs but account/modules/billing show a lock; hidden tabs are never shown
  const TABS = ALL_TABS.filter(t => !t.hidden && (!t.adminOnly || isAdmin));

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      await supabase.from('users').update({ full_name: displayName }).eq('id', userId);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Max file size is 2MB'); return; }

    setUploadingAvatar(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `avatars/${userId}.${ext}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', userId);
      setCurrentAvatar(publicUrl + '?t=' + Date.now());
    } catch (err) {
      console.error('Avatar upload failed:', err);
      alert('Failed to upload avatar. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert('Max file size is 2MB'); return; }

    setUploadingLogo(true);
    try {
      const ext = file.name.split('.').pop() ?? 'png';
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/firm/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: file.type, ext }),
      });
      if (!res.ok) throw new Error('Upload failed');
      const { logoUrl } = await res.json() as { logoUrl: string };
      setCurrentLogo(logoUrl + '?t=' + Date.now());
    } catch (err) {
      console.error('Logo upload failed:', err);
      alert('Failed to upload firm logo. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSaveFirmName() {
    if (!firmId || !editFirmName.trim()) return;
    setSavingFirmName(true);
    try {
      await supabase.from('firms').update({ name: editFirmName.trim() }).eq('id', firmId);
      setFirmNameSaved(true);
      setTimeout(() => setFirmNameSaved(false), 2500);
    } finally {
      setSavingFirmName(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Settings</h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Manage your firm, tools, profile, and preferences.</p>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isLocked = tab.id === 'account' && !isAdmin;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-150 -mb-px whitespace-nowrap
                ${activeTab === tab.id
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
            >
              <Icon size={15} />
              {tab.label}
              {isLocked && <Lock size={11} className="opacity-40" />}
            </button>
          );
        })}
      </div>

      {/* Preferences tab */}
      {activeTab === 'preferences' && <PreferencesTab />}

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-solid rounded-xl p-6">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Profile Photo</h3>
            <div className="flex items-center gap-5">
              <Avatar name={displayName || userEmail} avatarUrl={currentAvatar} size={64} />
              <div>
                <label className="btn-secondary cursor-pointer text-sm">
                  {uploadingAvatar ? 'Uploading…' : 'Upload Photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handleAvatarUpload}
                    disabled={uploadingAvatar}
                  />
                </label>
                <p className="text-xs text-[var(--text-muted)] mt-2">JPG, PNG or WebP · Max 2MB</p>
              </div>
            </div>
          </div>

          <div className="glass-solid rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Display Name</h3>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your display name"
              className="input-base"
            />
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Email</label>
              <p className="text-sm text-[var(--text-secondary)] mt-1">{userEmail}</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="btn-primary"
              >
                {savingProfile ? 'Saving…' : 'Save Profile'}
              </button>
              {profileSaved && <span className="text-xs text-green-500 font-medium">Saved!</span>}
            </div>
          </div>
        </div>
      )}

      {/* Account tab */}
      {activeTab === 'account' && (
        <div className={!isAdmin ? 'relative' : ''}>
          {!isAdmin && (
            <div className="flex items-center gap-2 p-3 mb-6 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/30 text-sm text-amber-700 dark:text-amber-400">
              <Lock size={14} className="flex-shrink-0" />
              These settings can only be changed by a firm admin.
            </div>
          )}
          <div className={`space-y-6 ${!isAdmin ? 'opacity-40 pointer-events-none select-none' : ''}`}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-solid rounded-xl p-6 space-y-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Firm Details</h3>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Firm Name</label>
                  {isAdmin ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="text"
                        value={editFirmName}
                        onChange={e => setEditFirmName(e.target.value)}
                        className="input-base flex-1"
                        placeholder="Firm name"
                      />
                      <button
                        onClick={handleSaveFirmName}
                        disabled={savingFirmName || !editFirmName.trim() || editFirmName.trim() === firmName}
                        className="btn-primary shrink-0 disabled:opacity-50"
                      >
                        {savingFirmName ? 'Saving…' : 'Save'}
                      </button>
                      {firmNameSaved && <span className="text-xs text-green-500 font-medium shrink-0">Saved!</span>}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text-primary)] mt-1">{firmName || '—'}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Subscription</label>
                  <p className="text-sm text-[var(--text-primary)] mt-1">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--accent-light)] text-[var(--accent)]">
                      {TIER_LABELS[subscriptionTier] || subscriptionTier}
                    </span>
                  </p>
                </div>
                <div className="pt-1 border-t border-[var(--border)]">
                  <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Firm Logo</label>
                  <div className="flex items-center gap-4 mt-2">
                    {currentLogo ? (
                      <img src={currentLogo} alt="Firm logo" className="h-12 max-w-[120px] object-contain rounded border border-[var(--border)] bg-white p-1" />
                    ) : (
                      <div className="h-12 w-20 rounded border border-dashed border-[var(--border)] bg-[var(--bg-nav-hover)] flex items-center justify-center">
                        <span className="text-[10px] text-[var(--text-muted)]">No logo</span>
                      </div>
                    )}
                    {isAdmin && (
                      <div>
                        <label className="btn-secondary cursor-pointer text-sm">
                          {uploadingLogo ? 'Uploading…' : currentLogo ? 'Replace Logo' : 'Upload Logo'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={handleLogoUpload}
                            disabled={uploadingLogo}
                          />
                        </label>
                        <p className="text-xs text-[var(--text-muted)] mt-1.5">PNG, JPG, SVG · Max 2MB</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <GoogleDriveSettings />
            </div>

          </div>
        </div>
      )}

      {/* Team tab — admin only */}
      {activeTab === 'team' && isAdmin && (
        <TeamTab currentUserId={userId} />
      )}

      {/* AI & API Key tab — admin only */}
      {activeTab === 'api-key' && isAdmin && (
        <div className="max-w-2xl">
          <ApiKeySettings />
        </div>
      )}

      {/* Modules tab — admin only */}
      {activeTab === 'modules' && isAdmin && (
        <ModulesTab initialActiveModules={activeModules} />
      )}

      {/* Billing tab — admin only */}
      {activeTab === 'billing' && isAdmin && (
        <BillingTab initialActiveModules={activeModules} initialSeatCount={seatCount} />
      )}

      {/* Calendar tab — available to all users when module is active */}
      {activeTab === 'calendar' && calendarModuleActive && (
        <CalendarSettingsTab isAdmin={isAdmin} currentUserId={userId} />
      )}

      {/* Staff Hire tab — admin only, shown when module is active */}
      {activeTab === 'staff-hire' && isAdmin && staffHireModuleActive && (
        <StaffHireSettingsTab />
      )}
    </div>
  );
}
