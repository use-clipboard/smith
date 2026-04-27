'use client';

import { useState, useEffect } from 'react';
import { Shield, Check, Loader2, Users, Crown } from 'lucide-react';
import type { StaffHireAccessUser } from '@/types';

export default function StaffHireSettingsTab() {
  const [users, setUsers] = useState<StaffHireAccessUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // user_id being saved
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/staff-hire/access')
      .then(r => r.json())
      .then((data: { users: StaffHireAccessUser[] }) => setUsers(data.users ?? []))
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(userId: string, grant: boolean) {
    setSaving(userId);
    try {
      await fetch('/api/staff-hire/access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, grant }),
      });
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, has_access: grant } : u));
      setSaved(userId);
      setTimeout(() => setSaved(null), 2000);
    } catch {
      alert('Failed to update access');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Staff Hire Access</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Control which team members can access the Staff Hire tool. Admins always have access. Staff users must be explicitly granted access — this tool contains sensitive information such as salary data and applicant records.
            </p>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
          </div>
        )}

        {!loading && users.length === 0 && (
          <div className="text-center py-6">
            <Users size={20} className="text-[var(--text-muted)] mx-auto mb-2" />
            <p className="text-sm text-[var(--text-muted)]">No team members found.</p>
          </div>
        )}

        {!loading && users.length > 0 && (
          <div className="space-y-2">
            {users.map(user => {
              const isAdmin = user.role === 'admin';
              const isSaving = saving === user.user_id;
              const isSaved = saved === user.user_id;

              return (
                <div key={user.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-nav-hover)]">
                  {/* Avatar placeholder */}
                  <div className="w-8 h-8 rounded-full bg-[var(--accent-light)] flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-[var(--accent)]">
                      {(user.full_name || user.email || '?')[0].toUpperCase()}
                    </span>
                  </div>

                  {/* Name + role */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {user.full_name || user.email}
                      </p>
                      {isAdmin && (
                        <Crown size={11} className="text-amber-500 flex-shrink-0" aria-label="Admin" />
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">{user.email}</p>
                  </div>

                  {/* Access toggle */}
                  {isAdmin ? (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                      <Check size={13} />
                      Always on
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {isSaved && <span className="text-xs text-green-500">Saved!</span>}
                      {isSaving && <Loader2 size={14} className="animate-spin text-[var(--accent)]" />}
                      <button
                        onClick={() => handleToggle(user.user_id, !user.has_access)}
                        disabled={isSaving}
                        className={`relative w-10 h-5.5 rounded-full transition-colors ${user.has_access ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'} disabled:opacity-50`}
                        style={{ height: '1.375rem' }}
                        title={user.has_access ? 'Revoke access' : 'Grant access'}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${user.has_access ? 'left-5' : 'left-0.5'}`} />
                      </button>
                      <span className={`text-xs font-medium ${user.has_access ? 'text-green-600 dark:text-green-400' : 'text-[var(--text-muted)]'}`}>
                        {user.has_access ? 'Access granted' : 'No access'}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
