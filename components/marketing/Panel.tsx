/**
 * Bento panel — every major marketing section sits inside one of these large
 * rounded white cards, floating on the lavender page background. This is the
 * core layout motif from the SMITH landing mockup (vs Briefcase's edge-to-edge
 * white sections).
 */
export default function Panel({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`scroll-mt-24 overflow-hidden rounded-[28px] border border-white bg-white shadow-[0_12px_50px_-12px_rgba(31,38,88,0.12)] ${className}`}
    >
      {children}
    </section>
  );
}
