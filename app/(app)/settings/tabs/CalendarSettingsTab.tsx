'use client';

import { useState, useEffect } from 'react';
import {
  CalendarDays, Wifi, WifiOff, Eye, EyeOff, Pencil, Loader2,
  Check, AlertTriangle, ExternalLink, Lock, Bell, BellOff,
} from 'lucide-react';
import {
  REMINDER_PREF_KEY,
  REMINDER_UPDATE_EVENT,
} from '@/components/ui/CalendarReminderBanner';

interface MemberSetting {
  userId: string;
  name: string;
  email: string;
  role: string;
  connected: boolean;
  googleEmail: string | null;
  visibleToTeam: boolean;
  editableByTeam: boolean;
  locked: boolean; // true for staff — settings cannot be changed
}

interface Props {
  isAdmin: boolean;
  currentUserId: string;
}

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Off',          value: null },
  { label: '5 minutes',    value: 5    },
  { label: '15 minutes',   value: 15   },
  { label: '30 minutes',   value: 30   },
  { label: '1 hour',       value: 60   },
];

interface UpcomingEvent { id: string; title: string; start: string }

export default function CalendarSettingsTab({ isAdmin, currentUserId }: Props) {
  const [members, setMembers] = useState<MemberSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [ownStatus, setOwnStatus] = useState<{ connected: boolean; googleEmail: string | null } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  const [reminderSaved, setReminderSaved] = useState(false);
  // Upcoming events preview — fetched when reminders section is shown
  const [upcomingEvents,     setUpcomingEvents]     = useState<UpcomingEvent[]>([]);
  const [upcomingLoading,    setUpcomingLoading]    = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/calendar/status'),
        fetch('/api/calendar/settings'),
      ]);
      const status = await statusRes.json();
      const settings = await settingsRes.json();
      setOwnStatus({ connected: status.connected, googleEmail: status.googleEmail });
      setMembers(settings.members ?? []);
    } finally {
      setLoading(false);
    }
  }

  // Read reminder pref from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(REMINDER_PREF_KEY);
      if (raw !== null) setReminderMinutes(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadData(); }, []);

  // Fetch upcoming events for the reminder preview
  useEffect(() => {
    setUpcomingLoading(true);
    fetch('/api/calendar/reminders')
      .then(r => r.ok ? r.json() : { events: [] })
      .then(d => setUpcomingEvents((d.events ?? []).slice(0, 5)))
      .catch(() => {})
      .finally(() => setUpcomingLoading(false));
  }, []);

  async function handleToggle(userId: string, field: 'visibleToTeam' | 'editableByTeam', value: boolean) {
    const member = members.find(m => m.userId === userId);
    if (!member) return;

    const next: MemberSetting = { ...member, [field]: value };
    setMembers(prev => prev.map(m => m.userId === userId ? next : m));
    setSavingId(userId);

    try {
      const res = await fetch('/api/calendar/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          visibleToTeam: next.visibleToTeam,
          editableByTeam: next.editableByTeam,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSavedId(userId);
      setTimeout(() => setSavedId(null), 2000);
    } catch {
      // Revert on error
      setMembers(prev => prev.map(m => m.userId === userId ? member : m));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect your Google Calendar? Your events will no longer sync.')) return;
    setDisconnecting(true);
    try {
      await fetch('/api/calendar/auth/disconnect', { method: 'DELETE' });
      setOwnStatus(prev => prev ? { ...prev, connected: false, googleEmail: null } : null);
      setMembers(prev => prev.map(m => m.userId === currentUserId ? { ...m, connected: false, googleEmail: null } : m));
    } finally {
      setDisconnecting(false);
    }
  }

  function handleReminderChange(minutes: number | null) {
    setReminderMinutes(minutes);
    // Persist to localStorage
    try {
      if (minutes === null) {
        localStorage.removeItem(REMINDER_PREF_KEY);
      } else {
        localStorage.setItem(REMINDER_PREF_KEY, JSON.stringify(minutes));
      }
    } catch { /* ignore */ }
    // Notify the CalendarReminderBanner in the same tab immediately
    window.dispatchEvent(
      new CustomEvent(REMINDER_UPDATE_EVENT, { detail: { minutes } })
    );
    setReminderSaved(true);
    setTimeout(() => setReminderSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <CalendarDays size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Google Calendar</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Each team member connects their own Google Calendar. Admins control which calendars are
              visible to the rest of the team.
            </p>
          </div>
        </div>
      </div>

      {/* My Calendar — connect/disconnect */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">My Calendar</h3>

        {ownStatus?.connected ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Wifi size={14} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Connected</p>
                {ownStatus.googleEmail && (
                  <p className="text-xs text-[var(--text-muted)]">{ownStatus.googleEmail}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="btn-secondary text-sm text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-nav-hover)] flex items-center justify-center">
                <WifiOff size={14} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Not connected</p>
                <p className="text-xs text-[var(--text-muted)]">Connect to sync your Google Calendar</p>
              </div>
            </div>
            <a
              href="/api/calendar/auth/connect"
              className="btn-primary text-sm flex items-center gap-1.5 shrink-0"
            >
              <CalendarDays size={13} /> Connect Calendar
            </a>
          </div>
        )}

        <div className="p-3 rounded-xl bg-[var(--bg-nav-hover)] text-xs text-[var(--text-muted)] space-y-1">
          <p className="font-medium text-[var(--text-secondary)]">Setup required</p>
          <p>
            Add <code className="bg-[var(--border)] px-1 rounded text-[var(--text-primary)]">
              {typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'}/auth/calendar/callback
            </code> as an authorised redirect URI in your Google Cloud Console OAuth app.
          </p>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
          >
            Open Google Cloud Console <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Meeting Reminders */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
            {reminderMinutes
              ? <Bell size={16} className="text-amber-600 dark:text-amber-400" />
              : <BellOff size={16} className="text-[var(--text-muted)]" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Meeting Reminders</h3>
              {reminderSaved && (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <Check size={11} /> Saved
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              A banner appears at the top of the app before your upcoming meetings.
              Banners are per-session — they reappear after a page refresh.
            </p>
          </div>
        </div>

        {/* Interval picker */}
        <div className="flex flex-wrap gap-2">
          {REMINDER_OPTIONS.map(opt => {
            const active = reminderMinutes === opt.value;
            return (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => handleReminderChange(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all
                  ${active
                    ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                    : 'border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-content)] hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400'
                  }`}
              >
                {opt.value !== null && <Bell size={10} className="inline mr-1 mb-0.5" />}
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Upcoming events preview — lets you verify reminders will fire */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
            Your next 24 hours
          </p>
          {upcomingLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <Loader2 size={11} className="animate-spin" /> Checking your calendar…
            </div>
          ) : upcomingEvents.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">
              No timed events found in the next 24 hours.
              {!ownStatus?.connected && (
                <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                  Connect your calendar above to enable reminders.
                </span>
              )}
            </p>
          ) : (
            <div className="space-y-1">
              {upcomingEvents.map(e => {
                const startMs   = new Date(e.start).getTime();
                const nowMs     = Date.now();
                const diffMins  = Math.round((startMs - nowMs) / 60_000);
                const willFire  = reminderMinutes !== null && diffMins > 0 && diffMins <= reminderMinutes;
                const startTime = new Date(e.start).toLocaleTimeString('en-GB', {
                  hour: '2-digit', minute: '2-digit', hour12: false,
                });
                const startDate = new Date(e.start).toLocaleDateString('en-GB', {
                  weekday: 'short', day: 'numeric', month: 'short',
                });
                return (
                  <div
                    key={e.id}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors
                      ${willFire
                        ? 'border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700/50'
                        : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'
                      }`}
                  >
                    {willFire
                      ? <Bell size={11} className="text-amber-500 shrink-0" />
                      : <CalendarDays size={11} className="text-[var(--text-muted)] shrink-0" />
                    }
                    <span className={`flex-1 min-w-0 truncate font-medium ${willFire ? 'text-amber-800 dark:text-amber-200' : 'text-[var(--text-secondary)]'}`}>
                      {e.title}
                    </span>
                    <span className={`shrink-0 text-[11px] ${willFire ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-muted)]'}`}>
                      {startDate} {startTime}
                      {willFire && (
                        <span className="ml-1 font-semibold">· reminder active</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Team visibility — admin only */}
      {isAdmin && (
        <div className="glass-solid rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Team Calendar Permissions</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Staff calendars are always visible and editable by the team.
              Admin calendars are visible and editable by default — you can restrict individual admins below.
            </p>
          </div>

          <div className="space-y-2">
            {members.map(m => (
              <div
                key={m.userId}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-colors
                  ${m.userId === currentUserId ? 'border-[var(--accent)] bg-[var(--accent-light)]/40' : 'border-[var(--border)]'}
                  ${m.locked ? 'bg-[var(--bg-nav-hover)]/50' : ''}`}
              >
                {/* Member info */}
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold
                    ${m.connected ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'}`}>
                    {(m.name?.[0] ?? '?').toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                      {m.name}
                      {m.userId === currentUserId && <span className="ml-1 text-[var(--text-muted)] font-normal">(you)</span>}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {m.connected ? (m.googleEmail ?? 'Connected') : 'Not connected'}
                      {' · '}
                      <span className="capitalize">{m.role}</span>
                    </p>
                  </div>
                </div>

                {/* Staff: locked badge */}
                {m.locked ? (
                  <div className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                    <Lock size={11} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">Always visible &amp; editable</span>
                  </div>
                ) : (
                  /* Admin: toggleable settings */
                  <div className="flex items-center gap-3 shrink-0">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      {m.visibleToTeam
                        ? <Eye size={13} className="text-[var(--accent)]" />
                        : <EyeOff size={13} className="text-[var(--text-muted)]" />
                      }
                      <span className="text-[11px] text-[var(--text-secondary)] w-14">
                        {m.visibleToTeam ? 'Visible' : 'Hidden'}
                      </span>
                      <button
                        onClick={() => handleToggle(m.userId, 'visibleToTeam', !m.visibleToTeam)}
                        disabled={savingId === m.userId}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50
                          ${m.visibleToTeam ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
                        aria-label={m.visibleToTeam ? 'Hide from team' : 'Show to team'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                          ${m.visibleToTeam ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </label>

                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <Pencil size={12} className={m.editableByTeam ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                      <span className="text-[11px] text-[var(--text-secondary)] w-20">
                        {m.editableByTeam ? 'Team can add' : 'Read only'}
                      </span>
                      <button
                        onClick={() => handleToggle(m.userId, 'editableByTeam', !m.editableByTeam)}
                        disabled={savingId === m.userId}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50
                          ${m.editableByTeam ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
                        aria-label={m.editableByTeam ? 'Make read only' : 'Allow team to add events'}
                      >
                        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                          ${m.editableByTeam ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </label>

                    {/* Save indicator */}
                    <div className="w-5 flex items-center justify-center">
                      {savingId === m.userId && <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />}
                      {savedId === m.userId && <Check size={12} className="text-emerald-500" />}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {members.some(m => !m.connected) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--bg-nav-hover)] text-xs text-[var(--text-muted)]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-500" />
              Some team members haven't connected their Google Calendar yet. Permissions apply once they connect.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
