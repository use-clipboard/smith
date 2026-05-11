import ProposalPublicView from './ProposalPublicView';

interface PageProps {
  params: { token: string };
}

export default function PublicProposalPage({ params }: PageProps) {
  return <ProposalPublicView token={params.token} />;
}
