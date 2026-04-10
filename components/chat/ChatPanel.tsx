'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X, MessageSquare } from 'lucide-react';
import { useChatContext } from './ChatProvider';
import Avatar from '@/components/ui/Avatar';

export default function ChatPanel() {
  const {
    teamMembers, onlineUserIds, openConversationWith,
    conversations, unreadCounts, setIsPanelOpen, currentUserId,
  } = useChatContext();

  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setIsPanelOpen]);

  const others = teamMembers.filter(m => m.id !== currentUserId);
  const filtered = search
    ? others.filter(m => m.full_name.toLowerCase().includes(search.toLowerCase()))
    : others;

  const online = filtered.filter(m => onlineUserIds.has(m.id));
  const offline = filtered.filter(m => !onlineUserIds.has(m.id));

  const getUnreadForUser = (uid: string) => {
    const conv = Object.values(conversations).find(
      c => c.type === 'direct' && c.otherMember?.id === uid
    );
    return conv ? (unreadCounts[conv.id] || 0) : 0;
  };

  return (
    <div
      ref={panelRef}
      className="absolute top-full right-0 mt-2 w-72 rounded-2xl shadow-2xl border border-[var(--border)] bg-[var(--bg-card-solid)] overflow-hidden z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold text-[var(--text-primary)]">Team Messages</span>
        </div>
        <button
          onClick={() => setIsPanelOpen(false)}
          className="w-6 h-6 flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-nav-hover)] transition-all"
        >
          <X size={13} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 bg-[var(--bg-page)] rounded-lg px-2.5 py-1.5">
          <Search size={12} className="text-[var(--text-muted)] shrink-0" />
          <input
            type="text"
            placeholder="Find a colleague..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-xs bg-transparent outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>

      {/* Members */}
      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
        {online.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Online — {online.length}
              </span>
            </div>
            {online.map(m => (
              <MemberRow
                key={m.id}
                member={m}
                isOnline
                unread={getUnreadForUser(m.id)}
                onClick={() => openConversationWith(m.id)}
              />
            ))}
          </div>
        )}

        {offline.length > 0 && (
          <div>
            <div className="px-4 pt-3 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Away — {offline.length}
              </span>
            </div>
            {offline.map(m => (
              <MemberRow
                key={m.id}
                member={m}
                isOnline={false}
                unread={getUnreadForUser(m.id)}
                onClick={() => openConversationWith(m.id)}
              />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
            No team members found
          </div>
        )}

        <div className="h-2" />
      </div>
    </div>
  );
}

function MemberRow({
  member, isOnline, unread, onClick,
}: {
  member: { full_name: string; avatar_url?: string | null; role: string };
  isOnline: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-nav-hover)] transition-all text-left"
    >
      <div className="relative shrink-0">
        <Avatar name={member.full_name} avatarUrl={member.avatar_url} size={30} />
        <span
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-card)] ${
            isOnline ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-600'
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{member.full_name}</p>
        <p className="text-[10px] text-[var(--text-muted)] truncate capitalize">
          {isOnline ? '● Active now' : member.role}
        </p>
      </div>
      {unread > 0 && (
        <span className="shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-[var(--accent)] text-white text-[9px] font-bold px-1">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
}
