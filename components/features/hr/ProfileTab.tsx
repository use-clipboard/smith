'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronDown, ChevronRight, Loader2, Plus, Trash2, Edit3, Check, X, AlertTriangle,
  ShieldCheck, Phone, GraduationCap, MessageSquare, Star, Monitor, Clock, PoundSterling,
  LogOut, Cake, FileCheck2,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { initials, avatarColour } from '@/components/features/tasks/StepComments';
import type { TeamMember } from './HrClient';

interface Props {
  /** Profile being viewed. */
  userId: string;
  /** Person doing the viewing. */
  viewerId: string;
  viewerRole: 'admin' | 'staff';
  team: TeamMember[];
  /** Called whenever a section successfully saves a user-row field, so the
   *  parent can update its team-list state without a full refetch. */
  onMemberUpdated?: (member: Partial<TeamMember> & { id: string }) => void;
}

// Section wrapper ─────────────────────────────────────────────────────────
function Section({
  id, title, icon: Icon, defaultOpen, children,
}: { id: string; title: string; icon: React.ElementType; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="bg-white border border-[var(--border)] rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-nav-hover)] transition-colors"
      >
        {open ? <ChevronDown size={14} className="text-[var(--accent)]" /> : <ChevronRight size={14} className="text-gray-400" />}
        <Icon size={15} className="text-[var(--text-secondary)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1 text-left">{title}</h3>
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function MiniLoader() {
  return <div className="text-xs text-[var(--text-muted)] py-3"><Loader2 size={12} className="inline animate-spin mr-1.5" />Loading…</div>;
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-[var(--text-muted)] py-2 italic">{msg}</p>;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso + (iso.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Main tab ─────────────────────────────────────────────────────────────
export default function ProfileTab({ userId, viewerId, viewerRole, team, onMemberUpdated }: Props) {
  const subject = useMemo(() => team.find(m => m.id === userId), [team, userId]);
  const isSelf = userId === viewerId;
  const isAdmin = viewerRole === 'admin';
  const isManager = !!subject && subject.manager_id === viewerId;
  const canEdit = isSelf || isAdmin || isManager;

  if (!subject) return <Empty msg="Person not found." />;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white border border-[var(--border)] rounded-xl p-4 flex items-center gap-3">
        <div className={`h-12 w-12 rounded-full flex items-center justify-center text-sm font-bold text-white ${avatarColour(subject.id)}`}>
          {initials(subject.full_name, subject.email)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-[var(--text-primary)]">{subject.full_name ?? subject.email}</p>
          <p className="text-xs text-[var(--text-muted)]">{subject.job_title ?? '—'}{subject.employment_start_date ? ` · started ${fmtDate(subject.employment_start_date)}` : ''}</p>
        </div>
      </div>

      <BirthdaySection userId={userId} isSelf={isSelf} isAdmin={isAdmin} subject={subject} onMemberUpdated={onMemberUpdated} />
      {isAdmin && !isSelf && <EmploymentDatesSection userId={userId} subject={subject} onMemberUpdated={onMemberUpdated} />}
      <EmergencyContactsSection userId={userId} canEdit={canEdit} isSelf={isSelf} />
      <RightToWorkSection userId={userId} isAdmin={isAdmin} />
      <ProbationSection userId={userId} isAdmin={isAdmin} canEditDates={isAdmin || isManager} />
      <OnboardingSection userId={userId} canEdit={isAdmin || isManager} isSelf={isSelf} />
      <TrainingSection userId={userId} canEdit={canEdit} />
      <OneToOnesSection userId={userId} viewerId={viewerId} subject={subject} />
      <AppraisalsSection userId={userId} viewerId={viewerId} isAdmin={isAdmin} isManager={isManager} isSelf={isSelf} />
      <DseSection userId={userId} canEdit={canEdit} />
      <ToilSection userId={userId} canRecord={isAdmin || isManager} />
      {(isAdmin || isSelf) && <SalarySection userId={userId} isAdmin={isAdmin} isSelf={isSelf} />}
      <LeaverSection userId={userId} isAdmin={isAdmin} />
    </div>
  );
}

// ── Birthday & DOB ───────────────────────────────────────────────────────
// Self serve: edit your own DOB via /api/users/me/birthday.
// Admin: can edit anyone else's DOB via /api/hr/team/[id] (PATCH).
function BirthdaySection({
  userId, isSelf, isAdmin, subject, onMemberUpdated,
}: {
  userId: string;
  isSelf: boolean;
  isAdmin: boolean;
  subject: TeamMember;
  onMemberUpdated?: (member: Partial<TeamMember> & { id: string }) => void;
}) {
  const [dob, setDob] = useState<string>('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const canEdit = isSelf || isAdmin;

  useEffect(() => {
    if (isSelf) {
      fetch('/api/users/me/birthday')
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d) { setDob(d.date_of_birth ?? ''); setShow(!!d.show_birthday_to_team); } })
        .finally(() => setLoading(false));
    } else {
      // For admins viewing someone else, the subject row from the team list
      // already carries date_of_birth / show_birthday_to_team — no extra
      // fetch needed. Staff viewing a colleague never see this section.
      setDob(subject.date_of_birth ?? '');
      setShow(!!subject.show_birthday_to_team);
      setLoading(false);
    }
  }, [isSelf, subject.date_of_birth, subject.show_birthday_to_team]);

  const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      const endpoint = isSelf ? '/api/users/me/birthday' : `/api/hr/team/${userId}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_of_birth: dob || null, show_birthday_to_team: show }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error ?? body?.detail ?? `Save failed (${res.status})`;
        setError(typeof msg === 'string' ? msg : 'Save failed');
        return;
      }
      // For admin updates the server returns the refreshed member row; mirror
      // those values back into local state so what's on screen matches what
      // landed in the DB (date_of_birth normalises to YYYY-MM-DD). Also push
      // the row up so the parent's team list refreshes — keeps the profile
      // header, list and any other consumers in sync without a refresh.
      if (!isSelf) {
        const body = await res.json().catch(() => null);
        const m = body?.member as TeamMember | undefined;
        if (m) {
          setDob(m.date_of_birth ?? '');
          setShow(!!m.show_birthday_to_team);
          onMemberUpdated?.(m);
        }
      } else {
        // Self-serve endpoint doesn't return the row, but we know the user
        // id + which fields changed, so we can still propagate them.
        onMemberUpdated?.({ id: userId, date_of_birth: dob || null, show_birthday_to_team: show });
      }
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  // Staff viewing a colleague: hide the whole section (DOB is private unless
  // the owner opts in, and that opt-in is surfaced elsewhere — the Overview
  // tab's upcoming birthdays).
  if (!canEdit) return null;
  return (
    <Section id="dob" title="Birthday" icon={Cake} defaultOpen={isAdmin && !isSelf}>
      {loading ? <MiniLoader /> : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block mb-1 text-[var(--text-muted)]">Date of birth</span>
            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="input-base text-sm" />
          </label>
          <label className="text-xs flex items-center gap-2 mb-2">
            <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
            {isSelf ? 'Show my birthday to the team' : 'Show on the team birthday list'}
          </label>
          <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">
            {saving ? <Loader2 size={12} className="animate-spin inline" /> : 'Save'}
          </button>
          {savedAt && !saving && !error && (
            <span className="text-xs text-emerald-600 mb-2">Saved</span>
          )}
          {error && (
            <span className="text-xs text-rose-600 mb-2">{error}</span>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Employment start date (admin only) ───────────────────────────────────
// Lets an admin set / correct someone's work start date from the People view
// instead of re-running the joiner wizard. Service-anniversary calculations
// across the HR tool pick the new value up automatically on next load.
function EmploymentDatesSection({ userId, subject, onMemberUpdated }: {
  userId: string;
  subject: TeamMember;
  onMemberUpdated?: (member: Partial<TeamMember> & { id: string }) => void;
}) {
  const [startDate, setStartDate] = useState<string>(subject.employment_start_date ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setStartDate(subject.employment_start_date ?? ''); }, [subject.employment_start_date]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/team/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employment_start_date: startDate || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const msg = body?.error ?? body?.detail ?? `Save failed (${res.status})`;
        setError(typeof msg === 'string' ? msg : 'Save failed');
        return;
      }
      const body = await res.json().catch(() => null);
      const m = body?.member as TeamMember | undefined;
      if (m) {
        setStartDate(m.employment_start_date ?? '');
        onMemberUpdated?.(m);
      }
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  return (
    <Section id="employment-dates" title="Employment dates" icon={Clock} defaultOpen>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block mb-1 text-[var(--text-muted)]">Work start date</span>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-base text-sm" />
        </label>
        <button onClick={() => void save()} disabled={saving} className="btn-primary text-sm">
          {saving ? <Loader2 size={12} className="animate-spin inline" /> : 'Save'}
        </button>
        {savedAt && !saving && !error && (
          <span className="text-xs text-emerald-600 mb-2">Saved</span>
        )}
        {error && (
          <span className="text-xs text-rose-600 mb-2">{error}</span>
        )}
      </div>
    </Section>
  );
}

// ── Emergency contacts ───────────────────────────────────────────────────
interface EmergencyContact {
  id: string;
  user_id: string;
  name: string;
  relationship: string | null;
  phone: string;
  email: string | null;
  is_primary: boolean;
}

function EmergencyContactsSection({ userId, canEdit, isSelf }: { userId: string; canEdit: boolean; isSelf: boolean }) {
  const [list, setList] = useState<EmergencyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', email: '', is_primary: false });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/emergency-contacts?userId=${userId}`)
      .then(r => r.ok ? r.json() : { contacts: [] })
      .then(d => setList(d.contacts ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.name.trim() || !form.phone.trim()) return;
    await fetch('/api/hr/personnel/emergency-contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...form, relationship: form.relationship || null, email: form.email || null }),
    });
    setForm({ name: '', relationship: '', phone: '', email: '', is_primary: false });
    setAdding(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Remove this contact?')) return;
    await fetch(`/api/hr/personnel/emergency-contacts/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <Section id="emergency" title="Emergency contacts" icon={Phone}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg={isSelf ? 'No contacts yet — add one in case of emergency.' : 'No contacts on file.'} />}
          {list.map(c => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{c.name}{c.is_primary && <span className="ml-2 text-[10px] uppercase tracking-wide bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Primary</span>}</p>
                <p className="text-xs text-[var(--text-muted)]">{c.relationship ?? '—'} · {c.phone}{c.email ? ` · ${c.email}` : ''}</p>
              </div>
              {canEdit && (
                <button onClick={() => void remove(c.id)} className="text-red-600 hover:text-red-800"><Trash2 size={13} /></button>
              )}
            </div>
          ))}
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />Add contact</button>
          )}
          {canEdit && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input-base text-sm" />
                <input placeholder="Relationship (e.g. spouse)" value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} className="input-base text-sm" />
                <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="input-base text-sm" />
                <input placeholder="Email (optional)" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="input-base text-sm" />
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.is_primary} onChange={e => setForm({ ...form, is_primary: e.target.checked })} />Primary contact</label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Right to work ────────────────────────────────────────────────────────
interface RtwRow {
  id: string;
  document_type: string;
  document_reference: string | null;
  expiry_date: string | null;
  evidence_url: string | null;
  checked_at: string | null;
  notes: string | null;
}

function RightToWorkSection({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [row, setRow] = useState<RtwRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ document_type: 'passport', document_reference: '', expiry_date: '', evidence_url: '', notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/right-to-work?userId=${userId}`)
      .then(r => r.ok ? r.json() : { record: null })
      .then(d => {
        setRow(d.record ?? null);
        if (d.record) setForm({
          document_type: d.record.document_type,
          document_reference: d.record.document_reference ?? '',
          expiry_date: d.record.expiry_date ?? '',
          evidence_url: d.record.evidence_url ?? '',
          notes: d.record.notes ?? '',
        });
      })
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    await fetch('/api/hr/personnel/right-to-work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        document_type: form.document_type,
        document_reference: form.document_reference || null,
        expiry_date: form.expiry_date || null,
        evidence_url: form.evidence_url || null,
        notes: form.notes || null,
      }),
    });
    setEditing(false);
    load();
  }

  return (
    <Section id="rtw" title="Right to work" icon={FileCheck2}>
      {loading ? <MiniLoader /> : editing && isAdmin ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={form.document_type} onChange={e => setForm({ ...form, document_type: e.target.value })} className="input-base text-sm">
              <option value="passport">Passport</option>
              <option value="brp">Biometric Residence Permit</option>
              <option value="share_code">Share code</option>
              <option value="visa">Visa</option>
              <option value="other">Other</option>
            </select>
            <input placeholder="Document reference" value={form.document_reference} onChange={e => setForm({ ...form, document_reference: e.target.value })} className="input-base text-sm" />
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Expiry date</span>
              <input type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} className="input-base text-sm w-full" />
            </label>
            <input placeholder="Evidence URL (Drive link)" value={form.evidence_url} onChange={e => setForm({ ...form, evidence_url: e.target.value })} className="input-base text-sm" />
          </div>
          <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="input-base text-sm w-full" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={() => void save()} className="btn-primary text-sm">Save</button>
          </div>
        </div>
      ) : row ? (
        <div className="space-y-1.5 text-sm">
          <p><span className="text-[var(--text-muted)]">Document:</span> {row.document_type}{row.document_reference ? ` · ${row.document_reference}` : ''}</p>
          <p><span className="text-[var(--text-muted)]">Expires:</span> {fmtDate(row.expiry_date)}</p>
          {row.checked_at && <p className="text-xs text-[var(--text-muted)]">Last checked {fmtDate(row.checked_at)}</p>}
          {row.evidence_url && <a href={row.evidence_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--accent)] hover:underline">View evidence</a>}
          {isAdmin && <button onClick={() => setEditing(true)} className="btn-secondary text-xs mt-2"><Edit3 size={11} className="inline mr-1" />Update</button>}
        </div>
      ) : (
        <div>
          <Empty msg="No right-to-work record on file." />
          {isAdmin && <button onClick={() => setEditing(true)} className="btn-primary text-xs"><Plus size={11} className="inline mr-1" />Record</button>}
        </div>
      )}
    </Section>
  );
}

