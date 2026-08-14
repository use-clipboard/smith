// Access control for the Capture "Ask SMITH" review chat (Phase 1 pilot).
//
// Capture (full analysis) itself is a released tool available to the whole firm.
// The review-chat assistant, however, is still in preview while we prove the
// pattern out, so it is gated to a small email allowlist — the same approach the
// Campaigns and Tax Studio modules use during their build. When it goes GA,
// replace the body with `return !!email` and drop this gate at the call sites.
//
// Single source of truth for the check, used by both the API route and the UI.

export const CAPTURE_CHAT_ALLOWED_EMAILS = [
  'christos@marnerosmarcus.co.uk',
  'christos@mmandco.com',
  'smith@smithyaccountants.co.uk', // Sam Smithy — added for pilot testing
];

export function canAccessCaptureChat(email?: string | null): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return CAPTURE_CHAT_ALLOWED_EMAILS.some(a => a.toLowerCase() === e);
}
