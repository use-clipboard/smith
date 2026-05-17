'use client';

import ComposeModal from './ComposeModal';
import { useComposeWindow } from './ComposeWindowProvider';

/** Window-level event names other components can listen to. */
export const EMAIL_SENT_EVENT = 'smith:email-sent';

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
    rememberLocally('email-replied-ids', originalThreadId);
    notifySent({ threadId: originalThreadId, originalThreadId, kind: 'reply' });
  }
  function handleForwardSent(originalThreadId: string) {
    rememberLocally('email-forwarded-ids', originalThreadId);
    notifySent({ threadId: originalThreadId, originalThreadId, kind: 'forward' });
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
      initialSnapshot={cw.snapshot}
      replyTo={cw.ctx?.replyTo ?? null}
      replyAllRecipients={cw.ctx?.replyAllRecipients ?? null}
      forwardOf={cw.ctx?.forwardOf ?? null}
      defaultClients={cw.ctx?.defaultClients ?? null}
      defaultTo={cw.ctx?.defaultTo ?? null}
      prefilledBody={cw.ctx?.prefilledBody ?? null}
      defaultSubject={cw.ctx?.defaultSubject ?? null}
      defaultAttachments={cw.ctx?.defaultAttachments ?? null}
      threadMessages={cw.ctx?.threadMessages ?? null}
      signature={cw.signature}
      googleEmail={cw.googleEmail}
      displayName={cw.displayName}
      tasksModuleActive={cw.tasksModuleActive}
      onSent={handleSent}
      onReplySent={handleReplySent}
      onForwardSent={handleForwardSent}
      onCreateTaskFromSent={handleCreateTaskFromSent}
    />
  );
}

function rememberLocally(key: string, id: string) {
  try {
    const raw = localStorage.getItem(key);
    const arr: [string, string][] = raw ? JSON.parse(raw) : [];
    const map = new Map<string, string>(arr);
    map.set(id, new Date().toISOString());
    localStorage.setItem(key, JSON.stringify([...map]));
  } catch { /* ignore */ }
}

function notifySent(detail: SentDetail) {
  try {
    window.dispatchEvent(new CustomEvent<SentDetail>(EMAIL_SENT_EVENT, { detail }));
  } catch { /* ignore */ }
}
