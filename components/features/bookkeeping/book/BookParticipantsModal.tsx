'use client';

/**
 * BookParticipantsModal — manage the people behind a set of books: partners,
 * the sole trader, directors and shareholders. Foundation for profit
 * allocation, dividend vouchers/minutes and self-assessment feeds
 * (docs/people-and-entities.md).
 *
 * A participant can be added from one of three sources: hard-entered, picked
 * from the client's client-links, or picked from the client's key contacts.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, Users, Plus, Trash2, Link2, Contact, Pencil } from 'lucide-react';
import type {
  Book, BookParticipant, ParticipantRole, ParticipantSource, ParticipantSourceOption,
} from '@/types/bookkeeping';
import { PARTICIPANT_ROLE_LABEL } from '@/types/bookkeeping';

interface AccountLite { id: string; name: string; ledger: string | null; code?: string | null }

function defaultRole(t: Book['template_type']): ParticipantRole {
  if (t === 'partnership' || t === 'llp') return 'partner';
  if (t === 'sole_trader' || t === 'self_employed') return 'sole_trader';
  return 'director';
}

function roleFromHint(hint: string | null): ParticipantRole | null {
  if (!hint) return null;
  const h = hint.toLowerCase();
  if (h.includes('director')) return 'director';
  if (h.includes('shareholder')) return 'shareholder';
  if (h.includes('partner')) return 'partner';
  return null;
}

const ROLE_OPTIONS: ParticipantRole[] = ['partner', 'sole_trader', 'director', 'shareholder'];

export default function BookParticipantsModal({ book, open, onClose }: { book: Book; open: boolean; onClose: () => void }) {
  const bookId = book.id;
  const [participants, setParticipants] = useState<BookParticipant[]>([]);
  const [links, setLinks] = useState<ParticipantSourceOption[]>([]);
  const [keyContacts, setKeyContacts] = useState<ParticipantSourceOption[]>([]);
  const [capitalAccounts, setCapitalAccounts] = useState<AccountLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // ── Add form state ──
  const [source, setSource] = useState<ParticipantSource>('manual');
  const [pickedRef, setPickedRef] = useState('');
  const [name, setName] = useState('');
  const [linkedClientId, setLinkedClientId] = useState<string | null>(null);
  const [role, setRole] = useState<ParticipantRole>(defaultRole(book.template_type));
  const [profitPct, setProfitPct] = useState('');
  const [sharePct, setSharePct] = useState('');
  const [salary, setSalary] = useState('');
  const [capitalAccountId, setCapitalAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, sRes, aRes] = await Promise.all([
        fetch(`/api/bookkeeping/books/${bookId}/participants`),
        fetch(`/api/bookkeeping/books/${bookId}/participant-sources`),
        fetch(`/api/bookkeeping/books/${bookId}/accounts`),
      ]);
      const p = await pRes.json().catch(() => ({}));
      const s = await sRes.json().catch(() => ({}));
      const a = await aRes.json().catch(() => ({}));
      setParticipants(p.participants ?? []);
      setLinks(s.links ?? []);
      setKeyContacts(s.keyContacts ?? []);
      setCapitalAccounts(((a.accounts ?? []) as AccountLite[]).filter(x => /capital/i.test(x.ledger ?? '')));
    } finally { setLoading(false); }
  }, [bookId]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  function resetForm() {
    setSource('manual'); setPickedRef(''); setName(''); setLinkedClientId(null);
    setRole(defaultRole(book.template_type));
    setProfitPct(''); setSharePct(''); setSalary(''); setCapitalAccountId('');
  }

  function applyPicked(opt: ParticipantSourceOption | undefined) {
    if (!opt) { setPickedRef(''); return; }
    setPickedRef(opt.ref_id);
    setName(opt.name);
    setLinkedClientId(opt.linked_client_id);
    const hinted = roleFromHint(opt.role_hint);
    if (hinted) setRole(hinted);
    if (opt.ownership_percentage != null) setSharePct(String(opt.ownership_percentage));
  }

  async function add() {
    if (!name.trim()) { setError('Enter a name.'); return; }
    setSaving(true); setError('');
    try {
      const num = (v: string) => (v.trim() === '' ? null : Number(v));
      const r = await fetch(`/api/bookkeeping/books/${bookId}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role,
          source_type: source,
          linked_client_id: source === 'manual' ? null : linkedClientId,
          name: name.trim(),
          profit_share_pct: role === 'partner' ? num(profitPct) : null,
          shareholding_pct: role === 'shareholder' ? num(sharePct) : null,
          annual_salary: role === 'director' ? num(salary) : null,
          capital_account_id: role === 'partner' && capitalAccountId ? capitalAccountId : null,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? 'Could not add participant.');
      setParticipants(prev => [...prev, d.participant]);
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add participant.');
    } finally { setSaving(false); }
  }

  async function remove(id: string) {
    if (!confirm('Remove this person from the book?')) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/participants/${id}`, { method: 'DELETE' });
    if (r.ok) setParticipants(prev => prev.filter(p => p.id !== id));
  }

  // Inline-edit the primary figure for a participant (profit %, shareholding %
  // or salary depending on role).
  async function patchFigure(p: BookParticipant, field: 'profit_share_pct' | 'shareholding_pct' | 'annual_salary', value: string) {
    const num = value.trim() === '' ? null : Number(value);
    if (p[field] === num) return;
    const r = await fetch(`/api/bookkeeping/books/${bookId}/participants/${p.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: num }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setParticipants(prev => prev.map(x => x.id === p.id ? d.participant : x));
  }

  if (!open) return null;

  const accountName = (id: string | null) => capitalAccounts.find(a => a.id === id)?.name ?? null;
  const sourceOptions = source === 'client_link' ? links : source === 'key_contact' ? keyContacts : [];

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl max-h-[88vh] flex flex-col rounded-2xl bg-white shadow-2xl overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 flex items-center gap-2 shrink-0">
          <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Users size={15} /></span>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-900">People &amp; roles</h2>
            <p className="text-[11px] text-slate-500">Partners, directors and shareholders behind {book.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}

          {/* Existing participants */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : participants.length === 0 ? (
            <p className="text-sm text-slate-500">No people added yet. Add the partners / directors / shareholders below.</p>
          ) : (
            <div className="space-y-2">
              {participants.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 truncate">{p.name}</span>
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{PARTICIPANT_ROLE_LABEL[p.role]}</span>
                      {p.source_type === 'client_link' && <Link2 size={11} className="text-slate-400" />}
                      {p.source_type === 'key_contact' && <Contact size={11} className="text-slate-400" />}
                    </div>
                    {p.role === 'partner' && accountName(p.capital_account_id) && (
                      <p className="text-[11px] text-slate-400 mt-0.5">Capital account: {accountName(p.capital_account_id)}</p>
                    )}
                  </div>
                  {/* Primary figure, inline-editable */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {p.role === 'partner' && (
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input type="number" defaultValue={p.profit_share_pct ?? ''} onBlur={e => patchFigure(p, 'profit_share_pct', e.target.value)}
                          className="w-16 text-sm border border-slate-300 rounded px-1.5 py-1 text-right" placeholder="—" /> %
                      </label>
                    )}
                    {p.role === 'shareholder' && (
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        <input type="number" defaultValue={p.shareholding_pct ?? ''} onBlur={e => patchFigure(p, 'shareholding_pct', e.target.value)}
                          className="w-16 text-sm border border-slate-300 rounded px-1.5 py-1 text-right" placeholder="—" /> %
                      </label>
                    )}
                    {p.role === 'director' && (
                      <label className="flex items-center gap-1 text-xs text-slate-500">
                        £<input type="number" defaultValue={p.annual_salary ?? ''} onBlur={e => patchFigure(p, 'annual_salary', e.target.value)}
                          className="w-24 text-sm border border-slate-300 rounded px-1.5 py-1 text-right" placeholder="salary" />
                      </label>
                    )}
                    <button onClick={() => remove(p.id)} aria-label="Remove" className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-700"><Plus size={14} /> Add a person</div>

            {/* Source picker */}
            <div className="flex gap-1.5">
              {([['manual', 'Type in', Pencil], ['client_link', 'From links', Link2], ['key_contact', 'Key contact', Contact]] as const).map(([val, label, Icon]) => {
                const count = val === 'client_link' ? links.length : val === 'key_contact' ? keyContacts.length : null;
                const disabled = (val === 'client_link' && links.length === 0) || (val === 'key_contact' && keyContacts.length === 0);
                return (
                  <button key={val} type="button" disabled={disabled}
                    onClick={() => { setSource(val); setPickedRef(''); if (val === 'manual') { setName(''); setLinkedClientId(null); } }}
                    className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      source === val ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <Icon size={12} /> {label}{count != null && !disabled ? ` (${count})` : ''}
                  </button>
                );
              })}
            </div>

            {source !== 'manual' && (
              <select value={pickedRef} onChange={e => applyPicked(sourceOptions.find(o => o.ref_id === e.target.value))}
                className="w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                <option value="">Select…</option>
                {sourceOptions.map(o => (
                  <option key={o.ref_id} value={o.ref_id}>{o.name}{o.role_hint ? ` · ${o.role_hint}` : ''}</option>
                ))}
              </select>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Name</span>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name"
                  className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Role</span>
                <select value={role} onChange={e => setRole(e.target.value as ParticipantRole)}
                  className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{PARTICIPANT_ROLE_LABEL[r]}</option>)}
                </select>
              </label>
            </div>

            {/* Role-specific fields */}
            <div className="grid grid-cols-2 gap-2">
              {role === 'partner' && (
                <>
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-500">Profit share %</span>
                    <input type="number" value={profitPct} onChange={e => setProfitPct(e.target.value)} placeholder="e.g. 50"
                      className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                  </label>
                  {capitalAccounts.length > 0 && (
                    <label className="block">
                      <span className="text-[11px] font-medium text-slate-500">Capital account</span>
                      <select value={capitalAccountId} onChange={e => setCapitalAccountId(e.target.value)}
                        className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white">
                        <option value="">— none —</option>
                        {capitalAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </label>
                  )}
                </>
              )}
              {role === 'shareholder' && (
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Shareholding %</span>
                  <input type="number" value={sharePct} onChange={e => setSharePct(e.target.value)} placeholder="e.g. 50"
                    className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
              )}
              {role === 'director' && (
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500">Annual salary (£)</span>
                  <input type="number" value={salary} onChange={e => setSalary(e.target.value)} placeholder="e.g. 12570"
                    className="mt-0.5 w-full text-sm border border-slate-300 rounded-lg px-2.5 py-2" />
                </label>
              )}
            </div>

            <div className="flex justify-end">
              <button onClick={add} disabled={saving || !name.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {saving ? 'Adding…' : 'Add person'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
