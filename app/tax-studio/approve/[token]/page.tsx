import TaxStudioApproveClient from './TaxStudioApproveClient';

export const metadata = { title: 'Approve your tax return' };

export default function TaxStudioApprovePage({ params }: { params: { token: string } }) {
  return <TaxStudioApproveClient token={params.token} />;
}
