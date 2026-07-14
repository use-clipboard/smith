'use client';

/**
 * LandlordSendApprovalModal — send the property income computation to the client
 * for approval. Mirrors the MTD IT flow: when Email Triage is on we prepare the
 * approval + rendered email server-side and hand it to the in-app compose window
 * (prefilled recipient, subject, body, client allocation and the PDF attached)
 * so the user sends from their own Gmail. Otherwise the server sends it directly.
 *
 * Two modes:
 *   combined    — one email to the client with the whole-portfolio computation.
 *   individual  — one email per owner, each with a report of only their share.
 */

import { useEffect, useState } from 'react';
import { X, Loader2, Send, Mail, Users, FileText, CheckCircle2 } from 'lucide-react';
import { useModules } from '@/components/ui/ModulesProvider';
import { useComposeWindow } from '@/components/features/email/ComposeWindowProvider';
import { blobToBase64 } from '@/utils/pdfFromHtml';

export interface ApprovalPerson {
  key: string;
  name: string;
  clientId: string | null;
  email: string | null;
}

type Mode = 'combined' | 'individual';

interface Props {
  open: boolean;
  outputId: string;
  clientId: string | null;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  /** The owners with a share of the portfolio — empty hides the per-individual option. */
  people: ApprovalPerson[];
  /** Summary lines for the email body. `person` undefined → the combined figures. */
  summaryFor: (person?: { key: string; name: string }) => Array<{ label: string; value: string }>;
  /** Builds the PDF. `person` undefined → the combined pack. */
  buildPdf: (person?: { key: string; name: string }) => Promise<Blob>;
  onClose: () => void;
  onSent: (info: { sent: number; via_compose: boolean }) => void;
}

