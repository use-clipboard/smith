'use client';

/**
 * Google-Calendar-style recurrence picker.
 *
 * A native <select> of presets derived from the event's start date (so the
 * labels read "Weekly on Monday", "Monthly on the fourth Monday", "Annually on
 * 24 August", …) plus a "Custom…" option that opens a small builder modal
 * (repeat every N days/weeks/months/years · which weekdays · ends never/on/after).
 *
 * Emits an RRULE *body* (no "RRULE:" prefix) via onChange — or 'none'. The parent
 * stores that string and prefixes it when POSTing to Google.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORDINAL: Record<number, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', [-1]: 'last' };

type Kind = 'none' | 'daily' | 'weekly' | 'monthly' | 'annually' | 'weekdays' | 'custom';
type CustomFreq = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
interface CustomCfg {
  interval: number;
  freq: CustomFreq;
  byday: string[];          // RRULE weekday codes, weekly only
  ends: 'never' | 'on' | 'after';
  until: string;            // YYYY-MM-DD
  count: number;
}

/** The nth occurrence of this weekday in its month (1–4), or -1 for the last. */
function nthWeekday(date: Date): number {
  const nth = Math.ceil(date.getDate() / 7);
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const isLast = date.getDate() + 7 > daysInMonth;
  return isLast || nth >= 5 ? -1 : nth;
}
function toUntil(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${y}${m}${d}T235959Z`; // end of that day, UTC — good enough for a date-only bound
}
const FREQ_MAP: Record<CustomFreq, string> = { DAY: 'DAILY', WEEK: 'WEEKLY', MONTH: 'MONTHLY', YEAR: 'YEARLY' };

/** Build an RRULE body from the selection. Returns 'none' when not repeating. */
function buildRRule(kind: Kind, startDate: Date, custom: CustomCfg): string {
  const dow = DAY_CODES[startDate.getDay()];
  switch (kind) {
    case 'none':     return 'none';
    case 'daily':    return 'FREQ=DAILY';
    case 'weekly':   return `FREQ=WEEKLY;BYDAY=${dow}`;
    case 'monthly':  return `FREQ=MONTHLY;BYDAY=${nthWeekday(startDate)}${dow}`;
    case 'annually': return 'FREQ=YEARLY';
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'custom': {
      let r = `FREQ=${FREQ_MAP[custom.freq]}`;
      if (custom.interval > 1) r += `;INTERVAL=${custom.interval}`;
      if (custom.freq === 'WEEK' && custom.byday.length) {
        r += `;BYDAY=${DAY_CODES.filter(c => custom.byday.includes(c)).join(',')}`;
      }
      if (custom.ends === 'on' && custom.until) r += `;UNTIL=${toUntil(custom.until)}`;
      else if (custom.ends === 'after' && custom.count > 0) r += `;COUNT=${Math.max(1, custom.count)}`;
      return r;
    }
  }
}

/** Best-effort parse of an existing RRULE body back into a selection (for edit). */
function parseRRule(body: string, startDate: Date): { kind: Kind; custom: CustomCfg } {
  const base: CustomCfg = { interval: 1, freq: 'WEEK', byday: [DAY_CODES[startDate.getDay()]], ends: 'never', until: '', count: 13 };
  if (!body || body === 'none') return { kind: 'none', custom: base };
  const parts = Object.fromEntries(
    body.replace(/^RRULE:/i, '').split(';').map(kv => kv.split('=') as [string, string]),
  ) as Record<string, string>;
  const freq = (parts.FREQ ?? '').toUpperCase();
  const interval = parseInt(parts.INTERVAL ?? '1', 10) || 1;
  const byday = (parts.BYDAY ?? '').split(',').filter(Boolean);
  const hasEnd = !!parts.UNTIL || !!parts.COUNT;
  const dow = DAY_CODES[startDate.getDay()];

  // Match the simple presets (no interval / end bound).
  if (interval === 1 && !hasEnd) {
    if (freq === 'DAILY') return { kind: 'daily', custom: base };
    if (freq === 'YEARLY') return { kind: 'annually', custom: base };
    if (freq === 'WEEKLY') {
      const set = new Set(byday);
      if (byday.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every(d => set.has(d))) return { kind: 'weekdays', custom: base };
      if (byday.length <= 1 && (byday.length === 0 || set.has(dow))) return { kind: 'weekly', custom: base };
    }
    if (freq === 'MONTHLY' && (parts.BYDAY ?? '') === `${nthWeekday(startDate)}${dow}`) return { kind: 'monthly', custom: base };
  }

  // Otherwise treat as custom, mapping the fields back into the builder.
  const freqRev = (Object.keys(FREQ_MAP) as CustomFreq[]).find(k => FREQ_MAP[k] === freq) ?? 'WEEK';
  const custom: CustomCfg = {
    interval,
    freq: freqRev,
    byday: byday.length ? byday.filter(b => DAY_CODES.includes(b as typeof DAY_CODES[number])) : [dow],
    ends: parts.UNTIL ? 'on' : parts.COUNT ? 'after' : 'never',
    until: parts.UNTIL ? `${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}` : '',
    count: parts.COUNT ? parseInt(parts.COUNT, 10) || 13 : 13,
  };
  return { kind: 'custom', custom };
}

/** Short human summary of a custom rule for the select label. */
function summarize(custom: CustomCfg): string {
  const unit = custom.freq === 'DAY' ? 'day' : custom.freq === 'WEEK' ? 'week' : custom.freq === 'MONTH' ? 'month' : 'year';
  let s = custom.interval > 1 ? `Every ${custom.interval} ${unit}s` : `Every ${unit}`;
  if (custom.freq === 'WEEK' && custom.byday.length) {
    const days = DAY_CODES.filter(c => custom.byday.includes(c)).map(c => DAY_NAMES[DAY_CODES.indexOf(c)].slice(0, 3));
    s += ` on ${days.join(', ')}`;
  }
  if (custom.ends === 'on' && custom.until) s += `, until ${custom.until.split('-').reverse().join('/')}`;
  else if (custom.ends === 'after' && custom.count > 0) s += `, ${custom.count}×`;
  return s;
}

export default function RecurrencePicker({
  startDate, value, onChange,
}: {
  startDate: Date;
  value: string;                 // RRULE body or 'none'
  onChange: (rruleBody: string) => void;
}) {
  const [{ kind, custom }, setSel] = useState(() => parseRRule(value, startDate));
  const [showCustom, setShowCustom] = useState(false);
  // Draft config while the custom modal is open (only committed on "Done").
  const [draft, setDraft] = useState<CustomCfg>(custom);

  // Emit the RRULE whenever the selection OR the start date changes (so a
  // date-derived preset like "Weekly on Monday" follows the date, as Google does).
  const rrule = useMemo(() => buildRRule(kind, startDate, custom), [kind, startDate, custom]);
  const lastEmitted = useRef<string>(value);
  useEffect(() => {
    if (rrule !== lastEmitted.current) { lastEmitted.current = rrule; onChange(rrule); }
  }, [rrule, onChange]);

  const dow = startDate.getDay();
  const presets: { value: Kind; label: string }[] = [
    { value: 'none',     label: 'Does not repeat' },
    { value: 'daily',    label: 'Daily' },
    { value: 'weekly',   label: `Weekly on ${DAY_NAMES[dow]}` },
    { value: 'monthly',  label: `Monthly on the ${ORDINAL[nthWeekday(startDate)]} ${DAY_NAMES[dow]}` },
    { value: 'annually', label: `Annually on ${startDate.getDate()} ${MONTHS[startDate.getMonth()]}` },
    { value: 'weekdays', label: 'Every weekday (Monday to Friday)' },
    { value: 'custom',   label: kind === 'custom' ? summarize(custom) : 'Custom…' },
  ];

  function pick(next: Kind) {
    if (next === 'custom') {
      setDraft(kind === 'custom' ? custom : { ...custom, freq: 'WEEK', byday: [DAY_CODES[dow]], interval: 1, ends: 'never' });
      setShowCustom(true);
      return;
    }
    setSel({ kind: next, custom });
  }

  function toggleDraftDay(code: string) {
    setDraft(d => ({ ...d, byday: d.byday.includes(code) ? d.byday.filter(x => x !== code) : [...d.byday, code] }));
  }

  return (
    <>
      <select
        value={kind}
        onChange={e => pick(e.target.value as Kind)}
        className="input-base py-1 text-xs"
        style={{ width: 'auto', minWidth: 0, maxWidth: '100%' }}
      >
        {presets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>

      {showCustom && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCustom(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-[var(--bg-card,#fff)] p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-4">Custom recurrence</h3>

            {/* Repeat every N unit */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-[var(--text-secondary)]">Repeat every</span>
              <input
                type="number" min={1} max={999} value={draft.interval}
                onChange={e => setDraft(d => ({ ...d, interval: Math.max(1, Number(e.target.value) || 1) }))}
                className="input-base w-16 text-sm text-center"
              />
              <select value={draft.freq} onChange={e => setDraft(d => ({ ...d, freq: e.target.value as CustomFreq }))} className="input-base text-sm">
                <option value="DAY">{draft.interval > 1 ? 'days' : 'day'}</option>
                <option value="WEEK">{draft.interval > 1 ? 'weeks' : 'week'}</option>
                <option value="MONTH">{draft.interval > 1 ? 'months' : 'month'}</option>
                <option value="YEAR">{draft.interval > 1 ? 'years' : 'year'}</option>
              </select>
            </div>

            {/* Repeat on — weekly only */}
            {draft.freq === 'WEEK' && (
              <div className="mb-4">
                <p className="text-sm text-[var(--text-secondary)] mb-2">Repeat on</p>
                <div className="flex gap-1.5">
                  {DAY_CODES.map((code, i) => {
                    const on = draft.byday.includes(code);
                    return (
                      <button
                        key={i} type="button" onClick={() => toggleDraftDay(code)}
                        aria-pressed={on}
                        className={`h-8 w-8 rounded-full text-xs font-medium transition-colors ${on ? 'bg-[var(--accent)] text-white' : 'bg-black/[0.06] text-[var(--text-secondary)] hover:bg-black/10'}`}
                      >
                        {DAY_SHORT[i]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ends */}
            <div className="mb-5">
              <p className="text-sm text-[var(--text-secondary)] mb-2">Ends</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="ends" checked={draft.ends === 'never'} onChange={() => setDraft(d => ({ ...d, ends: 'never' }))} className="accent-[var(--accent)]" />
                  Never
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="ends" checked={draft.ends === 'on'} onChange={() => setDraft(d => ({ ...d, ends: 'on' }))} className="accent-[var(--accent)]" />
                  On
                  <input
                    type="date" value={draft.until} disabled={draft.ends !== 'on'}
                    onChange={e => setDraft(d => ({ ...d, until: e.target.value }))}
                    className="input-base py-1 text-sm disabled:opacity-50"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" name="ends" checked={draft.ends === 'after'} onChange={() => setDraft(d => ({ ...d, ends: 'after' }))} className="accent-[var(--accent)]" />
                  After
                  <input
                    type="number" min={1} max={999} value={draft.count} disabled={draft.ends !== 'after'}
                    onChange={e => setDraft(d => ({ ...d, count: Math.max(1, Number(e.target.value) || 1) }))}
                    className="input-base w-16 py-1 text-sm text-center disabled:opacity-50"
                  />
                  occurrences
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCustom(false)} className="btn-ghost">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  // A weekly rule needs at least one weekday — default to the start day.
                  const fixed = draft.freq === 'WEEK' && draft.byday.length === 0
                    ? { ...draft, byday: [DAY_CODES[dow]] } : draft;
                  setSel({ kind: 'custom', custom: fixed });
                  setShowCustom(false);
                }}
                className="btn-primary"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