// ── Probation ────────────────────────────────────────────────────────────
interface ProbationRow {
  id: string;
  start_date: string;
  end_date: string;
  status: 'active' | 'passed' | 'failed' | 'extended' | 'cancelled';
  outcome_notes: string | null;
}

function ProbationSection({ userId, isAdmin, canEditDates }: { userId: string; isAdmin: boolean; canEditDates: boolean }) {
  const [row, setRow] = useState<ProbationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ start_date: '', end_date: '', status: 'active', outcome_notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/probation?userId=${userId}`)
      .then(r => r.ok ? r.json() : { record: null })
      .then(d => {
        setRow(d.record ?? null);
        if (d.record) setForm({
          start_date: d.record.start_date,
          end_date: d.record.end_date,
          status: d.record.status,
          outcome_notes: d.record.outcome_notes ?? '',
        });
      })
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    await fetch('/api/hr/personnel/probation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        start_date: form.start_date,
        end_date: form.end_date,
        status: form.status,
        outcome_notes: form.outcome_notes || null,
      }),
    });
    setEditing(false);
    load();
  }

  const STATUS_BADGE: Record<ProbationRow['status'], string> = {
    active: 'bg-amber-100 text-amber-700',
    passed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-red-100 text-red-700',
    extended: 'bg-sky-100 text-sky-700',
    cancelled: 'bg-gray-100 text-gray-500',
  };

  return (
    <Section id="probation" title="Probation" icon={ShieldCheck}>
      {loading ? <MiniLoader /> : editing && canEditDates ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Start</span>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">End</span>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Status</span>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="input-base text-sm w-full">
                <option value="active">Active</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
                <option value="extended">Extended</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>
          <textarea placeholder="Outcome notes" value={form.outcome_notes} onChange={e => setForm({ ...form, outcome_notes: e.target.value })} rows={2} className="input-base text-sm w-full" />
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={() => void save()} className="btn-primary text-sm">Save</button>
          </div>
        </div>
      ) : row ? (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded ${STATUS_BADGE[row.status]}`}>{row.status}</span>
            <span>{fmtDate(row.start_date)} – {fmtDate(row.end_date)}</span>
          </div>
          {row.outcome_notes && <p className="text-xs text-[var(--text-muted)] italic">{row.outcome_notes}</p>}
          {canEditDates && <button onClick={() => setEditing(true)} className="btn-secondary text-xs mt-2"><Edit3 size={11} className="inline mr-1" />Update</button>}
        </div>
      ) : (
        <div>
          <Empty msg="No probation period on file." />
          {canEditDates && <button onClick={() => setEditing(true)} className="btn-primary text-xs"><Plus size={11} className="inline mr-1" />Add</button>}
        </div>
      )}
    </Section>
  );
}

