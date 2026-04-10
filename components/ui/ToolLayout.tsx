import { LucideIcon } from 'lucide-react';

interface ToolLayoutProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  iconColor?: string;
  children: React.ReactNode;
  /** Remove max-width constraint for data-heavy full-width pages */
  wide?: boolean;
}

export default function ToolLayout({ title, description, icon: Icon, iconColor = 'var(--accent)', children, wide }: ToolLayoutProps) {
  return (
    <div className={`p-6 ${wide ? 'w-full' : 'max-w-[1400px]'}`}>
      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        {Icon && (
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${iconColor}18` }}
          >
            <Icon size={20} style={{ color: iconColor }} />
          </div>
        )}
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">{title}</h2>
          {description && <p className="text-sm text-[var(--text-muted)] mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
