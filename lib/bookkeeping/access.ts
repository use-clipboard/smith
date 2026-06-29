// Access control for the Bookkeeping tool.
//
// RELEASED 2026-06-29 — the tool is live for the whole firm: any authenticated
// user can use it. (For the public SaaS rollout, narrow this to a per-firm
// active-module check so only firms that have enabled Bookkeeping see it.)

interface UserLike {
  email?: string | null;
}

export function canAccessBookkeeping(user: UserLike | null | undefined): boolean {
  return !!user?.email;
}
