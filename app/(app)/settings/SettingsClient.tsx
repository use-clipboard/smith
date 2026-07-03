'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidersHorizontal, User, Building2, Lock, Puzzle, CreditCard, Layers, Key, UsersRound, CalendarDays, UserPlus, CheckSquare, Mail, HeartHandshake, FileSignature, ChevronDown, Wrench, MessagesSquare, CalendarCheck, BookCopy, LayoutDashboard, FolderArchive, Clock } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import GoogleDriveSettings from '@/components/features/settings/GoogleDriveSettings';
import DeleteAccountSection from '@/components/features/settings/DeleteAccountSection';
import DeleteFirmSection from '@/components/features/settings/DeleteFirmSection';
import PreferencesTab from './tabs/PreferencesTab';
import DashboardSettingsTab from './tabs/DashboardSettingsTab';
import ModulesTab from './tabs/ModulesTab';
import TiersTab from './tabs/TiersTab';
import BillingTab from './tabs/BillingTab';
import TeamTab from './tabs/TeamTab';
import ApiKeySettings from '@/components/features/settings/ApiKeySettings';
import CalendarSettingsTab from './tabs/CalendarSettingsTab';
import StaffHireSettingsTab from './tabs/StaffHireSettingsTab';
import TasksSettingsTab from './tabs/TasksSettingsTab';
import MtdItSettingsTab from './tabs/MtdItSettingsTab';
import TimesheetsSettingsTab from './tabs/TimesheetsSettingsTab';
import EmailTriageTab from './tabs/EmailTriageTab';
import HrSettingsTab from './tabs/HrSettingsTab';
import ProposalsSettingsTab from './tabs/ProposalsSettingsTab';
import AgentSmithSettingsTab from './tabs/AgentSmithSettingsTab';
import CommunityTab from './tabs/CommunityTab';
import BookkeepingSettingsTab from './tabs/BookkeepingSettingsTab';
import AgentHatIcon from '@/components/ui/AgentHatIcon';
import { createClient } from '@/lib/supabase';

type Tab = 'preferences' | 'dashboard' | 'profile' | 'account' | 'team' | 'api-key' | 'modules' | 'tiers' | 'billing' | 'calendar' | 'staff-hire' | 'tasks' | 'timesheets' | 'email-triage' | 'hr' | 'proposals' | 'mtd-it' | 'agent-smith' | 'community' | 'bookkeeping' | 'document-vault';

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
  tasksModuleActive?: boolean;
  emailTriageModuleActive?: boolean;
  hrModuleActive?: boolean;
  proposalsModuleActive?: boolean;
  mtdItModuleActive?: boolean;
  bookkeepingActive?: boolean;
  documentVaultActive?: boolean;
  emailSenderName?: string | null;
  emailSenderAddress?: string | null;
}

