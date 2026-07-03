// Temporary access gate for the Accounts Studio module.
//
// While Accounts Studio is in "Soon" preview, only the emails below can
// actually open and use it (for live testing). Everyone else sees the teaser +
// a "coming soon" screen. Remove this gate (and the `comingSoon` flag in
// config/navItems.ts) to release the tool to all firms on the Compliance tier.

export const ACCOUNTS_STUDIO_ALLOWED_EMAILS = [
  'christos@marnerosmarcus.co.uk',
  'christos@mmandco.com',
];

export function canAccessAccountsStudio(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return ACCOUNTS_STUDIO_ALLOWED_EMAILS.some(a => a.toLowerCase() === e);
}
