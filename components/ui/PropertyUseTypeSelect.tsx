'use client';

import Tooltip from '@/components/ui/Tooltip';

// Residential / Commercial property marker, shared by the MTD IT and Landlord
// tools (both read/write mtd_it_properties.use_type). The tax character drives
// the finance-cost treatment: residential finance costs are restricted (relieved
// as a 20% tax reducer), commercial finance costs stay fully deductible.

export type PropertyUseType = 'residential' | 'commercial' | null;

/** Badge colours for the marker — reused wherever the type is displayed. */
export const USE_TYPE_STYLE: Record<'residential' | 'commercial', { label: string; cls: string }> = {
  residential: { label: 'Residential', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  commercial:  { label: 'Commercial',  cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

/** Small inline select for a property's tax character. Colours itself to the
 *  chosen value so the type reads at a glance. */
export default function PropertyUseTypeSelect({
  value, disabled, onChange,
}: {
  value: PropertyUseType;
  disabled?: boolean;
  onChange: (v: PropertyUseType) => void;
}) {
  const tone = value ? USE_TYPE_STYLE[value].cls : 'bg-white text-gray-400 border-gray-200';
  return (
    <Tooltip label="Residential finance costs are restricted (20% tax reducer); commercial finance costs stay fully deductible. Sets the at-a-glance marker and the finance-cost treatment.">
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={e => onChange((e.target.value || null) as PropertyUseType)}
        aria-label="Property type (residential or commercial)"
        className={`px-1.5 py-0.5 text-[11px] font-medium border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 disabled:opacity-50 ${tone}`}
      >
        <option value="">Set type…</option>
        <option value="residential">🏠 Residential</option>
        <option value="commercial">🏢 Commercial</option>
      </select>
    </Tooltip>
  );
}
