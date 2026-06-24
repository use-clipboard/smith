import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import VatSandboxTester from '@/components/features/hmrc/VatSandboxTester';

// Admin-only dev/compliance page for HMRC VAT (MTD) production approval. Not in
// the nav — reached directly at /hmrc-vat-test.
export default async function HmrcVatTestPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') redirect('/dashboard');

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-lg font-bold text-slate-900">HMRC production approval — VAT endpoint test</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Connect, retrieve VAT obligations, and submit a return against the sandbox. Capture the responses
          (obligations + form bundle number) as evidence for the Production Approvals Checklist.
        </p>
      </div>
      <VatSandboxTester />
    </div>
  );
}
