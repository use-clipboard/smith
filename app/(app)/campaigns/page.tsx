import { getUserContext } from '@/lib/getUserContext';
import CampaignsModule from '@/components/features/campaigns/CampaignsModule';

export default async function CampaignsPage() {
  const ctx = await getUserContext();
  return <CampaignsModule userEmail={ctx?.email ?? null} />;
}
