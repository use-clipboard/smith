'use client';

import { useWaitlist } from './WaitlistProvider';

/**
 * A CTA that opens the pre-launch waitlist lightbox. Drop-in replacement for the
 * old `<Link href="/signup">` CTAs — pass the same className so styling is
 * identical. `source` tags where the click came from (for later segmentation).
 */
export default function WaitlistButton({
  className,
  children,
  source,
}: {
  className?: string;
  children: React.ReactNode;
  source?: string;
}) {
  const { open } = useWaitlist();
  return (
    <button type="button" onClick={() => open(source)} className={className}>
      {children}
    </button>
  );
}
