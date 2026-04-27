'use client';

import { useTabContext } from './TabContext';

// Import all tool page components directly.
// Rendering them here (rather than via Next.js routing) keeps them mounted in memory
// when you switch tabs — state and in-progress AI fetches are never lost.
import FullAnalysisPage from '@/app/(app)/full-analysis/page';
import BankToCsvPage from '@/app/(app)/bank-to-csv/page';
import LandlordPage from '@/app/(app)/landlord/page';
import FinalAccountsPage from '@/app/(app)/final-accounts/page';
import PerformancePage from '@/app/(app)/performance/page';
import P32Page from '@/app/(app)/p32/page';
import RiskAssessmentPage from '@/app/(app)/risk-assessment/page';
import SummarisePage from '@/app/(app)/summarise/page';
import VaultPage from '@/app/(app)/vault/page';
import PoliciesPage from '@/app/(app)/policies/page';
import CHSecretarialPage from '@/app/(app)/ch-secretarial/page';
import CalendarPage from '@/app/(app)/calendar/page';
import MeetingNotesPage from '@/app/(app)/meeting-notes/page';
import StaffHirePage from '@/app/(app)/staff-hire/page';

const ROUTE_TO_COMPONENT: Record<string, React.ComponentType> = {
  '/full-analysis':   FullAnalysisPage,
  '/bank-to-csv':     BankToCsvPage,
  '/landlord':        LandlordPage,
  '/final-accounts':  FinalAccountsPage,
  '/performance':     PerformancePage,
  '/p32':             P32Page,
  '/risk-assessment': RiskAssessmentPage,
  '/summarise':       SummarisePage,
  '/vault':           VaultPage,
  '/policies':        PoliciesPage,
  '/ch-secretarial':  CHSecretarialPage,
  '/calendar':        CalendarPage,
  '/meeting-notes':   MeetingNotesPage,
  '/staff-hire':      StaffHirePage,
};

/** Routes managed by TabPanels (not Next.js routing). Import this wherever you need to distinguish tool tabs from regular pages. */
export const TOOL_ROUTES = new Set(Object.keys(ROUTE_TO_COMPONENT));

/**
 * Renders every open tool tab as a permanently-mounted component.
 * Only the active tab is visible (display:none on the others).
 * This must be placed inside a `position: relative` container that fills available height.
 */
export default function TabPanels() {
  const { tabs, activeTabId } = useTabContext();

  const toolTabs = tabs.filter(t => ROUTE_TO_COMPONENT[t.route]);
  if (toolTabs.length === 0) return null;

  return (
    <>
      {toolTabs.map(tab => {
        const Component = ROUTE_TO_COMPONENT[tab.route];
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            style={{ display: isActive ? undefined : 'none' }}
            className="absolute inset-0 overflow-y-auto scrollbar-thin"
          >
            <Component />
          </div>
        );
      })}
    </>
  );
}