// ── Onboarding ───────────────────────────────────────────────────────────
interface OnboardingItem {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: 'pending' | 'done' | 'skipped' | 'na';
  done_by: string | null;
  done_at: string | null;
  display_order: number;
}

function OnboardingSection({ userId, canEdit, isSelf }: { userId: string; canEdit: boolean; isSelf: boolean }) {
  const [list, setList] = useState<OnboardingItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/onboarding/items?userId=${userId}`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then(d => setList(d.items ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function applyTemplate() {
    if (!confirm('Apply the firm onboarding template to this person? Existing items are kept.')) return;
    await fetch('/api/hr/onboarding/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'apply_template', user_id: userId }),
    });
    load();
  }

  async function setStatus(id: string, status: OnboardingItem['status']) {
    await fetch(`/api/hr/onboarding/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  }

  const total = list.length;
  const done = list.filter(i => i.status === 'done' || i.status === 'na' || i.status === 'skipped').length;

  return (
    <Section id="onboarding" title={`Onboarding${total ? ` · ${done}/${total}` : ''}`} icon={Check}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg="No onboarding items yet." />}
          {list.map(item => (
            <div key={item.id} className="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
              <input
                type="checkbox"
                disabled={!isSelf && !canEdit}
                checked={item.status === 'done'}
                onChange={e => void setStatus(item.id, e.target.checked ? 'done' : 'pending')}
                className="mt-1"
              />
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.status === 'done' ? 'line-through text-[var(--text-muted)]' : ''}`}>{item.title}</p>
                {item.description && <p className="text-xs text-[var(--text-muted)]">{item.description}</p>}
                {item.due_date && <p className="text-[10px] text-[var(--text-muted)]">Due {fmtDate(item.due_date)}</p>}
              </div>
              {canEdit && (
                <select value={item.status} onChange={e => void setStatus(item.id, e.target.value as OnboardingItem['status'])} className="input-base text-xs h-7">
                  <option value="pending">Pending</option>
                  <option value="done">Done</option>
                  <option value="skipped">Skipped</option>
                  <option value="na">N/A</option>
                </select>
              )}
            </div>
          ))}
          {canEdit && (
            <button onClick={() => void applyTemplate()} className="btn-secondary text-xs mt-1">
              <Plus size={11} className="inline mr-1" />Apply firm template
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Training & CPD ───────────────────────────────────────────────────────
interface TrainingRow {
  id: string;
  title: string;
  provider: string | null;
  hours: number;
  date_completed: string;
  cpd_year: number | null;
  certificate_url: string | null;
}

function TrainingSection({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const [list, setList] = useState<TrainingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', provider: '', hours: '0', date_completed: '', cpd_year: String(new Date().getFullYear()), certificate_url: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/training?userId=${userId}`)
      .then(r => r.ok ? r.json() : { records: [] })
      .then(d => setList(d.records ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const yearTotals = useMemo(() => {
    const m = new Map<number, number>();
    list.forEach(r => { if (r.cpd_year != null) m.set(r.cpd_year, (m.get(r.cpd_year) ?? 0) + Number(r.hours)); });
    return Array.from(m.entries()).sort((a, b) => b[0] - a[0]);
  }, [list]);

  async function add() {
    if (!form.title.trim() || !form.date_completed) return;
    await fetch('/api/hr/personnel/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        title: form.title,
        provider: form.provider || null,
        hours: Number(form.hours),
        date_completed: form.date_completed,
        cpd_year: form.cpd_year ? Number(form.cpd_year) : null,
        certificate_url: form.certificate_url || null,
      }),
    });
    setForm({ title: '', provider: '', hours: '0', date_completed: '', cpd_year: String(new Date().getFullYear()), certificate_url: '' });
    setAdding(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Delete this record?')) return;
    await fetch(`/api/hr/personnel/training/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <Section id="training" title="Training & CPD" icon={GraduationCap}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {yearTotals.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-1">
              {yearTotals.map(([year, hours]) => (
                <span key={year} className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-0.5">
                  {year}: <strong>{hours.toFixed(1)}h</strong>
                </span>
              ))}
            </div>
          )}
          {list.length === 0 && <Empty msg="No training recorded yet." />}
          {list.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {r.provider ? `${r.provider} · ` : ''}{Number(r.hours).toFixed(1)}h · {fmtDate(r.date_completed)}{r.cpd_year ? ` · CPD ${r.cpd_year}` : ''}
                </p>
                {r.certificate_url && <a href={r.certificate_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--accent)] hover:underline">Certificate</a>}
              </div>
              {canEdit && <button onClick={() => void remove(r.id)} className="text-red-600 hover:text-red-800"><Trash2 size={13} /></button>}
            </div>
          ))}
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />Add training record</button>
          )}
          {canEdit && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input placeholder="Title (e.g. ICAEW VAT update)" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="input-base text-sm col-span-2" />
                <input placeholder="Provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value })} className="input-base text-sm" />
                <input type="number" step="0.25" placeholder="Hours" value={form.hours} onChange={e => setForm({ ...form, hours: e.target.value })} className="input-base text-sm" />
                <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Date</span>
                  <input type="date" value={form.date_completed} onChange={e => setForm({ ...form, date_completed: e.target.value })} className="input-base text-sm w-full" />
                </label>
                <input type="number" placeholder="CPD year" value={form.cpd_year} onChange={e => setForm({ ...form, cpd_year: e.target.value })} className="input-base text-sm" />
                <input placeholder="Certificate URL" value={form.certificate_url} onChange={e => setForm({ ...form, certificate_url: e.target.value })} className="input-base text-sm col-span-2" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── 1:1s ─────────────────────────────────────────────────────────────────
interface OneToOneRow {
  id: string;
  staff_user_id: string;
  manager_user_id: string;
  meeting_date: string;
  notes: string | null;
  action_items: string | null;
  staff: { id: string; full_name: string | null; email: string } | null;
  manager: { id: string; full_name: string | null; email: string } | null;
}

function OneToOnesSection({ userId, viewerId, subject }: { userId: string; viewerId: string; subject: TeamMember }) {
  const [list, setList] = useState<OneToOneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ meeting_date: '', notes: '', action_items: '' });

  // Default pair: subject + their manager. Viewer can only see if they are a party.
  const managerId = subject.manager_id;
  const isViewerInPair = viewerId === userId || (managerId != null && viewerId === managerId);

  const load = useCallback(() => {
    if (!managerId) { setList([]); setLoading(false); return; }
    setLoading(true);
    fetch(`/api/hr/personnel/one-to-ones?staffUserId=${userId}&managerUserId=${managerId}`)
      .then(r => r.ok ? r.json() : { records: [] })
      .then(d => setList(d.records ?? []))
      .finally(() => setLoading(false));
  }, [userId, managerId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!managerId || !form.meeting_date) return;
    await fetch('/api/hr/personnel/one-to-ones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        staff_user_id: userId,
        manager_user_id: managerId,
        meeting_date: form.meeting_date,
        notes: form.notes || null,
        action_items: form.action_items || null,
      }),
    });
    setForm({ meeting_date: '', notes: '', action_items: '' });
    setAdding(false);
    load();
  }

  if (!managerId) {
    return (
      <Section id="one-to-ones" title="1:1 meetings" icon={MessageSquare}>
        <Empty msg="Set a line manager to start logging 1:1s." />
      </Section>
    );
  }

  return (
    <Section id="one-to-ones" title="1:1 meetings" icon={MessageSquare}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg="No 1:1s logged yet." />}
          {list.map(r => (
            <div key={r.id} className="p-2.5 rounded-lg bg-gray-50">
              <p className="text-xs text-[var(--text-muted)]">{fmtDate(r.meeting_date)} · {r.manager?.full_name ?? r.manager?.email} ↔ {r.staff?.full_name ?? r.staff?.email}</p>
              {r.notes && <p className="text-sm mt-1 whitespace-pre-wrap">{r.notes}</p>}
              {r.action_items && (
                <div className="mt-1.5 text-xs">
                  <span className="font-semibold text-[var(--text-muted)]">Actions: </span>
                  <span className="whitespace-pre-wrap">{r.action_items}</span>
                </div>
              )}
            </div>
          ))}
          {isViewerInPair && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />Log a 1:1</button>
          )}
          {isViewerInPair && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Meeting date</span>
                <input type="date" value={form.meeting_date} onChange={e => setForm({ ...form, meeting_date: e.target.value })} className="input-base text-sm" />
              </label>
              <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} className="input-base text-sm w-full" />
              <textarea placeholder="Action items" value={form.action_items} onChange={e => setForm({ ...form, action_items: e.target.value })} rows={2} className="input-base text-sm w-full" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Appraisals ───────────────────────────────────────────────────────────
interface AppraisalRow {
  id: string;
  user_id: string;
  reviewer_id: string;
  review_period_start: string;
  review_period_end: string;
  rating: 'exceeds' | 'meets' | 'developing' | 'below' | null;
  strengths: string | null;
  improvements: string | null;
  goals: string | null;
  status: 'draft' | 'submitted' | 'acknowledged';
  submitted_at: string | null;
  acknowledged_at: string | null;
}

const RATING_BADGE: Record<NonNullable<AppraisalRow['rating']>, string> = {
  exceeds: 'bg-emerald-100 text-emerald-700',
  meets: 'bg-sky-100 text-sky-700',
  developing: 'bg-amber-100 text-amber-700',
  below: 'bg-red-100 text-red-700',
};

function AppraisalsSection({ userId, viewerId, isAdmin, isManager, isSelf }: {
  userId: string; viewerId: string; isAdmin: boolean; isManager: boolean; isSelf: boolean;
}) {
  const [list, setList] = useState<AppraisalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/appraisals?userId=${userId}`)
      .then(r => r.ok ? r.json() : { records: [] })
      .then(d => setList(d.records ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function transition(id: string, action: 'submit' | 'acknowledge') {
    await fetch(`/api/hr/personnel/appraisals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: action === 'submit' ? 'submitted' : 'acknowledged' }),
    });
    load();
  }

  return (
    <Section id="appraisals" title="Performance reviews" icon={Star}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg="No appraisals yet." />}
          {list.map(r => (
            <div key={r.id} className="p-3 rounded-lg bg-gray-50 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{fmtDate(r.review_period_start)} – {fmtDate(r.review_period_end)}</span>
                {r.rating && <span className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded ${RATING_BADGE[r.rating]}`}>{r.rating}</span>}
                <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-gray-200 text-gray-700">{r.status}</span>
              </div>
              {r.strengths && <p className="text-xs"><span className="font-semibold text-[var(--text-muted)]">Strengths: </span>{r.strengths}</p>}
              {r.improvements && <p className="text-xs"><span className="font-semibold text-[var(--text-muted)]">Improvements: </span>{r.improvements}</p>}
              {r.goals && <p className="text-xs"><span className="font-semibold text-[var(--text-muted)]">Goals: </span>{r.goals}</p>}
              <div className="flex gap-2 pt-1">
                {r.status === 'draft' && (viewerId === r.reviewer_id || isAdmin) && (
                  <button onClick={() => void transition(r.id, 'submit')} className="btn-secondary text-xs">Submit to {isSelf ? 'me' : 'subject'}</button>
                )}
                {r.status === 'submitted' && isSelf && (
                  <button onClick={() => void transition(r.id, 'acknowledge')} className="btn-primary text-xs"><Check size={11} className="inline mr-1" />Acknowledge</button>
                )}
              </div>
            </div>
          ))}
          {(isAdmin || isManager) && (
            <p className="text-[11px] text-[var(--text-muted)]">Use the Team Profiles tab to start a new appraisal as reviewer.</p>
          )}
        </div>
      )}
    </Section>
  );
}

