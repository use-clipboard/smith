'use client';

import ComposeModal from './ComposeModal';
import { useComposeWindow } from './ComposeWindowProvider';

/** Window-level event names other components can listen to. */
export const EMAIL_SENT_EVENT = 'smith:email-sent';
/** Fired when the user discards a draft from the compose window. */
export const EMAIL_DRAFT_DISCARDED_EVENT = 'smith:email-draft-discarded';
/** Fired when a brand-new draft is first auto-saved (enters the Drafts folder). */
export const EMAIL_DRAFT_CREATED_EVENT = 'smith:email-draft-created';

interface SentDetail {
  threadId:         string;
  originalThreadId: string | null;
  kind:             'fresh' | 'reply' | 'forward';
}

/**
 * Mounts <ComposeModal> at AppShell level and wires it into the
 * ComposeWindowProvider context, so the modal survives navigation.
 */
export default function GlobalComposeWindow() {
  const cw = useComposeWindow();

  function handleSent(threadId: string) {
    notifySent({ threadId, originalThreadId: null, kind: 'fresh' });
  }
  function handleReplySent(originalThreadId: string) {
    // Replied/forwarded status is now tracked per email (by RFC Message-ID) by
    // the triage page's EMAIL_SENT_EVENT handler and, definitively, by the
    // server's reply-chain analysis when the thread is next opened. We only
    // fire the event here — no thread-keyed localStorage (that flagged whole
    // conversations as replied when only one message was).
    notifySent({ threadId: originalThreadId, originalThreadId, kind: 'reply' });
  }
  function handleForwardSent(originalThreadId: string) {
    notifySent({ threadId: originalThreadId, originalThreadId, kind: 'forward' });
  }
  function handleDiscarded() {
    try {
      window.dispatchEvent(new CustomEvent(EMAIL_DRAFT_DISCARDED_EVENT));
    } catch { /* ignore */ }
  }
  function handleDraftCreated() {
    try {
      window.dispatchEvent(new CustomEvent(EMAIL_DRAFT_CREATED_EVENT));
    } catch { /* ignore */ }
  }
  function handleCreateTaskFromSent(data: { subject: string; plainBody: string; toEmail: string; toName: string }) {
    // The Create Task flow lives on the email page. If the user sent from
    // outside it, we fire an event the email page can pick up next mount,
    // and stash the payload in sessionStorage so it can be retrieved later.
    try {
      sessionStorage.setItem('smith:create-task-from-email', JSON.stringify(data));
    } catch { /* non-critical */ }
    window.dispatchEvent(new CustomEvent('smith:email-create-task', { detail: data }));
  }

  return (
    <ComposeModal
      open={cw.mode === 'open'}
      onClose={() => cw.close(true)}
      onMinimise={cw.minimise}
      onRestore={cw.restore}
      onPendingSendChange={cw.setPendingSend}
      initialSnapshot={cw.snapshot}
      replyTo={cw.ctx?.replyTo ?? null}
      replyAllRecipients={cw.ctx?.replyAllRecipients ?? null}
      forwardOf={cw.ctx?.forwardOf ?? null}
      defaultClients={cw.ctx?.defaultClients ?? null}
      defaultTo={cw.ctx?.defaultTo ?? null}
      prefilledBody={cw.ctx?.prefilledBody ?? null}
      defaultSubject={cw.ctx?.defaultSubject ?? null}
      defaultAttachments={cw.ctx?.defaultAttachments ?? null}
      defaultDraftId={cw.ctx?.defaultDraftId ?? null}
      defaultBcc={cw.ctx?.defaultBcc ?? null}
      defaultHtmlBody={cw.ctx?.defaultHtmlBody ?? null}
      threadMessages={cw.ctx?.threadMessages ?? null}
      signature={cw.signature}
      googleEmail={cw.googleEmail}
      displayName={cw.displayName}
      tasksModuleActive={cw.tasksModuleActive}
      onSent={handleSent}
      onReplySent={handleReplySent}
      onForwardSent={handleForwardSent}
      onCreateTaskFromSent={handleCreateTaskFromSent}
      onDiscarded={handleDiscarded}
      onDraftCreated={handleDraftCreated}
    />
  );
}

function notifySent(detail: SentDetail) {
  try {
    window.dispatchEvent(new CustomEvent<SentDetail>(EMAIL_SENT_EVENT, { detail }));
  } catch { /* ignore */ }
}
