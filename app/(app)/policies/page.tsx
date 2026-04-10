'use client';
import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  BookOpen, Plus, Search, Pencil, Trash2, Eye, EyeOff,
  X, Check, FileText, Lock, AlertTriangle, BookMarked, Save,
  ChevronRight, ChevronDown,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';

// Load editor client-side only (Tiptap uses browser APIs)
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false, loading: () => (
  <div className="flex-1 glass-solid rounded-xl border border-[var(--border)] flex items-center justify-center">
    <p className="text-sm text-[var(--text-muted)]">Loading editor…</p>
  </div>
) });

// ── Types ─────────────────────────────────────────────────────────────────────

interface PolicyMeta {
  id: string; title: string; category: string;
  is_published: boolean; version: number; updated_at: string;
  users: { full_name: string } | null;
}
interface Policy extends PolicyMeta { content: string; created_at: string; }

// ── Default categories ────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = [
  'Employee Handbook', 'Standard Operating Procedures', 'Compliance & AML',
  'HR Policies', 'IT & Data Security', 'Client Services',
  'Financial Procedures', 'Health & Safety', 'General',
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyMeta[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Policy | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Edit state
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('General');
  const [editContent, setEditContent] = useState('');
  const [editPublished, setEditPublished] = useState(true);
  const [editCustomCategory, setEditCustomCategory] = useState('');
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Data fetching ─────────────────────────────────────────────────────────────

  const fetchPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/policies');
      if (res.ok) { const data = await res.json(); setPolicies(data.policies ?? []); setIsAdmin(data.isAdmin ?? false); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchPolicies(); }, [fetchPolicies]);

  const fetchPolicy = useCallback(async (id: string) => {
    setSelectedLoading(true);
    try {
      const res = await fetch(`/api/policies/${id}`);
      if (res.ok) { const data = await res.json(); setSelected(data.policy); }
    } finally { setSelectedLoading(false); }
  }, []);

  useEffect(() => {
    if (selectedId) void fetchPolicy(selectedId);
    else setSelected(null);
  }, [selectedId, fetchPolicy]);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const filteredPolicies = search
    ? policies.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()))
    : policies;
  const categories = [...new Set(filteredPolicies.map(p => p.category))].sort();

  function toggleCategory(cat: string) {
    setCollapsedCategories(prev => { const n = new Set(prev); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });
  }

  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...policies.map(p => p.category)])].sort();
  const finalCategory = showCategoryInput && editCustomCategory.trim() ? editCustomCategory.trim() : editCategory;

  // ── Edit helpers ──────────────────────────────────────────────────────────────

  function startNew() {
    setIsNew(true); setEditing(true);
    setEditTitle(''); setEditCategory('General'); setEditContent('<p></p>');
    setEditPublished(true); setShowCategoryInput(false); setEditCustomCategory(''); setSaveError(null);
    setSelectedId(null); setSelected(null);
  }

  function startEdit() {
    if (!selected) return;
    setIsNew(false); setEditing(true);
    setEditTitle(selected.title); setEditCategory(selected.category);
    setEditContent(selected.content || '<p></p>');
    setEditPublished(selected.is_published);
    setShowCategoryInput(false); setEditCustomCategory(''); setSaveError(null);
  }

  function cancelEdit() { setEditing(false); setIsNew(false); setSaveError(null); }

  async function handleSave() {
    if (!editTitle.trim()) { setSaveError('Title is required'); return; }
    setSaving(true); setSaveError(null);
    try {
      const body = { title: editTitle.trim(), category: finalCategory, content: editContent, is_published: editPublished };
      const res = isNew
        ? await fetch('/api/policies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/policies/${selected!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setSaveError(data.error || 'Save failed'); return; }
      await fetchPolicies(); setSelected(data.policy); setSelectedId(data.policy.id);
      setEditing(false); setIsNew(false);
    } catch { setSaveError('An unexpected error occurred'); } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!selected) return;
    setDeleting(true);
    try {
      await fetch(`/api/policies/${selected.id}`, { method: 'DELETE' });
      await fetchPolicies(); setSelectedId(null); setSelected(null); setConfirmDelete(false); setEditing(false);
    } finally { setDeleting(false); }
  }

  async function handleTogglePublish() {
    if (!selected) return;
    const res = await fetch(`/api/policies/${selected.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_published: !selected.is_published }),
    });
    if (res.ok) {
      const data = await res.json();
      setSelected(data.policy);
      setPolicies(prev => prev.map(p => p.id === data.policy.id ? { ...p, is_published: data.policy.is_published } : p));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <ToolLayout title="Policies & Procedures" description="Firm policies, SOPs and employee handbook." icon={BookOpen} iconColor="#0F766E">

      {/* Rich text content styles */}
      <style>{`
        .policy-editor h1,.policy-view h1{font-size:1.6rem;font-weight:700;margin:1.2rem 0 .6rem;color:var(--text-primary);border-bottom:1px solid var(--border);padding-bottom:.35rem}
        .policy-editor h2,.policy-view h2{font-size:1.25rem;font-weight:700;margin:1rem 0 .5rem;color:var(--text-primary)}
        .policy-editor h3,.policy-view h3{font-size:1.05rem;font-weight:600;margin:.9rem 0 .4rem;color:var(--text-primary)}
        .policy-editor h4,.policy-view h4{font-size:.95rem;font-weight:600;margin:.75rem 0 .3rem;color:var(--text-secondary)}
        .policy-editor p,.policy-view p{margin:.45rem 0;line-height:1.75}
        .policy-editor ul,.policy-view ul{list-style:disc;margin:.5rem 0;padding-left:1.5rem}
        .policy-editor ol,.policy-view ol{list-style:decimal;margin:.5rem 0;padding-left:1.5rem}
        .policy-editor li,.policy-view li{margin:.2rem 0;line-height:1.65}
        .policy-editor blockquote,.policy-view blockquote{border-left:3px solid var(--accent);padding-left:.85rem;margin:.75rem 0;color:var(--text-muted);font-style:italic}
        .policy-editor code,.policy-view code{background:var(--bg-nav-hover);border-radius:4px;padding:.1rem .35rem;font-family:monospace;font-size:.85em;color:var(--accent)}
        .policy-editor hr,.policy-view hr{border:none;border-top:1px solid var(--border);margin:1.25rem 0}
        .policy-editor a,.policy-view a,.policy-link{color:var(--accent);text-decoration:underline;cursor:pointer}
        .policy-editor strong,.policy-view strong{font-weight:600}
        .policy-editor u,.policy-view u{text-decoration:underline}
        .policy-editor s,.policy-view s{text-decoration:line-through}
        .policy-editor mark,.policy-view mark{border-radius:2px;padding:0 2px}
        .policy-editor [data-text-align=center],.policy-view [data-text-align=center],.policy-editor .text-center{text-align:center}
        .policy-editor [data-text-align=right],.policy-view [data-text-align=right]{text-align:right}
        .policy-editor [data-text-align=justify],.policy-view [data-text-align=justify]{text-align:justify}
        .policy-editor p[style*="text-align: center"],.policy-view p[style*="text-align: center"]{text-align:center}
        .policy-editor p[style*="text-align: right"],.policy-view p[style*="text-align: right"]{text-align:right}
        .policy-editor p[style*="text-align: justify"],.policy-view p[style*="text-align: justify"]{text-align:justify}
        .policy-editor .ProseMirror:focus{outline:none}
        .shadow-dropdown{box-shadow:0 4px 24px rgba(0,0,0,.12)}
      `}</style>

      <div className="flex gap-0 h-[calc(100vh-200px)] min-h-[520px]">

        {/* ── Left sidebar ────────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-[var(--border)] pr-4 mr-4">

          {/* Search + New */}
          <div className="flex gap-2 mb-3">
            <div className="flex items-center gap-2 flex-1 px-3 py-2 glass-solid rounded-lg border border-[var(--border-input)]">
              <Search size={13} className="text-[var(--text-muted)] shrink-0" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search policies…"
                className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
              {search && <button onClick={() => setSearch('')}><X size={12} className="text-[var(--text-muted)]" /></button>}
            </div>
            {isAdmin && (
              <button onClick={startNew} title="New policy"
                className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                <Plus size={16} />
              </button>
            )}
          </div>

          {/* Category + policy list */}
          <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
            {loading ? (
              <div className="py-8 text-center text-xs text-[var(--text-muted)]">Loading…</div>
            ) : categories.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <BookMarked size={24} className="mx-auto text-[var(--text-muted)] opacity-30" />
                <p className="text-xs text-[var(--text-muted)]">
                  {search ? 'No policies match your search.' : isAdmin ? 'No policies yet. Click + to create one.' : 'No policies published yet.'}
                </p>
              </div>
            ) : categories.map(cat => {
              const catPolicies = filteredPolicies.filter(p => p.category === cat);
              const collapsed = collapsedCategories.has(cat);
              return (
                <div key={cat}>
                  <button onClick={() => toggleCategory(cat)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors group">
                    {collapsed ? <ChevronRight size={13} className="text-[var(--text-muted)]" /> : <ChevronDown size={13} className="text-[var(--text-muted)]" />}
                    <span className="flex-1 text-left text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors truncate">{cat}</span>
                    <span className="text-xs text-[var(--text-muted)] opacity-60 shrink-0">{catPolicies.length}</span>
                  </button>
                  {!collapsed && (
                    <ul className="ml-4 mb-1 space-y-0.5">
                      {catPolicies.map(p => (
                        <li key={p.id}>
                          <button onClick={() => { setSelectedId(p.id); setEditing(false); setIsNew(false); }}
                            className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-sm transition-colors group ${selectedId === p.id && !editing ? 'bg-[var(--accent-light)] text-[var(--accent)]' : 'hover:bg-[var(--bg-nav-hover)] text-[var(--text-secondary)]'}`}>
                            <FileText size={12} className="shrink-0 opacity-60" />
                            <span className="flex-1 truncate leading-tight">{p.title}</span>
                            {isAdmin && !p.is_published && (
                              <span className="shrink-0 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-medium rounded">Draft</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {isAdmin && !loading && (
            <div className="mt-3 pt-3 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                <Lock size={10} />You can create, edit and publish policies as admin.
              </p>
            </div>
          )}
        </div>

        {/* ── Right panel ──────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Empty state */}
          {!selectedId && !editing && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
              <BookOpen size={40} className="text-[var(--text-muted)] opacity-20" />
              <div>
                <p className="font-medium text-[var(--text-secondary)]">Select a policy from the list</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {isAdmin ? 'Or click + to create a new one.' : 'Ask your firm admin to add policies here.'}
                </p>
              </div>
            </div>
          )}

          {/* ── Editor mode ──────────────────────────────────────────────── */}
          {editing && (
            <div className="flex flex-col h-full gap-3">

              {/* Top bar */}
              <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                <input value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  placeholder="Policy title…"
                  className="flex-1 min-w-[200px] text-xl font-bold bg-transparent border-b-2 border-[var(--border)] focus:border-[var(--accent)] outline-none py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors" />
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={cancelEdit} className="btn-ghost text-sm">Cancel</button>
                  <button onClick={() => void handleSave()} disabled={saving || !editTitle.trim()} className="btn-primary disabled:opacity-50">
                    <Save size={14} />{saving ? 'Saving…' : isNew ? 'Publish' : 'Save changes'}
                  </button>
                </div>
              </div>

              {/* Meta bar */}
              <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide shrink-0">Category</label>
                  {showCategoryInput ? (
                    <div className="flex items-center gap-1">
                      <input value={editCustomCategory} onChange={e => setEditCustomCategory(e.target.value)}
                        placeholder="Category name…" autoFocus className="input-base text-xs py-1 px-2 w-44" />
                      <button type="button" onClick={() => { setShowCategoryInput(false); if (editCustomCategory.trim()) setEditCategory(editCustomCategory.trim()); }}
                        className="p-1.5 text-[var(--accent)] hover:bg-[var(--accent-light)] rounded"><Check size={13} /></button>
                      <button type="button" onClick={() => setShowCategoryInput(false)} className="p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] rounded"><X size={13} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <select value={editCategory} onChange={e => setEditCategory(e.target.value)} className="input-base text-xs py-1.5 px-2">
                        {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button type="button" onClick={() => setShowCategoryInput(true)}
                        className="text-xs text-[var(--accent)] hover:underline whitespace-nowrap">+ New category</button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-xs font-medium text-[var(--text-muted)]">{editPublished ? 'Published' : 'Draft'}</span>
                  <button type="button" onClick={() => setEditPublished(v => !v)}
                    className={`relative w-10 h-6 rounded-full transition-colors ${editPublished ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${editPublished ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              </div>

              {saveError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200 flex-shrink-0">
                  <AlertTriangle size={14} />{saveError}
                </div>
              )}

              {/* Rich text editor */}
              <RichTextEditor content={editContent} onChange={setEditContent}
                placeholder="Start writing your policy. Use the toolbar above to format headings, bold, lists, colours and more." />

              {/* Delete (edit only, not new) */}
              {!isNew && (
                <div className="flex-shrink-0">
                  {confirmDelete ? (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-red-600 font-medium">Delete this policy permanently?</p>
                      <button onClick={() => setConfirmDelete(false)} className="btn-ghost text-xs">Cancel</button>
                      <button onClick={() => void handleDelete()} disabled={deleting}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-xs font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors">
                        <Trash2 size={11} />{deleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)}
                      className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 transition-colors">
                      <Trash2 size={12} />Delete this policy
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── View mode ─────────────────────────────────────────────────── */}
          {selectedId && !editing && (
            <div className="flex flex-col h-full">
              {selectedLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-[var(--text-muted)]">Loading…</p>
                </div>
              ) : selected ? (
                <>
                  {/* Policy header */}
                  <div className="flex items-start justify-between gap-4 mb-5 flex-shrink-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <span className="px-2 py-0.5 bg-[var(--bg-nav-hover)] text-[var(--text-muted)] text-xs rounded border border-[var(--border)]">
                          {selected.category}
                        </span>
                        {isAdmin && !selected.is_published && (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">Draft — not visible to staff</span>
                        )}
                        <span className="text-xs text-[var(--text-muted)]">v{selected.version}</span>
                        {selected.users?.full_name && (
                          <span className="text-xs text-[var(--text-muted)]">
                            · Updated by {selected.users.full_name} · {new Date(selected.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <h1 className="text-2xl font-bold text-[var(--text-primary)]">{selected.title}</h1>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => void handleTogglePublish()}
                          className={`btn-secondary text-xs py-1.5 ${!selected.is_published ? 'text-green-600 border-green-200 hover:bg-green-50' : ''}`}>
                          {selected.is_published ? <><EyeOff size={13} />Unpublish</> : <><Eye size={13} />Publish</>}
                        </button>
                        <button onClick={startEdit} className="btn-secondary text-xs py-1.5">
                          <Pencil size={13} />Edit
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto glass-solid rounded-xl border border-[var(--border)] p-6 scrollbar-thin">
                    {selected.content?.trim() && selected.content !== '<p></p>' ? (
                      <div
                        className="policy-view text-sm text-[var(--text-primary)] leading-relaxed"
                        dangerouslySetInnerHTML={{ __html: selected.content }}
                      />
                    ) : (
                      <div className="py-12 text-center">
                        <FileText size={28} className="mx-auto text-[var(--text-muted)] opacity-20 mb-3" />
                        <p className="text-sm text-[var(--text-muted)]">This policy has no content yet.</p>
                        {isAdmin && (
                          <button onClick={startEdit} className="mt-3 btn-primary text-xs"><Pencil size={12} />Add content</button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </ToolLayout>
  );
}
