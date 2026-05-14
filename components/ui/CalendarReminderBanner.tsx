'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, CalendarDays, Clock, Bell } from 'lucide-react';

interface UpcomingEvent {
  id: string;
  title: string;
  start: string;
  htmlLink?: string;
  meetLink?: string;
}

interface PersonalReminderLite {
  id: string;
  title: string;
  remindAt: string;
  leadMinutes: number | null;
  isAllDay: boolean;
  notes: string | null;
}

interface Props {
  userId: string;
}

export const REMINDER_PREF_KEY            = 'smith_cal_reminder_minutes';
export const REMINDER_UPDATE_EVENT        = 'smith:reminder-update';
// Separate default lead time for user-created personal reminders (timed)
export const PERSONAL_REMINDER_PREF_KEY   = 'smith_cal_personal_reminder_minutes';
export const PERSONAL_REMINDER_UPDATE_EVENT = 'smith:personal-reminder-update';
// Separate default lead time for all-day personal reminders (in minutes;
// values are multiples of 1440, fired at 09:00 local on the offset day)
export const PERSONAL_ALLDAY_REMINDER_PREF_KEY    = 'smith_cal_personal_allday_reminder_minutes';
export const PERSONAL_ALLDAY_REMINDER_UPDATE_EVENT = 'smith:personal-allday-reminder-update';