export default function LandlordSendApprovalModal({
  open, outputId, clientId, clientName, clientRef, clientEmail, people, summaryFor, buildPdf, onClose, onSent,
}: Props) {
  const { isModuleActive } = useModules();
  const compose = useComposeWindow();
  const triageActive = isModuleActive('email-triage');

  const [mode, setMode] = useState<Mode>('combined');
  const [recipient, setRecipient] = useState(clientEmail ?? '');
  /** Per-person recipient overrides, keyed by person key. */
  const [personEmails, setPersonEmails] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [coverNote, setCoverNote] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('combined');
    setRecipient(clientEmail ?? '');
    setPersonEmails(Object.fromEntries(people.map(p => [p.key, p.email ?? ''])));
    setSelected(Object.fromEntries(people.map(p => [p.key, true])));
    setCoverNote(''); setError(''); setProgress('');
  }, [open, clientEmail, people]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !sending) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const chosen = people.filter(p => selected[p.key]);

  /** One send. Returns the compose payload when we're handing off to the compose window. */
  async function sendOne(person: { key: string; name: string } | undefined, to: string) {
    const pdfBlob = await buildPdf(person);
    const pdfBase64 = await blobToBase64(pdfBlob);

    const res = await fetch(`/api/landlord/outputs/${outputId}/send-approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient_email: to,
        cover_note: coverNote.trim() || null,
        pdf_base64: pdfBase64,
        person_key: person?.key ?? null,
        person_name: person?.name ?? null,
        summary_lines: summaryFor(person),
        // With Email Triage on, the server records the approval + renders the
        // email but doesn't send — the compose window does, from the user's Gmail.
        prepare_only: triageActive,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error ?? `Failed to send to ${to}`);

    if (triageActive) {
      const pdfFile = new File([pdfBlob], (j.attachment_filename as string) || 'property-income.pdf', { type: 'application/pdf' });
      compose.open({
        defaultTo: [{ name: person?.name ?? clientName, email: to }],
        defaultSubject: (j.subject as string) ?? '',
        prefilledBody: (j.html_body as string) ?? '',
        defaultAttachments: [pdfFile],
        defaultClients: clientId
          ? [{ id: clientId, name: clientName, client_ref: clientRef ?? '', contact_email: clientEmail, risk_rating: null }]
          : [],
      });
    }
  }

  async function send() {
    setError('');
    if (mode === 'combined') {
      if (!recipient.trim()) { setError('Enter an email address to send to.'); return; }
    } else {
      if (chosen.length === 0) { setError('Choose at least one person to send to.'); return; }
      const missing = chosen.filter(p => !(personEmails[p.key] ?? '').trim());
      if (missing.length > 0) { setError(`Add an email address for ${missing.map(p => p.name).join(', ')}.`); return; }
    }

    setSending(true);
    try {
      if (mode === 'combined') {
        await sendOne(undefined, recipient.trim());
        onSent({ sent: 1, via_compose: triageActive });
      } else {
        // Sequential: each send builds its own PDF, and the compose window opens
        // one per person — firing them at once would race the compose stack.
        let done = 0;
        for (const p of chosen) {
          setProgress(`${p.name} (${done + 1} of ${chosen.length})`);
          await sendOne({ key: p.key, name: p.name }, (personEmails[p.key] ?? '').trim());
          done++;
        }
        onSent({ sent: done, via_compose: triageActive });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send');
    } finally {
      setSending(false);
      setProgress('');
    }
  }

  if (!open) return null;

  const canSendIndividual = people.length > 0;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={!sending ? onClose : undefined}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Send size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Send for approval</h2>
            <p className="text-[11px] text-slate-500">{clientName}{clientRef ? ` (${clientRef})` : ''}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="text-slate-400 hover:text-slate-700 disabled:opacity-50"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto scrollbar-thin">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('combined')} disabled={sending}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-50 ${mode === 'combined' ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><FileText size={13} /> Combined report</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">One email to the client, whole portfolio.</span>
            </button>
            <button type="button" onClick={() => canSendIndividual && setMode('individual')} disabled={sending || !canSendIndividual}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-50 ${mode === 'individual' ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300'} ${!canSendIndividual ? 'cursor-not-allowed' : ''}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><Users size={13} /> Per individual</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                {canSendIndividual ? `${people.length} owner${people.length === 1 ? '' : 's'}, each sees only their share.` : 'No owners set up on the properties.'}
              </span>
            </button>
          </div>

          {mode === 'combined' ? (
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Send to</span>
              <input type="email" value={recipient} onChange={e => setRecipient(e.target.value)} placeholder="client@example.com"
                className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
              {!clientEmail && <span className="text-[11px] text-amber-600 mt-1 block">This client has no contact email saved — enter one above.</span>}
            </label>
          ) : (
            <div>
              <span className="text-[11px] font-medium text-slate-500">Send to each owner</span>
              <div className="mt-1 space-y-1.5">
                {people.map(p => (
                  <div key={p.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${selected[p.key] ? 'border-slate-200' : 'border-slate-100 bg-slate-50/60'}`}>
                    <input type="checkbox" checked={!!selected[p.key]} disabled={sending}
                      onChange={e => setSelected(s => ({ ...s, [p.key]: e.target.checked }))}
                      aria-label={`Send to ${p.name}`} className="rounded shrink-0" />
                    <span className="text-xs font-medium text-slate-800 w-28 shrink-0 truncate">{p.name}</span>
                    <input type="email" value={personEmails[p.key] ?? ''} disabled={sending || !selected[p.key]}
                      onChange={e => setPersonEmails(m => ({ ...m, [p.key]: e.target.value }))}
                      placeholder={p.clientId ? 'no contact email saved' : 'email address'}
                      className="flex-1 min-w-0 text-xs border border-slate-300 rounded-md px-2 py-1.5 disabled:bg-slate-50 disabled:text-slate-400" />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                Each person gets their own report and their own approval link — one approving doesn&rsquo;t approve for the others.
              </p>
            </div>
          )}

          <label className="block">
            <span className="text-[11px] font-medium text-slate-500">Cover note <span className="text-slate-400">(optional)</span></span>
            <textarea value={coverNote} onChange={e => setCoverNote(e.target.value)} rows={3}
              placeholder="A personal line to open the email — the firm's standard wording follows it."
              className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 resize-y" />
            {mode === 'individual' && chosen.length > 1 && <span className="text-[11px] text-slate-400 mt-1 block">The same note goes to everyone.</span>}
          </label>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Mail size={13} className="shrink-0 mt-0.5" />
            {triageActive
              ? <span>
                  {mode === 'individual' && chosen.length > 1
                    ? `${chosen.length} emails open in your compose window, one per person, each with their own PDF attached.`
                    : 'The email opens in your compose window with the PDF attached and the client allocated, so you can review it before sending from your own inbox.'}
                </span>
              : <span>The email is sent from your connected Gmail with the PDF attached. Connect Email Triage to review it in a compose window first.</span>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
          {sending && progress && <span className="text-[11px] text-slate-500 mr-auto flex items-center gap-1.5"><CheckCircle2 size={12} /> {progress}</span>}
          <button onClick={onClose} disabled={sending} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => void send()} disabled={sending || (mode === 'combined' ? !recipient.trim() : chosen.length === 0)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {sending ? 'Preparing…'
              : triageActive
                ? (mode === 'individual' && chosen.length > 1 ? `Prepare ${chosen.length} emails` : 'Prepare email')
                : (mode === 'individual' && chosen.length > 1 ? `Send ${chosen.length} for approval` : 'Send for approval')}
          </button>
        </div>
      </div>
    </div>
  );
}
