import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import FraudHeaderValidator from '@/components/features/hmrc/FraudHeaderValidator';

// Admin-only dev/compliance page for HMRC production approval. Not in the nav —
// reached directly at /hmrc-fph. Hosts the fraud-prevention header validator.
export default async function HmrcFphPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') redirect('/dashboard');

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-slate-900">HMRC production approval — header check</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Validate SMITH&apos;s fraud-prevention headers against HMRC&apos;s test API. Required before HMRC issues
          production credentials for MTD VAT and MTD IT.
        </p>
      </div>
      <FraudHeaderValidator />
    </div>
  );
}
