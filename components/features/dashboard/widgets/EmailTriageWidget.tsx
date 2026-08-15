'use client';

import { Mail } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';
import { useEmailCount } from '@/components/ui/EmailCountProvider';

export default function EmailTriageWidget() {
  const openTool = useOpenTool();
  // Shared app-wide count (same source as the sidebar badge): untriaged in
  // triage mode, unread in traditional mode. null while it first loads.
  const { count, mode } = useEmailCount();
  const traditional = mode === 'traditional';

  return (
    <WidgetCard
      icon={<Mail size={15} className="text-[var(--accent)]" />}
      title="Email"
      onViewAll={() => openTool('email-triage', 'Email', '/email', Mail)}
    >
      {count === null ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <p className="text-4xl font-bold text-[var(--accent)] leading-none">{count}</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {traditional
              ? (count === 0 ? 'All caught up 🎉' : count === 1 ? 'unread email' : 'unread emails')
              : (count === 0 ? 'All triaged 🎉' : count === 1 ? 'email to triage' : 'emails to triage')}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
