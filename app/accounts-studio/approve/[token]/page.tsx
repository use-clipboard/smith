import ApproveClient from './ApproveClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Approve your accounts',
  robots: { index: false, follow: false },
};

export default function AccountsStudioApprovePage({ params }: { params: { token: string } }) {
  return <ApproveClient token={params.token} />;
}
