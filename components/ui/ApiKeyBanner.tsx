'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

interface Props {
  userRole: string;
}

export default function ApiKeyBanner({ userRole }: Props) {
  const isAdmin = userRole === 'admin';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800/40 text-sm text-amber-800 dark:text-amber-300 shrink-0">
      <AlertTriangle size={15} className="shrink-0 text-amber-500" />
      {isAdmin ? (
        <span>
          No AI API key configured — tools won&apos;t work until one is added.{' '}
          <Link
            href="/settings?tab=api-key"
            className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-200 transition-colors"
          >
            Set up API key →
          </Link>
        </span>
      ) : (
        <span>
          No AI API key configured — please contact your firm administrator to set one up in Settings.
        </span>
      )}
    </div>
  );
}
