'use client';

import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from 'react';
import type { EmailMessage } from '@/lib/gmail';
import type { Client } from './AllocateModal';
import { useModules } from '@/components/ui/ModulesProvider';

interface SelectedRecipient { name: string; email: string }
interface ReplyAllRecipients { to: SelectedRecipient[]; cc: SelectedRecipient[] }

/**
 * Snapshot of every field a user might have filled in. Captured on minimise,
 * restored when the compose window is reopened. Lives in memory only — a hard
 * page refresh discards it.
 */
export interface ComposeSnapshot {
  to:                 SelectedRecipient[];
  cc:                 SelectedRecipient[];
  bcc:                SelectedRecipient[];
  showCc:             boolean;
  showBcc:            boolean;
  subject:            string;
  bodyHtml:           string;
  attachedFiles:      File[];
  selectedClients:    Client[];
  createTaskEnabled:  boolean;
}

/** Context that defines what the compose window is for (reply, forward, fresh) */
export interface ComposeOpenContext {
  replyTo?:            EmailMessage | null;
  replyAllRecipients?: ReplyAllRecipients | null;
  forwardOf?:          EmailMessage | null;
  defaultClients?:     Client[] | null;
  defaultTo?:          { name: string; email: string }[] | null;
  prefilledBody?:      string | null;
  threadMessages?:     EmailMessage[] | null;
}

type Mode = 'closed' | 'open' | 'minimised';

interface ComposeWindowState {
  mode:        Mode;
  ctx:         ComposeOpenContext | null;
  snapshot:    ComposeSnapshot | null;
  /** Sender identity — fetched lazily the first time the user opens compose. */
  signature:   string | null;
  googleEmail: string;
  displayName: string;
}

interface ComposeWindowValue extends ComposeWindowState {
  /**
   * Open the compose window. If a minimised draft exists, the new args are
   * ignored and the existing draft is restored (one-draft-at-a-time policy).
   * Returns true if the new context was applied, false if a minimised draft
   * was restored instead.
   */
  open: (args?: ComposeOpenContext) => boolean;
  minimise: (snap: ComposeSnapshot) => void;
  restore: () => void;
  close:   (force?: boolean) => void;
  /** Optimistic update of identity (e.g. after the user changes their signature) */
  setIdentity: (patch: Partial<{ signature: string | null; googleEmail: string; displayName: string }>) => void;
  tasksModuleActive: boolean;
}

const ComposeWindowContext = createContext<ComposeWindowValue | null>(null);

export function useComposeWindow(): ComposeWindowValue {
  const ctx = useContext(ComposeWindowContext);
  if (!ctx) throw new Error('useComposeWindow must be used inside <ComposeWindowProvider>');
  return ctx;
}

interface ProviderProps { userName: string | null | undefined; children: ReactNode }

export default function ComposeWindowProvider({ userName, children }: ProviderProps) {
  const { isModuleActive } = useModules();
  const tasksModuleActive = isModuleActive('tasks');

  const [state, setState] = useState<ComposeWindowState>({
    mode:        'closed',
    ctx:         null,
    snapshot:    null,
    signature:   null,
    googleEmail: '',
    displayName: userName ?? '',
  });

  // Track whether we've fetched identity yet so we don't re-fetch on every open.
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const fetchIdentity = useCallback(async () => {
    if (identityLoaded) return;
    try {
      const [statusRes, sigRes] = await Promise.all([
        fetch('/api/email/status').catch(() => null),
        fetch('/api/email/signature').catch(() => null),
      ]);
      let googleEmail = '';
      let displayName = userName ?? '';
      let signature: string | null = null;
      if (statusRes?.ok) {
        const d = await statusRes.json() as { googleEmail?: string; displayName?: string };
        googleEmail = d.googleEmail ?? '';
        if (d.displayName) displayName = d.displayName;
      }
      if (sigRes?.ok) {
        const d = await sigRes.json() as { signature?: string | null };
        signature = d.signature ?? null;
      }
      setState(s => ({ ...s, googleEmail, displayName, signature }));
    } catch { /* identity is non-critical for opening the modal */ }
    finally { setIdentityLoaded(true); }
  }, [identityLoaded, userName]);

  const open = useCallback((args?: ComposeOpenContext): boolean => {
    fetchIdentity();
    let restored = false;
    setState(s => {
      // If a minimised draft exists, restore it and ignore the new args.
      // (The user can close it with X if they want to start fresh.)
      if (s.mode === 'minimised' && s.snapshot) {
        restored = true;
        return { ...s, mode: 'open' };
      }
      if (s.mode === 'open') return s;
      return { ...s, mode: 'open', ctx: args ?? null, snapshot: null };
    });
    return !restored;
  }, [fetchIdentity]);

  const minimise = useCallback((snap: ComposeSnapshot) => {
    setState(s => ({ ...s, mode: 'minimised', snapshot: snap }));
  }, []);

  const restore = useCallback(() => {
    setState(s => s.mode === 'minimised' ? { ...s, mode: 'open' } : s);
  }, []);

  const close = useCallback((force = false) => {
    setState(s => {
      if (!force && s.snapshot && hasContent(s.snapshot)) {
        if (typeof window !== 'undefined' && !window.confirm('Discard this draft?')) {
          return s;
        }
      }
      return { ...s, mode: 'closed', ctx: null, snapshot: null };
    });
  }, []);

  const setIdentity = useCallback((patch: Partial<{ signature: string | null; googleEmail: string; displayName: string }>) => {
    setState(s => ({ ...s, ...patch }));
  }, []);

  // Keep displayName fresh if userName prop changes (e.g. profile rename)
  useEffect(() => {
    setState(s => (userName && !s.displayName) ? { ...s, displayName: userName } : s);
  }, [userName]);

  return (
    <ComposeWindowContext.Provider value={{
      ...state,
      tasksModuleActive,
      open, minimise, restore, close, setIdentity,
    }}>
      {children}
    </ComposeWindowContext.Provider>
  );
}

function hasContent(snap: ComposeSnapshot): boolean {
  if (snap.to.length > 0 || snap.cc.length > 0 || snap.bcc.length > 0) return true;
  if (snap.subject.trim().length > 0) return true;
  if (snap.attachedFiles.length > 0) return true;
  // Body has user content if it contains anything other than the signature shell
  const stripped = snap.bodyHtml.replace(/<[^>]+>/g, '').trim();
  return stripped.length > 0;
}
