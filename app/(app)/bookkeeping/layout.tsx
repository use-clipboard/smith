import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';
import BookkeepingComingSoon from '@/components/features/bookkeeping/BookkeepingComingSoon';

// Gating layout for the Bookkeeping tool while it's in active development.
// Anyone in the firm can see the sidebar entry (with a "Soon" pill), but only
// allow-listed users (see lib/bookkeeping/access.ts) can actually open the
// tool. Everyone else lands on the Coming Soon placeholder.
export default async function BookkeepingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  if (!canAccessBookkeeping(user)) {
    return <BookkeepingComingSoon />;
  }

  return <>{children}</>;
}
