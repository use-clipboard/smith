'use client';

/**
 * TriageCategoryManager — Settings → Email Triage editor for the user's
 * customisable triage categories. The two anchors (Untriaged first, No Action
 * Needed last) are shown locked; the middle categories can be renamed,
 * recoloured, re-iconed, reordered (drag) and deleted. Saving persists to
 * /api/email/triage-category-config and tells any open triage page to refresh.
 */

import { useEffect, useRef, useState } from 'react';
import { GripVertical, Plus, Trash2, Loader2, Check, Lock } from 'lucide-react';
import {
  ICON_REGISTRY, ICON_OPTIONS, CATEGORY_PALETTE, iconFor,
  FIXED_FIRST, FIXED_LAST, UNTRIAGED_KEY, COMPLETED_KEY, type CategoryDef,
} from '@/components/features/email/emailCategories';

function LockedRow({ def, position }: { def: CategoryDef; position: string }) {
  const Icon = iconFor(def.iconName);
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-nav-hover)]/40 opacity-90">
      <Lock size={13} className="text-[var(--text-muted)] shrink-0" />
      <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${def.color}1a` }}>
        <Icon size={14} style={{ color: def.color }} />
      </span>
      <span className="flex-1 text-sm font-medium text-[var(--text-primary)]">{def.label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Fixed · {position}</span>
    </div>
  );
}

export default function TriageCategoryManager() {
  const [middle, setMiddle] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [iconPickerFor, setIconPickerFor] = useState<number | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);
  // Where a deleted category's filed emails should go (keyed by the deleted
  // category's key). Applied on save.
  const [pendingReassign, setPendingReassign] = useState<Record<string, string>>({});
  // The delete dialog: shown when deleting a category that has filed emails.
  const [deleteTarget, setDeleteTarget] = useState<{ cat: CategoryDef; count: number } | null>(null);
  const [destChoice, setDestChoice] = useState<string>(UNTRIAGED_KEY);
  const [checkingCount, setCheckingCount] = useState(false);

  useEffect(() => {
    fetch('/api/email/triage-category-config')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.middle) setMiddle(d.middle as CategoryDef[]); })
      .catch(() => setError('Could not load your categories.'))
      .finally(() => setLoading(false));
  }, []);

  function mutate(next: CategoryDef[]) { setMiddle(next); setDirty(true); setSavedAt(null); }
  function updateAt(i: number, patch: Partial<CategoryDef>) { mutate(middle.map((c, j) => (j === i ? { ...c, ...patch } : c))); }
  function addCategory() {
    const usedColors = new Set(middle.map(c => c.color));
    const color = CATEGORY_PALETTE.find(c => !usedColors.has(c)) ?? CATEGORY_PALETTE[0];
    mutate([...middle, { key: '', label: '', iconName: 'Tag', color, aiDescription: '' }]);
  }
  async function remove(i: number) {
    const c = middle[i];
    // A never-saved category (no key) can't have any filed emails — just drop it.
    if (!c.key) { mutate(middle.filter((_, j) => j !== i)); return; }
    setCheckingCount(true);
    let count = 0;
    try {
      const res = await fetch(`/api/email/triage-category-config?countFor=${encodeURIComponent(c.key)}`);
      if (res.ok) count = ((await res.json()) as { count?: number }).count ?? 0;
    } catch { /* if the count fails, fall through to the dialog with 0 */ }
    setCheckingCount(false);
    if (count === 0) { mutate(middle.filter(x => x.key !== c.key)); return; }
    setDestChoice(UNTRIAGED_KEY);
    setDeleteTarget({ cat: c, count });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const key = deleteTarget.cat.key;
    setPendingReassign(prev => ({ ...prev, [key]: destChoice }));
    mutate(middle.filter(x => x.key !== key));
    setDeleteTarget(null);
  }
  function move(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= middle.length || to >= middle.length) return;
    const next = [...middle];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    mutate(next);
  }

  async function save() {
    if (middle.some(c => !c.label.trim())) { setError('Every category needs a name.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/email/triage-category-config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ middle, reassign: pendingReassign }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})) as { error?: string }; throw new Error(e.error ?? 'Failed to save'); }
      const d = await res.json() as { middle: CategoryDef[] };
      setMiddle(d.middle);
      setPendingReassign({});
      setDirty(false);
      setSavedAt(Date.now());
      // Refresh any open triage page.
      window.dispatchEvent(new CustomEvent('smith:triage-categories-updated'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save categories.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4"><Loader2 size={14} className="animate-spin" /> Loading categories…</div>;
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Triage categories</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Customise your triage buckets — name, colour, icon and order. <span className="font-medium">Untriaged</span> and
          {' '}<span className="font-medium">No Action Needed</span> are fixed as the first and last. The optional guidance line
          tells Auto Triage when to use each bucket.
        </p>
      </div>

      <LockedRow def={FIXED_FIRST} position="first" />

      <div className="space-y-2">
        {middle.map((c, i) => {
          const RowIcon = iconFor(c.iconName);
          return (
            <div
              key={i}
              draggable
              onDragStart={() => { dragIndex.current = i; }}
              onDragOver={e => { e.preventDefault(); const from = dragIndex.current; if (from === null || from === i) return; move(from, i); dragIndex.current = i; }}
              onDragEnd={() => { dragIndex.current = null; }}
              className="flex items-center gap-2 px-2 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card-solid)]"
            >
              <button className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0" aria-label="Drag to reorder">
                <GripVertical size={15} />
              </button>

              {/* Icon picker */}
              <div className="relative shrink-0">
                <button
                  onClick={() => { setIconPickerFor(iconPickerFor === i ? null : i); setColorPickerFor(null); }}
                  className="w-8 h-8 rounded-md flex items-center justify-center border border-[var(--border)] hover:border-[var(--accent)]"
                  style={{ background: `${c.color}1a` }}
                  aria-label="Choose icon"
                >
                  <RowIcon size={15} style={{ color: c.color }} />
                </button>
                {iconPickerFor === i && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setIconPickerFor(null)} />
                    <div className="absolute left-0 top-full mt-1 z-[61] w-56 max-h-52 overflow-y-auto scrollbar-thin grid grid-cols-6 gap-1 p-2 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl">
                      {ICON_OPTIONS.map(name => {
                        const I = ICON_REGISTRY[name];
                        return (
                          <button
                            key={name}
                            onClick={() => { updateAt(i, { iconName: name }); setIconPickerFor(null); }}
                            className={`w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--bg-nav-hover)] ${c.iconName === name ? 'ring-2 ring-[var(--accent)]' : ''}`}
                            title={name}
                          >
                            <I size={15} style={{ color: c.color }} />
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Colour picker */}
              <div className="relative shrink-0">
                <button
                  onClick={() => { setColorPickerFor(colorPickerFor === i ? null : i); setIconPickerFor(null); }}
                  className="w-7 h-7 rounded-md border border-[var(--border)] hover:border-[var(--accent)]"
                  style={{ background: c.color }}
                  aria-label="Choose colour"
                />
                {colorPickerFor === i && (
                  <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setColorPickerFor(null)} />
                    <div className="absolute left-0 top-full mt-1 z-[61] w-44 grid grid-cols-8 gap-1 p-2 bg-[var(--bg-card-solid)] border border-[var(--border)] rounded-xl shadow-xl">
                      {CATEGORY_PALETTE.map(col => (
                        <button
                          key={col}
                          onClick={() => { updateAt(i, { color: col }); setColorPickerFor(null); }}
                          className={`w-4 h-4 rounded-full ${c.color.toLowerCase() === col.toLowerCase() ? 'ring-2 ring-offset-1 ring-[var(--accent)]' : ''}`}
                          style={{ background: col }}
                          aria-label={col}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Name + AI guidance */}
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                <input
                  value={c.label}
                  onChange={e => updateAt(i, { label: e.target.value })}
                  placeholder="Category name"
                  maxLength={40}
                  className="w-full text-sm font-medium bg-transparent border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                />
                <input
                  value={c.aiDescription}
                  onChange={e => updateAt(i, { aiDescription: e.target.value })}
                  placeholder="Auto Triage guidance (optional) — e.g. “emails about VAT deadlines”"
                  maxLength={300}
                  className="w-full text-[11px] bg-transparent outline-none text-[var(--text-muted)] placeholder:text-[var(--text-muted)]/70"
                />
              </div>

              <button onClick={() => remove(i)} disabled={checkingCount} className="shrink-0 p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40" aria-label="Delete category">
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        onClick={addCategory}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-dashed border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] w-full justify-center"
      >
        <Plus size={14} /> Add category
      </button>

      <LockedRow def={FIXED_LAST} position="last" />

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="btn-primary text-sm flex items-center gap-1.5 px-4 py-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {saving ? 'Saving…' : 'Save categories'}
        </button>
        {savedAt && !dirty && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </div>

      {/* Delete dialog — asks where a non-empty category's emails should go. */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="w-full max-w-sm bg-[var(--bg-card-solid)] rounded-xl shadow-2xl border border-[var(--border-card)] p-5" onClick={e => e.stopPropagation()}>
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Delete “{deleteTarget.cat.label}”?</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1.5">
              <span className="font-medium text-[var(--text-secondary)]">{deleteTarget.count.toLocaleString()}</span>{' '}
              email{deleteTarget.count === 1 ? '' : 's'} {deleteTarget.count === 1 ? 'is' : 'are'} filed here. Where should they go?
            </p>
            <select
              value={destChoice}
              onChange={e => setDestChoice(e.target.value)}
              className="w-full mt-3 text-sm rounded-lg border border-[var(--border-input)] bg-white/60 px-3 py-2 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              <option value={UNTRIAGED_KEY}>Untriaged</option>
              {middle.filter(c => c.key && c.key !== deleteTarget.cat.key).map(c => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
              <option value={COMPLETED_KEY}>No Action Needed</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-2">The move is applied when you save your changes.</p>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button onClick={() => setDeleteTarget(null)} className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]/30">Cancel</button>
              <button onClick={confirmDelete} className="text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 font-medium">Delete category</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
