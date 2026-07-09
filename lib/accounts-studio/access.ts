// Access check for the Accounts Studio module.
//
// Accounts Studio is now generally available. This helper is retained as the
// single gate used across the module's API routes + UI so the check stays in
// one place; it now allows any authenticated user. Whether the tool actually
// appears for a firm is still governed by the firm's tier / active_modules
// (accounts-studio is part of the Compliance tier — see config/modules.config).
//
// (Previously an email allowlist while the tool was in "Soon" preview.)

export function canAccessAccountsStudio(email?: string | null): boolean {
  return !!email;
}
