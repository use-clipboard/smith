'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Calendar, RefreshCw,
  CalendarDays, List, WifiOff, Trash2, Loader2, Pencil, EyeOff, Eye, Lock, Check, Bell, ChevronDown,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useModules } from '@/components/ui/ModulesProvider';
import CreateEventModal from './CreateEventModal';
import EditEventModal from './EditEventModal';
import ReminderModal, { PersonalReminder } from './ReminderModal';
import { createClient } from '@/lib/supabase';
import { dispatchCalendarChanged } from '@/lib/calendarBus';

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  attendees?: { email: string; name?: string }[];
  htmlLink?: string;
  meetLink?: string;
  ownerUserId?: string;
  ownerName?: string;
  ownerColor?: string;
  /** Only present for the event owner. true = hidden from all other team members. */
  isHidden?: boolean;
}

interface MemberInfo {
  id: string;
  name: string;
  email: string;
  connected: boolean;
  color: string;
  department_id?: string | null;
}

interface Department { id: string; name: string }

type ViewMode = 'month' | 'week' | 'agenda';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatTime(iso: string): string {
  if (!iso.includes('T')) return 'All day';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/** Parse a Google Calendar date/datetime string into a local Date.
 *  Date-only strings like "2026-04-24" are parsed as local midnight
 *  (not UTC midnight) to avoid BST/timezone off-by-one day bugs. */
function parseEventDate(iso: string): Date {
  // date-only: "YYYY-MM-DD" — append T00:00 so JS treats it as local time
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return new Date(`${iso}T00:00:00`);
  }
  return new Date(iso);
}

function getRemindersForDay(reminders: PersonalReminder[], day: Date) {
  return reminders.filter(r => isSameDay(new Date(r.remindAt), day));
}

function getEventsForDay(events: CalendarEvent[], day: Date) {
  return events.filter(e => {
    const start = parseEventDate(e.start);
    // For multi-day all-day events the end date is exclusive (day after last day)
    const end = e.end ? parseEventDate(e.end) : start;
    const isAllDay = !e.start.includes('T');
    if (isAllDay) {
      // Event spans [start, end) — include if day falls within that range
      const dayMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
      const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
      return dayMs >= startMs && dayMs < endMs;
    }
    return isSameDay(start, day);
  });
}

