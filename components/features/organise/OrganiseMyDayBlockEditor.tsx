'use client';

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Link2, Building2, User, Check } from 'lucide-react';
import type { Task } from '@/types';

// Edit a custom focus block: its name, colour, and an optional link to any task
// across the firm (search by client → pick a task, or pick an internal task).

const COLORS = ['#4f46e5', '#7c3aed', '#0ea5e9', '#059669', '#d97706', '#e11d48', '#64748b', '#0891b2'];

interface Initial { label: string; color?: string; taskId?: string | null; taskTitle?: string | null; clientName?: string | null }
interface Props {
  initial: Initial;
  tasks: Task[];
  onSave: (v: { label: string; color: string; taskId: string | null; taskTitle: string | null; clientName: string | null }) => void;
  onClose: () => void;
}

export default function OrganiseMyDayBlockEditor({ initial, tasks, onSave, onClose }: Props) {
  const [label, setLabel] = useState(initial.label || 'Custom');
  const [color, setColor] = useState(initial.color ?? '#64748b');
  const [taskId, setTaskId] = useState<string | null>(initial.taskId ?? null);
  const [taskTitle, setTaskTitle] = useState<string | null>(initial.taskTitle ?? null);
  const [clientName, setClientName] = useState<string | null>(initial.clientName ?? null);

  const [mode, setMode] = useState<'client' | 'internal'>('client');
  const [clientQuery, setClientQuery] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState('');

  // Firm clients that have tasks (derived from the loaded task list).
  const clients = useMemo(() => {
    const m = new Map<string, { id: string; name: string; ref: string | null }>();
    for (const t of tasks) if (t.client_id && t.client) m.set(t.client_id, { id: t.client_id, name: t.client.name, ref: t.client.client_ref ?? null });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const filteredClients = useMemo(() => {
    const q = clientQuery.trim().toLowerCase();
    return (q ? clients.filter(c => c.name.toLowerCase().includes(q) || (c.ref ?? '').toLowerCase().includes(q)) : clients).slice(0, 40);
  }, [clients, clientQuery]);

  const clientTasks = useMemo(() => selectedClient ? tasks.filter(t => t.client_id === selectedClient && t.status !== 'complete') : [], [tasks, selectedClient]);
  const internalTasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return tasks.filter(t => t.is_internal && t.status !== 'complete' && (!q || t.title.toLowerCase().includes(q))).slice(0, 60);
  }, [tasks, taskQuery]);

  function pickTask(t: Task) {
    setTaskId(t.id); setTaskTitle(t.title);
    setClientName(t.is_internal ? 'Internal' : (t.client?.name ?? null));
  }
  function unlink() { setTaskId(null); setTaskTitle(null); setClientName(null); }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div onMouseDown={e => e.stopPropagation()} className="w-full max-w-md max-h-[86vh] flex flex-col rounded-2xl bg-white shadow-2xl border border-black/5 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-900">Edit block</p>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Name</label>
            <input value={label} onChange={e => setLabel(e.target.value)} className="input-base w-full" placeholder="Focus time" />
          </div>

          {/* Colour */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Colour</label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} aria-label={`Colour ${c}`}
                  className={`h-7 w-7 rounded-full transition-transform ${color === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`} style={{ background: c }}>
                  {color === c && <Check size={13} className="mx-auto text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Task link */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Linked task <span className="font-normal text-gray-400">(optional — logs time against it)</span></label>
            {taskId ? (
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <Link2 size={14} className="shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-gray-800">{taskTitle}</p><p className="truncate text-[11px] text-gray-500">{clientName ?? '—'}</p></div>
                <button onClick={unlink} className="shrink-0 text-[11px] font-semibold text-rose-500 hover:underline">Unlink</button>
              </div>
            ) : (
              <>
                <div className="flex gap-1.5 mb-2">
                  <button onClick={() => setMode('client')} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold ${mode === 'client' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}><Building2 size={12} /> By client</button>
                  <button onClick={() => setMode('internal')} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] font-semibold ${mode === 'internal' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'}`}><User size={12} /> Internal</button>
                </div>
                {mode === 'client' ? (
                  !selectedClient ? (
                    <>
                      <div className="relative mb-1.5"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input autoFocus value={clientQuery} onChange={e => setClientQuery(e.target.value)} placeholder="Search clients…" className="input-base w-full !pl-8" /></div>
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                        {filteredClients.length === 0 ? <p className="px-3 py-4 text-center text-[12px] text-gray-400">No clients with tasks.</p>
                          : filteredClients.map(c => (
                            <button key={c.id} onClick={() => setSelectedClient(c.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-800">{c.name}</span>
                              {c.ref && <span className="shrink-0 text-[11px] font-mono text-gray-400">{c.ref}</span>}
                            </button>
                          ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setSelectedClient(null)} className="mb-1.5 text-[12px] font-semibold text-indigo-600 hover:underline">← Back to clients</button>
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                        {clientTasks.length === 0 ? <p className="px-3 py-4 text-center text-[12px] text-gray-400">No open tasks for this client.</p>
                          : clientTasks.map(t => (
                            <button key={t.id} onClick={() => pickTask(t)} className="w-full px-3 py-2 text-left hover:bg-gray-50"><p className="truncate text-[13px] font-medium text-gray-800">{t.title}</p></button>
                          ))}
                      </div>
                    </>
                  )
                ) : (
                  <>
                    <div className="relative mb-1.5"><Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" /><input autoFocus value={taskQuery} onChange={e => setTaskQuery(e.target.value)} placeholder="Search internal tasks…" className="input-base w-full !pl-8" /></div>
                    <div className="max-h-52 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                      {internalTasks.length === 0 ? <p className="px-3 py-4 text-center text-[12px] text-gray-400">No internal tasks.</p>
                        : internalTasks.map(t => (
                          <button key={t.id} onClick={() => pickTask(t)} className="w-full px-3 py-2 text-left hover:bg-gray-50"><p className="truncate text-[13px] font-medium text-gray-800">{t.title}</p></button>
                        ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-gray-100">
          <button onClick={onClose} className="text-[13px] font-semibold text-gray-600 px-3 py-2 rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={() => onSave({ label: label.trim() || 'Custom', color, taskId, taskTitle, clientName })} className="text-[13px] font-semibold text-white px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700">Save</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
