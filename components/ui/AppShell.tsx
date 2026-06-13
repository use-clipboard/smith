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
import NotificationToastNotifier from './NotificationToastNotifier';
import ApiKeyBanner from './ApiKeyBanner';
import CalendarReminderBanner from './CalendarReminderBanner';
import StickyNotesProvider from './StickyNotes/StickyNotesProvider';
import StickyNotesLayer from './StickyNotes/StickyNotesLayer';
import FocusModeProvider, { useFocusMode } from './FocusModeProvider';
import { Minimize2 } from 'lucide-react';
import ComposeWindowProvider from '@/components/features/email/ComposeWindowProvider';
import GlobalComposeWindow from '@/components/features/email/GlobalComposeWindow';
import MinimisedComposeChip from '@/components/features/email/MinimisedComposeChip';
import TabProvider, { useTabContext } from './TabContext';
import { TabActivityProvider } from './TabActivityContext';
import { ModulesProvider } from './ModulesProvider';
import EmailCountProvider from './EmailCountProvider';
import TasksCountProvider from './TasksCountProvider';
import NotificationsProvider from './NotificationsProvider';
import { FavouritesProvider } from './FavouritesProvider';
import { DashboardLayoutProvider } from './DashboardLayoutProvider';
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
  initialDashboardLayout: string[] | null;
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

// Floating "Exit focus" affordance — pinned top-right when focus mode is on
// so the user always has a visible way out (the chrome itself is hidden).
function FocusModeExitChip() {
  const { focusMode, setFocusMode } = useFocusMode();
  if (!focusMode) return null;
  return (
    <Tooltip label="Exit focus mode (Esc or Ctrl+\)" side="left">
      <button
        onClick={() => setFocusMode(false)}
        aria-label="Exit focus mode"
        className="fixed top-3 right-3 z-[100] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-xs font-semibold shadow-xl hover:brightness-110 transition-all"
      >
        <Minimize2 size={13} />
        Exit focus
      </button>
    </Tooltip>
  );
}

type AppShellInnerProps = Omit<AppShellProps, 'firmId' | 'activeModules' | 'initialFavourites' | 'initialDashboardLayout' | 'showOnboarding'>;

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
    <div className={`h-screen p-3 bg-transparent ${screenNudgeActive ? 'animate-nudge' : ''}`}>
      {/* Floating app panel — the whole app sits on one rounded glass panel with
          the colour gradient showing through the margin around it. */}
      <div className="flex h-full w-full overflow-hidden rounded-[20px] shadow-2xl ring-1 ring-white/25">
      <Sidebar
        userName={userName}
        userEmail={userEmail}
        userRole={userRole}
        avatarUrl={avatarUrl}
      />

      <div
        className="flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        style={{
          // Soft near-white backdrop for the whole main area — faint blue glow
          // top-right, faint lavender glow bottom-left (replicated in CSS so it
          // scales crisply and doesn't bleed the saturated app gradient through).
          background:
            'radial-gradient(100% 95% at 92% 4%, rgba(96, 150, 255, 0.44) 0%, rgba(96, 150, 255, 0) 48%),' +
            'radial-gradient(92% 90% at 4% 102%, rgba(197, 150, 255, 0.50) 0%, rgba(197, 150, 255, 0) 50%),' +
            '#f3f3fc',
        }}
      >
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
    </div>
  );
}

export default function AppShell({
  children, userName, userEmail, userRole, avatarUrl, userId, firmId, activeModules, initialFavourites, initialDashboardLayout, showOnboarding, hasApiKey,
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
      <EmailCountProvider>
      <TasksCountProvider>
      <NotificationsProvider userId={userId}>
      <FavouritesProvider initialFavourites={initialFavourites}>
      <DashboardLayoutProvider initialLayout={initialDashboardLayout}>
      <ChatProvider userId={userId} firmId={firmId}>
        <TabProvider>
          <TabActivityProvider>
            <StickyNotesProvider userId={userId}>
              <ComposeWindowProvider userName={userName}>
                <FocusModeProvider>
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
                <NotificationToastNotifier />
                <StickyNotesLayer />
                <GlobalComposeWindow />
                <MinimisedComposeChip />
                <FocusModeExitChip />
                {onboardingVisible && (
                  <OnboardingModal onDismiss={handleDismissOnboarding} />
                )}
                </FocusModeProvider>
              </ComposeWindowProvider>
            </StickyNotesProvider>
          </TabActivityProvider>
        </TabProvider>
      </ChatProvider>
      </DashboardLayoutProvider>
      </FavouritesProvider>
      </NotificationsProvider>
      </TasksCountProvider>
      </EmailCountProvider>
    </ModulesProvider>
  );
}
