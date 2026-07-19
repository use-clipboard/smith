import { Megaphone } from 'lucide-react';

// Placeholder shown when a user can't yet access Campaigns (not on the preview
// allowlist, or the firm's plan doesn't include it). Mirrors the other tools'
// "coming soon" screens.
export default function CampaignsComingSoon() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-2xl mx-auto mt-12">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-5">
          <Megaphone size={26} style={{ color: 'var(--accent)' }} />
        </div>
        <h2 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">Campaigns</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
          The intelligent client communications engine for your firm — newsletters, tax
          reminders and deadline campaigns, built from your own live client, task,
          compliance and billing data.
        </p>
        <div className="inline-flex items-center gap-2 mt-6 px-3 py-1.5 rounded-full bg-[var(--accent-light)] text-[var(--accent)] text-xs font-semibold">
          Coming soon
        </div>
      </div>
    </div>
  );
}
