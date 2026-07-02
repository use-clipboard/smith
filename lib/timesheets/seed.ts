// Demo data generator for the Timesheets module.
//
// This module ships self-contained: on first load we synthesise a realistic
// fortnight of firm activity so every chart, KPI and leaderboard is alive with
// no database dependency. The generated set is persisted to localStorage (see
// TimesheetsProvider) so it stays stable across reloads. Swapping this for
// Supabase-backed rows is the natural follow-up.

import type { TsClient, TsStaff, TsActivity, TimeEntry } from './types';
import { addDays, toIsoDate, startOfWeek } from './format';

export const DEPARTMENTS = [
  'Accounts',
  'Tax',
  'Bookkeeping',
  'Audit',
  'Advisory',
  'Payroll',
] as const;

/** The demo user's own staff id — relabelled with the real signed-in name. */
export const ME_ID = 'me';

export const SEED_STAFF: TsStaff[] = [
  { id: ME_ID,   name: 'You',            role: 'Manager',       department: 'Accounts',    weeklyCapacityHours: 37.5, ratePence: 14000, hue: 250 },
  { id: 'u-amy', name: 'Amara Okafor',   role: 'Senior',        department: 'Tax',         weeklyCapacityHours: 37.5, ratePence: 12000, hue: 280 },
  { id: 'u-ben', name: 'Ben Carter',     role: 'Semi-Senior',   department: 'Bookkeeping', weeklyCapacityHours: 37.5, ratePence: 8500,  hue: 200 },
  { id: 'u-cho', name: 'Chloe Nguyen',   role: 'Manager',       department: 'Audit',       weeklyCapacityHours: 37.5, ratePence: 15000, hue: 160 },
  { id: 'u-dev', name: 'Dev Patel',      role: 'Senior',        department: 'Advisory',    weeklyCapacityHours: 37.5, ratePence: 13500, hue: 25  },
  { id: 'u-eli', name: 'Elena Rossi',    role: 'Semi-Senior',   department: 'Accounts',    weeklyCapacityHours: 30,   ratePence: 9000,  hue: 330 },
  { id: 'u-fin', name: 'Finlay Grant',   role: 'Junior',        department: 'Payroll',     weeklyCapacityHours: 37.5, ratePence: 7000,  hue: 45  },
  { id: 'u-gra', name: 'Grace Bello',    role: 'Partner',       department: 'Advisory',    weeklyCapacityHours: 25,   ratePence: 22000, hue: 220 },
];

export const SEED_CLIENTS: TsClient[] = [
  { id: 'c-acme', name: 'Acme Ltd',            ref: 'ACM01' },
  { id: 'c-smith', name: 'Smith & Co',          ref: 'SMI01' },
  { id: 'c-globa', name: 'Global Corp',         ref: 'GLO01' },
  { id: 'c-brigh', name: 'Brightwater Cafés',   ref: 'BRI01' },
  { id: 'c-north', name: 'Northgate Joinery',   ref: 'NOR01' },
  { id: 'c-vertx', name: 'Vertex Digital',      ref: 'VER01' },
  { id: 'c-oakle', name: 'Oakley Property LLP', ref: 'OAK01' },
  { id: 'c-maple', name: 'Maple Health Ltd',    ref: 'MAP01' },
  { id: 'c-riven', name: 'Riverton Motors',     ref: 'RIV01' },
  { id: 'c-lumis', name: 'Lumis Studio',        ref: 'LUM01' },
];

