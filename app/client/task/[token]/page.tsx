import type { Metadata } from 'next';
import ClientTaskPortal from '@/components/features/tasks/ClientTaskPortal';

export const metadata: Metadata = {
  title: 'Action Required — SMITH',
  description: 'Complete your task step',
};

// Force dynamic so the token is read at request time, not build time
export const dynamic = 'force-dynamic';

export default function ClientTaskPage({ params }: { params: { token: string } }) {
  return <ClientTaskPortal token={params.token} />;
}
