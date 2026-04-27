'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  X, CalendarDays, Loader2, Check, ExternalLink, Mail,
  EyeOff, Eye, Copy, UserPlus,
} from 'lucide-react';
import { dispatchCalendarChanged } from '@/lib/calendarBus';

interface Props {
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  onClose: () => void;
}

// ── Shared time/date helpers (mirrors CreateEventModal) ───────────────────────

function roundUpTo15(d: Date): Date {
  const ms = 15 * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}
function toDateValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function toTimeValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateValue(d);
}

interface TimeSlot { value: string; label: string }
function buildTimeSlots(): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const period = h < 12 ? 'am' : 'pm';
      const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
      slots.push({ value, label: `${dh}:${String(m).padStart(2, '0')}${period}` });
    }
  }
  return slots;
}
const TIME_SLOTS = buildTimeSlots();

function durLabel(mins: number): string {
  if (mins <= 0 || mins > 12 * 60) return '';
  if (mins < 60) return ` (${mins} mins)`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m === 0 ? ` (${h} hr${h !== 1 ? 's' : ''})` : ` (${h} hr ${m} mins)`;
}

const TIMEZONES = [
  { value: 'Europe/London',        label: 'London (GMT/BST)' },
  { value: 'Europe/Dublin',        label: 'Dublin (GMT/IST)' },
  { value: 'Europe/Paris',         label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin',        label: 'Berlin (CET/CEST)' },
  { value: 'Europe/Rome',          label: 'Rome (CET/CEST)' },
  { value: 'Europe/Madrid',        label: 'Madrid (CET/CEST)' },
  { value: 'Europe/Amsterdam',     label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/Zurich',        label: 'Zurich (CET/CEST)' },
  { value: 'Europe/Stockholm',     label: 'Stockholm (CET/CEST)' },
  { value: 'America/New_York',     label: 'New York (ET)' },
  { value: 'America/Chicago',      label: 'Chicago (CT)' },
  { value: 'America/Denver',       label: 'Denver (MT)' },
  { value: 'America/Los_Angeles',  label: 'Los Angeles (PT)' },
  { value: 'America/Toronto',      label: 'Toronto (ET)' },
  { value: 'America/Vancouver',    label: 'Vancouver (PT)' },
  { value: 'America/Sao_Paulo',    label: 'São Paulo (BRT)' },
  { value: 'Asia/Dubai',           label: 'Dubai (GST)' },
  { value: 'Asia/Kolkata',         label: 'India (IST)' },
  { value: 'Asia/Singapore',       label: 'Singapore (SGT)' },
  { value: 'Asia/Tokyo',           label: 'Tokyo (JST)' },
  { value: 'Asia/Shanghai',        label: 'Shanghai (CST)' },
  { value: 'Asia/Hong_Kong',       label: 'Hong Kong (HKT)' },
  { value: 'Asia/Seoul',           label: 'Seoul (KST)' },
  { value: 'Australia/Sydney',     label: 'Sydney (AEST/AEDT)' },
  { value: 'Australia/Melbourne',  label: 'Melbourne (AEST/AEDT)' },
  { value: 'Pacific/Auckland',     label: 'Auckland (NZST/NZDT)' },
  { value: 'UTC',                  label: 'UTC' },
];

const REPEAT_OPTIONS = [
  { value: 'none',         label: 'Does not repeat' },
  { value: 'FREQ=DAILY',   label: 'Every day' },
  { value: 'FREQ=WEEKLY',  label: 'Every week' },
  { value: 'FREQ=MONTHLY', label: 'Every month' },
  { value: 'FREQ=YEARLY',  label: 'Every year' },
];

interface TeamMember { id: string; name: string; email: string; connected: boolean; color: string }

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScheduleMeetingModal({ clientId, clientName, clientEmail, onClose }: Props) {
  // Default: tomorrow at 10:00, snapped to 15-min
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const startDefault = roundUpTo15(tomorrow);
  const endDefault   = new Date(startDefault.getTime() + 60 * 60 * 1000);
  const browserTz    = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/London';
  const defaultTz    = TIMEZONES.find(tz => tz.value === browserTz)?.value ?? 'Europe/London';

  // Form state
  const [title,           setTitle]           = useState(`Meeting with ${clientName}`);
  const [isAllDay,        setIsAllDay]        = useState(false);
  const [startDate,       setStartDate]       = useState(toDateValue(startDefault));
  const [startTime,       setStartTime]       = useState(toTimeValue(startDefault));
  const [endDate,         setEndDate]         = useState(toDateValue(endDefault));
  const [endTime,         setEndTime]         = useState(toTimeValue(endDefault));
  const [timezone,        setTimezone]        = useState(defaultTz);
  const [repeat,          setRepeat]          = useState('none');
  const [location,        setLocation]        = useState('');
  const [description,     setDescription]     = useState('');
  const [addGoogleMeet,   setAddGoogleMeet]   = useState(false);
  const [sendClientInvite, setSendClientInvite] = useState(true);
  const [makeHidden,      setMakeHidden]      = useState(false);
  // Combined attendees list — free-form emails + quick-added team members
  const [attendees,       setAttendees]       = useState<string[]>([]);
  const [attendeeInput,   setAttendeeInput]   = useState('');

  // UI state
  const [saving,           setSaving]           = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);
  const [isAdmin,          setIsAdmin]          = useState(false);
  const [currentUserId,    setCurrentUserId]    = useState('');
  const [teamMembers,      setTeamMembers]      = useState<TeamMember[]>([]);
  const [result,           setResult]           = useState<{
    htmlLink: string; meetLink?: string; inviteSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/calendar/status')
      .then(r => r.json())
      .then(d => {
        setCalendarConnected(!!d.connected);
        setIsAdmin(!!d.isAdmin);
      });
    fetch('/api/calendar/events?start=' + new Date().toISOString() + '&end=' + new Date().toISOString())
      .then(r => r.json())
      .then(d => {
        if (d.members) setTeamMembers(d.members);
      });
    // Resolve current user id so we can exclude self from team list
    import('@/lib/supabase').then(({ createClient }) => {
      createClient().auth.getUser().then(({ data }) => {
        if (data.user) setCurrentUserId(data.user.id);
      });
    });
  }, []);

  // End-time options with duration labels
  const endTimeOptions = useMemo<TimeSlot[]>(() => {
    if (startDate !== endDate) return TIME_SLOTS;
    const [sh, sm] = startTime.split(':').map(Number);
    const startMins = sh * 60 + sm;
    return TIME_SLOTS.map(slot => {
      const [eh, em] = slot.value.split(':').map(Number);
      const d = eh * 60 + em - startMins;
      return d > 0 ? { ...slot, label: slot.label + durLabel(d) } : slot;
    });
  }, [startTime, startDate, endDate]);

  function handleStartTimeChange(val: string) {
    setStartTime(val);
    if (startDate === endDate) {
      const [sh, sm] = val.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if (eh * 60 + em <= sh * 60 + sm) {
        const next = new Date(2000, 0, 1, sh, sm + 60);
        const nh = next.getHours(), nm = next.getMinutes();
        if (nh < sh) setEndDate(addDays(endDate, 1));
        setEndTime(`${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`);
      }
    }
  }

  function addAttendee(email: string) {
    const e = email.trim().toLowerCase();
    if (e && isValidEmail(e) && !attendees.includes(e)) {
      setAttendees(prev => [...prev, e]);
    }
    setAttendeeInput('');
  }

  function removeAttendee(email: string) {
    setAttendees(prev => prev.filter(e => e !== email));
  }

  function handleAttendeeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addAttendee(attendeeInput);
    } else if (e.key === 'Backspace' && !attendeeInput && attendees.length > 0) {
      setAttendees(prev => prev.slice(0, -1));
    }
  }

  function toggleTeamMember(email: string) {
    if (attendees.includes(email)) removeAttendee(email);
    else addAttendee(email);
  }

  function copyMeetLink(link: string) {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let startISO: string, endISO: string;
      if (isAllDay) {
        startISO = startDate;
        endISO   = addDays(endDate, 1);
      } else {
        startISO = new Date(`${startDate}T${startTime}:00`).toISOString();
        endISO   = new Date(`${endDate}T${endTime}:00`).toISOString();
      }

      const recurrence = repeat !== 'none' ? [`RRULE:${repeat}`] : undefined;

      const res = await fetch('/api/calendar/meetings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          title:          title.trim(),
          start:          startISO,
          end:            endISO,
          isAllDay,
          timezone,
          location:       location.trim()    || undefined,
          description:    description.trim() || undefined,
          recurrence,
          addGoogleMeet,
          sendClientInvite: sendClientInvite && !!clientEmail,
          additionalAttendeeEmails: attendees,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to schedule meeting');

      // Mark hidden if requested (admin only)
      if (makeHidden && data.eventId) {
        const visRes = await fetch('/api/calendar/events/visibility', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eventId: data.eventId, hidden: true }),
        });
        if (!visRes.ok) {
          const visData = await visRes.json().catch(() => ({}));
          throw new Error(visData.error ?? 'Meeting created but failed to set visibility');
        }
      }

      setResult({
        htmlLink:   data.htmlLink,
        meetLink:   data.meetLink ?? undefined,
        inviteSent: data.inviteSent,
      });
      dispatchCalendarChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule meeting');
    } finally {
      setSaving(false);
    }
  }

  // ── Success state ────────────────────────────────────────────────────────────

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
        <div
          className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-md p-6 space-y-4 text-center"
          onClick={e => e.stopPropagation()}
        >
          <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
            <Check size={22} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">Meeting Scheduled</h2>
            {result.inviteSent && clientEmail ? (
              <p className="text-sm text-[var(--text-muted)] mt-1 flex items-center justify-center gap-1.5">
                <Mail size={13} /> Invite sent to {clientEmail}
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {!clientEmail
                  ? 'No client email on file — invite not sent.'
                  : 'Client invite not sent (disabled).'
                }
              </p>
            )}
          </div>

          {/* Meet link */}
          {result.meetLink && (
            <div className="rounded-xl border-2 border-[var(--accent)] bg-[var(--accent-light)] p-3 space-y-2 text-left">
              <div className="flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--accent)] shrink-0">
                  <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
                </svg>
                <span className="text-xs font-semibold text-[var(--accent)]">Google Meet</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] font-mono break-all">{result.meetLink}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => copyMeetLink(result.meetLink!)}
                  className="flex-1 btn-secondary text-xs flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy link'}
                </button>
                <a
                  href={result.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 btn-primary text-xs flex items-center justify-center gap-1.5"
                >
                  <ExternalLink size={11} /> Join now
                </a>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onClose} className="btn-secondary flex-1">Done</button>
            {result.htmlLink && (
              <a
                href={result.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1 flex items-center justify-center gap-1.5"
              >
                <ExternalLink size={13} /> View in Calendar
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="glass-solid rounded-2xl border border-[var(--border)] shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <CalendarDays size={15} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Schedule Meeting</h2>
              <p className="text-xs text-[var(--text-muted)]">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={16} />
          </button>
        </div>

        {/* Calendar not connected warning */}
        {calendarConnected === false && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400">
            Your Google Calendar is not connected.{' '}
            <a href="/settings?tab=calendar" className="underline font-medium">Connect in Settings</a>{' '}
            to schedule meetings.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Meeting Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input-base mt-1"
              required
            />
          </div>

          {/* Date / time block */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-nav-hover)] p-3 space-y-2">
            <div className="flex items-center gap-1.5 flex-wrap text-sm">
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className="input-base py-1.5 text-sm"
                style={{ width: 'auto', minWidth: 0 }}
              />
              {!isAllDay && (
                <select
                  value={startTime}
                  onChange={e => handleStartTimeChange(e.target.value)}
                  className="input-base py-1.5 text-sm"
                  style={{ width: 'auto', minWidth: 0 }}
                >
                  {TIME_SLOTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              <span className="text-xs text-[var(--text-muted)] px-0.5">to</span>
              {!isAllDay && (
                <select
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="input-base py-1.5 text-sm"
                  style={{ width: 'auto', minWidth: 0 }}
                >
                  {endTimeOptions.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="input-base py-1.5 text-sm"
                style={{ width: 'auto', minWidth: 0 }}
              />
              {!isAllDay && (
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="text-xs font-medium text-[var(--accent)] bg-transparent border-none outline-none cursor-pointer hover:underline px-0"
                  title="Time zone"
                >
                  {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              )}
            </div>
            <div className="flex items-center gap-4 pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={e => setIsAllDay(e.target.checked)}
                  className="rounded border-[var(--border-input)] accent-[var(--accent)] w-3.5 h-3.5"
                />
                <span className="text-xs text-[var(--text-secondary)]">All day</span>
              </label>
              <select
                value={repeat}
                onChange={e => setRepeat(e.target.value)}
                className="input-base py-1 text-xs"
                style={{ width: 'auto', minWidth: 0 }}
              >
                {REPEAT_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* Google Meet toggle */}
          <div
            onClick={() => setAddGoogleMeet(v => !v)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all
              ${addGoogleMeet
                ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                : 'border-[var(--border)] bg-[var(--bg-nav-hover)] hover:border-[var(--accent)]'
              }`}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"
              className={addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}
            >
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
            </svg>
            <div className="flex-1">
              <p className={`text-xs font-medium ${addGoogleMeet ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                {addGoogleMeet ? 'Google Meet video call added' : 'Add Google Meet video call'}
              </p>
              {addGoogleMeet && (
                <p className="text-[11px] text-[var(--text-muted)]">A link will be generated and shared with all attendees</p>
              )}
            </div>
            <div className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0
              ${addGoogleMeet ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                ${addGoogleMeet ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
          </div>

          {/* Location */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Location (optional)</label>
            <input
              type="text"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Office, Zoom link, Teams"
              className="input-base mt-1"
            />
          </div>

          {/* Agenda / Notes */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Agenda / Notes (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="input-base mt-1 resize-none"
            />
          </div>

          {/* Client invite toggle */}
          <div
            onClick={() => clientEmail && setSendClientInvite(v => !v)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 transition-all
              ${clientEmail ? 'cursor-pointer' : 'cursor-default opacity-60'}
              ${sendClientInvite && clientEmail
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-900/20'
                : 'border-[var(--border)] bg-[var(--bg-nav-hover)]'
              }`}
          >
            <Mail size={15} className={sendClientInvite && clientEmail ? 'text-emerald-600 dark:text-emerald-400 shrink-0' : 'text-[var(--text-muted)] shrink-0'} />
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${sendClientInvite && clientEmail ? 'text-emerald-700 dark:text-emerald-300' : 'text-[var(--text-secondary)]'}`}>
                {sendClientInvite && clientEmail ? 'Client invite will be sent' : 'Client invite'}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] truncate">
                {clientEmail
                  ? sendClientInvite
                    ? `Invite will be sent to ${clientEmail}`
                    : `Invite disabled — ${clientEmail} will not be notified`
                  : 'No email on file for this client'
                }
              </p>
            </div>
            {clientEmail && (
              <div className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0
                ${sendClientInvite ? 'bg-emerald-500' : 'bg-[var(--border-input)]'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                  ${sendClientInvite ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            )}
          </div>

          {/* Extra attendees */}
          <div>
            <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-1.5">
              <UserPlus size={12} /> Extra Attendees (optional)
            </label>
            {/* Tag input */}
            <div
              className="mt-1 flex flex-wrap gap-1.5 p-2 rounded-lg border border-[var(--border-input)] bg-[var(--bg-content)] min-h-[40px] cursor-text"
              onClick={() => document.getElementById('schedule-attendee-input')?.focus()}
            >
              {attendees.map(email => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-[var(--accent-light)] text-[var(--accent)] font-medium"
                >
                  {email}
                  <button
                    type="button"
                    onClick={ev => { ev.stopPropagation(); removeAttendee(email); }}
                    className="hover:text-red-500 ml-0.5 leading-none"
                  >×</button>
                </span>
              ))}
              <input
                id="schedule-attendee-input"
                type="text"
                value={attendeeInput}
                onChange={e => setAttendeeInput(e.target.value)}
                onKeyDown={handleAttendeeKeyDown}
                onBlur={() => { if (attendeeInput) addAttendee(attendeeInput); }}
                placeholder={attendees.length === 0 ? 'Type email and press Enter…' : ''}
                className="flex-1 min-w-[160px] text-xs outline-none bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
            </div>

            {/* Team member quick-add */}
            {teamMembers.filter(m => m.id !== currentUserId && m.email).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {teamMembers
                  .filter(m => m.id !== currentUserId && m.email)
                  .map(m => {
                    const added = attendees.includes(m.email.toLowerCase());
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleTeamMember(m.email.toLowerCase())}
                        title={!m.connected ? `${m.name}'s calendar is not connected` : undefined}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] border transition-all
                          ${added
                            ? 'border-[var(--accent)] bg-[var(--accent-light)] text-[var(--accent)]'
                            : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                          }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                        {m.name}
                        {added && <Check size={9} />}
                      </button>
                    );
                  })}
              </div>
            )}
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
              The client is already invited above. Add team colleagues or other email addresses here.
            </p>
          </div>

          {/* Hidden toggle — admin only */}
          {isAdmin && (
            <div
              onClick={() => setMakeHidden(v => !v)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all
                ${makeHidden
                  ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                  : 'border-[var(--border)] bg-[var(--bg-nav-hover)] hover:border-[var(--border-input)]'
                }`}
            >
              {makeHidden
                ? <EyeOff size={15} className="text-[var(--accent)] shrink-0" />
                : <Eye size={15} className="text-[var(--text-muted)] shrink-0" />
              }
              <div className="flex-1">
                <p className={`text-xs font-medium ${makeHidden ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
                  {makeHidden ? 'Hidden from team' : 'Visible to team'}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {makeHidden
                    ? 'Other team members will only see a "Busy" block'
                    : 'All team members with calendar access can see this'
                  }
                </p>
              </div>
              <div className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0
                ${makeHidden ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                  ${makeHidden ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button
              type="submit"
              disabled={saving || calendarConnected === false || !title.trim()}
              className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Scheduling…</>
                : <><CalendarDays size={14} /> Schedule Meeting</>
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
