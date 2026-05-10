'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShieldAlert, Plus, Loader2, AlertTriangle, ChevronRight, EyeOff, Lock,
  Inbox, Send, ArrowLeft, Check, X, MessageSquare, Clock, Eye,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember } from './HrClient';
import FileDisclosureModal from './FileDisclosureModal';

interface Props {
  userId: string;
  team: TeamMember[];
}

export interface DisclosureRow {
  id: string;
  reporter_id: string;
  is_anonymous: boolean;
  recipient_id: string;
  recipient_role: 'manager' | 'other_manager' | 'confidential_recipient';
  category: 'harassment' | 'bullying' | 'discrimination' | 'safety' | 'financial_wrongdoing' | 'whistleblowing' | 'other';
  urgency: 'low' | 'medium' | 'high';
  body: string;
  status: 'submitted' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed_no_action';
  recipient_notes: string | null;
  resolution_summary: string | null;
  resolved_at: string | null;
  created_at: string;
  reporter: { id: string; full_name: string | null; email: string } | null;
  recipient: { id: string; full_name: string | null; email: string } | null;
}

const CATEGORY_LABELS: Record<DisclosureRow['category'], string> = {
  harassment: 'Harassment',
  bullying: 'Bullying',
  discrimination: 'Discrimination',
  safety: 'Health & safety',
  financial_wrongdoing: 'Financial wrongdoing',
  whistleblowing: 'Whistleblowing',
  other: 'Other',
};
const STATUS_LABELS: Record<DisclosureRow['status'], string> = {
  submitted: 'Submitted',
  acknowledged: 'Acknowledged',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed_no_action: 'Closed — no action',
};
const STATUS_BADGE: Record<DisclosureRow['status'], string> = {
  submitted: 'bg-blue-100 text-blue-700',
  acknowledged: 'bg-purple-100 text-purple-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed_no_action: 'bg-gray-100 text-gray-500',
};
const URGENCY_BADGE: Record<DisclosureRow['urgency'], string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function ConfidentialTab({ userId, team }: Props) {
  const [scope, setScope] = useState<'mine' | 'inbox'>('mine');
  const [list, setList] = useState<DisclosureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fileOpen, setFileOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/hr/disclosures?scope=${scope}`);
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to load');
      setList((await res.json()).disclosures ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { void load(); }, [load]);

  const inboxCount = useMemo(() => list.filter(d => scope === 'inbox' && d.status !== 'resolved' && d.status !== 'closed_no_action').length, [list, scope]);

  if (openId) {
    return <DisclosureDetail id={openId} userId={userId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <div className="space-y-4">
      {/* Trust banner */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-[var(--accent)] text-xs">
        <Lock size={14} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">Confidential channel</p>
          <p className="mt-0.5 opacity-90">Only the recipient you choose can see what you write. Firm admins do not get an override. Every recipient access is logged for transparency. Anonymous mode hides your name from the recipient.</p>
        </div>
      </div>

      {/* Scope toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="inline-flex bg-white border border-[var(--border)] rounded-full p-0.5 text-xs">
          <button
            onClick={() => setScope('mine')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${scope === 'mine' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >
            <Send size={12} />My disclosures
          </button>
          <button
            onClick={() => setScope('inbox')}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${scope === 'inbox' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}
          >
            <Inbox size={12} />Inbox
            {inboxCount > 0 && <span className="ml-1 text-[10px] font-bold bg-red-500 text-white rounded-full px-1.5 py-0.5">{inboxCount}</span>}
          </button>
        </div>
        <button onClick={() => setFileOpen(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus size={13} /> File a disclosure
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-[var(--border)]">
          <ShieldAlert size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">
            {scope === 'mine' ? 'You haven\'t filed any confidential disclosures.' : 'Nothing in your confidential inbox.'}
          </p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {list.map(d => (
            <button
              key={d.id}
              onClick={() => setOpenId(d.id)}
              className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_BADGE[d.status]}`}>
                    {STATUS_LABELS[d.status]}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${URGENCY_BADGE[d.urgency]}`}>
                    {d.urgency}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">{CATEGORY_LABELS[d.category]}</span>
                  <span className="text-[11px] text-gray-400">·</span>
                  <span className="text-[11px] text-[var(--text-muted)]">{timeAgo(d.created_at)}</span>
                </div>
                <p className="text-sm text-[var(--text-primary)] mt-1 line-clamp-1">{d.body}</p>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {scope === 'mine' ? (
                    <>
                      To <strong>{d.recipient?.full_name ?? d.recipient?.email ?? '—'}</strong>
                      {d.is_anonymous && <span className="ml-1.5 inline-flex items-center gap-1 text-purple-600"><EyeOff size={10} />Anonymous</span>}
                    </>
                  ) : (
                    <>
                      From{' '}
                      {d.is_anonymous
                        ? <span className="inline-flex items-center gap-1 text-purple-600"><EyeOff size={10} /><strong>Anonymous</strong></span>
                        : <strong>{d.reporter?.full_name ?? d.reporter?.email ?? '—'}</strong>}
                    </>
                  )}
                </p>
              </div>
              <ChevronRight size={14} className="text-gray-400 shrink-0" />
            </button>
          ))}
        </div>
      )}

      <FileDisclosureModal
        isOpen={fileOpen}
        onClose={() => setFileOpen(false)}
        onSaved={() => { setFileOpen(false); setScope('mine'); void load(); }}
        team={team}
        currentUserId={userId}
      />
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────
interface MessageRow {
  id: string;
  author_id: string;
  author_role: 'reporter' | 'recipient';
  body: string;
  created_at: string;
  author: { id: string; full_name: string | null; email: string } | null;
}
interface AuditRow {
  id: string;
  action: 'viewed' | 'status_changed' | 'message_sent' | 'recipient_changed';
  details: Record<string, unknown> | null;
  created_at: string;
  actor_id: string;
}

function DisclosureDetail({ id, userId, onBack }: { id: string; userId: string; onBack: () => void }) {
  const [d, setD] = useState<DisclosureRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [dRes, mRes] = await Promise.all([
        fetch(`/api/hr/disclosures/${id}`),
        fetch(`/api/hr/disclosures/${id}/messages`),
      ]);
      if (!dRes.ok) throw new Error((await dRes.json()).error ?? 'Failed to load');
      const dData = await dRes.json();
      setD(dData.disclosure);
      if (mRes.ok) setMessages((await mRes.json()).messages ?? []);

      // Audit (only the recipient really finds this useful to see, but reporters
      // also get to see it for transparency — both are RLS-permitted parties)
      const aRes = await fetch(`/api/hr/disclosures/${id}/audit`).catch(() => null);
      if (aRes?.ok) setAudit((await aRes.json()).audit ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (loading || !d) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)]"><ArrowLeft size={13} />Back</button>
        <div className="text-center py-10 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading…</div>
      </div>
    );
  }

  const isReporter = d.reporter_id === userId;
  const isRecipient = d.recipient_id === userId;

  async function send() {
    if (!newMessage.trim() || sending) return;
    setSending(true); setError(null);
    try {
      const res = await fetch(`/api/hr/disclosures/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: newMessage.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Send failed');
      setNewMessage('');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Send failed'); }
    finally { setSending(false); }
  }

  async function updateStatus(status: DisclosureRow['status']) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/hr/disclosures/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Update failed');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)]"><ArrowLeft size={13} />Back to list</button>

      <div className="bg-white border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_BADGE[d.status]}`}>{STATUS_LABELS[d.status]}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${URGENCY_BADGE[d.urgency]}`}>{d.urgency}</span>
            <span className="text-[11px] text-[var(--text-muted)]">{CATEGORY_LABELS[d.category]}</span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)]">Filed {timeAgo(d.created_at)}</span>
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">From</p>
          {d.is_anonymous && !isReporter ? (
            <div className="flex items-center gap-2 text-sm text-purple-700">
              <EyeOff size={14} />Anonymous reporter — identity withheld
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {d.reporter && (
                <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${avatarColour(d.reporter.id)}`}>
                  {initials(d.reporter.full_name, d.reporter.email)}
                </div>
              )}
              <span className="text-sm">{d.reporter?.full_name ?? d.reporter?.email ?? '—'}</span>
              {d.is_anonymous && isReporter && <span className="text-[10px] text-purple-600 inline-flex items-center gap-1"><EyeOff size={10} />Filed anonymously — recipient can&apos;t see your name</span>}
            </div>
          )}
        </div>

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Disclosure</p>
          <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">{d.body}</p>
        </div>

        {/* Recipient-only controls */}
        {isRecipient && (
          <div className="pt-3 border-t border-gray-100 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">Update status</p>
            <div className="flex flex-wrap gap-2">
              {(['acknowledged', 'in_progress', 'resolved', 'closed_no_action'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => void updateStatus(s)}
                  disabled={busy || d.status === s}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    d.status === s ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'bg-white border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'
                  } disabled:opacity-50`}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Resolution shared with reporter */}
        {d.resolution_summary && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">Resolution summary</p>
            <p className="text-sm text-emerald-900 whitespace-pre-wrap">{d.resolution_summary}</p>
          </div>
        )}

        {/* Recipient notes — visible only to the recipient */}
        {isRecipient && d.recipient_notes && (
          <div className="pt-3 border-t border-gray-100">
            <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1">Your private notes (recipient-only)</p>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{d.recipient_notes}</p>
          </div>
        )}
      </div>

      {/* Thread */}
      <div className="bg-white border border-[var(--border)] rounded-xl">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
          <MessageSquare size={14} className="text-[var(--text-muted)]" />
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Thread</p>
          <span className="text-[11px] text-[var(--text-muted)]">{messages.length} message{messages.length === 1 ? '' : 's'}</span>
        </div>
        <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic text-center py-6">No replies yet.</p>
          ) : (
            messages.map(m => {
              const isMine = m.author_id === userId;
              const showAnonymous = m.author_role === 'reporter' && d.is_anonymous && !isMine;
              return (
                <div key={m.id} className={`px-4 py-3 ${isMine ? 'bg-[var(--accent-light)]/30' : ''}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {showAnonymous ? (
                      <span className="inline-flex items-center gap-1 text-xs text-purple-700"><EyeOff size={11} />Anonymous reporter</span>
                    ) : m.author ? (
                      <>
                        <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white ${avatarColour(m.author.id)}`}>
                          {initials(m.author.full_name, m.author.email)}
                        </div>
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{m.author.full_name ?? m.author.email}</span>
                      </>
                    ) : <span className="text-xs">—</span>}
                    <span className="text-[10px] text-gray-400">· {timeAgo(m.created_at)}</span>
                  </div>
                  <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{m.body}</p>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-gray-100 p-3 flex items-end gap-2">
          <textarea
            value={newMessage}
            onChange={e => setNewMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            placeholder={isReporter && d.is_anonymous ? 'Reply (your messages stay anonymous to the recipient)' : 'Reply…'}
            className="input-base text-sm flex-1 resize-none"
          />
          <button onClick={() => void send()} disabled={!newMessage.trim() || sending} className="btn-primary disabled:opacity-50 inline-flex items-center gap-1.5">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}Send
          </button>
        </div>
      </div>

      {/* Audit log — visible to both parties for transparency */}
      {audit.length > 0 && (
        <div className="bg-white border border-[var(--border)] rounded-xl">
          <div className="px-4 py-2.5 border-b border-gray-100 flex items-center gap-2">
            <Eye size={14} className="text-[var(--text-muted)]" />
            <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">Activity log</p>
          </div>
          <div className="divide-y divide-gray-100">
            {audit.map(a => (
              <div key={a.id} className="px-4 py-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                <Clock size={11} className="text-gray-400" />
                <span className="text-gray-400">{timeAgo(a.created_at)}</span>
                <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700"><AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}</div>}
    </div>
  );
}
