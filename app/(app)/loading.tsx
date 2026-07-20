/**
 * Instant streaming fallback for the authenticated app. Next.js shows this the
 * moment a navigation resolves into the (app) segment, while the async server
 * page fetches its data — the dashboard in particular runs several sequential
 * Supabase queries (including a full team listUsers), so the wait is real.
 *
 * The layout mirrors the dashboard shell (padded container, header block, a
 * three-column card grid) so the transition into the loaded page doesn't jump.
 * Bars use --border so the skeleton reads correctly in both light and dark.
 */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`rounded bg-[var(--border)] ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="glass rounded-xl p-5 h-full flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-[var(--border)]" />
        <Bar className="h-3.5 w-32" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-3 w-3/4" />
              <Bar className="h-2.5 w-1/2 opacity-60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AppLoading() {
  return (
    <div className="p-6 sm:p-8 space-y-6 animate-pulse" aria-busy="true" aria-label="Loading">
      {/* Header — greeting + subtitle */}
      <div className="px-1 pt-1 space-y-2">
        <Bar className="h-6 w-56" />
        <Bar className="h-3.5 w-72 opacity-60" />
      </div>

      {/* Three-column widget grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
