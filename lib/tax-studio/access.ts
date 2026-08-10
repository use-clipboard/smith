// Access control for the Tax Studio module.
//
// Tax Studio is a Compliance-tier tool. It is now open to any firm whose plan
// includes it: access is granted when the firm's resolved active_modules contain
// 'tax-studio', which both the Compliance and Practice Suite tiers provide (see
// config/modules.config — 'tax-studio' is in COMPLIANCE_MODULE_IDS).
//
// The tool still carries a "Soon" label in the nav (config/navItems.ts —
// comingSoon: true) while it finishes hardening, but it is no longer restricted
// to an email allowlist. When it goes fully GA, drop the comingSoon flag.
//
// This is the single gate used across the module's API routes + UI so the check
// stays in one place. Pass the firm's active modules — getUserContext resolves
// these from the firm's tier, so a tier that includes Tax Studio just works.

export const TAX_STUDIO_MODULE_ID = 'tax-studio';

export function canAccessTaxStudio(activeModules?: string[] | null): boolean {
  return !!activeModules?.includes(TAX_STUDIO_MODULE_ID);
}
