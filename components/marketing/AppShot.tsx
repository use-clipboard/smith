'use client';

import { useState } from 'react';

/**
 * Renders a real app screenshot from /public. If the file isn't there yet (or
 * fails to load), it silently falls back to the supplied mock node — so the
 * page always looks finished, and instantly upgrades the moment the real
 * screenshot is dropped into /public/marketing/.
 */
export default function AppShot({
  src,
  alt,
  fallback,
  className = '',
}: {
  src: string;
  alt: string;
  fallback: React.ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`block w-full ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
