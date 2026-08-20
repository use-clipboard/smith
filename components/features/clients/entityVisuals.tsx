'use client';

/**
 * Entity node styling for the connections graph and the link editor — the
 * single source of truth for how a client record is drawn as a node (colour,
 * shape, icon by business_type). Keeping this in one place means the org-chart
 * lightbox and the "Add / Edit link" modal always look identical.
 */

import { Building2, User, Landmark, HeartHandshake, Home, Briefcase, HelpCircle, Search } from 'lucide-react';

export interface EntityStyle {
  label: string;
  bg: string;
  border: string;
  text: string;
  Icon: typeof Building2;
  shape: 'rounded' | 'circle' | 'diamond' | 'pill';
}

export const ENTITY_STYLE: Record<string, EntityStyle> = {
  limited_company: { label: 'Ltd Co.',     bg: '#dbeafe', border: '#2563eb', text: '#1e3a8a', Icon: Building2,      shape: 'rounded' },
  partnership:     { label: 'Partnership', bg: '#fef3c7', border: '#d97706', text: '#78350f', Icon: Briefcase,      shape: 'rounded' },
  sole_trader:     { label: 'Sole Trader', bg: '#fef9c3', border: '#ca8a04', text: '#713f12', Icon: Briefcase,      shape: 'rounded' },
  individual:      { label: 'Individual',  bg: '#fce7f3', border: '#db2777', text: '#831843', Icon: User,           shape: 'circle'  },
  trust:           { label: 'Trust',       bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95', Icon: Landmark,       shape: 'diamond' },
  charity:         { label: 'Charity',     bg: '#dcfce7', border: '#16a34a', text: '#14532d', Icon: HeartHandshake, shape: 'pill'    },
  rental_landlord: { label: 'Landlord',    bg: '#cffafe', border: '#0891b2', text: '#164e63', Icon: Home,           shape: 'rounded' },
};

export const FALLBACK_STYLE: EntityStyle = {
  label: 'Other', bg: '#f3f4f6', border: '#6b7280', text: '#374151', Icon: HelpCircle, shape: 'rounded',
};

export function entityStyleFor(businessType: string | null | undefined): EntityStyle {
  return ENTITY_STYLE[businessType ?? ''] ?? FALLBACK_STYLE;
}

export interface EntityCardData {
  name: string;
  client_ref?: string | null;
  business_type?: string | null;
}

/**
 * A static, org-chart-styled entity card for use in the link editor. When
 * `data` is null it renders a dashed "pick a client" placeholder.
 */
export function EntityCard({
  data,
  placeholder = 'Choose a client',
}: {
  data: EntityCardData | null;
  placeholder?: string;
}) {
  if (!data) {
    return (
      <div
        className="w-full max-w-[300px] flex flex-col items-center justify-center gap-1.5 text-center"
        style={{
          minHeight: 84, padding: '12px 16px', borderRadius: 14,
          border: '2px dashed #cbd5e1', background: '#f8fafc', color: '#94a3b8',
        }}
      >
        <Search size={16} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>{placeholder}</span>
      </div>
    );
  }

  const style = entityStyleFor(data.business_type);
  const Icon = style.Icon;
  const radius = style.shape === 'circle' || style.shape === 'pill' ? 9999 : 14;

  return (
    <div
      className="w-full max-w-[300px] flex flex-col items-center justify-center text-center"
      style={{
        minHeight: 84, padding: '12px 18px',
        background: style.bg,
        border: `2px solid ${style.border}`,
        borderRadius: radius,
        color: style.text,
        boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', opacity: 0.85 }}>
        <Icon size={12} />
        <span>{style.label}</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, marginTop: 3, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {data.name}
      </div>
      {data.client_ref && (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', opacity: 0.7, marginTop: 1 }}>{data.client_ref}</div>
      )}
    </div>
  );
}
