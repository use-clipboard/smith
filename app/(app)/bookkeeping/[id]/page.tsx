import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';
import BookView from '@/components/features/bookkeeping/BookView';

export default async function BookPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const ctx = await getUserContext();
  if (!ctx) redirect('/login');
  if (!canAccessBookkeeping(ctx.activeModules)) redirect('/bookkeeping');

  // Author name travels with whiteboard notes so the UI can show "Posted by …"
  // without per-render joins. Fall back to email if the profile has no name.
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle();
  const currentUserName = profile?.full_name ?? profile?.email ?? null;

  return (
    <BookView
      bookId={params.id}
      userRole={ctx.userRole}
      currentUserId={ctx.userId}
      currentUserName={currentUserName}
    />
  );
}
