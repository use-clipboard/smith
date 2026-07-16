'use client';

import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from 'react';
import type { EmailMessage } from '@/lib/gmail';
import type { Client } from './AllocateModal';
import { useModules } from '@/components/ui/ModulesProvider';
import { DEFAULT_EMAIL_FONT } from '@/lib/emailFonts';

interface SelectedRecipient { name: string; email: string }
interface ReplyAllRecipients { to: SelectedRecipient[]; cc: SelectedRecipient[] }

/** A file too large to attach inline (>25 MB, or that would take the message
 *  over Gmail's 25 MB limit) that was uploaded to the firm's Google Drive
 *  instead — sent as a shareable link in the email body. */
export interface DriveAttachment { name: string; link: string; size: number; fileId: string }

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
  /** Font id for this email (lib/emailFonts.ts) — the firm default unless the
   *  sender overrode it from the toolbar. Held here so the choice survives a
   *  minimise/restore, which unmounts the editor. */
  bodyFont:           string;
  attachedFiles:      File[];
  driveAttachments:   DriveAttachment[];
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
  /** Pre-fill the Subject line on a fresh compose (ignored on reply/forward
   *  which derive subject from the source message). */
  defaultSubject?:     string | null;
  /** Pre-attach files to a fresh compose. Use this when something upstream
   *  already produced a PDF the user is expected to send as-is (e.g. the
   *  MTD IT approval pack). */
  defaultAttachments?: File[] | null;
  threadMessages?:     EmailMessage[] | null;
  /** Resume editing an existing Gmail draft. When set, the compose modal
   *  updates this draft on Save and deletes it after a successful Send. */
  defaultDraftId?:     string | null;
  /** Pre-fill BCC (used when opening a saved draft that had BCC recipients). */
  defaultBcc?:         { name: string; email: string }[] | null;
  /** Pre-fill the body HTML directly. Used when resuming a saved draft so we
   *  bypass the reply/forward body builders entirely. */
  defaultHtmlBody?:    string | null;
  /** Font the resumed draft was saved in, recovered from its wrapper by
   *  /api/email/draft. Null means "use the firm default". */
  defaultBodyFont?:    string | null;
}

type Mode = 'closed' | 'open' | 'minimised';

interface ComposeWindowState {
  mode:        Mode;
  ctx:         ComposeOpenContext | null;
  snapshot:    ComposeSnapshot | null;
  /** True during the 5s undo-send countdown: the window is minimised with its
   *  snapshot retained (so Undo can restore it), but the minimised chip is
   *  hidden and open() is ignored until the send resolves. */
  pendingSend: boolean;
  /** Sender identity — fetched lazily the first time the user opens compose. */
  signature:   string | null;
  googleEmail: string;
  displayName: string;
  /** The firm's default email font — the font every compose starts in. */
  firmFont:    string;
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
  setPendingSend: (v: boolean) => void;
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
    pendingSend: false,
    signature:   null,
    googleEmail: '',
    displayName: userName ?? '',
    firmFont:    DEFAULT_EMAIL_FONT,
  });

  // Track whether we've fetched identity yet so we don't re-fetch on every open.
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const fetchIdentity = useCallback(async () => {
    if (identityLoaded) return;
    try {
      const [statusRes, sigRes, fontRes] = await Promise.all([
        fetch('/api/email/status').catch(() => null),
        fetch('/api/email/signature').catch(() => null),
        fetch('/api/email/firm-settings').catch(() => null),
      ]);
      let googleEmail = '';
      let displayName = userName ?? '';
      let signature: string | null = null;
      let firmFont = DEFAULT_EMAIL_FONT;
      if (statusRes?.ok) {
        const d = await statusRes.json() as { googleEmail?: string; displayName?: string };
        googleEmail = d.googleEmail ?? '';
        if (d.displayName) displayName = d.displayName;
      }
      if (sigRes?.ok) {
        const d = await sigRes.json() as { signature?: string | null };
        signature = d.signature ?? null;
      }
      if (fontRes?.ok) {
        const d = await fontRes.json() as { settings?: { defaultFont?: string } };
        if (d.settings?.defaultFont) firmFont = d.settings.defaultFont;
      }
      setState(s => ({ ...s, googleEmail, displayName, signature, firmFont }));
    } catch { /* identity is non-critical for opening the modal */ }
    finally { setIdentityLoaded(true); }
  }, [identityLoaded, userName]);

  const open = useCallback((args?: ComposeOpenContext): boolean => {
    fetchIdentity();
    let restored = false;
    setState(s => {
      // A send countdown is running — its snapshot must stay untouched so
      // Undo can restore it. Ignore opens for these ~5 seconds.
      if (s.pendingSend) {
        restored = true;
        return s;
      }
      // If a minimised draft exists, restore it and ignore the new args.
      // (The user can close it with X if they want to start fresh.)
      if (s.mode === 'minimised' && s.snapshot) {
        restored = true;
        return { ...s, mode: 'open' };
      }
      // A window is already open with someone else's draft — leave it alone.
      // `restored` marks that the caller's args were NOT applied, so a caller
      // handing over an email it must not lose (an approval pack, say) can tell
      // the difference instead of assuming it loaded.
      if (s.mode === 'open') {
        restored = true;
        return s;
      }
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
      return { ...s, mode: 'closed', ctx: null, snapshot: null, pendingSend: false };
    });
  }, []);

  const setPendingSend = useCallback((v: boolean) => {
    setState(s => ({ ...s, pendingSend: v }));
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
      open, minimise, restore, close, setIdentity, setPendingSend,
    }}>
      {children}
    </ComposeWindowContext.Provider>
  );
}

function hasContent(snap: ComposeSnapshot): boolean {
  if (snap.to.length > 0 || snap.cc.length > 0 || snap.bcc.length > 0) return true;
  if (snap.subject.trim().length > 0) return true;
  if (snap.attachedFiles.length > 0) return true;
  if (snap.driveAttachments.length > 0) return true;
  // Body has user content if it contains anything other than the signature shell
  const stripped = snap.bodyHtml.replace(/<[^>]+>/g, '').trim();
  return stripped.length > 0;
}
