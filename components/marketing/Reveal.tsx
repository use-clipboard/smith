'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-reveal wrapper. Fades + slides its children up the first time they
 * enter the viewport (via IntersectionObserver). Use `delay` to stagger items
 * in a grid. Honours prefers-reduced-motion (renders instantly, no transform).
 */
export default function Reveal({
  children,
  className = '',
  delay = 0,
  y = 24,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** vertical travel distance in px */
  y?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setShown(true);
      cleanup();
    };

    // Reveal once the element is ~12% up from the bottom of the viewport.
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.88 && r.bottom > 0) reveal();
    };

    // IntersectionObserver is the efficient path; the scroll/resize listeners are
    // a robustness fallback so a reveal can never get stuck hidden.
    const io = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && reveal(),
      { threshold: 0, rootMargin: '0px 0px -12% 0px' }
    );
    io.observe(el);
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    const raf = requestAnimationFrame(check);
    // Synchronous initial check — reveals already-visible content (e.g. the
    // hero) on mount without waiting for a frame/observer tick.
    check();

    function cleanup() {
      io.disconnect();
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
      cancelAnimationFrame(raf);
    }
    return cleanup;
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : `translateY(${y}px)`,
        transition: 'opacity 0.6s ease, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
        transitionDelay: `${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </div>
  );
}
