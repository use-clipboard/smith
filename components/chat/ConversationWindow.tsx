'use client';

import {
  useState, useEffect, useRef, KeyboardEvent, useCallback,
} from 'react';
import { X, Minus, Send, Smile, Zap } from 'lucide-react';
import { useChatContext } from './ChatProvider';
import EmojiPicker from './EmojiPicker';
import Avatar from '@/components/ui/Avatar';
import type { ChatMessage, MessageReaction } from '@/types';

interface Props {
  conversationId: string;
  index: number;
}

export default function ConversationWindow({ conversationId, index }: Props) {
  const {
    conversations, messages, typingUsers, nudgedConversations,
    sendMessage, sendNudge, addReaction, removeReaction,
    closeConversation, markAsRead, setTyping, clearNudge,
    currentUserId, teamMembers, onlineUserIds,
  } = useChatContext();

  const [input, setInput] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hoveredMsgId, setHoveredMsgId] = useState<string | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [unreadBadge, setUnreadBadge] = useState(0);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const conversation = conversations[conversationId];
  const convMessages = messages[conversationId] || [];
  const isTyping = (typingUsers[conversationId] || []).length > 0;
  const typingNames = (typingUsers[conversationId] || [])
    .map(id => teamMembers.find(m => m.id === id)?.full_name?.split(' ')[0])
    .filter(Boolean);
  const otherMember = conversation?.otherMember;
  const isOtherOnline = otherMember ? onlineUserIds.has(otherMember.id) : false;
  const isNudged = nudgedConversations.has(conversationId);

  // Shake on nudge
  useEffect(() => {
    if (isNudged) {
      setIsShaking(true);
      setIsMinimized(false);
      const t = setTimeout(() => {
        setIsShaking(false);
        clearNudge(conversationId);
      }, 900);
      return () => clearTimeout(t);
    }
  }, [isNudged, clearNudge, conversationId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (!isMinimized) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [convMessages.length, isMinimized]);

  // Mark as read on focus / open
  useEffect(() => {
    if (!isMinimized) {
      markAsRead(conversationId);
      setUnreadBadge(0);
    }
  }, [isMinimized, conversationId, markAsRead]);

  // Track unread while minimized
  const prevCountRef = useRef(convMessages.length);
  useEffect(() => {
    if (isMinimized && convMessages.length > prevCountRef.current) {
      const newCount = convMessages.length - prevCountRef.current;
      setUnreadBadge(prev => prev + newCount);
    }
    prevCountRef.current = convMessages.length;
  }, [convMessages.length, isMinimized]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
        setReactionPickerFor(null);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setTyping(conversationId, false);
    await sendMessage(conversationId, text);
  }, [input, conversationId, sendMessage, setTyping]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    setTyping(conversationId, value.length > 0);
  };

  const handleEmojiInsert = (emoji: string) => {
    setInput(prev => prev + emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };

  // Stack windows right-to-left: index 0 is rightmost
  const rightOffset = index * 348 + 16;

  if (!conversation) return null;

  return (
    <div
      className={`fixed bottom-0 z-[60] flex flex-col rounded-t-2xl shadow-2xl border border-[var(--border)] bg-[var(--bg-card-solid)] overflow-hidden transition-all duration-200 ${
        isShaking ? 'animate-nudge' : ''
      }`}
      style={{ right: rightOffset, width: 332, height: isMinimized ? 44 : 440 }}
    >
      {/* Header bar — click to toggle minimise */}
      <button
        className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--accent)] shrink-0 w-full text-left"
        onClick={() => {
          setIsMinimized(m => !m);
          if (isMinimized) { markAsRead(conversationId); setUnreadBadge(0); }
        }}
      >
        <div className="relative shrink-0">
          <Avatar name={otherMember?.full_name} avatarUrl={otherMember?.avatar_url ?? null} size={24} />
          <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[var(--accent)] ${
            isOtherOnline ? 'bg-emerald-400' : 'bg-gray-400'
          }`} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate leading-none">
            {otherMember?.full_name || conversation.name || 'Chat'}
          </p>
          <p className="text-[10px] text-indigo-200 mt-0.5">
            {isOtherOnline ? 'Active now' : 'Away'}
          </p>
        </div>

        <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
          {unreadBadge > 0 && isMinimized && (
            <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold px-1 mr-1">
              {unreadBadge > 9 ? '9+' : unreadBadge}
            </span>
          )}
          <button
            onClick={() => { setIsMinimized(m => !m); }}
            className="w-6 h-6 flex items-center justify-center rounded text-indigo-200 hover:text-white hover:bg-white/20 transition-all"
          >
            <Minus size={12} />
          </button>
          <button
            onClick={() => closeConversation(conversationId)}
            className="w-6 h-6 flex items-center justify-center rounded text-indigo-200 hover:text-white hover:bg-white/20 transition-all"
          >
            <X size={12} />
          </button>
        </div>
      </button>

      {/* Body — hidden when minimised */}
      {!isMinimized && (
        <>
          {/* Messages list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 scrollbar-thin">
            {convMessages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full py-10 text-center">
                <div className="w-12 h-12 rounded-full bg-[var(--bg-page)] flex items-center justify-center mb-3">
                  <Avatar name={otherMember?.full_name} avatarUrl={otherMember?.avatar_url ?? null} size={36} />
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Start a conversation with{' '}
                  <span className="font-medium text-[var(--text-secondary)]">
                    {otherMember?.full_name?.split(' ')[0]}
                  </span>
                </p>
              </div>
            )}

            {convMessages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                isMine={msg.sender_id === currentUserId}
                prevMsg={convMessages[i - 1]}
                isHovered={hoveredMsgId === msg.id}
                showReactionPicker={reactionPickerFor === msg.id}
                currentUserId={currentUserId}
                teamMembers={teamMembers}
                onHover={() => setHoveredMsgId(msg.id)}
                onLeave={() => { setHoveredMsgId(null); setReactionPickerFor(null); }}
                onToggleReactionPicker={() =>
                  setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id)
                }
                onAddReaction={emoji => { addReaction(msg.id, emoji, conversationId); setReactionPickerFor(null); }}
                onRemoveReaction={id => removeReaction(id, conversationId)}
              />
            ))}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex items-end gap-1.5">
                <div className="w-5 shrink-0" />
                <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-[var(--bg-page)] flex items-center gap-1">
                  {typingNames.length > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)] mr-1">
                      {typingNames.join(', ')}
                    </span>
                  )}
                  <TypingDots />
                </div>
              </div>
            )}

            <div ref={endRef} />
          </div>

          {/* Input area */}
          <div className="shrink-0 border-t border-[var(--border)] px-3 py-2.5 relative">
            {/* Emoji picker popover */}
            {showEmojiPicker && (
              <div ref={emojiPickerRef} className="absolute bottom-full left-0 mb-2 z-50">
                <EmojiPicker onSelect={handleEmojiInsert} />
              </div>
            )}

            <div className="flex items-end gap-2">
              {/* Text input */}
              <div className="flex-1 bg-[var(--bg-page)] rounded-xl px-3 py-2 flex items-end gap-1.5 border border-[var(--border-input)]">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message…"
                  rows={1}
                  className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none leading-relaxed"
                  style={{ maxHeight: 72 }}
                />
                <button
                  onMouseDown={e => { e.preventDefault(); setShowEmojiPicker(s => !s); }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all shrink-0 pb-0.5"
                  title="Emoji"
                >
                  <Smile size={14} />
                </button>
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => sendNudge(conversationId)}
                  title="Nudge"
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-amber-100 text-amber-600 hover:bg-amber-200 transition-all dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-800/40"
                >
                  <Zap size={14} />
                </button>
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="w-8 h-8 flex items-center justify-center rounded-xl bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 transition-all"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>

            <p className="text-[10px] text-[var(--text-muted)] mt-1 px-0.5">
              Enter to send · Shift+Enter for new line · <span title="Send a nudge to get their attention">⚡ Nudge</span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg, isMine, prevMsg, isHovered, showReactionPicker,
  currentUserId, teamMembers,
  onHover, onLeave, onToggleReactionPicker, onAddReaction, onRemoveReaction,
}: {
  msg: ChatMessage;
  isMine: boolean;
  prevMsg?: ChatMessage;
  isHovered: boolean;
  showReactionPicker: boolean;
  currentUserId: string;
  teamMembers: Array<{ id: string; full_name: string; avatar_url?: string | null }>;
  onHover: () => void;
  onLeave: () => void;
  onToggleReactionPicker: () => void;
  onAddReaction: (emoji: string) => void;
  onRemoveReaction: (id: string) => void;
}) {
  const sender = teamMembers.find(m => m.id === msg.sender_id);
  const showAvatar = !isMine && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
  const isNudge = msg.type === 'nudge';
  const senderFirst = sender?.full_name?.split(' ')[0];

  // Group reactions by emoji
  const reactionGroups = (msg.reactions || []).reduce<
    Record<string, { count: number; myId?: string }>
  >((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0 };
    acc[r.emoji].count++;
    if (r.user_id === currentUserId) acc[r.emoji].myId = r.id;
    return acc;
  }, {});

  return (
    <div
      className={`flex items-end gap-1.5 ${isMine ? 'flex-row-reverse' : 'flex-row'} relative group`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Avatar slot */}
      {!isMine && (
        <div className="w-5 shrink-0 self-end">
          {showAvatar ? (
            <Avatar name={sender?.full_name} avatarUrl={sender?.avatar_url ?? null} size={20} />
          ) : null}
        </div>
      )}

      <div className={`flex flex-col gap-0.5 max-w-[210px] ${isMine ? 'items-end' : 'items-start'}`}>
        {/* Nudge pill */}
        {isNudge ? (
          <div className="px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 dark:bg-amber-900/30 dark:border-amber-700/40 dark:text-amber-400">
            {isMine ? `You nudged ${senderFirst ?? 'them'} 👋` : `${senderFirst} nudged you 👋`}
          </div>
        ) : (
          <div className={`px-3 py-1.5 rounded-2xl text-xs leading-relaxed break-words ${
            isMine
              ? 'bg-[var(--accent)] text-white rounded-br-sm'
              : 'bg-[var(--bg-page)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border)]'
          }`}>
            {msg.content}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-[10px] text-[var(--text-muted)] px-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>

        {/* Reactions */}
        {Object.keys(reactionGroups).length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {Object.entries(reactionGroups).map(([emoji, { count, myId }]) => (
              <button
                key={emoji}
                onClick={() => myId ? onRemoveReaction(myId) : onAddReaction(emoji)}
                className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] border transition-all ${
                  myId
                    ? 'bg-indigo-50 border-indigo-300 dark:bg-indigo-900/30 dark:border-indigo-700'
                    : 'bg-[var(--bg-page)] border-[var(--border)] hover:border-[var(--accent)]'
                }`}
              >
                {emoji}
                <span className="text-[var(--text-muted)] ml-0.5">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover: add reaction button */}
      {isHovered && !isNudge && (
        <div className={`absolute top-0 ${isMine ? 'left-0 -translate-x-1' : 'right-0 translate-x-1'} z-10`}>
          <button
            onClick={onToggleReactionPicker}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-[var(--bg-card-solid)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shadow-sm transition-all"
            title="Add reaction"
          >
            <Smile size={11} />
          </button>

          {showReactionPicker && (
            <div className={`absolute top-7 ${isMine ? 'right-0' : 'left-0'} z-20`}>
              <EmojiPicker onSelect={onAddReaction} compact />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Typing dots ─────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-0.5">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
