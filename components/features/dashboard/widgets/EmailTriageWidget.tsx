'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { WidgetCard, WidgetLoading, useOpenTool } from './shared';

export default function EmailTriageWidget() {
  const openTool = useOpenTool();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/email/unread')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => { if (active) setCount(d.count ?? 0); })
      .catch(() => { if (active) setCount(0); });
    return () => { active = false; };
  }, []);

  return (
    <WidgetCard
      icon={<Mail size={15} className="text-[var(--accent)]" />}
      title="Email Triage"
      onViewAll={() => openTool('email-triage', 'Email Triage', '/email', Mail)}
    >
      {count === null ? (
        <WidgetLoading />
      ) : (
        <div className="h-full flex flex-col items-center justify-center text-center">
          <p className="text-4xl font-bold text-[var(--accent)] leading-none">{count}</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">
            {count === 0 ? 'Inbox zero 🎉' : count === 1 ? 'unread email' : 'unread emails'}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
