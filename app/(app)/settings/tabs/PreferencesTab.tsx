'use client';

import { useState, useEffect } from 'react';
import { GripVertical, Star, Plus, X, Mic, Video, AlertCircle, CheckCircle2, Lock, Bell, CalendarClock } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useFavourites } from '@/components/ui/FavouritesProvider';
import { useModules } from '@/components/ui/ModulesProvider';
import { DEFAULT_ORGANISE_SETTINGS, type OrganiseSettings } from '@/lib/tasks/organiseSettings';
import { FAVOURITABLE_ITEMS } from '@/config/navItems';

type PermState = PermissionState | 'unknown' | 'requesting';

function PermissionBadge({ state }: { state: PermState }) {
  if (state === 'granted')    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Granted</span>;
  if (state === 'denied')     return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />Blocked</span>;
  if (state === 'prompt')     return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Not yet set</span>;
  if (state === 'requesting') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />Requesting…</span>;
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-gray-400" />Unknown</span>;
}

export default function PreferencesTab() {
  const { favourites, updateFavourites } = useFavourites();
  const { isModuleActive } = useModules();

  const [micPermission,    setMicPermission]    = useState<PermState>('unknown');
  const [cameraPermission, setCameraPermission] = useState<PermState>('unknown');
  // Which permission is showing its revoke instructions panel (null = none)
  const [revokingPermission, setRevokingPermission] = useState<'microphone' | 'camera' | null>(null);

  // ── Task-change notification preference (per-user) ────────────────────
  const hasTasks = isModuleActive('tasks');
  type TaskNotify = 'all' | 'oneoff' | 'none';
  const [taskNotify, setTaskNotify] = useState<TaskNotify>('all');
  const [taskNotifyLoaded, setTaskNotifyLoaded] = useState(false);

  useEffect(() => {
    if (!hasTasks) return;
    let cancelled = false;
    fetch('/api/users/notification-prefs')
      .then(r => r.ok ? r.json() : { notify_task_changes: 'all' })
      .then(d => { if (!cancelled) { setTaskNotify((d.notify_task_changes as TaskNotify) ?? 'all'); setTaskNotifyLoaded(true); } })
      .catch(() => { if (!cancelled) setTaskNotifyLoaded(true); });
    return () => { cancelled = true; };
  }, [hasTasks]);

  function updateTaskNotify(value: TaskNotify) {
    const prev = taskNotify;
    setTaskNotify(value); // optimistic
    fetch('/api/users/notification-prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_task_changes: value }),
    }).then(r => { if (!r.ok) setTaskNotify(prev); }).catch(() => setTaskNotify(prev));
  }

  // ── Organise-my-day planner preferences (per-user) ────────────────────
  const [org, setOrg] = useState<OrganiseSettings>(DEFAULT_ORGANISE_SETTINGS);
  const [orgLoaded, setOrgLoaded] = useState(false);
  useEffect(() => {
    if (!hasTasks) return;
    let cancelled = false;
    fetch('/api/users/organise-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { if (d?.settings) setOrg(d.settings as OrganiseSettings); setOrgLoaded(true); } })
      .catch(() => { if (!cancelled) setOrgLoaded(true); });
    return () => { cancelled = true; };
  }, [hasTasks]);
  function patchOrg(p: Partial<OrganiseSettings>) {
    const next = { ...org, ...p };
    setOrg(next); // optimistic
    fetch('/api/users/organise-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) })
      .then(r => (r.ok ? r.json() : null)).then(d => { if (d?.settings) setOrg(d.settings as OrganiseSettings); }).catch(() => {});
  }
  const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

  // Query current permission states on mount
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    void Promise.all([
      navigator.permissions.query({ name: 'microphone' as PermissionName }),
      navigator.permissions.query({ name: 'camera' as PermissionName }),
    ]).then(([mic, cam]) => {
      setMicPermission(mic.state);
      setCameraPermission(cam.state);
      // React live to browser-level changes (e.g. user changes via address bar padlock)
      mic.onchange = () => { setMicPermission(mic.state); if (mic.state !== 'granted') setRevokingPermission(null); };
      cam.onchange = () => { setCameraPermission(cam.state); if (cam.state !== 'granted') setRevokingPermission(null); };
    }).catch(() => { /* permissions API not available */ });
  }, []);

  async function requestMic() {
    setMicPermission('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicPermission('granted');
    } catch {
      setMicPermission('denied');
    }
  }

  async function requestCamera() {
    setCameraPermission('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      setCameraPermission('granted');
    } catch {
      setCameraPermission('denied');
    }
  }

  async function revokePermission(type: 'microphone' | 'camera') {
    // Try the browser's programmatic revoke API (non-standard, works in some browsers)
    try {
      if (navigator.permissions && 'revoke' in navigator.permissions) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (navigator.permissions as any).revoke({ name: type as PermissionName }) as PermissionStatus;
        if (result.state !== 'granted') {
          if (type === 'microphone') setMicPermission(result.state);
          else setCameraPermission(result.state);
          return; // Successfully revoked — no need to show instructions
        }
      }
    } catch { /* revoke API not available in this browser */ }
    // Programmatic revoke not available — show manual browser instructions
    setRevokingPermission(prev => prev === type ? null : type);
  }

  // Only show favouritable items whose module is active (or is always-active like clients)
  const availableItems = FAVOURITABLE_ITEMS.filter(item =>
    item.moduleId === 'clients' || isModuleActive(item.moduleId)
  );

  // Current favourites — filtered to only active items (gracefully drops deactivated ones)
  const activeFavourites = favourites
    .map(id => availableItems.find(i => i.moduleId === id))
    .filter((i): i is typeof availableItems[0] => i !== undefined);

  // Items not yet in favourites
  const unpinned = availableItems.filter(item => !favourites.includes(item.moduleId));

  function addFavourite(moduleId: string) {
    updateFavourites([...activeFavourites.map(i => i.moduleId), moduleId]);
  }

  function removeFavourite(moduleId: string) {
    updateFavourites(activeFavourites.map(i => i.moduleId).filter(id => id !== moduleId));
  }

  // ── Drag-to-reorder state ────────────────────────────────────────────
  // Insertion-line UX: dropping on the top half of a row inserts ABOVE it,
  // bottom half inserts BELOW. This matches what the user sees and avoids
  // the swap-like asymmetry between upward and downward drags.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after'>('before');

  function onDragStart(e: React.DragEvent<HTMLDivElement>, moduleId: string) {
    setDraggingId(moduleId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', moduleId);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>, overId: string) {
    if (!draggingId || draggingId === overId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos: 'before' | 'after' = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    if (dragOverId !== overId) setDragOverId(overId);
    if (dragOverPos !== pos) setDragOverPos(pos);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>, overId: string) {
    e.preventDefault();
    const fromId = draggingId ?? e.dataTransfer.getData('text/plain');
    const pos = dragOverPos;
    setDraggingId(null);
    setDragOverId(null);
    if (!fromId || fromId === overId) return;
    const ids = activeFavourites.map(i => i.moduleId);
    const fromIdx = ids.indexOf(fromId);
    const overIdx = ids.indexOf(overId);
    if (fromIdx < 0 || overIdx < 0) return;
    ids.splice(fromIdx, 1);
    // Insertion target index accounting for both the removal and before/after intent
    const insertIdx = (pos === 'before')
      ? (fromIdx < overIdx ? overIdx - 1 : overIdx)
      : (fromIdx < overIdx ? overIdx : overIdx + 1);
    ids.splice(insertIdx, 0, fromId);
    updateFavourites(ids);
  }

  function onDragEnd() {
    setDraggingId(null);
    setDragOverId(null);
  }

  const TASK_NOTIFY_OPTIONS: { value: TaskNotify; label: string; sub: string }[] = [
    { value: 'all',    label: 'All tasks',        sub: 'Notify me about any task assigned, updated or completed.' },
    { value: 'oneoff', label: 'One-off tasks only', sub: 'Skip recurring and template-generated tasks — only notify me about ad-hoc ones.' },
    { value: 'none',   label: 'None',             sub: 'Don’t send me any task-change notifications.' },
  ];

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Notifications (only if the Tasks tool is active) ────────────── */}
      {hasTasks && (
        <div className="glass-solid rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <Bell size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Task notifications</h3>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-5">
            Choose which task changes reach your notification bell. This affects only you — if you set up a lot of recurring or template tasks, switch to “one-off only” to cut the noise.
          </p>
          <div className="space-y-2.5">
            {TASK_NOTIFY_OPTIONS.map(opt => {
              const active = taskNotify === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => updateTaskNotify(opt.value)}
                  disabled={!taskNotifyLoaded}
                  className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                    active ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--accent)]/50'
                  }`}
                >
                  <span className={`mt-0.5 grid place-items-center h-4 w-4 rounded-full border shrink-0 ${active ? 'border-[var(--accent)]' : 'border-slate-300'}`}>
                    {active && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-[var(--text-primary)]">{opt.label}</span>
                    <span className="block text-xs text-[var(--text-muted)] mt-0.5">{opt.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Organise my day (only if the Tasks tool is active) ──────────── */}
      {hasTasks && (
        <div className="glass-solid rounded-xl p-6">
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock size={15} className="text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Organise my day</h3>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-5">
            Shape the working day the planner schedules your tasks into — your hours, lunch, a buffer between blocks, and time to wrap up. Just for you.
          </p>
          <div className="space-y-4">
            {/* Working hours */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><p className="text-sm font-medium text-[var(--text-primary)]">Working hours</p><p className="text-xs text-[var(--text-muted)]">When your day starts and ends</p></div>
              <div className="flex items-center gap-2">
                <input type="time" value={toHHMM(org.workStartMin)} disabled={!orgLoaded} onChange={e => patchOrg({ workStartMin: fromHHMM(e.target.value) })} className="input-base !py-1.5 !w-28" />
                <span className="text-xs text-[var(--text-muted)]">to</span>
                <input type="time" value={toHHMM(org.workEndMin)} disabled={!orgLoaded} onChange={e => patchOrg({ workEndMin: fromHHMM(e.target.value) })} className="input-base !py-1.5 !w-28" />
              </div>
            </div>
            {/* Lunch */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><p className="text-sm font-medium text-[var(--text-primary)]">Lunch</p><p className="text-xs text-[var(--text-muted)]">Blocked out so tasks schedule around it</p></div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <input type="checkbox" checked={org.lunchStartMin != null} disabled={!orgLoaded} onChange={e => patchOrg({ lunchStartMin: e.target.checked ? 13 * 60 : null })} /> On
                </label>
                {org.lunchStartMin != null && (
                  <>
                    <input type="time" value={toHHMM(org.lunchStartMin)} disabled={!orgLoaded} onChange={e => patchOrg({ lunchStartMin: fromHHMM(e.target.value) })} className="input-base !py-1.5 !w-28" />
                    <select value={org.lunchMinutes} disabled={!orgLoaded} onChange={e => patchOrg({ lunchMinutes: Number(e.target.value) })} className="input-base !py-1.5">
                      {[30, 45, 60].map(v => <option key={v} value={v}>{v} min</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
            {/* Buffer */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><p className="text-sm font-medium text-[var(--text-primary)]">Buffer between blocks</p><p className="text-xs text-[var(--text-muted)]">Breathing room between scheduled items</p></div>
              <select value={org.bufferMinutes} disabled={!orgLoaded} onChange={e => patchOrg({ bufferMinutes: Number(e.target.value) })} className="input-base !py-1.5">
                {[0, 5, 10, 15].map(v => <option key={v} value={v}>{v === 0 ? 'None' : `${v} min`}</option>)}
              </select>
            </div>
            {/* Wrap */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div><p className="text-sm font-medium text-[var(--text-primary)]">End-of-day wrap</p><p className="text-xs text-[var(--text-muted)]">Reserve time to wrap up &amp; plan tomorrow</p></div>
              <select value={org.wrapMinutes} disabled={!orgLoaded} onChange={e => patchOrg({ wrapMinutes: Number(e.target.value) })} className="input-base !py-1.5">
                {[0, 10, 15, 30].map(v => <option key={v} value={v}>{v === 0 ? 'Off' : `${v} min`}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Device Permissions ─────────────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Device Permissions</h3>
        <p className="text-xs text-[var(--text-muted)] mb-5">
          Required by the Meeting Notes tool for microphone recording and screen capture. Grant or revoke access here at any time.
        </p>
        <div className="space-y-3">

          {/* ── Microphone row ── */}
          {(['microphone', 'camera'] as const).map(type => {
            const isMic    = type === 'microphone';
            const state    = isMic ? micPermission : cameraPermission;
            const label    = isMic ? 'Microphone' : 'Camera';
            const subLabel = isMic ? 'Voice recording & live transcription' : 'Optional — reserved for future video features';
            const iconBg   = isMic ? 'bg-red-100' : 'bg-indigo-100';
            const iconCls  = isMic ? 'text-red-600' : 'text-indigo-600';
            const Icon     = isMic ? Mic : Video;
            const showRevoke = revokingPermission === type;

            return (
              <div key={type} className={`rounded-lg border bg-[var(--bg-card)] overflow-hidden transition-colors ${showRevoke ? 'border-amber-300' : 'border-[var(--border)]'}`}>
                {/* Main row */}
                <div className="flex items-center justify-between gap-3 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon size={15} className={iconCls} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
                      <p className="text-xs text-[var(--text-muted)]">{subLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <PermissionBadge state={state} />
                    {state === 'granted' ? (
                      <>
                        <CheckCircle2 size={15} className="text-green-500" />
                        <Tooltip label="Remove this permission">
                          <button
                            onClick={() => void revokePermission(type)}
                            aria-label="Remove this permission"
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                              showRevoke
                                ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                                : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-red-600 hover:border-red-200'
                            }`}
                          >
                            Revoke
                          </button>
                        </Tooltip>
                      </>
                    ) : state !== 'requesting' ? (
                      <button
                        onClick={() => void (isMic ? requestMic() : requestCamera())}
                        className="px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white rounded-lg hover:bg-[var(--accent-hover)] transition-colors"
                      >
                        Request Access
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Revoke instructions panel — slides open when user clicks Revoke */}
                {showRevoke && (
                  <div className="px-4 pb-4 pt-1 border-t border-amber-200 bg-amber-50">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-xs font-semibold text-amber-800">How to revoke {label.toLowerCase()} access</p>
                      <button onClick={() => setRevokingPermission(null)} className="text-amber-500 hover:text-amber-700 shrink-0">
                        <X size={13} />
                      </button>
                    </div>
                    <ol className="text-xs text-amber-700 space-y-1.5 list-none">
                      <li className="flex items-start gap-2">
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold shrink-0 mt-0.5 text-[10px]">1</span>
                        <span>Click the <Lock size={10} className="inline mb-0.5" /> <strong>padlock icon</strong> in your browser&apos;s address bar (at the top of the page)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold shrink-0 mt-0.5 text-[10px]">2</span>
                        <span>Find <strong>{label}</strong> in the permissions list and change it to <strong>Block</strong> or <strong>Reset to default</strong></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold shrink-0 mt-0.5 text-[10px]">3</span>
                        <span>The permission status above will update automatically — no page refresh needed</span>
                      </li>
                    </ol>
                  </div>
                )}
              </div>
            );
          })}

          {/* Blocked warning */}
          {(micPermission === 'denied' || cameraPermission === 'denied') && (
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>
                A permission is blocked by your browser. To re-enable it, click the <strong>padlock icon</strong> in your browser address bar, set the permission to <strong>Allow</strong>, then refresh the page.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Favourites ─────────────────────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Sidebar Favourites</h3>
        <p className="text-xs text-[var(--text-muted)] mb-5">
          Pin items to the top of your sidebar for quick access. Your choices only affect your own view.
        </p>

        {/* Current favourites */}
        {activeFavourites.length > 0 ? (
          <div className="space-y-1 mb-5">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Pinned — drag to reorder
            </p>
            {activeFavourites.map(item => {
              const Icon = item.icon;
              const isDragging = draggingId === item.moduleId;
              const showLineAbove = dragOverId === item.moduleId && dragOverPos === 'before' && draggingId !== item.moduleId;
              const showLineBelow = dragOverId === item.moduleId && dragOverPos === 'after' && draggingId !== item.moduleId;
              return (
                <div key={item.moduleId} className="relative">
                  {/* Insertion indicator above */}
                  <div className={`absolute left-2 right-2 -top-[3px] h-[3px] rounded-full bg-[var(--accent)] transition-opacity duration-100 pointer-events-none ${showLineAbove ? 'opacity-100' : 'opacity-0'}`} />
                  <div
                    draggable
                    onDragStart={e => onDragStart(e, item.moduleId)}
                    onDragOver={e => onDragOver(e, item.moduleId)}
                    onDrop={e => onDrop(e, item.moduleId)}
                    onDragEnd={onDragEnd}
                    onDragLeave={() => { if (dragOverId === item.moduleId) setDragOverId(null); }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent-light)] border border-[var(--accent)]/20 cursor-grab active:cursor-grabbing select-none transition-all duration-150
                      ${isDragging ? 'opacity-60 scale-[1.02] shadow-xl ring-2 ring-[var(--accent)]/40 rotate-[0.5deg]' : 'shadow-sm hover:shadow-md'}
                    `}
                  >
                    <GripVertical size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden />
                    <Star size={13} className="text-[var(--accent)] shrink-0" fill="currentColor" />
                    <Icon size={15} className="text-[var(--accent)] shrink-0" />
                    <span className="text-sm font-medium text-[var(--text-primary)] flex-1">{item.label}</span>
                    <Tooltip label="Remove from favourites">
                      <button
                        onPointerDown={e => e.stopPropagation()}
                        onClick={() => removeFavourite(item.moduleId)}
                        aria-label="Remove from favourites"
                        className="p-1 rounded hover:bg-[var(--danger)]/10 transition-colors"
                      >
                        <X size={13} className="text-[var(--text-muted)] hover:text-[var(--danger)]" />
                      </button>
                    </Tooltip>
                  </div>
                  {/* Insertion indicator below */}
                  <div className={`absolute left-2 right-2 -bottom-[3px] h-[3px] rounded-full bg-[var(--accent)] transition-opacity duration-100 pointer-events-none ${showLineBelow ? 'opacity-100' : 'opacity-0'}`} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6 mb-4 rounded-lg border border-dashed border-[var(--border)] text-center">
            <Star size={18} className="text-[var(--text-muted)] opacity-40 mb-2" />
            <p className="text-xs text-[var(--text-muted)]">No favourites pinned yet.</p>
            <p className="text-xs text-[var(--text-muted)]">Add items from the list below.</p>
          </div>
        )}

        {/* Available to pin */}
        {unpinned.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Available to pin
            </p>
            {unpinned.map(item => {
              const Icon = item.icon;
              return (
                <div
                  key={item.moduleId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-nav-hover)] transition-colors group"
                >
                  <Star size={13} className="text-[var(--text-muted)] opacity-30 shrink-0" />
                  <Icon size={15} className="text-[var(--text-muted)] shrink-0" />
                  <span className="text-sm text-[var(--text-secondary)] flex-1">{item.label}</span>
                  <Tooltip label="Add to favourites">
                    <button
                      onClick={() => addFavourite(item.moduleId)}
                      aria-label="Add to favourites"
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[var(--accent)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-light)] transition-all"
                    >
                      <Plus size={11} />
                      Pin
                    </button>
                  </Tooltip>
                </div>
              );
            })}
          </div>
        )}

        {availableItems.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            No tools are currently active. Ask your admin to enable modules in Settings → Tools.
          </p>
        )}
      </div>
    </div>
  );
}
