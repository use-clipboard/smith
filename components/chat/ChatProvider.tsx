'use client';

import {
  createContext, useContext, useState, useEffect,
  useCallback, useRef, ReactNode, useMemo,
} from 'react';
import { createClient } from '@/lib/supabase';
import type { TeamMember, ChatMessage, Conversation } from '@/types';

interface ChatContextType {
  teamMembers: TeamMember[];
  onlineUserIds: Set<string>;
  openConversationIds: string[];
  conversations: Record<string, Conversation>;
  messages: Record<string, ChatMessage[]>;
  unreadCounts: Record<string, number>;
  typingUsers: Record<string, string[]>;
  nudgedConversations: Set<string>;
  totalUnread: number;
  isPanelOpen: boolean;
  currentUserId: string;
  openConversationWith: (userId: string) => Promise<void>;
  closeConversation: (conversationId: string) => void;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
  sendNudge: (conversationId: string) => Promise<void>;
  addReaction: (messageId: string, emoji: string, conversationId: string) => Promise<void>;
  removeReaction: (reactionId: string, conversationId: string) => Promise<void>;
  markAsRead: (conversationId: string) => void;
  setTyping: (conversationId: string, isTyping: boolean) => void;
  clearNudge: (conversationId: string) => void;
  setIsPanelOpen: (open: boolean) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

interface ChatProviderProps {
  children: ReactNode;
  userId: string;
  firmId: string;
}

export function ChatProvider({ children, userId, firmId }: ChatProviderProps) {
  const supabase = useMemo(() => createClient(), []);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [openConversationIds, setOpenConversationIds] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, string[]>>({});
  const [nudgedConversations, setNudgedConversations] = useState<Set<string>>(new Set());
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messageChannels = useRef<Record<string, ReturnType<typeof supabase.channel>>>({});
  const typingTimeouts = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  // Load team members
  useEffect(() => {
    if (!userId) return;
    fetch('/api/users/team')
      .then(r => r.json())
      .then(data => { if (data.members) setTeamMembers(data.members); });
  }, [userId]);

  // Load existing conversations
  useEffect(() => {
    if (!userId) return;
    fetch('/api/messages')
      .then(r => r.json())
      .then(data => {
        if (!data.conversations) return;
        const convMap: Record<string, Conversation> = {};
        const unreadMap: Record<string, number> = {};
        data.conversations.forEach((c: Conversation & { unreadCount: number }) => {
          convMap[c.id] = c;
          unreadMap[c.id] = c.unreadCount || 0;
        });
        setConversations(convMap);
        setUnreadCounts(unreadMap);
      });
  }, [userId]);

  // Set up presence channel
  useEffect(() => {
    if (!firmId || !userId) return;

    const channel = supabase.channel(`presence:${firmId}`, {
      config: { presence: { key: userId } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<{ user_id: string }>();
        const ids = new Set(Object.values(state).flat().map(p => p.user_id));
        setOnlineUserIds(ids);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ user_id: userId });
        }
      });

    return () => { channel.unsubscribe(); };
  }, [firmId, userId, supabase]);

  // Subscribe to a conversation channel
  const subscribeToConversation = useCallback((conversationId: string) => {
    if (messageChannels.current[conversationId]) return;

    const channel = supabase
      .channel(`conv:${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'instant_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMsg = payload.new as ChatMessage;

          setMessages(prev => {
            const existing = prev[conversationId] || [];
            if (existing.some(m => m.id === newMsg.id)) return prev;
            return { ...prev, [conversationId]: [...existing, newMsg] };
          });

          if (newMsg.sender_id !== userId) {
            setOpenConversationIds(ids => {
              if (!ids.includes(conversationId)) {
                setUnreadCounts(prev => ({
                  ...prev,
                  [conversationId]: (prev[conversationId] || 0) + 1,
                }));
              }
              return ids;
            });

            if (newMsg.type === 'nudge') {
              setNudgedConversations(prev => new Set([...prev, conversationId]));
              setOpenConversationIds(prev =>
                prev.includes(conversationId) ? prev : [...prev, conversationId].slice(-3)
              );
            }
          }
        }
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const { user_id: tid, isTyping } = payload as { user_id: string; isTyping: boolean };
        if (tid === userId) return;
        setTypingUsers(prev => {
          const cur = prev[conversationId] || [];
          if (isTyping) {
            return cur.includes(tid) ? prev : { ...prev, [conversationId]: [...cur, tid] };
          }
          return { ...prev, [conversationId]: cur.filter(id => id !== tid) };
        });
      })
      .subscribe();

    messageChannels.current[conversationId] = channel;
  }, [supabase, userId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/messages/${conversationId}`);
    const data = await res.json();
    if (data.messages) {
      setMessages(prev => ({ ...prev, [conversationId]: data.messages }));
    }
  }, []);

  const openConversationWith = useCallback(async (targetUserId: string) => {
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ other_user_id: targetUserId }),
    });
    const data = await res.json();
    if (!data.conversation) return;

    const conv: Conversation = data.conversation;
    setConversations(prev => ({ ...prev, [conv.id]: conv }));
    subscribeToConversation(conv.id);
    await loadMessages(conv.id);
    setOpenConversationIds(prev =>
      prev.includes(conv.id) ? prev : [...prev, conv.id].slice(-3)
    );
    setIsPanelOpen(false);
  }, [subscribeToConversation, loadMessages]);

  const closeConversation = useCallback((conversationId: string) => {
    setOpenConversationIds(prev => prev.filter(id => id !== conversationId));
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string) => {
    const res = await fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, type: 'text' }),
    });
    const data = await res.json();
    // Optimistically add if realtime doesn't catch it fast enough
    if (data.message) {
      setMessages(prev => {
        const existing = prev[conversationId] || [];
        if (existing.some(m => m.id === data.message.id)) return prev;
        return { ...prev, [conversationId]: [...existing, data.message] };
      });
    }
  }, []);

  const sendNudge = useCallback(async (conversationId: string) => {
    await fetch(`/api/messages/${conversationId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '👋 Nudge!', type: 'nudge' }),
    });
  }, []);

  const addReaction = useCallback(async (messageId: string, emoji: string, conversationId: string) => {
    const res = await fetch(`/api/messages/${conversationId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: messageId, emoji }),
    });
    const data = await res.json();
    if (data.reaction) {
      setMessages(prev => ({
        ...prev,
        [conversationId]: (prev[conversationId] || []).map(msg =>
          msg.id === messageId
            ? { ...msg, reactions: [...(msg.reactions || []).filter(r => !(r.user_id === userId && r.emoji === emoji)), data.reaction] }
            : msg
        ),
      }));
    }
  }, [userId]);

  const removeReaction = useCallback(async (reactionId: string, conversationId: string) => {
    await fetch(`/api/messages/${conversationId}/reactions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reaction_id: reactionId }),
    });
    setMessages(prev => ({
      ...prev,
      [conversationId]: (prev[conversationId] || []).map(msg => ({
        ...msg,
        reactions: (msg.reactions || []).filter(r => r.id !== reactionId),
      })),
    }));
  }, []);

  const markAsRead = useCallback((conversationId: string) => {
    setUnreadCounts(prev => ({ ...prev, [conversationId]: 0 }));
    fetch(`/api/messages/${conversationId}/read`, { method: 'POST' }).catch(() => {});
  }, []);

  const setTyping = useCallback((conversationId: string, isTyping: boolean) => {
    const channel = messageChannels.current[conversationId];
    if (!channel) return;

    channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, isTyping } });

    if (isTyping) {
      clearTimeout(typingTimeouts.current[conversationId]);
      typingTimeouts.current[conversationId] = setTimeout(() => {
        channel.send({ type: 'broadcast', event: 'typing', payload: { user_id: userId, isTyping: false } });
      }, 3000);
    }
  }, [userId]);

  const clearNudge = useCallback((conversationId: string) => {
    setNudgedConversations(prev => {
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      Object.values(messageChannels.current).forEach(ch => ch.unsubscribe());
      Object.values(typingTimeouts.current).forEach(t => clearTimeout(t));
    };
  }, []);

  return (
    <ChatContext.Provider value={{
      teamMembers, onlineUserIds, openConversationIds, conversations,
      messages, unreadCounts, typingUsers, nudgedConversations,
      totalUnread, isPanelOpen, currentUserId: userId,
      openConversationWith, closeConversation, sendMessage, sendNudge,
      addReaction, removeReaction, markAsRead, setTyping, clearNudge,
      setIsPanelOpen,
    }}>
      {children}
    </ChatContext.Provider>
  );
}
