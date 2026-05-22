import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { getUserContext } from '@/lib/getUserContext';
import { canAccessBookkeeping } from '@/lib/bookkeeping/access';
import BookView from '@/components/features/bookkeeping/BookView';

export default async function BookPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (!canAccessBookkeeping(user)) redirect('/bookkeeping');

  const ctx = await getUserContext();
  if (!ctx) redirect('/login');

  return <BookView bookId={params.id} userRole={ctx.userRole} />;
}
