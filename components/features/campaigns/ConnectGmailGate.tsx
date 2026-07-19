import { Mail, ArrowRight } from 'lucide-react';

// Shown when the user hasn't linked a Gmail account. Campaigns sends
// exclusively over a connected Gmail, so linking one is a prerequisite to using
// the module at all.
export default function ConnectGmailGate() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="glass-solid rounded-2xl border border-[var(--border)] p-10 text-center max-w-xl mx-auto mt-12">
        <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mx-auto mb-5">
          <Mail size={26} style={{ color: 'var(--accent)' }} />
        </div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">Connect your Gmail to use Campaigns</h2>
        <p className="text-sm text-[var(--text-secondary)] mt-2 leading-relaxed">
          Campaigns send from your own Gmail account — so they land in your Sent Mail, come from your
          address, and replies come straight back to you. Link a Gmail account to get started.
        </p>
        <a href="/api/campaigns/connect" className="btn-primary mt-6 mx-auto inline-flex">
          Connect Gmail <ArrowRight size={15} />
        </a>
        <p className="text-[11px] text-[var(--text-muted)] mt-4">
          SMITH only uses this to send the campaigns you create. You can disconnect any time.
        </p>
      </div>
    </div>
  );
}
