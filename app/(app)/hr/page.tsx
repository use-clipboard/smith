import { redirect } from 'next/navigation';
import { getUserContext } from '@/lib/getUserContext';
import HrClient from '@/components/features/hr/HrClient';

export default async function HrPage() {
  const ctx = await getUserContext();
  if (!ctx) redirect('/login');
  if (!ctx.activeModules.includes('hr')) redirect('/dashboard');

  return <HrClient userId={ctx.userId} userRole={ctx.userRole} />;
}
