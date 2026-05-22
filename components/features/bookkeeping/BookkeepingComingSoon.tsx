import { BookCopy, Wrench } from 'lucide-react';

// Shown to any user without bookkeeping access while the tool is in
// development. Keeps the entry visible so the team knows it's coming,
// without exposing the half-built screens.
export default function BookkeepingComingSoon() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--accent-light)] mb-5">
          <BookCopy size={28} className="text-[var(--accent)]" />
        </div>
        <h1 className="text-xl font-bold text-[var(--text-primary)] mb-2">Bookkeeping — coming soon</h1>
        <p className="text-sm text-[var(--text-muted)] mb-6">
          AI-powered bookkeeping is in active development.
        </p>
        <div className="inline-flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1.5">
          <Wrench size={12} />
          Access will open up once the first phase is ready.
        </div>
      </div>
    </div>
  );
}
