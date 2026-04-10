'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { ExternalLink, FolderOpen, ChevronRight, HardDrive, Check, RefreshCw, X } from 'lucide-react';

interface DriveItem {
  id: string;
  name: string;
  type: 'root' | 'shared_drive' | 'folder';
}

interface Breadcrumb {
  id: string;
  name: string;
  isSharedDrive?: boolean;
  driveId?: string;
}

export default function GoogleDriveSettings() {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  // Folder picker
  const [showPicker, setShowPicker] = useState(false);
  const [pickerItems, setPickerItems] = useState<DriveItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [currentDriveId, setCurrentDriveId] = useState<string | undefined>();
  const [savingFolder, setSavingFolder] = useState(false);

  const successMsg = searchParams.get('drive') === 'connected' ? 'Google Drive connected successfully.' : '';
  const errorMsg = searchParams.get('error') ?? '';

  useEffect(() => {
    fetch('/api/google-drive/status')
      .then(r => r.json())
      .then(d => {
        setConnected(d.connected);
        setFolderId(d.folderId);
        setFolderName(d.folderName);
        setLoading(false);
      });
  }, []);

  const loadRoot = useCallback(async () => {
    setPickerLoading(true);
    setBreadcrumbs([]);
    setCurrentDriveId(undefined);
    try {
      const res = await fetch('/api/google-drive/browse');
      const data = await res.json();
      setPickerItems(data.items ?? []);
    } catch {
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  async function navigateTo(item: DriveItem) {
    setPickerLoading(true);
    try {
      let url = `/api/google-drive/browse?parentId=${item.id}`;
      let driveId = currentDriveId;

      if (item.type === 'shared_drive') {
        url += '&isSharedDrive=true';
        driveId = item.id;
        setCurrentDriveId(item.id);
      } else if (driveId) {
        url += `&driveId=${driveId}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      setPickerItems(data.items ?? []);
      setBreadcrumbs(prev => [...prev, {
        id: item.id,
        name: item.name,
        isSharedDrive: item.type === 'shared_drive',
        driveId,
      }]);
    } catch {
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  }

  async function navigateToBreadcrumb(index: number) {
    const newCrumbs = index < 0 ? [] : breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newCrumbs);

    if (index < 0) {
      await loadRoot();
      return;
    }

    const crumb = newCrumbs[newCrumbs.length - 1];
    setPickerLoading(true);
    try {
      let url = `/api/google-drive/browse?parentId=${crumb.id}`;
      if (crumb.isSharedDrive) url += '&isSharedDrive=true';
      else if (crumb.driveId) url += `&driveId=${crumb.driveId}`;
      const res = await fetch(url);
      const data = await res.json();
      setPickerItems(data.items ?? []);
      setCurrentDriveId(crumb.isSharedDrive ? crumb.id : crumb.driveId);
    } finally {
      setPickerLoading(false);
    }
  }

  async function handleSelectFolder(targetId: string, targetName: string) {
    setSavingFolder(true);
    try {
      const res = await fetch('/api/google-drive/folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: targetId, folderName: targetName }),
      });
      if (!res.ok) throw new Error('Save failed');
      setFolderId(targetId);
      setFolderName(targetName);
      setShowPicker(false);
    } catch {
      alert('Failed to save folder selection. Please try again.');
    } finally {
      setSavingFolder(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Google Drive? Existing files will remain in Drive but new uploads will stop working.')) return;
    setDisconnecting(true);
    await fetch('/api/google-drive/disconnect', { method: 'POST' });
    setConnected(false);
    setFolderId(null);
    setFolderName(null);
    setShowPicker(false);
    setDisconnecting(false);
  }

  const currentCrumb = breadcrumbs[breadcrumbs.length - 1];

  return (
    <div className="glass-solid rounded-xl border border-[var(--border)]">
      <div className="px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Google Drive</h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">
          Store uploaded client documents in your firm&apos;s Google Drive. Admins can choose any Drive or shared drive folder.
        </p>
      </div>

      <div className="p-6">
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900/30 rounded-lg text-sm text-green-700 dark:text-green-400">
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg text-sm text-red-700 dark:text-red-400">
            {decodeURIComponent(errorMsg)}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Checking connection…</p>
        ) : connected ? (
          <div className="space-y-4">
            {/* Connected row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0 mt-1" />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Connected</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-[var(--text-muted)]">
                      Storing in: <span className="font-medium text-[var(--text-secondary)]">{folderName ?? 'SMITH Files'}</span>
                    </span>
                    {folderId && (
                      <a
                        href={`https://drive.google.com/drive/folders/${folderId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                      >
                        Open <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => { setShowPicker(p => !p); if (!showPicker) loadRoot(); }}
                  className="text-sm text-[var(--accent)] hover:underline font-medium"
                >
                  Change folder
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-sm text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
                >
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </button>
              </div>
            </div>

            {/* Folder picker */}
            {showPicker && (
              <div className="border border-[var(--border)] rounded-xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-page)] border-b border-[var(--border)]">
                  <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Choose a folder</p>
                  <button onClick={() => setShowPicker(false)} className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={14} />
                  </button>
                </div>

                {/* Breadcrumbs */}
                <div className="flex items-center gap-1 px-4 py-2 bg-[var(--bg-page)] border-b border-[var(--border)] text-sm overflow-x-auto">
                  <button
                    onClick={() => navigateToBreadcrumb(-1)}
                    className="text-[var(--accent)] hover:underline whitespace-nowrap shrink-0 text-xs"
                  >
                    All Drives
                  </button>
                  {breadcrumbs.map((crumb, i) => (
                    <span key={`${crumb.id}-${i}`} className="flex items-center gap-1 shrink-0">
                      <ChevronRight size={11} className="text-[var(--text-muted)]" />
                      <button
                        onClick={() => navigateToBreadcrumb(i)}
                        className={`text-xs whitespace-nowrap ${i === breadcrumbs.length - 1 ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--accent)] hover:underline'}`}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </div>

                {/* Items */}
                <div className="max-h-60 overflow-y-auto">
                  {pickerLoading ? (
                    <div className="flex items-center justify-center h-20">
                      <RefreshCw size={16} className="animate-spin text-[var(--text-muted)]" />
                    </div>
                  ) : pickerItems.length === 0 ? (
                    <p className="p-6 text-sm text-[var(--text-muted)] text-center">No folders found here</p>
                  ) : (
                    <ul>
                      {pickerItems.map(item => (
                        <li key={item.id} className="flex items-center border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-page)] transition-colors">
                          <button
                            onClick={() => navigateTo(item)}
                            className="flex-1 flex items-center gap-2.5 px-4 py-2.5 text-left min-w-0"
                          >
                            {item.type === 'shared_drive' || item.type === 'root' ? (
                              <HardDrive size={15} className="text-[var(--accent)] shrink-0" />
                            ) : (
                              <FolderOpen size={15} className="text-amber-500 shrink-0" />
                            )}
                            <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{item.name}</span>
                            <ChevronRight size={13} className="text-[var(--text-muted)] shrink-0" />
                          </button>
                          {item.type === 'folder' && (
                            <button
                              onClick={() => handleSelectFolder(item.id, item.name)}
                              disabled={savingFolder}
                              className="shrink-0 px-3 py-2.5 text-xs font-medium text-[var(--accent)] hover:text-[var(--accent-hover)] disabled:opacity-50 border-l border-[var(--border)]"
                              title="Use this folder"
                            >
                              Use
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Use current folder footer (only when inside a folder, not at drive root) */}
                {currentCrumb && !currentCrumb.isSharedDrive && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] bg-[var(--bg-page)]">
                    <p className="text-xs text-[var(--text-muted)]">
                      Current: <span className="font-medium text-[var(--text-secondary)]">{currentCrumb.name}</span>
                    </p>
                    <button
                      onClick={() => handleSelectFolder(currentCrumb.id, currentCrumb.name)}
                      disabled={savingFolder}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-xs font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
                    >
                      {savingFolder ? <RefreshCw size={11} className="animate-spin" /> : <Check size={11} />}
                      Use this folder
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-[var(--border-input)]" />
              <p className="text-sm text-[var(--text-muted)]">Not connected</p>
            </div>
            <a href="/api/auth/google" className="btn-secondary">
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Connect Google Drive
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
