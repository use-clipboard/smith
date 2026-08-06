// Access control for the Tax Studio module.
//
// Tax Studio is a Compliance-tier tool, so whether it appears for a firm at all
// is governed by the firm's tier / active_modules (see config/modules.config —
// 'tax-studio' is in COMPLIANCE_MODULE_IDS).
//
// While the tool is in "Soon" preview it is additionally gated to a small email
// allowlist so it stays hidden from the rest of the firm during the build. When
// it goes GA, replace the body with `return !!email` (the Accounts Studio
// pattern) and drop the `comingSoon` flag in config/navItems.ts.
//
// This is the single gate used across the module's API routes + UI so the check
// stays in one place.

export const TAX_STUDIO_ALLOWED_EMAILS = [
  'christos@marnerosmarcus.co.uk',
  'christos@mmandco.com',
];

export function canAccessTaxStudio(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return TAX_STUDIO_ALLOWED_EMAILS.some(a => a.toLowerCase() === e);
}
