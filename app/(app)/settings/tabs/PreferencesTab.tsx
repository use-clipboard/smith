'use client';

import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Star, Plus, X, Mic, Video, AlertCircle, CheckCircle2, Lock } from 'lucide-react';
import { useTheme } from '@/components/ui/ThemeProvider';
import { useFavourites } from '@/components/ui/FavouritesProvider';
import { useModules } from '@/components/ui/ModulesProvider';
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
  const { theme, setTheme } = useTheme();
  const { favourites, updateFavourites } = useFavourites();
  const { isModuleActive } = useModules();

  const [micPermission,    setMicPermission]    = useState<PermState>('unknown');
  const [cameraPermission, setCameraPermission] = useState<PermState>('unknown');
  // Which permission is showing its revoke instructions panel (null = none)
  const [revokingPermission, setRevokingPermission] = useState<'microphone' | 'camera' | null>(null);

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

  function moveUp(index: number) {
    if (index === 0) return;
    const ids = activeFavourites.map(i => i.moduleId);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    updateFavourites(ids);
  }

  function moveDown(index: number) {
    if (index === activeFavourites.length - 1) return;
    const ids = activeFavourites.map(i => i.moduleId);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    updateFavourites(ids);
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Appearance ─────────────────────────────────────────────────── */}
      <div className="glass-solid rounded-xl p-6">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Appearance</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Choose how SMITH looks. &apos;System&apos; follows your device preference.
        </p>
        <div className="flex gap-3">
          {(['light', 'dark', 'system'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`flex flex-col items-center gap-2 px-5 py-4 rounded-xl border-2 transition-all duration-150 min-w-[80px]
                ${theme === t
                  ? 'border-[var(--accent)] bg-[var(--accent-light)]'
                  : 'border-[var(--border)] hover:border-[var(--accent)] bg-[var(--bg-card)]'
                }`}
            >
              <div className={`w-10 h-7 rounded-md border border-[var(--border-input)] overflow-hidden
                ${t === 'light' ? 'bg-white' : t === 'dark' ? 'bg-[#0D0D14]' : 'bg-gradient-to-r from-white to-[#0D0D14]'}`}
              />
              <span className="text-xs font-medium capitalize text-[var(--text-primary)]">{t}</span>
            </button>
          ))}
        </div>
      </div>

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
                        <button
                          onClick={() => void revokePermission(type)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            showRevoke
                              ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                              : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-red-600 hover:border-red-200'
                          }`}
                          title="Remove this permission"
                        >
                          Revoke
                        </button>
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
            {activeFavourites.map((item, index) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.moduleId}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--accent-light)] border border-[var(--accent)]/20"
                >
                  <Star size={13} className="text-[var(--accent)] shrink-0" fill="currentColor" />
                  <Icon size={15} className="text-[var(--accent)] shrink-0" />
                  <span className="text-sm font-medium text-[var(--text-primary)] flex-1">{item.label}</span>
                  {/* Reorder */}
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      className="p-1 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      <ChevronUp size={13} className="text-[var(--text-muted)]" />
                    </button>
                    <button
                      onClick={() => moveDown(index)}
                      disabled={index === activeFavourites.length - 1}
                      className="p-1 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      <ChevronDown size={13} className="text-[var(--text-muted)]" />
                    </button>
                  </div>
                  {/* Remove */}
                  <button
                    onClick={() => removeFavourite(item.moduleId)}
                    className="p-1 rounded hover:bg-[var(--danger)]/10 transition-colors"
                    title="Remove from favourites"
                  >
                    <X size={13} className="text-[var(--text-muted)] hover:text-[var(--danger)]" />
                  </button>
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
                  <button
                    onClick={() => addFavourite(item.moduleId)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-[var(--accent)] opacity-0 group-hover:opacity-100 hover:bg-[var(--accent-light)] transition-all"
                    title="Add to favourites"
                  >
                    <Plus size={11} />
                    Pin
                  </button>
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
