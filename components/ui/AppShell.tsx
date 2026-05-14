'use client';

import { ReactNode, useState } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import TabBar from './TabBar';
import TabPanels, { TOOL_ROUTES } from './TabPanels';
import AskSmithBubble from './AskSmithBubble';
import Tooltip from './Tooltip';
import OnboardingModal from './OnboardingModal';
import EmailToastNotifier from './EmailToastNotifier';
import ApiKeyBanner from './ApiKeyBanner';
import CalendarReminderBanner from './CalendarReminderBanner';
import StickyNotesProvider from './StickyNotes/StickyNotesProvider';
import StickyNotesLayer from './StickyNotes/StickyNotesLayer';
import ComposeWindowProvider from '@/components/features/email/ComposeWindowProvider';
import GlobalComposeWindow from '@/components/features/email/GlobalComposeWindow';
import MinimisedComposeChip from '@/components/features/email/MinimisedComposeChip';
import TabProvider, { useTabContext } from './TabContext';
import { TabActivityProvider } from './TabActivityContext';
import { ModulesProvider } from './ModulesProvider';
import { FavouritesProvider } from './FavouritesProvider';
import { ChatProvider, useChatContext } from '@/components/chat/ChatProvider';
import ConversationWindow from '@/components/chat/ConversationWindow';
import Avatar from '@/components/ui/Avatar';

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

// Chips at the bottom for conversations with unread messages that aren't open
function UnreadMessageChips() {
  const {
    unreadCounts, conversations, openConversationIds, openConversationWith,
  } = useChatContext();

  const chips = Object.entries(unreadCounts)
    .filter(([id, count]) => count > 0 && !openConversationIds.includes(id) && conversations[id])
    .map(([id, count]) => ({ id, count, conversation: conversations[id] }));

  if (chips.length === 0) return null;

  // Chips sit to the left of any open ConversationWindows (each window uses 348px)
  const windowStackWidth = openConversationIds.length * 348;

  return (
    <>
      {chips.map((chip, index) => {
        const otherMember = chip.conversation.otherMember;
        const rightOffset = windowStackWidth + 16 + index * 216;

        return (
          <button
            key={chip.id}
            onClick={() => otherMember && openConversationWith(otherMember.id)}
            aria-label={`Message from ${otherMember?.full_name ?? 'teammate'}`}
            className="fixed bottom-0 z-[60] flex items-center gap-2.5 px-3 py-2.5 bg-[var(--accent)] rounded-t-2xl shadow-2xl border border-[var(--border)] text-left hover:brightness-110 transition-all"
            style={{ right: rightOffset, width: 200 }}
          >
            <div className="relative shrink-0">
              <Avatar name={otherMember?.full_name} avatarUrl={otherMember?.avatar_url ?? null} size={24} />
            </div>
            <p className="flex-1 text-xs font-semibold text-white truncate leading-none">
              {otherMember?.full_name?.split(' ')[0] ?? chip.conversation.name ?? 'Chat'}
            </p>
            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1 shrink-0">
              {chip.count > 99 ? '99+' : chip.count}
            </span>
          </button>
        );
      })}
    </>
  );
}

type AppShellInnerProps = Omit<AppShellProps, 'firmId' | 'activeModules' | 'initialFavourites' | 'showOnboarding'>;

// Inner layout — runs inside all providers so it can read TabContext and TabActivityContext
function AppShellInner({
  children, userName, userEmail, userRole, avatarUrl, hasApiKey, userId,
}: AppShellInnerProps) {
  const { tabs, activeTabId } = useTabContext();
  const { screenNudgeActive } = useChatContext();
  const activeTab = tabs.find(t => t.id === activeTabId);
  // When a tool tab is active, TabPanels handles rendering — hide the Next.js children
  const isToolTabActive = !!activeTab && TOOL_ROUTES.has(activeTab.route);

  return (
    <div className={`flex h-screen overflow-hidden bg-[var(--bg-page)] ${screenNudgeActive ? 'animate-nudge' : ''}`}>
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        userRole={userRole}
        avatarUrl={avatarUrl}
      />

      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
        <TopBar userName={userName} avatarUrl={avatarUrl} />
        {!hasApiKey && <ApiKeyBanner userRole={userRole ?? 'staff'} />}
        {/* Reminder banner — renders as a slim strip when a meeting is due.
            Sits in the flex column so it doesn't reflow or block any tool/analysis. */}
        <CalendarReminderBanner userId={userId} />
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
            <StickyNotesProvider userId={userId}>
              <ComposeWindowProvider userName={userName}>
                <AppShellInner
                  userName={userName}
                  userEmail={userEmail}
                  userRole={userRole}
                  avatarUrl={avatarUrl}
                  hasApiKey={hasApiKey ?? true}
                  userId={userId}
                >
                  {children}
                </AppShellInner>
                {/* Floating overlays — outside AppShellInner but still inside all providers */}
                <AskSmithBubble />
                <ConversationWindows />
                <UnreadMessageChips />
                <EmailToastNotifier />
                <StickyNotesLayer />
                <GlobalComposeWindow />
                <MinimisedComposeChip />
                {onboardingVisible && (
                  <OnboardingModal onDismiss={handleDismissOnboarding} />
                )}
              </ComposeWindowProvider>
            </StickyNotesProvider>
          </TabActivityProvider>
        </TabProvider>
      </ChatProvider>
      </FavouritesProvider>
    </ModulesProvider>
  );
}