const REFETCH_MS = 15 * 60 * 1000; // re-fetch events every 15 min
const CHECK_MS   = 30 * 1000;      // re-evaluate windows every 30 s

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPref(): number | null {
  try {
    const raw = localStorage.getItem(REMINDER_PREF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return typeof v === 'number' ? v : null;
  } catch { return null; }
}

function readPersonalPref(): number {
  // Default to 5 mins for timed personal reminders if the user hasn't picked one.
  try {
    const raw = localStorage.getItem(PERSONAL_REMINDER_PREF_KEY);
    if (!raw) return 5;
    const v = JSON.parse(raw);
    return typeof v === 'number' ? v : 5;
  } catch { return 5; }
}

function readPersonalAllDayPref(): number {
  // Default to "on the day" for all-day personal reminders.
  try {
    const raw = localStorage.getItem(PERSONAL_ALLDAY_REMINDER_PREF_KEY);
    if (!raw) return 0;
    const v = JSON.parse(raw);
    return typeof v === 'number' ? v : 0;
  } catch { return 0; }
}

function formatTimeUntil(diffMs: number): string {
  if (diffMs <= 0) return 'starting now';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `in ${mins} min${mins !== 1 ? 's' : ''}`;
  const hrs = Math.round(mins / 60);
  return `in ${hrs} hour${hrs !== 1 ? 's' : ''}`;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

// ── Personal-reminder display row ─────────────────────────────────────────────
// Defined here (not as a separate file) to keep the banner self-contained.
function PersonalReminderRow({
  reminder, now, onDismiss,
}: {
  reminder: PersonalReminderLite;
  now: number;
  onDismiss: () => void;
}) {
  const diffMs    = new Date(reminder.remindAt).getTime() - now;
  const timeUntil = formatTimeUntil(diffMs);
  const clockStr  = formatClock(reminder.remindAt);
  return (
    <div className="flex items-center gap-2.5 px-4 py-2
                    bg-amber-50 dark:bg-amber-900/25
                    border-b border-amber-200 dark:border-amber-700/60">
      <div className="w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-700/50
                      flex items-center justify-center shrink-0">
        <Bell size={11} className="text-amber-700 dark:text-amber-300" />
      </div>
      <p className="text-xs flex-1 min-w-0 truncate text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Reminder · </span>
        <span className="font-medium">{reminder.title}</span>
        <span className="opacity-70 ml-1">at {clockStr} · {timeUntil}</span>
      </p>
      <button
        onClick={onDismiss}
        aria-label={`Dismiss reminder ${reminder.title}`}
        className="ml-0.5 p-1 rounded-md text-amber-600 dark:text-amber-400
                   hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
      >
        <X size={13} />
      </button>
    </div>
  );
}

export default function CalendarReminderBanner({ userId }: Props) {
  const [reminderMinutes, setReminderMinutes] = useState<number | null>(null);
  const [personalDefaultMinutes, setPersonalDefaultMinutes] = useState<number>(5);
  const [personalAllDayDefaultMinutes, setPersonalAllDayDefaultMinutes] = useState<number>(0);
  const [allEvents,       setAllEvents]       = useState<UpcomingEvent[]>([]);
  const [allPersonal,     setAllPersonal]     = useState<PersonalReminderLite[]>([]);
  const [dismissed,       setDismissed]       = useState<Set<string>>(new Set());
  const [dismissedPersonal, setDismissedPersonal] = useState<Set<string>>(new Set());
  const [dueReminders,    setDueReminders]    = useState<UpcomingEvent[]>([]);
  const [duePersonal,     setDuePersonal]     = useState<PersonalReminderLite[]>([]);
  // Ticks every 30 s to keep "in X mins" labels live — NOT used as a React key
  const [now, setNow] = useState(() => Date.now());

  // ── Read preference on mount ───────────────────────────────────────────────
  useEffect(() => {
    setReminderMinutes(readPref());
    setPersonalDefaultMinutes(readPersonalPref());
    setPersonalAllDayDefaultMinutes(readPersonalAllDayPref());
  }, []);

  // ── Listen for same-tab preference changes from CalendarSettingsTab ────────
  useEffect(() => {
    function onUpdate(e: Event) {
      const mins = (e as CustomEvent<{ minutes: number | null }>).detail.minutes;
      setReminderMinutes(mins);
    }
    function onPersonalUpdate(e: Event) {
      const mins = (e as CustomEvent<{ minutes: number }>).detail.minutes;
      setPersonalDefaultMinutes(mins);
    }
    function onPersonalAllDayUpdate(e: Event) {
      const mins = (e as CustomEvent<{ minutes: number }>).detail.minutes;
      setPersonalAllDayDefaultMinutes(mins);
    }
    window.addEventListener(REMINDER_UPDATE_EVENT, onUpdate);
    window.addEventListener(PERSONAL_REMINDER_UPDATE_EVENT, onPersonalUpdate);
    window.addEventListener(PERSONAL_ALLDAY_REMINDER_UPDATE_EVENT, onPersonalAllDayUpdate);
    return () => {
      window.removeEventListener(REMINDER_UPDATE_EVENT, onUpdate);
      window.removeEventListener(PERSONAL_REMINDER_UPDATE_EVENT, onPersonalUpdate);
      window.removeEventListener(PERSONAL_ALLDAY_REMINDER_UPDATE_EVENT, onPersonalAllDayUpdate);
    };
  }, []);

  // ── Fetch the current user's own upcoming events ──────────────────────────
  // Uses /api/calendar/reminders (dedicated endpoint — no team filtering needed)
  const fetchEvents = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/calendar/reminders');
      if (!res.ok) return;
      const data = await res.json();
      setAllEvents(data.events ?? []);
    } catch { /* reminders are non-critical; fail silently */ }
  }, [userId]);

  // ── Fetch the user's personal reminders (next 24 h) ───────────────────────
  const fetchPersonal = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/calendar/personal-reminders?upcomingHours=24');
      if (!res.ok) return;
      const data = await res.json();
      setAllPersonal(data.reminders ?? []);
    } catch { /* non-critical */ }
  }, [userId]);

  useEffect(() => {
    if (!reminderMinutes || !userId) {
      setAllEvents([]);
      setDueReminders([]);
    } else {
      fetchEvents();
    }
    if (!userId) {
      setAllPersonal([]);
      setDuePersonal([]);
      return;
    }
    // Personal reminders always fetch (each one carries its own lead time)
    fetchPersonal();
    const id = setInterval(() => {
      if (reminderMinutes) fetchEvents();
      fetchPersonal();
    }, REFETCH_MS);
    return () => clearInterval(id);
  }, [fetchEvents, fetchPersonal, reminderMinutes, userId]);

  // ── 30-second clock tick — keeps time labels and window checks fresh ───────
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CHECK_MS);
    return () => clearInterval(id);
  }, []);

  // ── Evaluate which events are inside the reminder window ──────────────────
  // Re-runs whenever events, preferences, dismissed set, or the clock ticks
  useEffect(() => {
    if (!reminderMinutes) { setDueReminders([]); return; }
    const windowMs = reminderMinutes * 60_000;
    const due = allEvents.filter(e => {
      if (dismissed.has(e.id)) return false;
      const diff = new Date(e.start).getTime() - now;
      // Show from [reminderMinutes] before until 1 min after start
      return diff <= windowMs && diff > -60_000;
    });
    setDueReminders(due);
  }, [allEvents, reminderMinutes, dismissed, now]);

  // Personal reminders use each row's own lead_minutes (or the user's default —
  // a separate default applies to all-day vs timed reminders).
  useEffect(() => {
    const due = allPersonal.filter(r => {
      if (dismissedPersonal.has(r.id)) return false;
      const fallback = r.isAllDay ? personalAllDayDefaultMinutes : personalDefaultMinutes;
      const lead = r.leadMinutes ?? fallback;
      const windowMs = lead * 60_000;
      const diff = new Date(r.remindAt).getTime() - now;
      return diff <= windowMs && diff > -60_000;
    });
    setDuePersonal(due);
  }, [allPersonal, personalDefaultMinutes, personalAllDayDefaultMinutes, dismissedPersonal, now]);

  // ── Nothing to show ───────────────────────────────────────────────────────
  if (dueReminders.length === 0 && duePersonal.length === 0) return null;

  // ── Banner rows ───────────────────────────────────────────────────────────
  return (
    <div className="shrink-0" aria-live="polite" aria-label="Calendar reminders">
      {duePersonal.map(reminder => (
        <PersonalReminderRow
          key={`pr-${reminder.id}`}
          reminder={reminder}
          now={now}
          onDismiss={() => setDismissedPersonal(prev => new Set([...prev, reminder.id]))}
        />
      ))}
      {dueReminders.map(event => {
        const diffMs    = new Date(event.start).getTime() - now;
        const timeUntil = formatTimeUntil(diffMs);
        const clockStr  = formatClock(event.start);

        return (
          // Stable key — never remounts on tick changes
          <div
            key={event.id}
            className="flex items-center gap-2.5 px-4 py-2
                       bg-amber-50 dark:bg-amber-900/25
                       border-b border-amber-200 dark:border-amber-700/60"
          >
            {/* Bell icon */}
            <div className="w-5 h-5 rounded-full bg-amber-200 dark:bg-amber-700/50
                            flex items-center justify-center shrink-0">
              <Clock size={11} className="text-amber-700 dark:text-amber-300" />
            </div>

            {/* Message */}
            <p className="text-xs flex-1 min-w-0 truncate text-amber-900 dark:text-amber-200">
              <span className="font-semibold">Reminder · </span>
              <span className="font-medium">{event.title}</span>
              <span className="opacity-70 ml-1">at {clockStr} · {timeUntil}</span>
            </p>

            {/* Actions */}
            <div className="flex items-center gap-0.5 shrink-0">
              {event.meetLink && (
                <a
                  href={event.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]
                             font-medium text-amber-700 dark:text-amber-300
                             hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
                  </svg>
                  Join Meet
                </a>
              )}
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]
                             font-medium text-amber-700 dark:text-amber-300
                             hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
                >
                  <CalendarDays size={11} className="shrink-0" />
                  Open
                </a>
              )}
              <button
                onClick={() => setDismissed(prev => new Set([...prev, event.id]))}
                aria-label={`Dismiss reminder for ${event.title}`}
                className="ml-0.5 p-1 rounded-md text-amber-600 dark:text-amber-400
                           hover:bg-amber-100 dark:hover:bg-amber-800/40 transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
