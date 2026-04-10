'use client';

interface AvatarProps {
  name?: string;
  avatarUrl?: string | null;
  size?: number; // px
  className?: string;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
}

export default function Avatar({ name, avatarUrl, size = 32, className = '' }: AvatarProps) {
  const initials = getInitials(name);
  const style = { width: size, height: size, minWidth: size, minHeight: size, fontSize: size * 0.38 };

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name || 'Avatar'}
        style={style}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <div
      style={style}
      className={`rounded-full flex items-center justify-center font-semibold select-none
        bg-[#1A1A2E] text-white dark:bg-white dark:text-[#0F0F1A] ${className}`}
    >
      {initials}
    </div>
  );
}
