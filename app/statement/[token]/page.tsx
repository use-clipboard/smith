import BillingPortalView from './BillingPortalView';

export const metadata = { title: 'Statement' };

export default function StatementPage({ params }: { params: { token: string } }) {
  return <BillingPortalView token={params.token} />;
}