// ── DSE ──────────────────────────────────────────────────────────────────
interface DseRow {
  id: string;
  assessment_date: string;
  recommendations: string | null;
  next_review_date: string | null;
  responses: Record<string, unknown>;
}

function DseSection({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const [list, setList] = useState<DseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    chair_adjustable: 'yes', screen_at_eye_level: 'yes', glare_free: 'yes',
    keyboard_separate: 'yes', breaks_taken: 'yes', issues: '',
    recommendations: '', next_review_date: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/dse?userId=${userId}`)
      .then(r => r.ok ? r.json() : { records: [] })
      .then(d => setList(d.records ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const responses = {
      chair_adjustable: form.chair_adjustable, screen_at_eye_level: form.screen_at_eye_level,
      glare_free: form.glare_free, keyboard_separate: form.keyboard_separate,
      breaks_taken: form.breaks_taken, issues: form.issues,
    };
    await fetch('/api/hr/personnel/dse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        assessment_date: new Date().toISOString().slice(0, 10),
        responses,
        recommendations: form.recommendations || null,
        next_review_date: form.next_review_date || null,
      }),
    });
    setAdding(false);
    load();
  }

  return (
    <Section id="dse" title="DSE assessment" icon={Monitor}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg="No DSE assessment recorded." />}
          {list.map(r => (
            <div key={r.id} className="p-2.5 rounded-lg bg-gray-50">
              <p className="text-xs text-[var(--text-muted)]">Assessed {fmtDate(r.assessment_date)}{r.next_review_date ? ` · next review ${fmtDate(r.next_review_date)}` : ''}</p>
              {r.recommendations && <p className="text-sm mt-1">{r.recommendations}</p>}
            </div>
          ))}
          {canEdit && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />New assessment</button>
          )}
          {canEdit && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2 text-xs">
              {[
                ['chair_adjustable', 'Is your chair fully adjustable?'],
                ['screen_at_eye_level', 'Is the top of your screen at eye level?'],
                ['glare_free', 'Is your screen free of glare/reflections?'],
                ['keyboard_separate', 'Is your keyboard separate (not laptop)?'],
                ['breaks_taken', 'Do you take regular breaks (every 50–60 min)?'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2">
                  <span className="flex-1">{label}</span>
                  <select value={(form as Record<string, string>)[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} className="input-base text-xs h-7">
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                    <option value="partial">Partial</option>
                  </select>
                </label>
              ))}
              <textarea placeholder="Issues / discomfort" value={form.issues} onChange={e => setForm({ ...form, issues: e.target.value })} rows={2} className="input-base text-sm w-full" />
              <textarea placeholder="Recommendations" value={form.recommendations} onChange={e => setForm({ ...form, recommendations: e.target.value })} rows={2} className="input-base text-sm w-full" />
              <label><span className="block mb-1 text-[var(--text-muted)]">Next review date</span>
                <input type="date" value={form.next_review_date} onChange={e => setForm({ ...form, next_review_date: e.target.value })} className="input-base text-sm" />
              </label>
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save assessment</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── TOIL ─────────────────────────────────────────────────────────────────
interface ToilRow {
  id: string;
  amount_hours: number;
  date_recorded: string;
  reason: string | null;
  recorded_by: string | null;
}

function ToilSection({ userId, canRecord }: { userId: string; canRecord: boolean }) {
  const [list, setList] = useState<ToilRow[]>([]);
  const [balance, setBalance] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ amount_hours: '', date_recorded: '', reason: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/toil?userId=${userId}`)
      .then(r => r.ok ? r.json() : { records: [], balance: 0 })
      .then(d => { setList(d.records ?? []); setBalance(d.balance ?? 0); })
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.amount_hours || !form.date_recorded) return;
    await fetch('/api/hr/personnel/toil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        amount_hours: Number(form.amount_hours),
        date_recorded: form.date_recorded,
        reason: form.reason || null,
      }),
    });
    setForm({ amount_hours: '', date_recorded: '', reason: '' });
    setAdding(false);
    load();
  }

  return (
    <Section id="toil" title={`TOIL · balance ${balance.toFixed(1)}h`} icon={Clock}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {list.length === 0 && <Empty msg="No TOIL recorded." />}
          {list.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
              <span className={`text-sm font-bold ${Number(r.amount_hours) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {Number(r.amount_hours) >= 0 ? '+' : ''}{Number(r.amount_hours).toFixed(1)}h
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-muted)]">{fmtDate(r.date_recorded)}{r.reason ? ` · ${r.reason}` : ''}</p>
              </div>
            </div>
          ))}
          {canRecord && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />Record TOIL (use negative for time taken)</button>
          )}
          {canRecord && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step="0.25" placeholder="Hours (e.g. 3 or -2)" value={form.amount_hours} onChange={e => setForm({ ...form, amount_hours: e.target.value })} className="input-base text-sm" />
                <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Date</span>
                  <input type="date" value={form.date_recorded} onChange={e => setForm({ ...form, date_recorded: e.target.value })} className="input-base text-sm w-full" />
                </label>
              </div>
              <input placeholder="Reason" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="input-base text-sm w-full" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Salary ───────────────────────────────────────────────────────────────
interface SalaryRow {
  id: string;
  effective_date: string;
  annual_salary: number;
  currency: string;
  notes: string | null;
}

function SalarySection({ userId, isAdmin, isSelf }: { userId: string; isAdmin: boolean; isSelf: boolean }) {
  const [list, setList] = useState<SalaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ effective_date: '', annual_salary: '', currency: 'GBP', notes: '' });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/salary?userId=${userId}`)
      .then(r => r.ok ? r.json() : { records: [] })
      .then(d => setList(d.records ?? []))
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!form.effective_date || !form.annual_salary) return;
    await fetch('/api/hr/personnel/salary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        effective_date: form.effective_date,
        annual_salary: Number(form.annual_salary),
        currency: form.currency,
        notes: form.notes || null,
      }),
    });
    setForm({ effective_date: '', annual_salary: '', currency: 'GBP', notes: '' });
    setAdding(false);
    load();
  }

  return (
    <Section id="salary" title="Salary" icon={PoundSterling}>
      {loading ? <MiniLoader /> : (
        <div className="space-y-2">
          {!isSelf && isAdmin && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />Your access to this salary record is logged.
            </p>
          )}
          {list.length === 0 && <Empty msg="No salary records." />}
          {list.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg bg-gray-50">
              <span className="text-sm font-bold">{r.currency} {Number(r.annual_salary).toLocaleString('en-GB', { minimumFractionDigits: 0 })}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[var(--text-muted)]">From {fmtDate(r.effective_date)}{r.notes ? ` · ${r.notes}` : ''}</p>
              </div>
            </div>
          ))}
          {isAdmin && !adding && (
            <button onClick={() => setAdding(true)} className="text-xs text-[var(--accent)] inline-flex items-center gap-1 hover:underline"><Plus size={12} />Add salary record</button>
          )}
          {isAdmin && adding && (
            <div className="border border-[var(--border)] rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <label className="text-xs col-span-1"><span className="block mb-1 text-[var(--text-muted)]">Effective</span>
                  <input type="date" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} className="input-base text-sm w-full" />
                </label>
                <input type="number" placeholder="Annual salary" value={form.annual_salary} onChange={e => setForm({ ...form, annual_salary: e.target.value })} className="input-base text-sm" />
                <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} className="input-base text-sm">
                  <option value="GBP">GBP</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <input placeholder="Notes (e.g. promotion, annual review)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="input-base text-sm w-full" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
                <button onClick={() => void add()} className="btn-primary text-sm">Save</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ── Leaver ───────────────────────────────────────────────────────────────
