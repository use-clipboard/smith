import { getUserContext } from '@/lib/getUserContext';
import { createClient } from '@/lib/supabase-server';
import TaxStudioModule from '@/components/features/tax-studio/TaxStudioModule';

export default async function TaxStudioPage() {
  const ctx = await getUserContext();
  let userName = '';
  if (ctx) {
    const supabase = createClient();
    const { data } = await supabase.from('users').select('full_name').eq('id', ctx.userId).maybeSingle();
    userName = (data?.full_name as string | null)?.trim() || '';
  }
  return <TaxStudioModule activeModules={ctx?.activeModules ?? null} userName={userName} />;
}
