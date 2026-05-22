// Access control for the Bookkeeping tool during its "Coming soon" build phase.
//
// While this tool is in development it must NOT be reachable by anyone except
// the developer. Once Phase 10 ships and the tool is ready for the wider firm
// (and eventually other firms in the SaaS rollout), broaden this gate — at
// that point firm-admin status + active-module check will be enough.
//
// Keep this list tight. Adding an email here makes the tool fully usable for
// that user in production.
const BOOKKEEPING_ALLOWED_EMAILS = new Set<string>([
  'christos@mmandco.com',
]);

interface UserLike {
  email?: string | null;
}

export function canAccessBookkeeping(user: UserLike | null | undefined): boolean {
  if (!user?.email) return false;
  return BOOKKEEPING_ALLOWED_EMAILS.has(user.email.toLowerCase());
}
