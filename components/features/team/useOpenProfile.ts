'use client';

import { User } from 'lucide-react';
import { useTabContext, type Tab } from '@/components/ui/TabContext';

/**
 * Opens a team member's profile in a NEW tab titled with their name — never
 * replacing the tab you're currently on. If that person's profile is already
 * open, it just switches to that existing tab (openInNewTab dedupes by route).
 * Use this anywhere a colleague's name/avatar should be clickable.
 */
export function useOpenProfile() {
  const { openInNewTab } = useTabContext();
  return (userId: string, name: string) => {
    openInNewTab({ id: `team-${userId}`, title: name || 'Profile', route: `/team/${userId}`, icon: User as Tab['icon'] });
  };
}
