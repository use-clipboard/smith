import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';
import BookkeepingComingSoon from '@/components/features/bookkeeping/BookkeepingComingSoon';

// Gating layout for the Bookkeeping tool. It's part of the Compliance tier, so
// only firms whose plan includes it (active_modules) can open it; everyone else
// lands on the Coming Soon / not-in-your-plan placeholder.
export default async function BookkeepingLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const ctx = await getUserContext();
  if (!ctx || !canAccessBookkeeping(ctx.activeModules)) {
    return <BookkeepingComingSoon />;
  }

  return <>{children}</>;
}