interface LeaverRow {
  id: string;
  notice_date: string | null;
  last_working_day: string | null;
  reason: 'resigned' | 'redundancy' | 'dismissal' | 'retired' | 'end_of_contract' | 'other';
  reason_details: string | null;
  exit_interview_done: boolean;
  exit_interview_notes: string | null;
  equipment_returned: boolean;
  systems_offboarded: boolean;
}

function LeaverSection({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [row, setRow] = useState<LeaverRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<LeaverRow>({
    id: '', notice_date: '', last_working_day: '', reason: 'resigned', reason_details: '',
    exit_interview_done: false, exit_interview_notes: '', equipment_returned: false, systems_offboarded: false,
  });

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/hr/personnel/leaver?userId=${userId}`)
      .then(r => r.ok ? r.json() : { record: null })
      .then(d => {
        setRow(d.record ?? null);
        if (d.record) setForm(d.record);
      })
      .finally(() => setLoading(false));
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    await fetch('/api/hr/personnel/leaver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        notice_date: form.notice_date || null,
        last_working_day: form.last_working_day || null,
        reason: form.reason,
        reason_details: form.reason_details || null,
        exit_interview_done: form.exit_interview_done,
        exit_interview_notes: form.exit_interview_notes || null,
        equipment_returned: form.equipment_returned,
        systems_offboarded: form.systems_offboarded,
      }),
    });
    setEditing(false);
    load();
  }

  return (
    <Section id="leaver" title="Leaver record" icon={LogOut}>
      {loading ? <MiniLoader /> : editing && isAdmin ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Notice date</span>
              <input type="date" value={form.notice_date ?? ''} onChange={e => setForm({ ...form, notice_date: e.target.value })} className="input-base text-sm w-full" />
            </label>
            <label className="text-xs"><span className="block mb-1 text-[var(--text-muted)]">Last working day</span>
              <input type="date" value={form.last_working_day ?? ''} onChange={e => setForm({ ...form, last_working_day: e.target.value })} className="input-base text-sm w-full" />
            </label>
          </div>
          <select value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value as LeaverRow['reason'] })} className="input-base text-sm">
            <option value="resigned">Resigned</option>
            <option value="redundancy">Redundancy</option>
            <option value="dismissal">Dismissal</option>
            <option value="retired">Retired</option>
            <option value="end_of_contract">End of contract</option>
            <option value="other">Other</option>
          </select>
          <textarea placeholder="Reason details" value={form.reason_details ?? ''} onChange={e => setForm({ ...form, reason_details: e.target.value })} rows={2} className="input-base text-sm w-full" />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.exit_interview_done} onChange={e => setForm({ ...form, exit_interview_done: e.target.checked })} />Exit interview done</label>
          <textarea placeholder="Exit interview notes" value={form.exit_interview_notes ?? ''} onChange={e => setForm({ ...form, exit_interview_notes: e.target.value })} rows={2} className="input-base text-sm w-full" />
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.equipment_returned} onChange={e => setForm({ ...form, equipment_returned: e.target.checked })} />Equipment returned</label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.systems_offboarded} onChange={e => setForm({ ...form, systems_offboarded: e.target.checked })} />Systems offboarded</label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Cancel</button>
            <button onClick={() => void save()} className="btn-primary text-sm">Save</button>
          </div>
        </div>
      ) : row ? (
        <div className="space-y-1.5 text-sm">
          <p><span className="text-[var(--text-muted)]">Reason:</span> {row.reason}</p>
          <p><span className="text-[var(--text-muted)]">Notice:</span> {fmtDate(row.notice_date)} · <span className="text-[var(--text-muted)]">Last day:</span> {fmtDate(row.last_working_day)}</p>
          <p className="text-xs flex gap-3 text-[var(--text-muted)]">
            <span>{row.exit_interview_done ? '✓' : '○'} exit interview</span>
            <span>{row.equipment_returned ? '✓' : '○'} equipment</span>
            <span>{row.systems_offboarded ? '✓' : '○'} systems</span>
          </p>
          {isAdmin && (
            <div className="flex flex-wrap gap-2 mt-2">
              <button onClick={() => setEditing(true)} className="btn-secondary text-xs"><Edit3 size={11} className="inline mr-1" />Update</button>
              <DeactivateLoginButton userId={userId} />
            </div>
          )}
        </div>
      ) : (
        <div>
          <Empty msg="Not a leaver." />
          {isAdmin && <button onClick={() => setEditing(true)} className="btn-primary text-xs"><Plus size={11} className="inline mr-1" />Begin leaver process</button>}
        </div>
      )}
    </Section>
  );
}


// Toggleable deactivate-login button. Tracks state locally — re-enable is also
// available so an admin can undo a click. Server-side enforces admin + same firm.
function DeactivateLoginButton({ userId }: { userId: string }) {
  const [busy, setBusy] = useState(false);
  const [deactivated, setDeactivated] = useState(false);

  async function deactivate() {
    if (!confirm("Disable this person's login? They will no longer be able to sign in. Their HR records and history are preserved. You can re-enable later.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/deactivate`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setDeactivated(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to deactivate login");
    } finally { setBusy(false); }
  }

  async function reactivate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/deactivate`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      setDeactivated(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to re-enable login");
    } finally { setBusy(false); }
  }

  if (deactivated) {
    return (
      <button onClick={() => void reactivate()} disabled={busy} className="btn-secondary text-xs inline-flex items-center gap-1 disabled:opacity-50">
        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Re-enable login
      </button>
    );
  }
  return (
    <button onClick={() => void deactivate()} disabled={busy} className="btn-secondary text-xs inline-flex items-center gap-1 text-red-700 border-red-200 hover:bg-red-50 disabled:opacity-50">
      {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}Deactivate login
    </button>
  );
}
