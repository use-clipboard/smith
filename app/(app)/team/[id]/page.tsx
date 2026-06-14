import TeamProfile from '@/components/features/team/TeamProfile';

// Real route backing the team-profile tab, so navigating to /team/<id> (e.g.
// clicking the tab in the tab bar, or a deep link) resolves instead of 404ing.
// When the tab is active, TabPanels renders the persistent copy and the shell
// hides this <main> instance — same pattern as the other tool tabs.
export default function TeamProfilePage({ params }: { params: { id: string } }) {
  return <TeamProfile userId={params.id} />;
}