export const SEED_ACTIVITIES: TsActivity[] = [
  { id: 'a-accprep', label: 'Accounts preparation',   type: 'billable',     department: 'Accounts' },
  { id: 'a-review',  label: 'Review and analysis',    type: 'billable',     department: 'Accounts' },
  { id: 'a-vat',     label: 'VAT return',             type: 'billable',     department: 'Bookkeeping' },
  { id: 'a-book',    label: 'Bookkeeping & data entry', type: 'billable',   department: 'Bookkeeping' },
  { id: 'a-tax',     label: 'Tax computation',        type: 'billable',     department: 'Tax' },
  { id: 'a-plan',    label: 'Tax planning',           type: 'billable',     department: 'Tax' },
  { id: 'a-audit',   label: 'Audit fieldwork',        type: 'billable',     department: 'Audit' },
  { id: 'a-advis',   label: 'Advisory & forecasting', type: 'billable',     department: 'Advisory' },
  { id: 'a-payroll', label: 'Payroll run',            type: 'billable',     department: 'Payroll' },
  { id: 'a-meeting', label: 'Client meeting',         type: 'billable',     department: 'Accounts' },
  { id: 'a-email',   label: 'Client email & queries', type: 'non_billable', department: 'Accounts' },
  { id: 'a-admin',   label: 'Admin',                  type: 'non_billable', department: 'Accounts' },
  { id: 'a-train',   label: 'Training & CPD',         type: 'internal',     department: 'Advisory' },
  { id: 'a-intmtg',  label: 'Internal meeting',       type: 'internal',     department: 'Advisory' },
  { id: 'a-bd',      label: 'Business development',   type: 'internal',     department: 'Advisory' },
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const between = (min: number, max: number) => min + Math.random() * (max - min);

/** Round minutes to the nearest 15 (timesheet convention). */
const round15 = (m: number) => Math.max(15, Math.round(m / 15) * 15);

let counter = 0;
const nextId = () => `te-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/**
 * Build a fortnight of entries for the whole team, ending on `today`.
 * Weekdays are filled to ~6.5–8.5h with a billable-leaning mix.
 */
export function generateSeedEntries(today: string): TimeEntry[] {
  const entries: TimeEntry[] = [];
  const thisMonday = startOfWeek(today);
  const start = addDays(thisMonday, -7); // start of last week

  for (const staff of SEED_STAFF) {
    let cursor = start;
    // 14 days from the start of last week.
    for (let i = 0; i < 14; i++) {
      const dow = new Date(`${cursor}T00:00:00`).getDay();
      const isWeekend = dow === 0 || dow === 6;
      // Don't log time in the future.
      if (cursor > today) break;

      if (!isWeekend) {
        // Partners/junior have lighter/heavier loads for realism.
        const targetHours = between(6.2, 8.6);
        let logged = 0;
        let clock = 9 * 60 + Math.round(between(0, 45)); // start ~09:00

        while (logged < targetHours * 60 - 30) {
          const billableRoll = Math.random();
          const activity =
            billableRoll < 0.68
              ? pick(SEED_ACTIVITIES.filter(a => a.type === 'billable'))
              : billableRoll < 0.88
              ? pick(SEED_ACTIVITIES.filter(a => a.type === 'non_billable'))
              : pick(SEED_ACTIVITIES.filter(a => a.type === 'internal'));

          const minutes = round15(between(45, 150));
          const client = activity.type === 'billable' ? pick(SEED_CLIENTS) : null;
          const hh = String(Math.floor(clock / 60)).padStart(2, '0');
          const mm = String(clock % 60).padStart(2, '0');

          entries.push({
            id: nextId(),
            userId: staff.id,
            date: cursor,
            start: `${hh}:${mm}`,
            clientId: client?.id ?? null,
            clientName: client?.name ?? 'Internal',
            taskTitle: taskTitleFor(activity.label, client?.name),
            activity: activity.label,
            department: activity.department,
            type: activity.type,
            minutes,
            ratePence: activity.type === 'billable' ? staff.ratePence : 0,
            notes: '',
            source: 'manual',
          });

          logged += minutes;
          clock += minutes + (Math.random() < 0.3 ? 15 : 0); // occasional gap
          if (clock > 19 * 60) break;
        }
      }
      cursor = addDays(cursor, 1);
    }
  }

  return entries;
}

/**
 * A single week of sample entries for ONE real user, mapped to the firm's real
 * clients. Used in live (Supabase) mode to give a fresh firm a starting dataset
 * that persists — only the signed-in user's own time, so nothing is fabricated
 * for colleagues. Returns entries without ids (the server assigns them).
 */
export function generateSampleForUser(
  today: string,
  userId: string,
  ratePence: number,
  realClients: { id: string; name: string }[],
): Omit<TimeEntry, 'id'>[] {
  const out: Omit<TimeEntry, 'id'>[] = [];
  const thisMonday = startOfWeek(today);
  for (let i = 0; i < 5; i++) {
    const day = addDays(thisMonday, i);
    if (day > today) break;
    let clock = 9 * 60;
    let logged = 0;
    while (logged < 6.5 * 60) {
      const roll = Math.random();
      const activity =
        roll < 0.7 ? pick(SEED_ACTIVITIES.filter(a => a.type === 'billable'))
        : roll < 0.88 ? pick(SEED_ACTIVITIES.filter(a => a.type === 'non_billable'))
        : pick(SEED_ACTIVITIES.filter(a => a.type === 'internal'));
      const minutes = round15(between(45, 135));
      const client = activity.type === 'billable' && realClients.length ? pick(realClients) : null;
      const hh = String(Math.floor(clock / 60)).padStart(2, '0');
      const mm = String(clock % 60).padStart(2, '0');
      out.push({
        userId,
        date: day,
        start: `${hh}:${mm}`,
        clientId: client?.id ?? null,
        clientName: client?.name ?? 'Internal',
        taskTitle: taskTitleFor(activity.label, client?.name),
        activity: activity.label,
        department: activity.department,
        type: activity.type,
        minutes,
        ratePence: activity.type === 'billable' ? ratePence : 0,
        notes: '',
        source: 'manual',
      });
      logged += minutes;
      clock += minutes;
      if (clock > 18 * 60) break;
    }
  }
  return out;
}

function taskTitleFor(activity: string, client?: string): string {
  const map: Record<string, string> = {
    'Accounts preparation': 'Year-end accounts',
    'Review and analysis': 'Quarterly review',
    'VAT return': 'VAT return',
    'Bookkeeping & data entry': 'Monthly bookkeeping',
    'Tax computation': 'CT600 preparation',
    'Tax planning': 'Tax planning',
    'Audit fieldwork': 'Statutory audit',
    'Advisory & forecasting': 'Management accounts',
    'Payroll run': 'Monthly payroll',
    'Client meeting': 'Client meeting',
    'Client email & queries': 'Correspondence',
    'Admin': 'General admin',
    'Training & CPD': 'CPD',
    'Internal meeting': 'Team catch-up',
    'Business development': 'New enquiries',
  };
  return map[activity] ?? activity;
}
