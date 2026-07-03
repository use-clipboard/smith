import { getUserContext } from '@/lib/getUserContext';
import AccountsStudioModule from '@/components/features/accounts-studio/AccountsStudioModule';

export default async function AccountsStudioPage() {
  const ctx = await getUserContext();
  return <AccountsStudioModule userEmail={ctx?.email ?? null} />;
}
