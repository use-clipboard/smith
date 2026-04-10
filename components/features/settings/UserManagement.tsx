'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';

interface User {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'staff';
  created_at: string;
}

export default function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'staff' | 'admin'>('staff');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState('');
  const [inviteError, setInviteError] = useState('');

  async function loadUsers() {
    setLoading(true);
    const res = await fetch('/api/users');
    const data = await res.json();
    if (data.error) {
      setError(data.error);
    } else {
      setUsers(data.users);
    }
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError('');
    setInviteSuccess('');

    const res = await fetch('/api/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole, full_name: inviteName }),
    });
    const data = await res.json();

    setInviting(false);

    if (data.error) {
      setInviteError(data.error);
    } else {
      setInviteSuccess(`Invite sent to ${inviteEmail}`);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('staff');
      loadUsers();
    }
  }

  async function handleRoleChange(userId: string, role: 'admin' | 'staff') {
    await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
  }

  async function handleRemove(userId: string, email: string) {
    if (!confirm(`Remove ${email} from the firm? This cannot be undone.`)) return;
    await fetch(`/api/users/${userId}`, { method: 'DELETE' });
    setUsers(prev => prev.filter(u => u.id !== userId));
  }

  return (
    <div className="space-y-8">
      {/* Invite form */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Invite a team member</h3>
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
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value as 'admin' | 'staff')}
            className="input-base"
          >
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" disabled={inviting} className="btn-primary justify-center disabled:opacity-50">
            <UserPlus size={14} />
            {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </form>
        {inviteSuccess && (
          <p className="mt-2 text-sm text-green-600 dark:text-green-400">{inviteSuccess}</p>
        )}
        {inviteError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{inviteError}</p>
        )}
      </div>

      {/* Users table */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Current team</h3>
        {loading ? (
          <div className="text-sm text-[var(--text-muted)]">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        ) : (
          <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden">
            {users.map(u => (
              <div key={u.id} className="flex items-center justify-between px-4 py-3 bg-[var(--bg-card-solid)] hover:bg-[var(--bg-nav-hover)] transition-colors">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {u.full_name || u.email}
                    {u.id === currentUserId && (
                      <span className="ml-2 text-xs text-[var(--text-muted)]">(you)</span>
                    )}
                  </p>
                  {u.full_name && (
                    <p className="text-xs text-[var(--text-muted)]">{u.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <select
                    value={u.role}
                    disabled={u.id === currentUserId}
                    onChange={e => handleRoleChange(u.id, e.target.value as 'admin' | 'staff')}
                    className="text-xs border border-[var(--border-input)] rounded-lg px-2 py-1 bg-[var(--bg-input)] text-[var(--text-secondary)] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  >
                    <option value="staff">Staff</option>
                    <option value="admin">Admin</option>
                  </select>
                  {u.id !== currentUserId && (
                    <button
                      onClick={() => handleRemove(u.id, u.email)}
                      className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
