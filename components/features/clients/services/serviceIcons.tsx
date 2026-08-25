'use client';

// Icon registry for services — a key stored on the catalogue/service maps to a
// lucide icon. Shared by the Services tab, the edit modal and Settings.

import {
  Briefcase, BookOpen, Receipt, Calculator, Users, FileText, Building2, ShieldCheck,
  Cloud, BarChart3, Landmark, Wallet, ClipboardList, HandCoins, FileBadge, Percent,
  PiggyBank, TrendingUp, type LucideIcon,
} from 'lucide-react';

export const SERVICE_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  bookkeeping: BookOpen,
  vat: Receipt,
  accounts: Calculator,
  payroll: Users,
  self_assessment: FileText,
  company: Building2,
  confirmation: ShieldCheck,
  cloud: Cloud,
  management: BarChart3,
  tax: Landmark,
  wallet: Wallet,
  cis: ClipboardList,
  advisory: HandCoins,
  filing: FileBadge,
  percent: Percent,
  savings: PiggyBank,
  growth: TrendingUp,
};

export const SERVICE_ICON_KEYS = Object.keys(SERVICE_ICONS);
export const DEFAULT_SERVICE_ICON: LucideIcon = Briefcase;

export function serviceIcon(key: string | null | undefined): LucideIcon {
  return (key && SERVICE_ICONS[key]) || DEFAULT_SERVICE_ICON;
}
