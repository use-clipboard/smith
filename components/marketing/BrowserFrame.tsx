/**
 * Screenshot frame — a clean rounded, shadowed panel that wraps a real app
 * screenshot (or a fallback mock). No fake browser chrome: the SMITH app
 * already has its own sidebar / top bar / tabs, so the screenshot speaks for
 * itself, floating on the page (matching the landing mockup).
 */
export default function BrowserFrame({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
  /** Deprecated — kept so existing callers that pass `url` don't break. */
  url?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-white/80 bg-white shadow-[0_30px_80px_-20px_rgba(31,38,88,0.35)] ring-1 ring-slate-200/60 ${className}`}
    >
      {children}
    </div>
  );
}
