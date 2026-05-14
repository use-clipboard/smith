import CommunityPostView from '@/components/features/community/CommunityPostView';

export default function Page({ params }: { params: { id: string } }) {
  return <CommunityPostView postId={params.id} />;
}