export default function CalendarClient() {
  const [userId, setUserId] = useState<string>('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  // HR departments — used to group/bulk-select the team list when the firm has
  // the HR tool and has set departments up. Empty otherwise (flat list).
  const { isModuleActive } = useModules();
  const hrActive = isModuleActive('hr');
  const [departments, setDepartments] = useState<Department[]>([]);
  useEffect(() => {
    if (!hrActive) return;
    let cancelled = false;
    fetch('/api/hr/departments')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.departments) setDepartments((d.departments as Department[]).map(x => ({ id: x.id, name: x.name }))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [hrActive]);
  const [loading, setLoading] = useState(true);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  // Set of member IDs whose calendars are hidden (multi-toggle)
  const [hiddenMembers, setHiddenMembers] = useState<Set<string>>(new Set());
  const hiddenInitialized = useRef(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Guests to pre-add when opening the create modal (e.g. "schedule with X").
  const [prefillAttendees, setPrefillAttendees] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventPopover, setShowEventPopover] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  // Personal reminders
  const [reminders, setReminders] = useState<PersonalReminder[]>([]);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [editingReminder, setEditingReminder] = useState<PersonalReminder | null>(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [teamFilter, setTeamFilter] = useState('');
  const [teamExpanded, setTeamExpanded] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      // Compute range based on current view
      let start: Date, end: Date;
      if (viewMode === 'month') {
        start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        start.setDate(start.getDate() - 7); // pad a week before
        end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);
        end.setDate(end.getDate() + 7); // pad a week after
      } else if (viewMode === 'week') {
        start = new Date(currentDate);
        start.setDate(start.getDate() - start.getDay());
        end = new Date(start);
        end.setDate(end.getDate() + 7);
      } else {
        start = new Date(currentDate);
        end = new Date(currentDate);
        end.setDate(end.getDate() + 30);
      }

      const [eventsRes, remindersRes] = await Promise.all([
        fetch(`/api/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`),
        fetch(`/api/calendar/personal-reminders?start=${start.toISOString()}&end=${end.toISOString()}`),
      ]);

      if (eventsRes.ok) {
        const data = await eventsRes.json();
        setEvents(data.events ?? []);
        setMembers(data.members ?? []);
        // Surface any per-member fetch errors (e.g. invalid token, bad Google creds)
        if (data.errors?.length) {
          setFetchError(`Could not load some calendars — check server logs. (${data.errors[0].error})`);
        } else {
          setFetchError(null);
        }
      } else {
        setFetchError('Failed to load calendar events. Please try refreshing.');
      }

      if (remindersRes.ok) {
        const data = await remindersRes.json();
        setReminders(data.reminders ?? []);
      }
    } catch {
      // Network-level failure (e.g. offline, or the dev server mid-recompile) —
      // degrade gracefully instead of throwing an unhandled rejection.
      setFetchError('Failed to load calendar events. Please try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [currentDate, viewMode]);

  useEffect(() => {
    // Resolve current user ID client-side
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
      }
    });

    fetch('/api/calendar/status')
      .then(r => r.ok ? r.json() : { connected: false, isAdmin: false })
      .then(d => {
        setCalendarConnected(!!d.connected);
        setIsAdmin(!!d.isAdmin);
      })
      .catch(() => setCalendarConnected(false));
  }, []);

  // Default: hide all team members except self on first load
  useEffect(() => {
    if (hiddenInitialized.current) return;
    if (!userId || members.length === 0) return;
    hiddenInitialized.current = true;
    const others = new Set(members.map(m => m.id).filter(id => id !== userId));
    setHiddenMembers(others);
  }, [userId, members]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  function navigate(dir: 1 | -1) {
    const d = new Date(currentDate);
    if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
    else if (viewMode === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setDate(d.getDate() + 30 * dir);
    setCurrentDate(d);
  }

  function goToday() {
    setCurrentDate(new Date());
  }

  // Emails of the teammates currently SELECTED (visible) in the sidebar,
  // excluding yourself — these are pre-invited to any new event you create.
  function selectedTeamEmails(): string[] {
    return members
      .filter(m => m.id !== userId && !hiddenMembers.has(m.id) && !!m.email)
      .map(m => m.email);
  }

  // Open New Event, pre-filling the guest list from the selected teammates.
  function openCreate(date: Date) {
    setPrefillAttendees(selectedTeamEmails());
    setSelectedDate(date);
    setShowCreateModal(true);
  }

  function toggleMember(memberId: string) {
    setHiddenMembers(prev => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  // Select / deselect a whole department at once. If every member is already
  // visible we hide them all; otherwise we show them all.
  function toggleDept(deptMembers: MemberInfo[]) {
    const allVisible = deptMembers.length > 0 && deptMembers.every(m => !hiddenMembers.has(m.id));
    setHiddenMembers(prev => {
      const next = new Set(prev);
      if (allVisible) deptMembers.forEach(m => next.add(m.id));
      else deptMembers.forEach(m => next.delete(m.id));
      return next;
    });
  }

  // Show only visible members' events
  const visibleEvents = events.filter(e => !e.ownerUserId || !hiddenMembers.has(e.ownerUserId));
  // Personal reminders only belong to the current user — hide them whenever
  // "My Calendar" isn't in the visible set (e.g. when the user has filtered
  // down to a colleague's calendar, their own reminder shouldn't follow).
  const visibleReminders = userId && !hiddenMembers.has(userId) ? reminders : [];

  // Calendar label
  const visibleMembers = members.filter(m => !hiddenMembers.has(m.id));
  const calendarLabel = visibleMembers.length === 0
    ? 'No calendars selected'
    : visibleMembers.length === 1
      ? visibleMembers[0].id === userId
        ? 'My Calendar'
        : `${visibleMembers[0].name}'s Calendar`
      : 'Team Calendar';

  async function handleDeleteEvent(event: CalendarEvent) {
    if (!confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ id: event.id });
      const attendeeEmails = (event.attendees ?? []).map(a => a.email).filter(Boolean);
      if (attendeeEmails.length) params.set('notifyEmails', attendeeEmails.join(','));
      if (event.title) params.set('eventTitle', event.title);

      const res = await fetch(`/api/calendar/events?${params}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to delete');
      }
      setShowEventPopover(false);
      setSelectedEvent(null);
      dispatchCalendarChanged();
      fetchEvents();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete event.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleVisibility(event: CalendarEvent) {
    const newHidden = !event.isHidden;
    // Optimistic update — update both the events list and the open popover
    const patch = (e: CalendarEvent) => e.id === event.id ? { ...e, isHidden: newHidden } : e;
    setEvents(prev => prev.map(patch));
    setSelectedEvent(prev => prev ? patch(prev) : null);
    setTogglingVisibility(true);
    try {
      const res = await fetch('/api/calendar/events/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, hidden: newHidden }),
      });
      if (!res.ok) throw new Error('Failed to update visibility');
    } catch {
      // Revert optimistic update on failure
      const revert = (e: CalendarEvent) => e.id === event.id ? { ...e, isHidden: !newHidden } : e;
      setEvents(prev => prev.map(revert));
      setSelectedEvent(prev => prev ? revert(prev) : null);
    } finally {
      setTogglingVisibility(false);
    }
  }

  function handleDayClick(day: Date) {
    openCreate(day);
  }

  function handleEventClick(e: React.MouseEvent, event: CalendarEvent) {
    e.stopPropagation();
    setSelectedEvent(event);
    setShowEventPopover(true);
  }

  function handleEventCreated() {
    fetchEvents();
  }

  const titleLabel = viewMode === 'month'
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : viewMode === 'week'
    ? `Week of ${currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : `${currentDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} onwards`;

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4">
      {/* Header — full-height layout (replaces ToolLayout, whose auto-height
          wrapper let the page scroll and the team list stretch the month). */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[var(--accent-light)] border border-[var(--border)]">
          <CalendarDays size={20} className="text-[var(--accent)]" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">Calendar</h2>
      </div>

      <div className="flex flex-col flex-1 min-h-0 gap-4 overflow-hidden">

        {/* Fetch error banner */}
        {fetchError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
            <span className="shrink-0">⚠</span>
            <span>{fetchError}</span>
            <button onClick={() => setFetchError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          {/* Navigation */}
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="btn-icon text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]" aria-label="Previous">
              <ChevronLeft size={16} />
            </button>
            <button onClick={goToday} className="btn-secondary text-sm px-3 py-1.5">Today</button>
            <button onClick={() => navigate(1)} className="btn-icon text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]" aria-label="Next">
              <ChevronRight size={16} />
            </button>
          </div>

          <h2 className="text-sm font-bold text-[var(--text-primary)] flex-1 min-w-0 truncate">
            {titleLabel}
          </h2>

          {/* View switcher */}
          <div className="flex items-center rounded-lg border border-[var(--border)] overflow-hidden shrink-0 bg-white">
            {(['month', 'week', 'agenda'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors
                  ${viewMode === v
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                  }`}
              >
                {v === 'agenda' ? <List size={13} /> : v}
              </button>
            ))}
          </div>

          <button
            onClick={fetchEvents}
            disabled={loading}
            className="btn-icon text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)]"
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="relative">
            <div className="flex items-stretch rounded-lg overflow-hidden">
              <button
                onClick={() => { openCreate(new Date()); setShowCreateMenu(false); }}
                className="btn-primary flex items-center gap-1.5 text-sm rounded-r-none"
              >
                <Plus size={14} /> New Event
              </button>
              <button
                onClick={() => setShowCreateMenu(v => !v)}
                aria-label="More create options"
                className="btn-primary text-sm px-1.5 rounded-l-none border-l border-white/30"
              >
                <ChevronDown size={14} />
              </button>
            </div>
            {showCreateMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowCreateMenu(false)} />
                <div className="absolute right-0 mt-1 z-50 w-48 rounded-lg glass-solid border border-[var(--border)] shadow-xl overflow-hidden">
                  <button
                    onClick={() => { openCreate(new Date()); setShowCreateMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)]"
                  >
                    <Calendar size={13} className="text-[var(--accent)]" /> New event
                  </button>
                  <button
                    onClick={() => { setSelectedDate(new Date()); setEditingReminder(null); setShowReminderModal(true); setShowCreateMenu(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left hover:bg-[var(--bg-nav-hover)]"
                  >
                    <Bell size={13} className="text-amber-500" /> New reminder
                    <span className="ml-auto text-[10px] text-[var(--text-muted)]">Private</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex gap-4 flex-1 min-h-0 overflow-hidden">
          {/* Sidebar: My Calendar pinned + collapsible team section with search */}
          {members.length > 0 && (() => {
            const me = members.find(m => m.id === userId);
            const team = members.filter(m => m.id !== userId);
            const filterLower = teamFilter.trim().toLowerCase();
            const filteredTeam = filterLower
              ? team.filter(m => m.name.toLowerCase().includes(filterLower) || m.email.toLowerCase().includes(filterLower))
              : team;
            const totalVisible = members.length - hiddenMembers.size;

            // Renders the row that selects a single member.
            const memberRow = (m: MemberInfo, isMe: boolean) => {
              const isVisible = !hiddenMembers.has(m.id);
              const inner = (
                <div className="relative">
                  <button
                    onClick={() => toggleMember(m.id)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all text-left w-full hover:bg-[var(--bg-nav-hover)] ${isVisible ? '' : 'opacity-75'}`}
                  >
                    <span
                      className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all"
                      style={{
                        backgroundColor: isVisible ? m.color : 'transparent',
                        borderColor: m.color,
                      }}
                    >
                      {isVisible && <Check size={10} color="white" strokeWidth={3} />}
                    </span>
                    <span className={`truncate flex-1 transition-colors ${isVisible ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      {isMe ? 'My Calendar' : m.name}
                    </span>
                    {!m.connected && <WifiOff size={10} className="text-[var(--text-muted)] shrink-0" />}
                  </button>
                </div>
              );
              return !m.connected
                ? <Tooltip key={m.id} label={`${isMe ? 'Your' : `${m.name}'s`} calendar is not connected`}>{inner}</Tooltip>
                : <div key={m.id}>{inner}</div>;
            };

            // Group by department when the HR tool is set up; otherwise flat.
            const useGroups = hrActive && departments.length > 0;
            const renderTeamList = () => {
              if (!useGroups) return filteredTeam.map(m => memberRow(m, false));
              const byDept = new Map<string, MemberInfo[]>();
              for (const m of filteredTeam) {
                const key = m.department_id ?? '__none__';
                const arr = byDept.get(key);
                if (arr) arr.push(m); else byDept.set(key, [m]);
              }
              const groups: { key: string; name: string; members: MemberInfo[] }[] = [];
              for (const d of departments) {
                const list = byDept.get(d.id);
                if (list && list.length) groups.push({ key: d.id, name: d.name, members: list });
              }
              // "No department" also catches members whose department_id points
              // at a department that no longer exists (so nobody is dropped).
              const known = new Set(departments.map(d => d.id));
              const noneList: MemberInfo[] = [...(byDept.get('__none__') ?? [])];
              for (const [key, list] of byDept) {
                if (key !== '__none__' && !known.has(key)) noneList.push(...list);
              }
              if (noneList.length) groups.push({ key: '__none__', name: 'No department', members: noneList });

              return groups.map(g => {
                const allVisible = g.members.every(m => !hiddenMembers.has(m.id));
                const someVisible = g.members.some(m => !hiddenMembers.has(m.id));
                return (
                  <div key={g.key} className="mb-1.5">
                    <Tooltip label={allVisible ? `Deselect ${g.name}` : `Select all of ${g.name}`} side="right">
                      <button
                        type="button"
                        onClick={() => toggleDept(g.members)}
                        className="w-full flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors"
                      >
                        <span className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${allVisible ? 'bg-[var(--accent)] border-[var(--accent)]' : someVisible ? 'border-[var(--accent)]' : 'border-[var(--border-input)]'}`}>
                          {allVisible
                            ? <Check size={10} color="white" strokeWidth={3} />
                            : someVisible ? <span className="block w-2 h-[2px] bg-[var(--accent)] rounded" /> : null}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] truncate flex-1 text-left">{g.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">{g.members.length}</span>
                      </button>
                    </Tooltip>
                    <div className="pl-1">
                      {g.members.map(m => memberRow(m, false))}
                    </div>
                  </div>
                );
              });
            };

            return (
              <div className="w-56 shrink-0 flex flex-col min-h-0 glass rounded-xl p-2">
                {/* My Calendar — pinned mini-section */}
                {me && (
                  <div className="mb-2">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] px-2 mb-1">Mine</p>
                    {memberRow(me, true)}
                  </div>
                )}

                {/* Team — collapsible section with search */}
                {team.length > 0 && (
                  <div className="flex flex-col min-h-0 flex-1">
                    <div className="flex items-center gap-1 px-2 mb-1">
                      <button
                        onClick={() => setTeamExpanded(v => !v)}
                        className="flex items-center gap-1 group min-w-0"
                      >
                        <ChevronDown
                          size={11}
                          className={`text-[var(--text-muted)] transition-transform ${teamExpanded ? '' : '-rotate-90'}`}
                        />
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors">
                          Team <span className="opacity-70 normal-case font-normal">({team.length})</span>
                        </p>
                      </button>
                      <button
                        onClick={() => {
                          const everyTeamShown = team.every(t => !hiddenMembers.has(t.id));
                          setHiddenMembers(prev => {
                            const next = new Set(prev);
                            if (everyTeamShown) team.forEach(t => next.add(t.id));
                            else team.forEach(t => next.delete(t.id));
                            return next;
                          });
                        }}
                        className="ml-auto text-[10px] text-[var(--accent)] hover:underline"
                      >
                        {team.every(t => !hiddenMembers.has(t.id)) ? 'Hide all' : 'Show all'}
                      </button>
                    </div>

                    {teamExpanded && (
                      <>
                        <div className="px-2 mb-1.5">
                          <input
                            type="text"
                            value={teamFilter}
                            onChange={e => setTeamFilter(e.target.value)}
                            placeholder="Search team…"
                            className="w-full text-xs px-2 py-1.5 rounded-md border border-[var(--border)] bg-[var(--bg-content)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]"
                          />
                        </div>
                        <div className="flex flex-col gap-0.5 overflow-y-auto scrollbar-thin min-h-0 pr-0.5">
                          {filteredTeam.length === 0 ? (
                            <p className="px-2 py-2 text-[11px] text-[var(--text-muted)]">No matches</p>
                          ) : (
                            renderTeamList()
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Footer chip — selection summary + invite hint */}
                <div className="mt-2 pt-2 border-t border-[var(--border)] px-2 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                    <span>{totalVisible} of {members.length} selected</span>
                    {hiddenMembers.size > 0 && (
                      <button
                        onClick={() => setHiddenMembers(new Set())}
                        className="text-[var(--accent)] hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] leading-snug flex items-start gap-1">
                    <CalendarDays size={10} className="mt-0.5 shrink-0 opacity-70" />
                    Selected teammates are invited to events you create.
                  </p>
                </div>
              </div>
            );
          })()}

          {/* Calendar grid */}
          <div className="flex-1 min-w-0 overflow-auto flex flex-col gap-2">
            {/* Calendar label */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-sm font-bold text-[var(--text-primary)]">{calendarLabel}</span>
            </div>

            {viewMode === 'month' && (
              <MonthView
                currentDate={currentDate}
                events={visibleEvents}
                reminders={visibleReminders}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
                onReminderClick={(e, r) => { e.stopPropagation(); setEditingReminder(r); setShowReminderModal(true); }}
                currentUserId={userId}
              />
            )}
            {viewMode === 'week' && (
              <WeekView
                currentDate={currentDate}
                events={visibleEvents}
                reminders={visibleReminders}
                onDayClick={handleDayClick}
                onEventClick={handleEventClick}
                onReminderClick={(e, r) => { e.stopPropagation(); setEditingReminder(r); setShowReminderModal(true); }}
                currentUserId={userId}
              />
            )}
            {viewMode === 'agenda' && (
              <AgendaView
                currentDate={currentDate}
                events={visibleEvents}
                reminders={visibleReminders}
                onEventClick={handleEventClick}
                onReminderClick={(e, r) => { e.stopPropagation(); setEditingReminder(r); setShowReminderModal(true); }}
                currentUserId={userId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Not connected lightbox — only shown once status is confirmed false */}
      {calendarConnected === false && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl p-8 w-full max-w-sm mx-4 flex flex-col items-center text-center gap-5">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
              <CalendarDays size={26} className="text-[var(--accent)]" />
            </div>
            <div className="space-y-2">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Connect your Google Calendar</h2>
              <p className="text-sm text-[var(--text-muted)] leading-relaxed">
                To use the Calendar tool, connect your Google Calendar from Settings.
                Each team member connects their own account.
              </p>
            </div>
            <div className="flex flex-col items-center gap-2 w-full">
              <a href="/settings?tab=calendar" className="btn-primary w-full flex items-center justify-center gap-2">
                <CalendarDays size={14} /> Go to Calendar Settings
              </a>
              <p className="text-xs text-[var(--text-muted)]">Settings → Calendar → Connect</p>
            </div>
          </div>
        </div>
      )}

      {/* Create event modal */}
      {showCreateModal && (
        <CreateEventModal
          defaultDate={selectedDate ?? new Date()}
          onClose={() => { setShowCreateModal(false); setSelectedDate(null); setPrefillAttendees([]); }}
          onCreated={handleEventCreated}
          isAdmin={isAdmin}
          members={members}
          currentUserId={userId}
          defaultAttendeeEmails={prefillAttendees}
        />
      )}

      {/* Edit event modal */}
      {showEditModal && editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => { setShowEditModal(false); setEditingEvent(null); }}
          onSaved={fetchEvents}
          isAdmin={isAdmin}
          currentUserId={userId}
        />
      )}

      {/* Personal reminder modal — create or edit */}
      {showReminderModal && (
        <ReminderModal
          defaultDate={selectedDate ?? new Date()}
          existing={editingReminder ?? undefined}
          onClose={() => { setShowReminderModal(false); setEditingReminder(null); }}
          onSaved={fetchEvents}
        />
      )}

      {/* Event detail popover */}
      {showEventPopover && selectedEvent && (() => {
        // Is this a masked busy block (hidden event seen by a non-owner)?
        const isMaskedBusy = !!selectedEvent.isHidden && selectedEvent.ownerUserId !== userId;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={() => { setShowEventPopover(false); setSelectedEvent(null); }}
          >
            <div
              className="glass-solid rounded-xl border border-[var(--border)] shadow-xl p-5 w-80 space-y-3"
              onClick={e => e.stopPropagation()}
            >
              {/* Close button */}
              <div className="flex items-start justify-between gap-2">
                {isMaskedBusy ? (
                  /* ── Masked busy header ── */
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-[var(--bg-nav-hover)] border border-[var(--border)] flex items-center justify-center shrink-0">
                      <Lock size={15} className="text-[var(--text-muted)]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--text-muted)]">Hidden / Busy</p>
                      {selectedEvent.ownerName && (
                        <p className="text-xs text-[var(--text-muted)] truncate">{selectedEvent.ownerName}</p>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Normal event header ── */
                  <div className="flex-1 min-w-0">
                    <div
                      className="w-3 h-3 rounded-full mb-2"
                      style={{ backgroundColor: selectedEvent.ownerColor ?? '#3b82f6' }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug">{selectedEvent.title}</h3>
                      {selectedEvent.isHidden && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[var(--bg-nav-hover)] text-[var(--text-muted)] border border-[var(--border)] shrink-0">
                          <Lock size={9} /> Hidden
                        </span>
                      )}
                    </div>
                    {selectedEvent.ownerName && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">{selectedEvent.ownerName}</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setShowEventPopover(false); setSelectedEvent(null); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                >
                  ✕
                </button>
              </div>

              {/* Time — always shown */}
              <div className="text-xs text-[var(--text-secondary)]">
                {selectedEvent.start.includes('T') ? (
                  /* Timed event */
                  <p>
                    <span className="font-medium">When: </span>
                    {new Date(selectedEvent.start).toLocaleString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    {selectedEvent.end && selectedEvent.end !== selectedEvent.start && (
                      <span> – {formatTime(selectedEvent.end)}</span>
                    )}
                  </p>
                ) : (
                  /* All-day event */
                  <p>
                    <span className="font-medium">When: </span>
                    {new Date(`${selectedEvent.start}T00:00:00`).toLocaleDateString('en-GB', {
                      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                    })}
                    <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--accent-light)] text-[var(--accent)] font-medium">All day</span>
                  </p>
                )}
              </div>

              {/* Full details — only shown to event owner */}
              {!isMaskedBusy && (
                <div className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {selectedEvent.location && (
                    <p><span className="font-medium">Where: </span>{selectedEvent.location}</p>
                  )}
                  {selectedEvent.description && (
                    <p className="whitespace-pre-wrap line-clamp-4 text-[var(--text-muted)]">{selectedEvent.description}</p>
                  )}
                  {(selectedEvent.attendees?.length ?? 0) > 0 && (
                    <p>
                      <span className="font-medium">Attendees: </span>
                      {selectedEvent.attendees!.map(a => a.name ?? a.email).join(', ')}
                    </p>
                  )}
                </div>
              )}

              {/* Visibility toggle — admin-only, own events only */}
              {!isMaskedBusy && selectedEvent.ownerUserId === userId && isAdmin && (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)]">
                  <div className="flex items-center gap-2">
                    {selectedEvent.isHidden
                      ? <EyeOff size={13} className="text-[var(--text-muted)]" />
                      : <Eye size={13} className="text-[var(--accent)]" />
                    }
                    <span className="text-xs text-[var(--text-secondary)]">
                      {selectedEvent.isHidden ? 'Hidden from team' : 'Visible to team'}
                    </span>
                  </div>
                  <Tooltip label={selectedEvent.isHidden ? 'Make visible to team' : 'Hide from team'}>
                  <button
                    onClick={() => handleToggleVisibility(selectedEvent)}
                    disabled={togglingVisibility}
                    aria-label={selectedEvent.isHidden ? 'Make visible to team' : 'Hide from team'}
                    className={`relative inline-flex h-5 w-9 rounded-full transition-colors disabled:opacity-50
                      ${!selectedEvent.isHidden ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
                  >
                    <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                      ${!selectedEvent.isHidden ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                  </button>
                  </Tooltip>
                </div>
              )}

              {/* Actions — only for own events */}
              {!isMaskedBusy && (
                <div className="flex items-center gap-2 pt-0.5 flex-wrap">
                  {selectedEvent.meetLink && (
                    <a
                      href={selectedEvent.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary text-xs inline-flex items-center gap-1.5 flex-1 justify-center"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                        <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
                      </svg>
                      Join Google Meet
                    </a>
                  )}
                  {selectedEvent.htmlLink && (
                    <a
                      href={selectedEvent.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-secondary text-xs inline-flex items-center gap-1 flex-1 justify-center"
                    >
                      <Calendar size={12} /> Open in Google
                    </a>
                  )}
                  {selectedEvent.ownerUserId === userId && (
                    <>
                      <button
                        onClick={() => {
                          setEditingEvent(selectedEvent);
                          setShowEditModal(true);
                          setShowEventPopover(false);
                        }}
                        className="btn-secondary text-xs inline-flex items-center gap-1 flex-1 justify-center"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => handleDeleteEvent(selectedEvent)}
                        disabled={deleting}
                        className="btn-secondary text-xs inline-flex items-center gap-1 flex-1 justify-center
                          text-red-600 dark:text-red-400 border-red-200 dark:border-red-800
                          hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                      >
                        {deleting
                          ? <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                          : <><Trash2 size={12} /> Delete</>
                        }
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Month View ────────────────────────────────────────────────────────────────

function MonthView({
  currentDate, events, reminders, onDayClick, onEventClick, onReminderClick, currentUserId,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  reminders: PersonalReminder[];
  onDayClick: (d: Date) => void;
  onEventClick: (e: React.MouseEvent, ev: CalendarEvent) => void;
  onReminderClick: (e: React.MouseEvent, r: PersonalReminder) => void;
  currentUserId: string;
}) {
  const today = new Date();
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  const cells: Array<{ date: Date; isCurrentMonth: boolean }> = [];

  // Leading days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), isCurrentMonth: false });
  }
  // Days of current month
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  // Trailing days to fill 6-week grid
  const trailing = 42 - cells.length;
  for (let d = 1; d <= trailing; d++) {
    cells.push({ date: new Date(year, month + 1, d), isCurrentMonth: false });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[11px] font-bold uppercase tracking-widest text-[var(--text-secondary)] py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 flex-1 border-t border-l border-[var(--border)] bg-[var(--border)] gap-px">
        {cells.map(({ date, isCurrentMonth }, i) => {
          const dayEvents = getEventsForDay(events, date);
          const dayReminders = getRemindersForDay(reminders, date);
          const isToday = isSameDay(date, today);
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const eventCap = Math.max(0, 3 - dayReminders.length);
          // Tiered backgrounds with light-violet hues so the grid reads as a
          // calendar rather than a spreadsheet: today wears a deeper accent
          // wash, weekday cells take a very faint violet tint, weekends pick
          // up a slightly cooler lavender, and out-of-month days drop to a
          // muted slate so the edges of the month still stand out.
          // Weekday in-month → white, weekend in-month → light purple,
          // out-of-month → a deeper purple so the month boundaries read at a
          // glance. Today wears a slightly stronger accent wash on top.
          const cellBg = !isCurrentMonth
            ? 'bg-violet-200/50 dark:bg-violet-900/40'
            : isToday
              ? 'bg-violet-100/70 dark:bg-violet-900/40'
              : isWeekend
                ? 'bg-violet-50/55 dark:bg-violet-950/30'
                : 'bg-white/55 dark:bg-slate-900/30';
          return (
            <div
              key={i}
              onClick={() => onDayClick(date)}
              className={`p-1 min-h-[90px] min-w-0 overflow-hidden cursor-pointer transition-colors ${cellBg} hover:bg-[var(--accent-light)]`}
            >
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-0.5
                ${isToday ? 'bg-[var(--accent)] text-white' : isCurrentMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
              >
                {date.getDate()}
              </div>
              <div className="space-y-0.5 min-w-0">
                {/* Personal reminders — bell icon, amber, owner-only */}
                {dayReminders.slice(0, 3).map(r => (
                  <Tooltip key={r.id} label={`Reminder · ${r.title}`} side="top">
                    <div
                      onClick={e => onReminderClick(e, r)}
                      className="text-[11px] leading-tight px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 flex items-center gap-0.5 overflow-hidden bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60"
                    >
                      <Bell size={9} className="shrink-0" />
                      <span className="opacity-70 shrink-0">
                        {r.isAllDay ? 'All day ' : `${formatTime(r.remindAt)} `}
                      </span>
                      <span className="truncate min-w-0 flex-1">{r.title}</span>
                    </div>
                  </Tooltip>
                ))}
                {dayEvents.slice(0, eventCap).map(ev => {
                  const isMasked = !!ev.isHidden && ev.ownerUserId !== currentUserId;
                  return isMasked ? (
                    <Tooltip key={ev.id} label={`${ev.ownerName ?? 'Team member'} is busy`} side="top">
                    <div
                      onClick={e => onEventClick(e, ev)}
                      className="text-[11px] leading-tight px-1.5 py-0.5 rounded cursor-pointer hover:opacity-70 flex items-center gap-0.5 opacity-40 overflow-hidden"
                      style={{ backgroundColor: '#9ca3af33', color: '#6b7280' }}
                    >
                      <Lock size={9} className="shrink-0" />
                      <span className="truncate italic min-w-0 flex-1">Hidden</span>
                    </div>
                    </Tooltip>
                  ) : (
                    <Tooltip key={ev.id} label={ev.isHidden ? `${ev.title} (hidden from team)` : ev.title} side="top">
                    <div
                      onClick={e => onEventClick(e, ev)}
                      className="text-[11px] leading-tight px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80 flex items-center gap-0.5 overflow-hidden"
                      style={{ backgroundColor: (ev.ownerColor ?? '#3b82f6') + '33', color: ev.ownerColor ?? '#3b82f6' }}
                    >
                      {ev.isHidden && <Lock size={9} className="shrink-0 opacity-70" />}
                      {ev.start.includes('T')
                        ? <span className="opacity-70 shrink-0">{formatTime(ev.start)} </span>
                        : <span className="opacity-60 shrink-0">All day </span>
                      }
                      <span className="truncate min-w-0 flex-1">{ev.title}</span>
                    </div>
                    </Tooltip>
                  );
                })}
                {(dayEvents.length + dayReminders.length) > 3 && (
                  <p className="text-[10px] text-[var(--text-muted)] px-1">
                    +{(dayEvents.length + dayReminders.length) - 3} more
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Week View ─────────────────────────────────────────────────────────────────

function WeekView({
  currentDate, events, reminders, onDayClick, onEventClick, onReminderClick, currentUserId,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  reminders: PersonalReminder[];
  onDayClick: (d: Date) => void;
  onEventClick: (e: React.MouseEvent, ev: CalendarEvent) => void;
  onReminderClick: (e: React.MouseEvent, r: PersonalReminder) => void;
  currentUserId: string;
}) {
  const today = new Date();
  const startOfWeek = new Date(currentDate);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="grid grid-cols-7 border-t border-l border-[var(--border)] bg-[var(--border)] gap-px">
      {days.map((day, i) => {
        const dayEvents = getEventsForDay(events, day);
        const dayReminders = getRemindersForDay(reminders, day);
        const isToday = isSameDay(day, today);
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
        // Match the month view: today wears a stronger violet, weekends pick
        // up a light lavender, weekdays stay white.
        const cellBg = isToday
          ? 'bg-violet-100/70 dark:bg-violet-900/40'
          : isWeekend
            ? 'bg-violet-50/55 dark:bg-violet-950/30'
            : 'bg-white/55 dark:bg-slate-900/30';
        return (
          <div
            key={i}
            className={`min-h-[200px] min-w-0 overflow-hidden cursor-pointer transition-colors ${cellBg} hover:bg-violet-100 dark:hover:bg-violet-900/40`}
            onClick={() => onDayClick(day)}
          >
            <div className={`text-center py-2 border-b border-[var(--border)] text-xs font-medium
              ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}
            >
              <div className="text-[11px] uppercase tracking-wide">{DAYS[day.getDay()]}</div>
              <div className={`text-lg font-bold leading-tight ${isToday ? 'text-[var(--accent)]' : ''}`}>
                {day.getDate()}
              </div>
            </div>
            <div className="p-1 space-y-0.5 min-w-0">
              {dayReminders.map(r => (
                <Tooltip key={r.id} label={`Reminder · ${r.title}`} side="top">
                  <div
                    onClick={e => onReminderClick(e, r)}
                    className="text-[11px] px-1.5 py-1 rounded cursor-pointer hover:opacity-80 overflow-hidden bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/60"
                  >
                    <span className="block text-[10px] opacity-70 truncate">
                      {r.isAllDay ? 'All day' : formatTime(r.remindAt)}
                    </span>
                    <span className="flex items-center gap-0.5 min-w-0">
                      <Bell size={9} className="shrink-0 opacity-80" />
                      <span className="truncate min-w-0 flex-1 font-medium">{r.title}</span>
                    </span>
                  </div>
                </Tooltip>
              ))}
              {dayEvents.map(ev => {
                const isMasked = !!ev.isHidden && ev.ownerUserId !== currentUserId;
                return isMasked ? (
                  <Tooltip key={ev.id} label={`${ev.ownerName ?? 'Team member'} is busy`} side="top">
                  <div
                    onClick={e => onEventClick(e, ev)}
                    className="text-[11px] px-1.5 py-1 rounded cursor-pointer hover:opacity-70 opacity-40 overflow-hidden"
                    style={{ backgroundColor: '#9ca3af33', color: '#6b7280' }}
                  >
                    {ev.start.includes('T') && <span className="block text-[10px]">{formatTime(ev.start)}</span>}
                    <span className="flex items-center gap-0.5 min-w-0">
                      <Lock size={9} className="shrink-0" />
                      <span className="truncate italic min-w-0 flex-1">Hidden</span>
                    </span>
                  </div>
                  </Tooltip>
                ) : (
                  <Tooltip key={ev.id} label={ev.isHidden ? `${ev.title} (hidden from team)` : ev.title} side="top">
                  <div
                    onClick={e => onEventClick(e, ev)}
                    className="text-[11px] px-1.5 py-1 rounded cursor-pointer hover:opacity-80 overflow-hidden"
                    style={{ backgroundColor: (ev.ownerColor ?? '#3b82f6') + '33', color: ev.ownerColor ?? '#3b82f6' }}
                  >
                    {ev.start.includes('T')
                      ? <span className="block text-[10px] opacity-70 truncate">{formatTime(ev.start)}</span>
                      : <span className="block text-[10px] opacity-60 truncate">All day</span>
                    }
                    <span className="flex items-center gap-0.5 min-w-0">
                      {ev.isHidden && <Lock size={9} className="shrink-0 opacity-70" />}
                      <span className="truncate min-w-0 flex-1">{ev.title}</span>
                    </span>
                  </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agenda View ───────────────────────────────────────────────────────────────

function AgendaView({
  currentDate, events, reminders, onEventClick, onReminderClick, currentUserId,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  reminders: PersonalReminder[];
  onEventClick: (e: React.MouseEvent, ev: CalendarEvent) => void;
  onReminderClick: (e: React.MouseEvent, r: PersonalReminder) => void;
  currentUserId: string;
}) {
  // Group events + reminders by date
  const groups: { label: string; date: Date; events: CalendarEvent[]; reminders: PersonalReminder[] }[] = [];
  const today = new Date();

  for (let i = 0; i < 30; i++) {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + i);
    const dayEvents = getEventsForDay(events, d);
    const dayReminders = getRemindersForDay(reminders, d);
    if (dayEvents.length > 0 || dayReminders.length > 0 || i === 0) {
      groups.push({
        label: isSameDay(d, today)
          ? 'Today'
          : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
        date: d,
        events: dayEvents,
        reminders: dayReminders,
      });
    }
  }

  if (groups.every(g => g.events.length === 0 && g.reminders.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-16">
        <Calendar size={32} className="text-[var(--text-muted)] mb-3" />
        <p className="text-sm text-[var(--text-muted)]">No events or reminders in the next 30 days</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 glass rounded-xl p-4">
      {groups.filter(g => g.events.length > 0 || g.reminders.length > 0).map((group, i) => {
        const isToday = isSameDay(group.date, today);
        const isWeekend = group.date.getDay() === 0 || group.date.getDay() === 6;
        // Same scheme as month/week: today highlighted in violet, weekends a
        // lighter lavender, weekdays neutral.
        const labelBg = isToday
          ? 'bg-violet-100/80 text-[var(--accent)] dark:bg-violet-900/40'
          : isWeekend
            ? 'bg-violet-50/70 text-[var(--text-secondary)] dark:bg-violet-950/30'
            : 'bg-white/70 text-[var(--text-muted)] dark:bg-slate-900/30';
        return (
        <div key={i}>
          <div className={`inline-flex text-xs font-semibold uppercase tracking-widest mb-2 px-2 py-1 rounded-md border border-[var(--border)] ${labelBg}`}>
            {group.label}
          </div>
          <div className="space-y-1.5">
            {group.reminders.map(r => (
              <div
                key={r.id}
                onClick={e => onReminderClick(e, r)}
                className="flex items-start gap-3 p-3 rounded-xl border border-amber-200/70 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 cursor-pointer hover:border-amber-400 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                  <Bell size={14} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-amber-800 dark:text-amber-200">{r.title}</p>
                  <p className="text-xs text-amber-700/70 dark:text-amber-300/70 mt-0.5">
                    Reminder · {r.isAllDay ? 'All day' : formatTime(r.remindAt)}
                    {r.notes && ` · ${r.notes.slice(0, 60)}${r.notes.length > 60 ? '…' : ''}`}
                  </p>
                </div>
              </div>
            ))}
            {group.events.map(ev => {
              const isMasked = !!ev.isHidden && ev.ownerUserId !== currentUserId;
              return (
                <div
                  key={ev.id}
                  onClick={e => onEventClick(e, ev)}
                  className={`flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] cursor-pointer transition-colors
                    ${isMasked
                      ? 'bg-[var(--bg-nav-hover)] opacity-50 hover:opacity-70'
                      : 'bg-white/70 hover:border-[var(--accent)]'
                    }`}
                >
                  <div
                    className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                    style={{ backgroundColor: isMasked ? '#9ca3af' : (ev.ownerColor ?? '#3b82f6') }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {(ev.isHidden) && <Lock size={11} className="shrink-0 text-[var(--text-muted)]" />}
                      <p className={`text-sm font-medium truncate ${isMasked ? 'text-[var(--text-muted)] italic' : 'text-[var(--text-primary)]'}`}>
                        {isMasked ? 'Hidden' : ev.title}
                      </p>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      {ev.start.includes('T')
                        ? `${formatTime(ev.start)}${ev.end && ev.end !== ev.start ? ` – ${formatTime(ev.end)}` : ''}`
                        : 'All day'
                      }
                      {!isMasked && ev.location && ` · ${ev.location}`}
                    </p>
                    {ev.ownerName && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{ev.ownerName}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
    </div>
  );
}
