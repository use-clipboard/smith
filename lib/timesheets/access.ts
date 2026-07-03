// Temporary access gate for the Timesheets module.
//
// While Timesheets is in "Soon" preview, only the emails below can actually
// open and use it (for live testing). Everyone else sees the teaser + a
// "coming soon" screen. Remove this gate (and the `comingSoon` flag in
// config/navItems.ts) to release the tool to all firms.

export const TIMESHEETS_ALLOWED_EMAILS = [
  'christos@mmandco.com',
];

export function canAccessTimesheets(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return TIMESHEETS_ALLOWED_EMAILS.some(a => a.toLowerCase() === e);
}
