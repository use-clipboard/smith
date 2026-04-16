'use client';

import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TabBar from './TabBar';
import TabPanels, { TOOL_ROUTES } from './TabPanels';
import AskSmithBubble from './AskSmithBubble';
import OnboardingModal from './OnboardingModal';
import ApiKeyBanner from './ApiKeyBanner';
import TabProvider, { useTabContext } from './TabContext';
import { TabActivityProvider } from './TabActivityContext';
import { ModulesProvider } from './ModulesProvider';
import { FavouritesProvider } from './FavouritesProvider';
import { ChatProvider, useChatContext } from '@/components/chat/ChatProvider';
import ConversationWindow from '@/components/chat/ConversationWindow';

interface AppShellProps {
  children: ReactNode;
  userName?: string;
  userEmail?: string;
  userRole?: string;
  avatarUrl?: string | null;
  userId: string;
  firmId: string;
  activeModules: string[];
  initialFavourites: string[];
  showOnboarding?: boolean;
  hasApiKey?: boolean;
}

// Rendered inside ChatProvider so it can access context
function ConversationWindows() {
  const { openConversationIds } = useChatContext();
  return (
    <>
      {openConversationIds.map((id, index) => (
        <ConversationWindow key={id} conversationId={id} index={index} />
      ))}
    </>
  );
}

type AppShellInnerProps = Omit<AppShellProps, 'userId' | 'firmId' | 'activeModules' | 'initialFavourites' | 'showOnboarding'>;

// Inner layout — runs inside all providers so it can read TabContext and TabActivityContext
function AppShellInner({
  children, userName, userEmail, userRole, avatarUrl, hasApiKey,
}: AppShellInnerProps) {
  const { tabs, activeTabId } = useTabContext();
  const activeTab = tabs.find(t => t.id === activeTabId);
  // When a tool tab is active, TabPanels handles rendering — hide the Next.js children
  const isToolTabActive = !!activeTab && TOOL_ROUTES.has(activeTab.route);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-page)]">
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        userRole={userRole}
        avatarUrl={avatarUrl}
      />

      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
        <TopBar userName={userName} avatarUrl={avatarUrl} />
        {!hasApiKey && <ApiKeyBanner userRole={userRole ?? 'staff'} />}
        <TabBar />

        {/* Content area — main and tool panels are absolutely stacked; only one is visible */}
        <div className="flex-1 min-h-0 relative">
          {/* Regular Next.js-routed pages: dashboard, clients, settings, newtab */}
          <main
            className="absolute inset-0 overflow-y-auto scrollbar-thin"
            style={{ display: isToolTabActive ? 'none' : undefined }}
          >
            {children}
          </main>

          {/* Tool pages — always mounted, CSS-toggled. Never unmounted while the tab is open. */}
          <TabPanels />
        </div>
      </div>
    </div>
  );
}

export default function AppShell({
  children, userName, userEmail, userRole, avatarUrl, userId, firmId, activeModules, initialFavourites, showOnboarding, hasApiKey,
}: AppShellProps) {
  const [onboardingVisible, setOnboardingVisible] = useState(showOnboarding ?? false);

  async function handleDismissOnboarding() {
    setOnboardingVisible(false);
    try {
      await fetch('/api/users/onboarding', { method: 'POST' });
    } catch {
      // Non-critical — modal won't show again this session regardless
    }
  }

  return (
    <ModulesProvider activeModules={activeModules}>
      <FavouritesProvider initialFavourites={initialFavourites}>
      <ChatProvider userId={userId} firmId={firmId}>
        <TabProvider>
          <TabActivityProvider>
            <AppShellInner
              userName={userName}
              userEmail={userEmail}
              userRole={userRole}
              avatarUrl={avatarUrl}
              hasApiKey={hasApiKey ?? true}
            >
              {children}
            </AppShellInner>
            {/* Floating overlays — outside AppShellInner but still inside all providers */}
            <AskSmithBubble />
            <ConversationWindows />
            {onboardingVisible && (
              <OnboardingModal onDismiss={handleDismissOnboarding} />
            )}
          </TabActivityProvider>
        </TabProvider>
      </ChatProvider>
      </FavouritesProvider>
    </ModulesProvider>
  );
}
