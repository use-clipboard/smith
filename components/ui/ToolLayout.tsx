import { LucideIcon } from 'lucide-react';

interface ToolLayoutProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  /** Remove max-width constraint for data-heavy full-width pages */
  wide?: boolean;
  /** Optional content rendered to the right of the page header (e.g. quick-action pill). */
  headerRight?: React.ReactNode;
}

export default function ToolLayout({ title, description, icon: Icon, iconColor, children, wide, headerRight }: ToolLayoutProps) {
  return (
    <div className={`p-6 ${wide ? 'w-full' : 'max-w-[1400px] mx-auto'}`}>
      {/* Page header — sits on the light main panel, so dark text + a tinted icon. */}
      <div className="flex items-center gap-3 mb-6">
        {Icon && (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
            style={{ backgroundColor: iconColor ? `${iconColor}1a` : 'var(--accent-light)' }}
          >
            <Icon size={20} style={{ color: iconColor ?? 'var(--accent)' }} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight truncate">{title}</h2>
          {description && <p className="text-sm text-[var(--text-secondary)] mt-0.5">{description}</p>}
        </div>
        {headerRight && <div className="shrink-0">{headerRight}</div>}
      </div>
      {children}
    </div>
  );
}