const TIER_LABELS: Record<string, string> = {
  internal: 'Internal (Phase 1)',
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

export default function SettingsClient({
  userId, firmId, userEmail, userName, avatarUrl, userRole,
  firmName, firmLogoUrl, subscriptionTier, activeModules, seatCount,
  calendarModuleActive, staffHireModuleActive, tasksModuleActive, emailTriageModuleActive, hrModuleActive, proposalsModuleActive, mtdItModuleActive, bookkeepingActive, documentVaultActive,
  emailSenderName, emailSenderAddress,
}: Props) {
  const isAdmin = userRole === 'admin';
  // Timesheets settings show for admins when the module is active (Practice Suite).
  const timesheetsAccess = activeModules.includes('timesheets');
  const searchParams = useSearchParams();

  // Allow deep-linking to a specific tab via ?tab=modules (map legacy 'appearance' → 'preferences')
  const rawTab = searchParams.get('tab');
  const resolvedTab = (rawTab === 'appearance' ? 'preferences' : rawTab) as Tab | null;
  const initialTab: Tab = resolvedTab ?? 'preferences';
  const [activeTab, setActiveTab] = useState<Tab>(
    isAdmin ? initialTab : (initialTab === 'modules' || initialTab === 'tiers' || initialTab === 'billing' ? 'preferences' : initialTab)
  );

  const [displayName, setDisplayName] = useState(userName);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [currentAvatar, setCurrentAvatar] = useState(avatarUrl);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [currentLogo, setCurrentLogo] = useState(firmLogoUrl);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [editFirmName, setEditFirmName] = useState(firmName);
  const [savingFirmName, setSavingFirmName] = useState(false);
  const [firmNameSaved, setFirmNameSaved] = useState(false);
  const supabase = createClient();

  type TabGroup = 'general' | 'tools';
  const ALL_TABS = [
    { id: 'preferences' as Tab, label: 'Preferences', icon: SlidersHorizontal, adminOnly: false, hidden: false, group: 'general' as TabGroup },
    { id: 'dashboard' as Tab,   label: 'Dashboard',   icon: LayoutDashboard,   adminOnly: false, hidden: false, group: 'general' as TabGroup },
    { id: 'profile' as Tab,     label: 'Profile',     icon: User,              adminOnly: false, hidden: false, group: 'general' as TabGroup },
    { id: 'account' as Tab,     label: 'Account',     icon: Building2,         adminOnly: false, hidden: false, group: 'general' as TabGroup },
    { id: 'team' as Tab,        label: 'Team',        icon: UsersRound,        adminOnly: true,  hidden: false, group: 'general' as TabGroup },
    { id: 'api-key' as Tab,     label: 'AI & API Key',icon: Key,               adminOnly: true,  hidden: false, group: 'general' as TabGroup },
    { id: 'tiers' as Tab,       label: 'Plan & Tiers', icon: Layers,           adminOnly: true,  hidden: false, group: 'general' as TabGroup },
    // Tool Enabling is now dictated by the tier — hidden from the nav, kept as an
    // internal granular override reachable via ?tab=modules.
    { id: 'modules' as Tab,     label: 'Tool Enabling', icon: Puzzle,          adminOnly: true,  hidden: true,  group: 'general' as TabGroup },
    { id: 'billing' as Tab,     label: 'Billing',     icon: CreditCard,        adminOnly: true,  hidden: false, group: 'general' as TabGroup },
    { id: 'calendar' as Tab,    label: 'Calendar',    icon: CalendarDays,      adminOnly: false, hidden: !calendarModuleActive,    group: 'tools' as TabGroup },
    { id: 'staff-hire' as Tab,  label: 'Staff Hire',  icon: UserPlus,          adminOnly: true,  hidden: !staffHireModuleActive,   group: 'tools' as TabGroup },
    { id: 'tasks' as Tab,        label: 'Tasks',        icon: CheckSquare,    adminOnly: true,  hidden: !tasksModuleActive,        group: 'tools' as TabGroup },
    { id: 'timesheets' as Tab,   label: 'Timesheets',   icon: Clock,          adminOnly: true,  hidden: !timesheetsAccess,         group: 'tools' as TabGroup },
    { id: 'email-triage' as Tab, label: 'Email Triage', icon: Mail,           adminOnly: false, hidden: !emailTriageModuleActive,  group: 'tools' as TabGroup },
    { id: 'document-vault' as Tab, label: 'Document Vault', icon: FolderArchive, adminOnly: true, hidden: !documentVaultActive,    group: 'tools' as TabGroup },
    { id: 'hr' as Tab,           label: 'HR',           icon: HeartHandshake, adminOnly: true,  hidden: !hrModuleActive,           group: 'tools' as TabGroup },
    { id: 'proposals' as Tab,    label: 'Proposals',    icon: FileSignature,  adminOnly: true,  hidden: !proposalsModuleActive,    group: 'tools' as TabGroup },
    { id: 'mtd-it' as Tab,       label: 'MTD IT',       icon: CalendarCheck,  adminOnly: true,  hidden: !mtdItModuleActive,        group: 'tools' as TabGroup },
    { id: 'bookkeeping' as Tab,  label: 'Bookkeeping',  icon: BookCopy,       adminOnly: true,  hidden: !bookkeepingActive,        group: 'tools' as TabGroup },
    { id: 'agent-smith' as Tab,  label: 'Agent Smith',  icon: AgentHatIcon,   adminOnly: true,  hidden: false,                     group: 'tools' as TabGroup },
    // Community is cross-firm and always available — sits in General, not Tools.
    { id: 'community' as Tab,    label: 'Community',    icon: MessagesSquare, adminOnly: false, hidden: false,                     group: 'general' as TabGroup },
  ];

  // Non-admins see all tabs but account/modules/billing show a lock; hidden tabs are never shown
  const TABS = ALL_TABS.filter(t => !t.hidden && (!t.adminOnly || isAdmin));
  const generalTabs = TABS.filter(t => t.group === 'general');
  const toolsTabs   = TABS.filter(t => t.group === 'tools');

  // Tools group is collapsible — persist state in localStorage, but auto-expand
  // when the user is currently on a tool tab so it doesn't appear empty.
  const TOOLS_OPEN_KEY = 'smith_settings_tools_open';
  const activeTabIsTool = toolsTabs.some(t => t.id === activeTab);
  const [toolsOpen, setToolsOpen] = useState<boolean>(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOOLS_OPEN_KEY);
      const stored = raw === null ? true : JSON.parse(raw) === true;
      setToolsOpen(stored || activeTabIsTool);
    } catch {
      setToolsOpen(true);
    }
    // intentionally only on mount — toggling later is handled by the user
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // If the user navigates to a tool tab via deep link or menu, force-expand.
  useEffect(() => {
    if (activeTabIsTool) setToolsOpen(true);
  }, [activeTabIsTool]);
  function toggleTools() {
    setToolsOpen(v => {
      const next = !v;
      try { localStorage.setItem(TOOLS_OPEN_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

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

  async function handleChangePassword() {
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error ?? 'Failed to update password.');
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordChanged(true);
      setTimeout(() => setPasswordChanged(false), 2500);
    } catch {
      setPasswordError('Something went wrong. Please try again.');
    } finally {
      setChangingPassword(false);
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
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">Settings</h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Manage your firm, tools, profile, and preferences.</p>
      </div>

      {/* Two-column layout: vertical tabs on the left, content on the right */}
      <div className="flex gap-6 items-start">
        {/* Tab rail */}
        <nav className="w-56 shrink-0 sticky top-6">
          <ul className="space-y-1 max-h-[calc(100vh-8rem)] overflow-y-auto pr-1 scrollbar-thin">
            {generalTabs.map(tab => {
              const Icon = tab.icon;
              const isLocked = tab.id === 'account' && !isAdmin;
              return (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
                      ${activeTab === tab.id
                        ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
                      }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className="flex-1 truncate">{tab.label}</span>
                    {isLocked && <Lock size={11} className="opacity-40 shrink-0" />}
                  </button>
                </li>
              );
            })}

            {/* Tool Settings — collapsible group of per-tool settings tabs */}
            {toolsTabs.length > 0 && (
              <li className="pt-2">
                <button
                  onClick={toggleTools}
                  aria-expanded={toolsOpen}
                  className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] transition-colors"
                >
                  <Wrench size={12} className="shrink-0" />
                  <span className="flex-1 text-left">Tool Settings</span>
                  <span className="opacity-60 normal-case tracking-normal text-[10px] font-medium">
                    {toolsTabs.length}
                  </span>
                  <ChevronDown
                    size={13}
                    className={`shrink-0 transition-transform ${toolsOpen ? '' : '-rotate-90'}`}
                  />
                </button>
                {toolsOpen && (
                  <ul className="mt-1 space-y-1">
                    {toolsTabs.map(tab => {
                      const Icon = tab.icon;
                      return (
                        <li key={tab.id}>
                          <button
                            onClick={() => setActiveTab(tab.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left
                              ${activeTab === tab.id
                                ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'
                              }`}
                          >
                            <Icon size={15} className="shrink-0" />
                            <span className="flex-1 truncate">{tab.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            )}
          </ul>
        </nav>

        {/* Content column */}
        <div className="flex-1 min-w-0 space-y-6">

      {/* Preferences tab */}
      {activeTab === 'preferences' && <PreferencesTab />}

      {/* Dashboard tab */}
      {activeTab === 'dashboard' && <DashboardSettingsTab />}

      {/* Profile tab */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
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

          <div className="glass-solid rounded-xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Change Password</h3>
              <p className="text-xs text-[var(--text-muted)] mt-1">Enter your current password, then choose a new one.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Current Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={e => { setCurrentPassword(e.target.value); setPasswordError(null); }}
                  placeholder="••••••••"
                  className="input-base mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => { setNewPassword(e.target.value); setPasswordError(null); }}
                  placeholder="At least 8 characters"
                  className="input-base mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Confirm New Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                  placeholder="Re-enter new password"
                  className="input-base mt-1"
                />
              </div>
            </div>
            {passwordError && <p className="text-xs text-red-500 font-medium">{passwordError}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={handleChangePassword}
                disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
                className="btn-primary disabled:opacity-50"
              >
                {changingPassword ? 'Updating…' : 'Update Password'}
              </button>
              {passwordChanged && <span className="text-xs text-green-500 font-medium">Password updated!</span>}
            </div>
          </div>
        </div>

          {/* Personal account deletion — this individual user only, not the firm. */}
          <DeleteAccountSection />
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

            </div>
          </div>

          {/* Whole-firm deletion — admin only, sits outside the opacity overlay. */}
          {isAdmin && (
            <div className="mt-6">
              <DeleteFirmSection firmName={firmName} />
            </div>
          )}
        </div>
      )}

      {/* Document Vault tab — admin only; Google Drive connection + sync folder */}
      {activeTab === 'document-vault' && documentVaultActive && (
        <GoogleDriveSettings />
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

      {/* Plan & Tiers — admin only */}
      {activeTab === 'tiers' && isAdmin && (
        <TiersTab subscriptionTier={subscriptionTier} initialActiveModules={activeModules} initialSeatCount={seatCount} />
      )}

      {/* Tool Enabling — hidden from nav; internal granular override (URL only) */}
      {activeTab === 'modules' && isAdmin && (
        <ModulesTab initialActiveModules={activeModules} subscriptionTier={subscriptionTier} />
      )}

      {/* Billing tab — admin only */}
      {activeTab === 'billing' && isAdmin && (
        <BillingTab initialActiveModules={activeModules} initialSeatCount={seatCount} subscriptionTier={subscriptionTier} />
      )}

      {/* Calendar tab — available to all users when module is active */}
      {activeTab === 'calendar' && calendarModuleActive && (
        <CalendarSettingsTab isAdmin={isAdmin} currentUserId={userId} />
      )}

      {/* Staff Hire tab — admin only, shown when module is active */}
      {activeTab === 'staff-hire' && isAdmin && staffHireModuleActive && (
        <StaffHireSettingsTab />
      )}

      {/* Tasks tab — admin only, shown when tasks module is active */}
      {activeTab === 'tasks' && isAdmin && tasksModuleActive && firmId && (
        <TasksSettingsTab
          firmId={firmId}
          isAdmin={isAdmin}
          initialEmailFromName={emailSenderName ?? null}
          initialEmailFromAddress={emailSenderAddress ?? null}
        />
      )}

      {/* Timesheets tab — admin only, preview allowlist */}
      {activeTab === 'timesheets' && timesheetsAccess && (
        <TimesheetsSettingsTab isAdmin={isAdmin} />
      )}

      {/* Email Triage tab — all users, shown when module is active */}
      {activeTab === 'email-triage' && emailTriageModuleActive && (
        <EmailTriageTab />
      )}

      {/* HR tab — admin only, shown when HR module is active */}
      {activeTab === 'hr' && hrModuleActive && (
        <HrSettingsTab isAdmin={isAdmin} />
      )}

      {/* Proposals tab — admin only, shown when Proposals module is active */}
      {activeTab === 'proposals' && proposalsModuleActive && (
        <ProposalsSettingsTab isAdmin={isAdmin} tasksModuleActive={!!tasksModuleActive} />
      )}

      {/* MTD IT tab — admin only, shown when MTD IT module is active */}
      {activeTab === 'mtd-it' && isAdmin && mtdItModuleActive && (
        <MtdItSettingsTab />
      )}

      {/* Bookkeeping tab — gated by canAccessBookkeeping (server-side) */}
      {activeTab === 'bookkeeping' && bookkeepingActive && (
        <BookkeepingSettingsTab />
      )}

      {/* Agent Smith tab — admin only */}
      {activeTab === 'agent-smith' && isAdmin && (
        <AgentSmithSettingsTab />
      )}

      {/* Community tab — all users */}
      {activeTab === 'community' && (
        <CommunityTab />
      )}

        </div>
      </div>
    </div>
  );
}
