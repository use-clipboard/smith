'use client';

/**
 * useLandlordApprovalSend — drives sending property income computations for
 * client approval.
 *
 * Two paths:
 *
 *  • No Email Triage — the server sends each email via the preparer's Gmail and
 *    stamps sent_at itself. We just fire them off in turn.
 *
 *  • Email Triage on — we don't send: we prepare the approval + render the email
 *    and hand it to the in-app compose window, and the USER sends it. Two
 *    consequences drive everything below:
 *
 *      1. The compose window is a SINGLETON — compose.open() no-ops while a
 *         window is already open. So a per-individual send can't fire N windows
 *         at once; it has to be a queue, advancing only when the previous email
 *         has actually been sent ('smith:compose-sent').
 *      2. The user might close the draft instead of sending. So a row is only
 *         marked sent when that event fires — never on prepare. A prepared row
 *         reads "Not sent yet" until then.
 *
 *    Each person's row is created lazily, just before their compose window
 *    opens, so abandoning the queue doesn't leave phantom rows for people who
 *    were never actually emailed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { blobToBase64 } from '@/utils/pdfFromHtml';

export interface SendTarget {
  /** Undefined → the combined computation for the whole portfolio. */
  person?: { key: string; name: string };
  email: string;
}

interface Options {
  outputId: string | null;
  clientId: string | null;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  triageActive: boolean;
  buildPdf: (person?: { key: string; name: string }, onProgress?: (label: string) => void) => Promise<Blob>;
  summaryFor: (person?: { key: string; name: string }) => Array<{ label: string; value: string }>;
  /** Something changed server-side — refresh the approvals list. */
  onChanged: () => void;
}

export function useLandlordApprovalSend(opts: Options) {
  const compose = useComposeWindow();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  /** Set when a queue finishes or is abandoned, for a closing message. */
  const [result, setResult] = useState<{ sent: number; skipped: number } | null>(null);

  // Refs so the window-event listener never reads a stale closure.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const queueRef     = useRef<SendTarget[]>([]);
  const coverNoteRef = useRef<string | null>(null);
  const pendingIdRef = useRef<string | null>(null);   // approval row awaiting a real send
  const sentCountRef = useRef(0);

  /** Create the approval row + render the email. Returns the prepared payload. */
  const prepare = useCallback(async (t: SendTarget) => {
    const o = optsRef.current;
    if (!o.outputId) throw new Error('The analysis has not been saved yet.');
    const who = t.person?.name ?? o.clientName;
    setProgress(`Building ${who}’s report…`);
    const pdfBlob = await o.buildPdf(t.person, label => setProgress(`${who} — ${label}`));
    setProgress(`Preparing ${who}’s email…`);
    const pdfBase64 = await blobToBase64(pdfBlob);

    const res = await fetch(`/api/landlord/outputs/${o.outputId}/send-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_email: t.email,
        cover_note: coverNoteRef.current,
        pdf_base64: pdfBase64,
        person_key: t.person?.key ?? null,
        person_name: t.person?.name ?? null,
        summary_lines: o.summaryFor(t.person),
        prepare_only: o.triageActive,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Failed to send to ${t.email}`);
    return { j, pdfBlob };
  }, []);

  /** Prepare the next target and hand it to the compose window. */
  const pump = useCallback(async () => {
    const o = optsRef.current;
    const next = queueRef.current.shift();
    if (!next) {
      // Queue drained.
      setBusy(false);
      setProgress('');
      setResult({ sent: sentCountRef.current, skipped: 0 });
      o.onChanged();
      return;
    }
    try {
      const { j, pdfBlob } = await prepare(next);

      if (!o.triageActive) {
        // The server sent it and stamped sent_at.
        sentCountRef.current += 1;
        o.onChanged();
        await pump();
        return;
      }

      // Triage: hand to compose and wait for the real send.
      pendingIdRef.current = (j.approval_id as string) ?? null;
      const pdfFile = new File([pdfBlob], (j.attachment_filename as string) || 'property-income.pdf', { type: 'application/pdf' });
      const applied = compose.open({
        defaultTo: [{ name: next.person?.name ?? o.clientName, email: next.email }],
        defaultSubject: (j.subject as string) ?? '',
        prefilledBody: (j.html_body as string) ?? '',
        defaultAttachments: [pdfFile],
        defaultClients: o.clientId
          ? [{ id: o.clientId, name: o.clientName, client_ref: o.clientRef ?? '', contact_email: o.clientEmail, risk_rating: null }]
          : [],
      });
      if (!applied) {
        // A different draft was already open/minimised, so our email was NOT
        // loaded. Stop rather than silently dropping it.
        queueRef.current = [];
        pendingIdRef.current = null;
        setBusy(false);
        setProgress('');
        setError('You already have a draft open in the compose window. Send or discard it, then try again.');
        o.onChanged();
        return;
      }
      setProgress(queueRef.current.length > 0
        ? `Waiting for you to send — ${queueRef.current.length} more after this`
        : 'Waiting for you to send…');
      o.onChanged();   // show the "Not sent yet" row straight away
    } catch (e) {
      queueRef.current = [];
      pendingIdRef.current = null;
      setBusy(false);
      setProgress('');
      setError(e instanceof Error ? e.message : 'Failed to send');
      o.onChanged();
    }
  }, [compose, prepare]);

  // The compose window reports a REAL send. Mark the pending row sent, then
  // move on to the next person.
  useEffect(() => {
    function onComposeSent() {
      const id = pendingIdRef.current;
      if (!id) return;
      pendingIdRef.current = null;
      sentCountRef.current += 1;
      void fetch(`/api/landlord/approvals/${id}/mark-sent`, { method: 'POST' })
        .catch(() => { /* the row stays "Not sent yet" — the truth is recoverable by re-sending */ })
        .finally(() => {
          optsRef.current.onChanged();
          void pump();
        });
    }
    window.addEventListener('smith:compose-sent', onComposeSent);
    return () => window.removeEventListener('smith:compose-sent', onComposeSent);
  }, [pump]);

  // The user closed the compose window without sending — abandon the rest of the
  // queue rather than leaving them hanging. The prepared row stays as a draft.
  useEffect(() => {
    if (!busy || !pendingIdRef.current) return;
    if (compose.mode !== 'closed') return;
    const skipped = queueRef.current.length;
    queueRef.current = [];
    pendingIdRef.current = null;
    setBusy(false);
    setProgress('');
    setResult({ sent: sentCountRef.current, skipped });
    optsRef.current.onChanged();
  }, [compose.mode, busy]);

  /** Kick off a send. Targets are processed in order. */
  const start = useCallback((targets: SendTarget[], coverNote: string | null) => {
    if (targets.length === 0) return;
    setError('');
    setResult(null);
    queueRef.current = [...targets];
    coverNoteRef.current = coverNote;
    sentCountRef.current = 0;
    setBusy(true);
    void pump();
  }, [pump]);

  return { start, busy, progress, error, setError, result };
}
