'use client';

/**
 * ServicesSettingsTab — the firm's shared services catalogue + packages. This is
 * the single home for services: the same catalogue powers both Proposals and
 * each client's Services tab. It reuses the Proposals module's editors
 * (ServicesSection / PackagesSection) so there's one source of truth
 * (proposal_services / proposal_packages). Admin only.
 */

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { ServicesSection, PackagesSection } from './ProposalsSettingsTab';
import BulkServiceAllocationModal from '@/components/features/clients/services/BulkServiceAllocationModal';

export default function ServicesSettingsTab({ isAdmin }: { isAdmin: boolean }) {
  const [showBulk, setShowBulk] = useState(false);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Services catalogue</h2>
            <p className="text-sm text-[var(--text-muted)]">Your firm-wide list of services, with pricing, frequency and VAT. Used both in proposals and on each client&rsquo;s Services tab.</p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowBulk(true)}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
            >
              <Layers size={14} /> Bulk Service Allocation
            </button>
          )}
        </div>
        <ServicesSection isAdmin={isAdmin} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Packages</h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">Bundle services together to add them to a client (or a proposal) in one click.</p>
        <PackagesSection isAdmin={isAdmin} />
      </section>

      {showBulk && (
        <BulkServiceAllocationModal onClose={() => setShowBulk(false)} />
      )}
    </div>
  );
}
