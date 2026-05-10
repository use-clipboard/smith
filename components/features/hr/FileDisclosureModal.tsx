'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, AlertTriangle, ShieldAlert, EyeOff, Lock } from 'lucide-react';
import type { TeamMember } from './HrClient';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  team: TeamMember[];
  currentUserId: string;
}

type RecipientRole = 'manager' | 'other_manager' | 'confidential_recipient';
type Category = 'harassment' | 'bullying' | 'discrimination' | 'safety' | 'financial_wrongdoing' | 'whistleblowing' | 'other';
type Urgency = 'low' | 'medium' | 'high';

const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'harassment', label: 'Harassment (incl. sexual harassment)' },
  { id: 'bullying', label: 'Bullying' },
  { id: 'discrimination', label: 'Discrimination' },
  { id: 'safety', label: 'Health & safety concern' },
  { id: 'financial_wrongdoing', label: 'Financial wrongdoing / fraud' },
  { id: 'whistleblowing', label: 'Whistleblowing (public-interest disclosure)' },
  { id: 'other', label: 'Other' },
];

export default function FileDisclosureModal({ isOpen, onClose, onSaved, team, currentUserId }: Props) {
  const [recipientRole, setRecipientRole] = useState<RecipientRole>('confidential_recipient');
  const [otherManagerId, setOtherManagerId] = useState('');
  const [category, setCategory] = useState<Category>('harassment');
  const [urgency, setUrgency] = useState<Urgency>('medium');
  const [body, setBody] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confidentialRecipientId, setConfidentialRecipientId] = useState<string | null>(null);

  // List of "other managers" the user can route to: anyone who manages someone,
  // excluding the user themselves and (if set) their own manager.
  const me = team.find(m => m.id === currentUserId);
  const otherManagers = useMemo(() => {
    const managerIds = new Set(team.filter(m => m.manager_id).map(m => m.manager_id as string));
    return team.filter(m => managerIds.has(m.id) && m.id !== currentUserId && m.id !== me?.manager_id);
  }, [team, currentUserId, me?.manager_id]);

  useEffect(() => {
    if (!isOpen) return;
    setRecipientRole('confidential_recipient');
    setOtherManagerId(otherManagers[0]?.id ?? '');
    setCategory('harassment');
    setUrgency('medium');
    setBody('');
    setIsAnonymous(false);
    setError(null);
    // Look up whether confidential recipient is configured
    fetch('/api/hr/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => setConfidentialRecipientId(d?.settings?.confidential_recipient_user_id ?? null))
      .catch(() => {/* ignore */});
  }, [isOpen, otherManagers]);

  if (!isOpen) return null;

  async function handleSubmit() {
    setBusy(true); setError(null);
    try {
      const payload: Record<string, unknown> = {
        recipient_role: recipientRole,
        category, urgency, body, is_anonymous: isAnonymous,
      };
      if (recipientRole === 'other_manager') {
        if (!otherManagerId) { setError('Please pick a manager.'); setBusy(false); return; }
        payload.recipient_id = otherManagerId;
      }
      const res = await fetch('/api/hr/disclosures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to file');
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to file'); }
    finally { setBusy(false); }
  }

  const confidentialRecipient = confidentialRecipientId
    ? team.find(m => m.id === confidentialRecipientId)
    : null;
  const myManager = me?.manager_id ? team.find(m => m.id === me.manager_id) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={!busy ? onClose : undefined} />
      <div className="relative glass-solid rounded-xl shadow-2xl w-full max-w-2xl mx-4 p-6 border border-[var(--border)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-light)] flex items-center justify-center">
              <ShieldAlert size={18} className="text-[var(--accent)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold">File a confidential disclosure</h2>
              <p className="text-xs text-[var(--text-muted)]">Only your chosen recipient will see this.</p>
            </div>
          </div>
          {!busy && <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]"><X size={16} /></button>}
        </div>

        <div className="space-y-4">
          {/* Recipient choice */}
          <div>
            <label className="block text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Who should receive this?</label>
            <div className="space-y-2">
              <RecipientOption
                checked={recipientRole === 'confidential_recipient'}
                onSelect={() => setRecipientRole('confidential_recipient')}
                title="Confidential HR Recipient"
                subtitle={confidentialRecipient
                  ? `${confidentialRecipient.full_name ?? confidentialRecipient.email} — your firm's designated confidant.`
                  : 'Your firm has not designated a Confidential HR Recipient yet — ask an admin to set one in Settings → HR.'}
                disabled={!confidentialRecipient}
                recommended
              />
              <RecipientOption
                checked={recipientRole === 'manager'}
                onSelect={() => setRecipientRole('manager')}
                title="My direct manager"
                subtitle={myManager ? (myManager.full_name ?? myManager.email) : 'You don\'t have a manager assigned. Choose another option.'}
                disabled={!myManager}
              />
              <RecipientOption
                checked={recipientRole === 'other_manager'}
                onSelect={() => setRecipientRole('other_manager')}
                title="A different manager"
                subtitle="Pick any manager in the firm — useful if the issue involves your direct manager."
                disabled={otherManagers.length === 0}
              >
                {recipientRole === 'other_manager' && (
                  <select value={otherManagerId} onChange={e => setOtherManagerId(e.target.value)} className="input-base text-sm w-full mt-2">
                    {otherManagers.map(m => <option key={m.id} value={m.id}>{m.full_name ?? m.email}</option>)}
                  </select>
                )}
              </RecipientOption>
            </div>
          </div>

          {/* Category + urgency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Category</label>
              <select value={category} onChange={e => setCategory(e.target.value as Category)} className="input-base text-sm w-full">
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Urgency</label>
              <select value={urgency} onChange={e => setUrgency(e.target.value as Urgency)} className="input-base text-sm w-full">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High — needs prompt attention</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">What you want to share</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              placeholder="Be as specific as you feel comfortable. Include dates, locations, and people involved if you can — but anything you share is enough to get a conversation going."
              className="input-base text-sm w-full"
            />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Minimum 20 characters.</p>
          </div>

          {/* Anonymity */}
          <label className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-nav-hover)] border border-[var(--border)] cursor-pointer">
            <input type="checkbox" checked={isAnonymous} onChange={e => setIsAnonymous(e.target.checked)} className="mt-0.5 rounded" />
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] inline-flex items-center gap-1.5"><EyeOff size={13} />File anonymously</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">The recipient will see what you write but not your name. Replies in the thread also stay anonymous. You&apos;ll still see your own disclosure in &ldquo;My disclosures&rdquo; and receive notifications. Note: anonymity may limit how thoroughly an issue can be investigated.</p>
            </div>
          </label>

          {/* Safety footer */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
            <Lock size={13} className="shrink-0 mt-0.5" />
            <div>
              If you are in immediate danger, contact emergency services on <strong>999</strong>. For confidential support, the Samaritans are available on <strong>116 123</strong> any time. ACAS (0300 123 1100) gives free advice on workplace issues.
            </div>
          </div>

          {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}

          <div className="flex items-center justify-end gap-3">
            <button onClick={onClose} disabled={busy} className="btn-secondary">Cancel</button>
            <button onClick={() => void handleSubmit()} disabled={busy || body.trim().length < 20} className="btn-primary disabled:opacity-50">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldAlert size={13} />}File disclosure
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipientOption({
  checked, onSelect, title, subtitle, disabled, recommended, children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  disabled?: boolean;
  recommended?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <label
      className={`block p-3 rounded-xl border cursor-pointer transition-colors ${
        disabled ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
        : checked ? 'bg-[var(--accent-light)] border-[var(--accent)]/30'
        : 'bg-white border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'
      }`}
    >
      <div className="flex items-start gap-3">
        <input type="radio" checked={checked} onChange={onSelect} disabled={disabled} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
            {recommended && <span className="text-[9px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5">Recommended</span>}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">{subtitle}</p>
          {children}
        </div>
      </div>
    </label>
  );
}
