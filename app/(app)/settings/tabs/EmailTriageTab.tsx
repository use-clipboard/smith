'use client';

import { useState, useEffect, useRef } from 'react';
import { Mail, Wifi, WifiOff, Check, Loader2, ExternalLink, AlertTriangle, Bold, Italic, Underline, Link } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import TriageCategoryManager from '@/components/features/settings/TriageCategoryManager';

interface GmailStatus {
  connected: boolean;
  googleEmail: string | null;
  inboxLabel: string;
  showAsThreads: boolean;
  connectedAt: string | null;
}

export default function EmailTriageTab() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [showAsThreads, setShowAsThreads] = useState(false);
  const [inboxLabel, setInboxLabel] = useState('INBOX');
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [desktopNotifs, setDesktopNotifs] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const v = localStorage.getItem('smith:email_desktop_notifications');
    setDesktopNotifs(v === null ? true : v === 'true');
  }, []);

  function toggleDesktopNotifs() {
    const next = !desktopNotifs;
    setDesktopNotifs(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('smith:email_desktop_notifications', String(next));
    }
  }

  const [signature, setSignature] = useState<string | null>(null);
  const [loadingSig, setLoadingSig] = useState(false);
  const [savingSig, setSavingSig] = useState(false);
  const [sigSaved, setSigSaved] = useState(false);
  const [sigError, setSigError] = useState('');
  const sigRef = useRef<HTMLDivElement>(null);

  async function loadStatus() {
    setLoading(true);
    try {
      const [statusRes, labelsRes] = await Promise.all([
        fetch('/api/email/status'),
        fetch('/api/email/labels'),
      ]);
      const s = await statusRes.json() as GmailStatus;
      const l = await labelsRes.json() as { labels: { id: string; name: string; type: string }[] };
      setStatus(s);
      setShowAsThreads(s.showAsThreads ?? false);
      setInboxLabel(s.inboxLabel ?? 'INBOX');
      setLabels((l.labels ?? []).filter(x => ['INBOX', 'ALL_MAIL', 'SENT', 'STARRED', 'IMPORTANT'].includes(x.id) || x.type === 'user'));
      if (s.connected) loadSignature();
    } finally {
      setLoading(false);
    }
  }

  async function loadSignature() {
    setLoadingSig(true);
    try {
      const res = await fetch('/api/email/signature');
      const data = await res.json() as { signature: string | null };
      setSignature(data.signature ?? '');
      requestAnimationFrame(() => {
        if (sigRef.current) sigRef.current.innerHTML = data.signature ?? '';
      });
    } finally {
      setLoadingSig(false);
    }
  }

  async function handleSaveSignature() {
    const html = sigRef.current?.innerHTML ?? '';
    setSavingSig(true);
    setSigError('');
    try {
      const res = await fetch('/api/email/signature', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: html }),
      });
      if (!res.ok) throw new Error('Failed');
      setSigSaved(true);
      setTimeout(() => setSigSaved(false), 2500);
    } catch {
      setSigError('Failed to save signature. Please try again.');
    } finally {
      setSavingSig(false);
    }
  }

  function fmt(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
    sigRef.current?.focus();
  }

  function handleInsertLink() {
    const url = prompt('Enter URL:');
    if (url) fmt('createLink', url);
  }

  useEffect(() => { loadStatus(); }, []);

  async function handleDisconnect() {
    if (!confirm('Disconnect Gmail? Your emails will no longer appear in SMITH.')) return;
    setDisconnecting(true);
    try {
      await fetch('/api/email/auth/disconnect', { method: 'DELETE' });
      setStatus(prev => prev ? { ...prev, connected: false, googleEmail: null } : null);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSavePrefs() {
    setSavingPrefs(true);
    try {
      await fetch('/api/email/labels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inboxLabel, showAsThreads }),
      });
      setPrefsSaved(true);
      setTimeout(() => setPrefsSaved(false), 2500);
    } finally {
      setSavingPrefs(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-solid rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
            <Mail size={16} className="text-[var(--accent)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email Triage</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Connect your Gmail account to send, receive, and triage client emails directly in SMITH.
              Each team member connects their own account.
            </p>
          </div>
        </div>
      </div>

      {/* Gmail connection */}
      <div className="glass-solid rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">My Gmail Account</h3>

        {status?.connected ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Wifi size={14} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Connected</p>
                {status.googleEmail && (
                  <p className="text-xs text-[var(--text-muted)]">{status.googleEmail}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="btn-secondary text-sm text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-nav-hover)] flex items-center justify-center">
                <WifiOff size={14} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Not connected</p>
                <p className="text-xs text-[var(--text-muted)]">Connect to start triaging emails in SMITH</p>
              </div>
            </div>
            <a
              href="/api/email/auth/connect"
              className="btn-primary text-sm flex items-center gap-1.5 shrink-0"
            >
              <Mail size={13} /> Connect Gmail
            </a>
          </div>
        )}

        <div className="p-3 rounded-xl bg-[var(--bg-nav-hover)] text-xs text-[var(--text-muted)] space-y-1">
          <p className="font-medium text-[var(--text-secondary)]">Setup required</p>
          <p>
            Add{' '}
            <code className="bg-[var(--border)] px-1 rounded text-[var(--text-primary)]">
              {typeof window !== 'undefined' ? window.location.origin : 'https://yourapp.com'}/auth/email/callback
            </code>{' '}
            as an authorised redirect URI in your Google Cloud Console OAuth app.
          </p>
          <a
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline"
          >
            Open Google Cloud Console <ExternalLink size={11} />
          </a>
        </div>
      </div>

      {/* Display preferences */}
      {status?.connected && (
        <div className="glass-solid rounded-xl p-5 space-y-5">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Display Preferences</h3>

          {/* Thread / flat toggle */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Group as conversations</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Show emails grouped by thread. We recommend keeping this off so each email is listed on its own.</p>
            </div>
            <button
              onClick={() => setShowAsThreads(v => !v)}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors
                ${showAsThreads ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
              aria-label="Toggle thread grouping"
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                ${showAsThreads ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Desktop notification toggle (saved per device in localStorage) */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">New email notifications</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Slide-in toast in the bottom-right when a new email arrives, visible from any tool. Saved per device.</p>
            </div>
            <button
              onClick={toggleDesktopNotifs}
              className={`relative inline-flex h-5 w-9 rounded-full transition-colors
                ${desktopNotifs ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}
              aria-label="Toggle new email notifications"
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5
                ${desktopNotifs ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Default inbox label */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-primary)]">Default inbox view</label>
            <select
              value={inboxLabel}
              onChange={e => setInboxLabel(e.target.value)}
              className="input-base text-sm"
            >
              <option value="INBOX">Inbox</option>
              <option value="ALL_MAIL">All Mail</option>
              <option value="STARRED">Starred</option>
              <option value="IMPORTANT">Important</option>
              {labels.filter(l => !['INBOX', 'ALL_MAIL', 'STARRED', 'IMPORTANT'].includes(l.id)).map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="text-xs text-[var(--text-muted)]">Which folder opens by default in Email Triage</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSavePrefs}
              disabled={savingPrefs}
              className="btn-primary"
            >
              {savingPrefs ? 'Saving…' : 'Save Preferences'}
            </button>
            {prefsSaved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        </div>
      )}

      {/* Triage categories */}
      {status?.connected && (
        <div className="glass-solid rounded-xl p-5">
          <TriageCategoryManager />
        </div>
      )}

      {/* Signature editor */}
      {status?.connected && (
        <div className="glass-solid rounded-xl p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email Signature</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Saved directly to Gmail — appears on all emails you send from any device.
            </p>
          </div>

          {loadingSig ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 size={14} className="animate-spin text-[var(--text-muted)]" />
              <span className="text-xs text-[var(--text-muted)]">Loading signature…</span>
            </div>
          ) : (
            <>
              {/* Formatting toolbar */}
              <div className="flex items-center gap-0.5 p-1.5 bg-[var(--bg-nav-hover)] border border-[var(--border)] rounded-t-lg border-b-0">
                <Tooltip label="Bold"><button aria-label="Bold" onMouseDown={e => { e.preventDefault(); fmt('bold'); }} className="p-1.5 rounded hover:bg-[var(--bg-page)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><Bold size={13} /></button></Tooltip>
                <Tooltip label="Italic"><button aria-label="Italic" onMouseDown={e => { e.preventDefault(); fmt('italic'); }} className="p-1.5 rounded hover:bg-[var(--bg-page)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><Italic size={13} /></button></Tooltip>
                <Tooltip label="Underline"><button aria-label="Underline" onMouseDown={e => { e.preventDefault(); fmt('underline'); }} className="p-1.5 rounded hover:bg-[var(--bg-page)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><Underline size={13} /></button></Tooltip>
                <div className="w-px h-4 bg-[var(--border)] mx-1" />
                <Tooltip label="Insert link"><button aria-label="Insert link" onMouseDown={e => { e.preventDefault(); handleInsertLink(); }} className="p-1.5 rounded hover:bg-[var(--bg-page)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"><Link size={13} /></button></Tooltip>
              </div>

              {/* Editor */}
              <div
                ref={sigRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[100px] max-h-[220px] overflow-y-auto p-3 text-sm text-[var(--text-primary)] bg-[var(--bg-page)] border border-[var(--border)] rounded-b-lg outline-none focus:border-[var(--accent)] transition-colors [&_a]:text-[var(--accent)] [&_a]:underline"
              />

              {/* Preview label */}
              <p className="text-[11px] text-[var(--text-muted)]">
                Tip: keep it concise — name, job title, phone, and a link if needed.
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleSaveSignature}
                  disabled={savingSig}
                  className="btn-primary flex items-center gap-1.5 disabled:opacity-50"
                >
                  {savingSig ? <Loader2 size={13} className="animate-spin" /> : null}
                  {savingSig ? 'Saving…' : 'Save Signature'}
                </button>
                {sigSaved && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <Check size={12} /> Saved to Gmail
                  </span>
                )}
                {sigError && (
                  <span className="text-xs text-red-500">{sigError}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className="glass-solid rounded-xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">How it works</h3>
        <ul className="space-y-2 text-xs text-[var(--text-muted)]">
          <li className="flex items-start gap-2">
            <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
            Emails refresh automatically every 30 seconds — no manual refresh needed
          </li>
          <li className="flex items-start gap-2">
            <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
            Allocate emails to one or more client timelines — they appear with an Email tag
          </li>
          <li className="flex items-start gap-2">
            <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
            Email signatures are pulled from your Gmail settings automatically
          </li>
          <li className="flex items-start gap-2">
            <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
            Use &ldquo;Suggest reply&rdquo; to get an AI-drafted response in your tone
          </li>
          <li className="flex items-start gap-2">
            <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
            Email content is read live from Gmail and is never stored in SMITH
          </li>
        </ul>
      </div>
    </div>
  );
}
