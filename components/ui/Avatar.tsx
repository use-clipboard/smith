'use client';

import { useOpenProfile } from '@/components/features/team/useOpenProfile';

interface AvatarProps {
  name?: string;
  avatarUrl?: string | null;
  size?: number; // px
  className?: string;
  /** When set, the avatar becomes a button that opens this team member's
   *  profile. Safe anywhere under the app shell; falls back to a plain avatar
   *  when no tab context is mounted. */
  userId?: string;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

export default function Avatar({ name, avatarUrl, size = 32, className = '', userId }: AvatarProps) {
  const openProfile = useOpenProfile();
  const initials = getInitials(name);
  const style = { width: size, height: size, minWidth: size, minHeight: size, fontSize: size * 0.38 };

  const inner = avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={avatarUrl}
      alt={name || 'Avatar'}
      style={style}
      className={`rounded-full object-cover ${className}`}
    />
  ) : (
    <div
      style={style}
      className={`rounded-full flex items-center justify-center font-semibold select-none
        bg-[#1A1A2E] text-white dark:bg-white dark:text-[#0F0F1A] ${className}`}
    >
      {initials}
    </div>
  );

  // Plain (non-interactive) avatar.
  if (!userId) return inner;

  // Clickable → opens the member's profile. stopPropagation so it works inside
  // clickable rows (a task row, a list item) without also triggering those.
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openProfile(userId, name ?? ''); }}
      aria-label={name ? `Open ${name}'s profile` : 'Open profile'}
      className="rounded-full shrink-0 hover:ring-2 hover:ring-[var(--accent)] hover:ring-offset-1 transition-all"
    >
      {inner}
    </button>
  );
}
