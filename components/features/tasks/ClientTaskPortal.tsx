'use client';

import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, Upload, X, FileText, AlertTriangle,
  Clock, Loader2, RefreshCw, ImageIcon, File,
} from 'lucide-react';

interface StepData {
  id: string;
  title: string;
  description: string | null;
  client_instructions: string | null;
  client_can_upload: boolean;
  status: string;
  due_date: string | null;
}

interface PortalData {
  token_id: string;
  expired: boolean;
  completed: boolean;
  expires_at: string;
  completed_at: string | null;
  task: { id: string; title: string; description: string | null; client: { name: string; client_ref: string } | null } | null;
  step: StepData | null;
  firm: { name: string; logo_url: string | null };
}

interface Props {
  token: string;
}

type PageState = 'loading' | 'ready' | 'expired' | 'completed' | 'not_found' | 'error';

const ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.webp,.gif,.xlsx,.xls,.csv';

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext ?? '')) return <ImageIcon className="h-4 w-4 text-blue-500" />;
  if (['xlsx', 'xls', 'csv'].includes(ext ?? '')) return <FileText className="h-4 w-4 text-green-600" />;
  return <File className="h-4 w-4 text-gray-500" />;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientTaskPortal({ token }: Props) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [data, setData] = useState<PortalData | null>(null);

  // Completion flow
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [justCompleted, setJustCompleted] = useState(false);

  // File upload
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, 'pending' | 'done' | 'error'>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Expired — refresh link flow
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshError, setRefreshError] = useState('');

  // Load portal data
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/client/task/${token}`);
        if (res.status === 404) { setPageState('not_found'); return; }
        if (!res.ok) { setPageState('error'); return; }
        const json: PortalData = await res.json();
        setData(json);
        if (json.completed) setPageState('completed');
        else if (json.expired) setPageState('expired');
        else setPageState('ready');
      } catch {
        setPageState('error');
      }
    }
    load();
  }, [token]);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const arr = Array.from(incoming);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...arr.filter(f => !existing.has(f.name + f.size))];
    });
  }

  function removeFile(name: string) {
    setFiles(prev => prev.filter(f => f.name !== name));
    setUploadProgress(prev => { const n = { ...prev }; delete n[name]; return n; });
  }

  async function uploadFiles(): Promise<boolean> {
    if (files.length === 0) return true;
    setUploading(true);
    let allOk = true;
    for (const file of files) {
      setUploadProgress(prev => ({ ...prev, [file.name]: 'pending' }));
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`/api/client/task/${token}/upload`, { method: 'POST', body: fd });
        setUploadProgress(prev => ({ ...prev, [file.name]: res.ok ? 'done' : 'error' }));
        if (!res.ok) allOk = false;
      } catch {
        setUploadProgress(prev => ({ ...prev, [file.name]: 'error' }));
        allOk = false;
      }
    }
    setUploading(false);
    return allOk;
  }

  async function handleComplete() {
    setSubmitting(true);
    setSubmitError('');
    try {
      // Upload files first if any
      if (files.length > 0) {
        const ok = await uploadFiles();
        if (!ok) {
          setSubmitError('Some files failed to upload. Please try again or remove them.');
          setSubmitting(false);
          return;
        }
      }
      // Mark complete
      const res = await fetch(`/api/client/task/${token}/complete`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSubmitError(body.error === 'already_completed' ? 'This step has already been marked as done.' : 'Something went wrong. Please try again.');
        setSubmitting(false);
        return;
      }
      setJustCompleted(true);
      setPageState('completed');
    } catch {
      setSubmitError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError('');
    try {
      const res = await fetch(`/api/client/task/${token}/refresh`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === 'already_completed') {
          setRefreshError('This step has already been completed — nothing left to do!');
        } else {
          setRefreshError('Could not refresh the link. Please contact your accountant.');
        }
        return;
      }
      const body = await res.json();
      // Redirect to new token URL
      window.location.href = body.new_url;
    } catch {
      setRefreshError('Network error. Please try again.');
    } finally {
      setRefreshing(false);
    }
    setRefreshed(true);
  }

  // ── Layout wrapper ──────────────────────────────────────────────────────────
  const firmName = data?.firm?.name ?? 'Your Accountant';
  const logoUrl  = data?.firm?.logo_url ?? null;

  function Shell({ children }: { children: React.ReactNode }) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        {/* Firm header */}
        <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3 shadow-sm">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={firmName} className="h-9 w-auto max-w-[140px] object-contain" />
          ) : (
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              {firmName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-base font-semibold text-gray-900">{firmName}</span>
        </header>

        {/* Content */}
        <main className="flex-1 flex items-start justify-center px-4 py-10">
          <div className="w-full max-w-lg">
            {children}
          </div>
        </main>

        <footer className="text-center py-4 text-xs text-gray-400">
          Powered by SMITH — secure task management for accounting firms
        </footer>
      </div>
    );
  }

  // ── States ──────────────────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin mb-3" />
          <p className="text-sm">Loading your task…</p>
        </div>
      </Shell>
    );
  }

  if (pageState === 'not_found' || pageState === 'error') {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link not found</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            This link is invalid or may have been removed. Please contact your accountant for a new link.
          </p>
        </div>
      </Shell>
    );
  }

  if (pageState === 'expired') {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <Clock className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">This link has expired</h1>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">
            The link for <strong>{data?.step?.title}</strong> on <strong>{data?.task?.title}</strong> has expired.
            Request a fresh link below and it will be sent to your browser immediately.
          </p>

          {refreshError && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4">{refreshError}</p>
          )}
          {refreshed ? (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2">
              ✓ Redirecting to your new link…
            </p>
          ) : (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Get a fresh link
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (pageState === 'completed') {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            {justCompleted ? 'All done — thank you!' : 'Already completed'}
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            {justCompleted
              ? `Your accountant has been notified that "${data?.step?.title}" is complete. We'll be in touch if anything else is needed.`
              : `"${data?.step?.title}" was already marked as done. No further action is needed.`
            }
          </p>
          {data?.task?.title && (
            <p className="mt-3 text-xs text-gray-400">Task: {data.task.title}</p>
          )}
        </div>
      </Shell>
    );
  }

  // ── Ready state ─────────────────────────────────────────────────────────────
  const step = data!.step!;
  const task = data!.task;
  const canUpload = step.client_can_upload;

  return (
    <Shell>
      <div className="space-y-4">

        {/* Task context */}
        {task && (
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide px-1">
            {task.title}{task.client ? ` · ${task.client.name}` : ''}
          </p>
        )}

        {/* Main card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {/* Step header */}
          <div className="bg-indigo-600 px-6 py-5">
            <p className="text-indigo-200 text-xs font-medium mb-1 uppercase tracking-wide">Action required from you</p>
            <h1 className="text-[var(--text-primary)] text-xl font-bold leading-snug">{step.title}</h1>
            {step.due_date && (
              <p className="text-indigo-200 text-xs mt-2 flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Due by {new Date(step.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
          </div>

          <div className="p-6 space-y-5">
            {/* Description / client instructions */}
            {(step.client_instructions || step.description) && (
              <div className="prose prose-sm max-w-none text-gray-600 text-sm leading-relaxed">
                <p className="whitespace-pre-line">{step.client_instructions ?? step.description}</p>
              </div>
            )}

            {/* File upload area */}
            {canUpload && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Attach files <span className="text-gray-400 font-normal">(optional)</span>
                </p>

                {/* Drop zone */}
                <div
                  className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); }}
                  onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                >
                  <Upload className="h-6 w-6 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    Drop files here or <span className="text-indigo-600 font-medium">browse</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">PDF, images, spreadsheets · Max 20 MB each</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ALLOWED_EXTENSIONS}
                    className="hidden"
                    onChange={e => addFiles(e.target.files)}
                  />
                </div>

                {/* File list */}
                {files.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {files.map(f => {
                      const status = uploadProgress[f.name];
                      return (
                        <li key={f.name + f.size} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                          {fileIcon(f.name)}
                          <span className="flex-1 truncate text-gray-700 text-xs">{f.name}</span>
                          <span className="text-gray-400 text-xs flex-shrink-0">{formatBytes(f.size)}</span>
                          {status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400 flex-shrink-0" />}
                          {status === 'done'    && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                          {status === 'error'   && <AlertTriangle className="h-3.5 w-3.5 text-red-400 flex-shrink-0" />}
                          {!status && (
                            <button onClick={() => removeFile(f.name)} className="text-gray-300 hover:text-red-400 flex-shrink-0">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* Error message */}
            {submitError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                {submitError}
              </p>
            )}

            {/* Submit button */}
            <button
              onClick={handleComplete}
              disabled={submitting || uploading}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm"
            >
              {submitting || uploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {uploading ? 'Uploading files…' : 'Marking as done…'}</>
              ) : (
                <><CheckCircle2 className="h-4 w-4" /> Mark as done</>
              )}
            </button>

            <p className="text-center text-xs text-gray-400">
              Clicking this will notify your accountant that this step is complete.
            </p>
          </div>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 px-4">
          This is a secure, one-time link sent by {firmName}. It expires {new Date(data!.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.
        </p>
      </div>
    </Shell>
  );
}
