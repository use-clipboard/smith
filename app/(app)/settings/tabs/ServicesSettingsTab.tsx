'use client';

/**
 * ServicesSettingsTab — the firm's shared services catalogue + packages. This is
 * the single home for services: the same catalogue powers both Proposals and
 * each client's Services tab. It reuses the Proposals module's editors
 * (ServicesSection / PackagesSection) so there's one source of truth
 * (proposal_services / proposal_packages). Admin only.
 */

import { ServicesSection, PackagesSection } from './ProposalsSettingsTab';

export default function ServicesSettingsTab({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Services catalogue</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">Your firm-wide list of services, with pricing, frequency and VAT. Used both in proposals and on each client&rsquo;s Services tab.</p>
        <ServicesSection isAdmin={isAdmin} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Packages</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">Bundle services together to add them to a client (or a proposal) in one click.</p>
        <PackagesSection isAdmin={isAdmin} />
      </section>
    </div>
  );
}
