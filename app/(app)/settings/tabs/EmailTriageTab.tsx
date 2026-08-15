'use client';

import { useState, useEffect, useRef } from 'react';
import { Mail, Wifi, WifiOff, Check, Loader2, ExternalLink, AlertTriangle, Bold, Italic, Underline, Link } from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import TriageCategoryManager from '@/components/features/settings/TriageCategoryManager';
import { EMAIL_FONTS, DEFAULT_EMAIL_FONT, emailFontStack } from '@/lib/emailFonts';

interface GmailStatus {
  connected: boolean;
  googleEmail: string | null;
  inboxLabel: string;
  showAsThreads: boolean;
  connectedAt: string | null;
}

export default function EmailTriageTab({ isAdmin = false }: { isAdmin?: boolean }) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [prefsSaved, setPrefsSaved] = useState(false);

  const [showAsThreads, setShowAsThreads] = useState(false);
  const [inboxLabel, setInboxLabel] = useState('INBOX');
  const [labels, setLabels] = useState<{ id: string; name: string }[]>([]);
  const [desktopNotifs, setDesktopNotifs] = useState(true);

  // Email mode (per-user): 'triage' (categories + Auto Triage + untriaged
  // counter) or 'traditional' (plain inbox + unread counter).
  const [mode, setMode] = useState<'triage' | 'traditional'>('triage');
  const [savingMode, setSavingMode] = useState(false);
  // The mode the user has clicked but not yet confirmed → drives the confirm
  // dialog. Null when no change is pending.
  const [pendingMode, setPendingMode] = useState<'triage' | 'traditional' | null>(null);
  useEffect(() => {
    fetch('/api/email/triage-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.settings?.mode === 'traditional') setMode('traditional'); })
      .catch(() => {});
  }, []);

  // Clicking a mode tile opens a confirm dialog (the change reloads the app), so
  // it never happens by accident.
  function requestMode(next: 'triage' | 'traditional') {
    if (next === mode || savingMode) return;
    setPendingMode(next);
  }

  async function confirmModeChange() {
    if (!pendingMode) return;
    setSavingMode(true);
    try {
      const res = await fetch('/api/email/triage-settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: pendingMode }),
      });
      if (!res.ok) throw new Error('save failed');
      // Reload so every surface (the tool, sidebar badge, dashboard) rebuilds
      // for the new mode in one clean pass.
      window.location.reload();
    } catch {
      setSavingMode(false);
      setPendingMode(null);
    }
  }

  // Firm-wide default font for outgoing email. Everyone sees it (it's what
  // their compose window starts in); only admins can change it.
  const [firmFont, setFirmFont] = useState(DEFAULT_EMAIL_FONT);
  const [savingFont, setSavingFont] = useState(false);
  const [fontSaved, setFontSaved] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/email/firm-settings')
      .then(r => r.ok ? r.json() : null)
      .then((d: { settings?: { defaultFont?: string } } | null) => {
        if (cancelled || !d?.settings?.defaultFont) return;
        setFirmFont(d.settings.defaultFont);
      })
      .catch(() => { /* the default stands */ });
    return () => { cancelled = true; };
  }, []);

  async function handleSaveFont(next: string) {
    setFirmFont(next);
    setSavingFont(true);
    setFontSaved(false);
    setFontError(null);
    try {
      const res = await fetch('/api/email/firm-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultFont: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? 'Couldn’t save the font.');
      }
      setFontSaved(true);
      setTimeout(() => setFontSaved(false), 2500);
    } catch (e) {
      setFontError(e instanceof Error ? e.message : 'Couldn’t save the font.');
    } finally {
      setSavingFont(false);
    }
  }

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
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email</h3>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
              Connect your Gmail account to send, receive, and manage client emails directly in SMITH.
              Each team member connects their own account.
            </p>
          </div>
        </div>
      </div>

      {/* Email mode */}
      <div className="glass-solid rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Email mode</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">Choose how the Email tool works for you. Changing this reloads the app.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { id: 'triage', title: 'Triage', desc: 'Sort emails into categories, use Auto Triage, and see an untriaged counter.' },
            { id: 'traditional', title: 'Traditional', desc: 'A plain inbox — no categories or triage. The counter shows unread emails.' },
          ] as const).map(opt => {
            const activeOpt = mode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => requestMode(opt.id)}
                disabled={savingMode}
                className={`text-left rounded-xl border p-4 transition-colors disabled:opacity-60 ${activeOpt ? 'border-[var(--accent)] bg-[var(--accent-light)]' : 'border-[var(--border)] hover:bg-[var(--bg-nav-hover)]'}`}
              >
                <span className="flex items-center gap-2">
                  <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${activeOpt ? 'border-[var(--accent)]' : 'border-[var(--border-input)]'}`}>
                    {activeOpt && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                  </span>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{opt.title}</span>
                </span>
                <span className="block text-xs text-[var(--text-muted)] mt-1.5 ml-6">{opt.desc}</span>
              </button>
            );
          })}
        </div>
        {savingMode && (
          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Switching mode…</p>
        )}
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
            <p className="text-xs text-[var(--text-muted)]">Which folder opens by default in the Email tool</p>
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

      {/* Firm default font — a firm-wide setting, so it sits outside the
          Gmail-connected gate: an admin sets the house font for everyone
          whether or not they've connected their own mailbox. Staff see it
          read-only so they know where their compose font comes from. */}
      <div className="glass-solid rounded-xl p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Outgoing Email Font</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {isAdmin
              ? 'The font every email from your firm starts in.'
              : 'Set by your firm admin.'}
            {' '}Senders can still change the font for an individual email from the compose toolbar.
          </p>
        </div>

        <select
          value={firmFont}
          onChange={e => void handleSaveFont(e.target.value)}
          disabled={!isAdmin || savingFont}
          aria-label="Firm default email font"
          className="input-base text-sm disabled:opacity-60"
          style={{ fontFamily: emailFontStack(firmFont) }}
        >
          {EMAIL_FONTS.map(f => (
            <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
          ))}
        </select>

        <p className="text-xs text-[var(--text-muted)]" style={{ fontFamily: emailFontStack(firmFont) }}>
          Preview — your emails will look like this.
        </p>

        {isAdmin && (
          <p className="text-[11px] text-[var(--text-muted)]">
            Only fonts that render reliably in email clients are listed. Anything else would
            silently fall back to the recipient’s default font, so it isn’t offered.
          </p>
        )}
        {savingFont && <p className="text-xs text-[var(--text-muted)] flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving…</p>}
        {fontSaved && <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1"><Check size={11} /> Saved</p>}
        {fontError && <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1"><AlertTriangle size={11} /> {fontError}</p>}
      </div>

      {/* Triage categories — greyed out in Traditional mode */}
      {status?.connected && (
        <div className="glass-solid rounded-xl p-5">
          {mode === 'traditional' && (
            <p className="text-xs text-[var(--text-muted)] mb-3 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-amber-500 shrink-0" />
              Categories are part of Triage mode. Switch to Triage mode to customise them.
            </p>
          )}
          <div className={mode === 'traditional' ? 'opacity-50 pointer-events-none select-none' : ''}>
            <TriageCategoryManager />
          </div>
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

      {/* Mode-change confirmation — the change reloads the app, so we warn first */}
      {pendingMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!savingMode) setPendingMode(null); }}
        >
          <div
            className="bg-[var(--bg-card-solid)] w-full max-w-sm rounded-2xl shadow-2xl border border-[var(--border)] p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} className="text-amber-500" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                  Switch to {pendingMode === 'traditional' ? 'Traditional' : 'Triage'} mode?
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">
                  SMITH will reload to apply the change.
                  {pendingMode === 'traditional'
                    ? ' Your triage categories are kept — they’re just hidden while you’re in Traditional mode.'
                    : ' Your categories and triage tools will be shown again.'}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setPendingMode(null)}
                disabled={savingMode}
                className="text-sm px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-nav-hover)] disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmModeChange}
                disabled={savingMode}
                className="text-sm px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 font-medium inline-flex items-center gap-1.5 transition-opacity"
              >
                {savingMode && <Loader2 size={12} className="animate-spin" />}
                {savingMode ? 'Applying…' : 'Confirm & reload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
