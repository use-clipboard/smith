'use client';

/**
 * LandlordSendApprovalModal — choose WHO gets the computation for approval.
 *
 * This is only the form: the sending itself is driven by
 * useLandlordApprovalSend in the parent, because with Email Triage on the work
 * outlives this modal (the emails are handed to the compose window one at a
 * time and only count as sent once the user actually sends them).
 *
 * Two modes:
 *   combined    — one email to the client with the whole-portfolio computation.
 *   individual  — one email per owner, each with a report of only their share.
 */

import { useEffect, useState } from 'react';
import { X, Send, Mail, Users, FileText } from 'lucide-react';
import type { SendTarget } from './useLandlordApprovalSend';

export interface ApprovalPerson {
  key: string;
  name: string;
  clientId: string | null;
  email: string | null;
}

type Mode = 'combined' | 'individual';

interface Props {
  open: boolean;
  clientName: string;
  clientRef: string | null;
  clientEmail: string | null;
  /** The owners with a share of the portfolio — empty hides the per-individual option. */
  people: ApprovalPerson[];
  triageActive: boolean;
  onClose: () => void;
  onStart: (targets: SendTarget[], coverNote: string | null) => void;
}

export default function LandlordSendApprovalModal({
  open, clientName, clientRef, clientEmail, people, triageActive, onClose, onStart,
}: Props) {
  const [mode, setMode] = useState<Mode>('combined');
  const [recipient, setRecipient] = useState(clientEmail ?? '');
  /** Per-person recipient overrides, keyed by person key. */
  const [personEmails, setPersonEmails] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [coverNote, setCoverNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode('combined');
    setRecipient(clientEmail ?? '');
    setPersonEmails(Object.fromEntries(people.map(p => [p.key, p.email ?? ''])));
    setSelected(Object.fromEntries(people.map(p => [p.key, true])));
    setCoverNote(''); setError('');
  }, [open, clientEmail, people]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = people.filter(p => selected[p.key]);

  function submit() {
    setError('');
    const note = coverNote.trim() || null;
    if (mode === 'combined') {
      if (!recipient.trim()) { setError('Enter an email address to send to.'); return; }
      onStart([{ email: recipient.trim() }], note);
    } else {
      if (chosen.length === 0) { setError('Choose at least one person to send to.'); return; }
      const missing = chosen.filter(p => !(personEmails[p.key] ?? '').trim());
      if (missing.length > 0) { setError(`Add an email address for ${missing.map(p => p.name).join(', ')}.`); return; }
      onStart(chosen.map(p => ({ person: { key: p.key, name: p.name }, email: (personEmails[p.key] ?? '').trim() })), note);
    }
  }

  if (!open) return null;

  const canSendIndividual = people.length > 0;
  const multi = mode === 'individual' && chosen.length > 1;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><Send size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">Send for approval</h2>
            <p className="text-[11px] text-slate-500">{clientName}{clientRef ? ` (${clientRef})` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto scrollbar-thin">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('combined')}
              className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${mode === 'combined' ? 'border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500' : 'border-slate-200 hover:border-slate-300'}`}>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900"><FileText size={13} /> Combined report</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">One email to the client, whole portfolio.</span>
            </button>
            <button type="button" onClick={() => canSendIndividual && setMode('individual')} disabled={!canSendIndividual}
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
                    <input type="checkbox" checked={!!selected[p.key]}
                      onChange={e => setSelected(s => ({ ...s, [p.key]: e.target.checked }))}
                      aria-label={`Send to ${p.name}`} className="rounded shrink-0" />
                    <span className="text-xs font-medium text-slate-800 w-28 shrink-0 truncate">{p.name}</span>
                    <input type="email" value={personEmails[p.key] ?? ''} disabled={!selected[p.key]}
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
            {multi && <span className="text-[11px] text-slate-400 mt-1 block">The same note goes to everyone.</span>}
          </label>

          <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            <Mail size={13} className="shrink-0 mt-0.5" />
            {triageActive
              ? <span>
                  Each email opens in your compose window with the PDF attached and the client allocated{multi ? ', one person at a time — the next opens once you send the current one' : ''}.
                  {' '}Nothing is recorded as sent until you actually send it.
                </span>
              : <span>The email is sent from your connected Gmail with the PDF attached. Connect Email Triage to review it in a compose window first.</span>}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button onClick={submit} disabled={mode === 'combined' ? !recipient.trim() : chosen.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
            <Send size={14} />
            {triageActive
              ? (multi ? `Prepare ${chosen.length} emails` : 'Prepare email')
              : (multi ? `Send ${chosen.length} for approval` : 'Send for approval')}
          </button>
        </div>
      </div>
    </div>
  );
}
