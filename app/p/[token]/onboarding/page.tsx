import OnboardingPublicView from './OnboardingPublicView';

export default function PublicOnboardingPage({ params }: { params: { token: string } }) {
  return <OnboardingPublicView token={params.token} />;
}
