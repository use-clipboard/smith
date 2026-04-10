'use client';

import { useEffect, useState } from 'react';
import { UserPlus, Pencil, X, Check, KeyRound, Trash2, Loader2, ChevronDown } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';

interface TeamMember {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'staff';
  created_at: string;
}

interface EditState {
  full_name: string;
  email: string;
  role: 'admin' | 'staff';
}

interface MemberRowProps {
  member: TeamMember;
  isSelf: boolean;
  onUpdate: (id: string, data: Partial<EditState>) => Promise<string | null>;
  onRemove: (id: string, name: string) => Promise<void>;
  onResetPassword: (id: string, name: string) => Promise<void>;
}

function MemberRow({ member, isSelf, onUpdate, onRemove, onResetPassword }: MemberRowProps) {
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditState>({
    full_name: member.full_name ?? '',
    email: member.email,
    role: member.role,
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const err = await onUpdate(member.id, edit);
    setSaving(false);
    if (err) {
      setSaveError(err);
    } else {
      setEditing(false);
    }
  }

  async function handleReset() {
    setResetting(true);
    await onResetPassword(member.id, member.full_name || member.email);
    setResetting(false);
    setResetDone(true);
    setTimeout(() => setResetDone(false), 3000);
  }

  async function handleRemove() {
    setRemoving(true);
    await onRemove(member.id, member.full_name || member.email);
    setRemoving(false);
  }

  const displayName = member.full_name || member.email;

  return (
    <div className="glass-solid rounded-xl border border-[var(--border)] overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-4 p-4">
        <Avatar name={displayName} size={40} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {displayName}
            </p>
            {isSelf && <span className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-nav-hover)] px-1.5 py-0.5 rounded">you</span>}
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              member.role === 'admin'
                ? 'bg-[var(--accent-light)] text-[var(--accent)]'
                : 'bg-[var(--bg-nav-hover)] text-[var(--text-muted)]'
            }`}>
              {member.role === 'admin' ? 'Admin' : 'Staff'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{member.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setEditing(v => !v); setSaveError(null); }}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <Pencil size={12} />
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Inline edit panel */}
      {editing && (
        <div className="border-t border-[var(--border)] bg-[var(--bg-page)] p-4 space-y-4">
          <div className={`grid grid-cols-1 gap-3 ${isSelf ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Full Name</label>
              <input
                value={edit.full_name}
                onChange={e => setEdit(s => ({ ...s, full_name: e.target.value }))}
                placeholder="Full name"
                className="input-base w-full"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Email Address</label>
              <input
                type="email"
                value={edit.email}
                onChange={e => setEdit(s => ({ ...s, email: e.target.value }))}
                placeholder="Email address"
                className="input-base w-full"
              />
            </div>
            {!isSelf && (
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1 block">Role</label>
                <div className="relative">
                  <select
                    value={edit.role}
                    onChange={e => setEdit(s => ({ ...s, role: e.target.value as 'admin' | 'staff' }))}
                    className="input-base w-full appearance-none pr-8"
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          {saveError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/10 px-3 py-2 rounded-lg">{saveError}</p>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                disabled={resetting || resetDone}
                className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-50"
              >
                {resetting ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                {resetting ? 'Sending…' : resetDone ? 'Reset sent!' : 'Reset Password'}
              </button>
              {!isSelf && (
                <button
                  onClick={handleRemove}
                  disabled={removing}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  {removing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {removing ? 'Removing…' : 'Remove Member'}
                </button>
              )}
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-xs py-1.5 px-4 disabled:opacity-50"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  currentUserId: string;
}

export default function TeamTab({ currentUserId }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // Invite form
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'admin'>('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  async function loadMembers() {
    setLoading(true);
    const res = await fetch('/api/users');
    const data = await res.json();
    if (data.error) setLoadError(data.error);
    else setMembers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => { void loadMembers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteMsg(null);
    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, full_name: inviteName }),
    });
    const data = await res.json();
    setInviting(false);
    if (data.error) {
      setInviteMsg({ type: 'error', text: data.error });
    } else {
      setInviteMsg({ type: 'success', text: `Invite sent to ${inviteEmail}` });
      setInviteName(''); setInviteEmail(''); setInviteRole('staff');
      void loadMembers();
    }
  }

  async function handleUpdate(id: string, data: Partial<EditState>): Promise<string | null> {
    const res = await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (json.error) return json.error as string;
    setMembers(prev => prev.map(m => m.id === id ? {
      ...m,
      full_name: data.full_name !== undefined ? data.full_name : m.full_name,
      email: data.email ?? m.email,
      role: data.role ?? m.role,
    } : m));
    return null;
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`Remove ${name} from the firm? This cannot be undone.`)) return;
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (json.error) alert(json.error);
    else setMembers(prev => prev.filter(m => m.id !== id));
  }

  async function handleResetPassword(id: string, name: string) {
    if (!confirm(`Send a password reset email to ${name}?`)) return;
    const res = await fetch(`/api/users/${id}/reset-password`, { method: 'POST' });
    const json = await res.json();
    if (json.error) alert(`Failed to send reset email: ${json.error}`);
  }

  return (
    <div className="space-y-6">
      {/* Invite form */}
      <div className="glass-solid rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <UserPlus size={16} className="text-[var(--accent)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Invite a Team Member</h3>
        </div>
        <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Full name"
            value={inviteName}
            onChange={e => setInviteName(e.target.value)}
            className="input-base"
          />
          <input
            type="email"
            placeholder="Email address"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            required
            className="input-base"
          />
          <div className="relative">
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'admin' | 'staff')}
              className="input-base w-full appearance-none pr-8"
            >
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          </div>
          <button type="submit" disabled={inviting} className="btn-primary justify-center disabled:opacity-50">
            {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
        </form>
        {inviteMsg && (
          <p className={`text-sm ${inviteMsg.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {inviteMsg.text}
          </p>
        )}
      </div>

      {/* Team members */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--text-muted)] px-1">
          {loading ? 'Team Members' : `Team Members (${members.length})`}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : loadError ? (
          <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {members.map(m => (
              <MemberRow
                key={m.id}
                member={m}
                isSelf={m.id === currentUserId}
                onUpdate={handleUpdate}
                onRemove={handleRemove}
                onResetPassword={handleResetPassword}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
