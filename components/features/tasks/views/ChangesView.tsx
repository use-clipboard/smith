'use client';

import { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import {
  Loader2, RefreshCw, CheckCircle2, RotateCcw, Trash2, Plus, Pencil, User as UserIcon,
} from 'lucide-react';

type ChangeType = 'created' | 'updated' | 'completed' | 'reopened' | 'deleted';

interface ChangeRow {
  id: string;
  task_id: string;
  change_type: ChangeType;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  task_title_at_change: string | null;
  changed_at: string;
  changed_by_user: { id: string; full_name: string | null; email: string } | null;
  task: { id: string; title: string; deleted_at: string | null } | null;
  client: { id: string; name: string; client_ref: string } | null;
}

const FIELD_LABELS: Record<string, string> = {
  title:                    'Title',
  description:              'Description',
  client_id:                'Client',
  status:                   'Status',
  due_date:                 'Due date',
  is_internal:              'Internal flag',
  recurrence_type:          'Recurrence',
  recurrence_interval_days: 'Recurrence interval (days)',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function userDisplay(u: { full_name: string | null; email: string } | null | undefined): string {
  if (!u) return 'System';
  return u.full_name || u.email || 'System';
}

function fieldLabel(field: string | null): string {
  if (!field) return '';
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

function displayValue(field: string | null, raw: string | null): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (field === 'is_internal') return raw === 'true' ? 'Yes' : 'No';
  if (field === 'due_date') {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  if (field === 'description') return raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
  if (field === 'client_id') return raw.length > 8 ? `client ${raw.slice(0, 8)}…` : raw;
  return raw;
}

function changeIcon(type: ChangeType) {
  switch (type) {
    case 'created':   return <Plus size={13} className="text-indigo-500" />;
    case 'completed': return <CheckCircle2 size={13} className="text-emerald-500" />;
    case 'reopened':  return <RotateCcw size={13} className="text-amber-500" />;
    case 'deleted':   return <Trash2 size={13} className="text-red-500" />;
    case 'updated':
    default:          return <Pencil size={13} className="text-gray-500" />;
  }
}

function changeBadge(type: ChangeType) {
  const map: Record<ChangeType, string> = {
    created:   'bg-indigo-50 text-indigo-700 border-indigo-200',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    reopened:  'bg-amber-50 text-amber-700 border-amber-200',
    deleted:   'bg-red-50 text-red-700 border-red-200',
    updated:   'bg-gray-100 text-gray-700 border-gray-200',
  };
  return map[type] ?? map.updated;
}

interface ChangesViewProps {
  /** When set, the component skips its own search bar and filters by this string */
  externalSearch?: string;
  /** When true, hides the top bar (search + count + refresh) entirely */
  hideHeader?: boolean;
}

export interface ChangesViewHandle {
  reload: () => void;
}

const ChangesView = forwardRef<ChangesViewHandle, ChangesViewProps>(function ChangesView(
  { externalSearch, hideHeader }: ChangesViewProps,
  ref,
) {
  const [internalSearch, setInternalSearch] = useState('');
  const search = externalSearch !== undefined ? externalSearch : internalSearch;
  const [rows, setRows] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/tasks/changes');
      if (r.ok) {
        const d = await r.json() as { changes: ChangeRow[] };
        setRows(d.changes ?? []);
      } else {
        setRows([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  useImperativeHandle(ref, () => ({ reload: load }), []);

  // Search across task title (current + snapshot), client name, client code, user name.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      (r.task?.title ?? '').toLowerCase().includes(q) ||
      (r.task_title_at_change ?? '').toLowerCase().includes(q) ||
      (r.client?.name ?? '').toLowerCase().includes(q) ||
      (r.client?.client_ref ?? '').toLowerCase().includes(q) ||
      (r.changed_by_user?.full_name ?? '').toLowerCase().includes(q) ||
      (r.changed_by_user?.email ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <div>
      {!hideHeader && (
        <div className="sticky top-0 z-30 backdrop-blur-md pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-3">
            <input
              type="text"
              placeholder="Search by task, client, code, or user…"
              value={internalSearch}
              onChange={e => setInternalSearch(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 w-80"
            />
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">{visible.length} change{visible.length === 1 ? '' : 's'}</span>
              <button onClick={load} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
                <RefreshCw size={12} /> Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {search
            ? 'No changes match your search.'
            : rows.length === 0
              ? 'No task changes recorded yet. Edits to tasks from now on will appear here.'
              : 'No matching changes.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {visible.map(r => {
            const taskTitle = r.task?.title ?? r.task_title_at_change ?? '(untitled task)';
            const isDeletedTask = !!r.task?.deleted_at;
            return (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors">
                <span className="mt-0.5 flex-shrink-0">{changeIcon(r.change_type)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`text-sm font-medium truncate ${isDeletedTask ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                      {taskTitle}
                    </p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 border ${changeBadge(r.change_type)}`}>
                      {r.change_type}
                    </span>
                  </div>

                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                    {r.client?.name && (
                      <span className="inline-flex items-center gap-1.5">
                        <span>{r.client.name}</span>
                        {r.client.client_ref && (
                          <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-600 text-[10px] font-semibold tracking-wide uppercase">
                            {r.client.client_ref}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <UserIcon size={11} /> {userDisplay(r.changed_by_user)}
                    </span>
                    <span>{fmtDateTime(r.changed_at)}</span>
                  </div>

                  {r.change_type === 'updated' && r.field_name && (
                    <div className="mt-1.5 text-xs text-gray-700 flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{fieldLabel(r.field_name)}:</span>
                      <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 line-through max-w-[20rem] truncate">
                        {displayValue(r.field_name, r.old_value)}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 max-w-[20rem] truncate">
                        {displayValue(r.field_name, r.new_value)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default ChangesView;
