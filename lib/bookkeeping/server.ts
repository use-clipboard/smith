// Server-side helper for Bookkeeping API routes. Resolves the authenticated
// user, enforces the access allow-list, and returns the firm/user context.
// Returns null when the request should be rejected — callers respond with 401.

import { createClient } from '@/lib/supabase-server';
import { getUserContext, type UserContext } from '@/lib/getUserContext';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';

export interface BookkeepingContext extends UserContext {
  email: string;
}

export async function getBookkeepingContext(): Promise<BookkeepingContext | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !canAccessBookkeeping(user)) return null;
  const ctx = await getUserContext();
  if (!ctx) return null;
  return { ...ctx, email: user.email ?? '' };
}
