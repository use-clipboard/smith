/**
 * Shared sidebar navigation item definitions.
 * Imported by both Sidebar.tsx and the Preferences settings tab.
 * Keep in sync with ALL_TOOLS / WORKSPACE in Sidebar when adding new routes.
 */
import type { ElementType } from 'react';
import {
  LayoutDashboard, FileSearch, ArrowLeftRight, Building2, House,
  ClipboardCheck, TrendingUp, Receipt, ShieldAlert, FileText,
  BookOpen, Users, Settings, HelpCircle, Archive,
} from 'lucide-react';

export interface NavItem {
  moduleId: string;
  href: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: ElementType<any>;
}

export const DASHBOARD_ITEM: NavItem = {
  moduleId: 'dashboard', href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard,
};

/** All tool nav items (excludes Dashboard). Filtered by active modules in the sidebar. */
export const TOOL_NAV_ITEMS: NavItem[] = [
  { moduleId: 'full-analysis',   href: '/full-analysis',  label: 'Full Analysis',   icon: FileSearch },
  { moduleId: 'bank-to-csv',     href: '/bank-to-csv',    label: 'Bank to CSV',     icon: ArrowLeftRight },
  { moduleId: 'landlord',        href: '/landlord',       label: 'Landlord',        icon: House },
  { moduleId: 'final-accounts',  href: '/final-accounts', label: 'Accounts Review', icon: ClipboardCheck },
  { moduleId: 'performance',     href: '/performance',    label: 'Performance',     icon: TrendingUp },
  { moduleId: 'p32',             href: '/p32',            label: 'P32 Summary',     icon: Receipt },
  { moduleId: 'risk-assessment', href: '/risk-assessment',label: 'Risk Assessment', icon: ShieldAlert },
  { moduleId: 'summarise',       href: '/summarise',      label: 'Summarise',       icon: FileText },
  { moduleId: 'ch-secretarial',  href: '/ch-secretarial', label: 'CH Secretarial',  icon: Building2 },
  { moduleId: 'document-vault',  href: '/vault',          label: 'Document Vault',  icon: Archive },
  { moduleId: 'policies',        href: '/policies',       label: 'Policies',        icon: BookOpen },
];

/** Workspace nav items (always visible, no module gate). */
export const WORKSPACE_NAV_ITEMS: NavItem[] = [
  { moduleId: 'clients',  href: '/clients',  label: 'Clients',  icon: Users },
  { moduleId: 'help',     href: '/help',     label: 'Help',     icon: HelpCircle },
  { moduleId: 'settings', href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Items the user can pin as favourites.
 * Includes all tools + Clients. Excludes Dashboard, Settings, Help.
 */
export const FAVOURITABLE_ITEMS: NavItem[] = [
  ...TOOL_NAV_ITEMS,
  { moduleId: 'clients', href: '/clients', label: 'Clients', icon: Users },
];

/** Fast lookup: moduleId → NavItem across all sections */
export const NAV_ITEM_BY_ID = new Map<string, NavItem>(
  [DASHBOARD_ITEM, ...TOOL_NAV_ITEMS, ...WORKSPACE_NAV_ITEMS].map(i => [i.moduleId, i])
);

/** Set of workspace module IDs for type-narrowing in the sidebar */
export const WORKSPACE_MODULE_IDS = new Set(WORKSPACE_NAV_ITEMS.map(w => w.moduleId));
