'use client';

import { useEffect, useState } from 'react';

interface Summary {
  expired: boolean;
  alreadyResponded: boolean;
  approvedAt: string | null;
  changesRequestedAt: string | null;
  changesNote: string | null;
  companyName: string;
  periodEnd: string;
  framework: string;
  firmName: string;
  amended: boolean;
  packHtml: string;
}

type Phase = 'loading' | 'error' | 'ready' | 'done';

export default function ApproveClient({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [data, setData] = useState<Summary | null>(null);
  const [mode, setMode] = useState<'view' | 'approve' | 'changes'>('view');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'approved' | 'changes' | null>(null);

  useEffect(() => {
    fetch(`/api/accounts-studio/approve/${token}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load these accounts.'); return d as Summary; })
      .then(d => { setData(d); setPhase(d.alreadyResponded || d.expired ? 'done' : 'ready'); })
      .catch(e => { setError(e instanceof Error ? e.message : 'Something went wrong.'); setPhase('error'); });
  }, [token]);

  async function submit(action: 'approve' | 'request_changes') {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/accounts-studio/approve/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name: action === 'approve' ? name : null, note: action === 'request_changes' ? note : null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not submit your response.');
      setResult(action === 'approve' ? 'approved' : 'changes');
      setPhase('done');
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); }
    finally { setBusy(false); }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'Arial, Helvetica, sans-serif', padding: '24px 16px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const card = (children: React.ReactNode) => (
    <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px rgba(31,38,88,0.10)', padding: 28, marginBottom: 16 }}>{children}</div>
  );

  if (phase === 'loading') return shell(card(<p style={{ color: '#64748b', margin: 0 }}>Loading your accounts…</p>));
  if (phase === 'error') return shell(card(<><h1 style={{ fontSize: 18, margin: '0 0 8px', color: '#0f172a' }}>Unable to open</h1><p style={{ color: '#b91c1c', margin: 0 }}>{error}</p></>));

  if (phase === 'done') {
    const approved = result === 'approved' || data?.approvedAt;
    return shell(card(
      <div style={{ textAlign: 'center', padding: '20px 8px' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px', background: approved ? '#dcfce7' : '#fef3c7', color: approved ? '#16a34a' : '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>{approved ? '✓' : '↩'}</div>
        <h1 style={{ fontSize: 20, margin: '0 0 6px', color: '#0f172a' }}>{approved ? 'Accounts approved' : 'Changes requested'}</h1>
        <p style={{ color: '#475569', margin: 0, fontSize: 14 }}>
          {approved
            ? `Thank you. ${data?.firmName || 'Your accountant'} has been notified and will proceed with submission.`
            : `Thank you. ${data?.firmName || 'Your accountant'} has been notified and will be in touch.`}
        </p>
        {data?.changesNote && !result && <p style={{ marginTop: 12, color: '#64748b', fontSize: 13 }}>Your note: {data.changesNote}</p>}
      </div>
    ));
  }

  // ready
  return shell(
    <>
      {card(
        <>
          <p style={{ margin: '0 0 4px', color: '#64748b', fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em' }}>{data?.firmName}</p>
          <h1 style={{ fontSize: 22, margin: '0 0 4px', color: '#0f172a' }}>Approve your accounts{data?.amended ? ' (Amended)' : ''}</h1>
          <p style={{ margin: 0, color: '#475569', fontSize: 14 }}>{data?.companyName} — financial statements for the year ended {data?.periodEnd}. Please review the accounts below, then approve or request changes.</p>
        </>
      )}

      {/* Accounts pack preview (isolated in an iframe so its styling is self-contained) */}
      <div style={{ background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px rgba(31,38,88,0.10)', overflow: 'hidden', marginBottom: 16 }}>
        <iframe
          title="Accounts"
          style={{ width: '100%', height: 620, border: 0, background: '#f8fafc' }}
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"/><style>body{margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif}.paper{background:#fff;max-width:760px;margin:16px auto;padding:40px 48px;box-shadow:0 2px 12px rgba(0,0,0,.08)}table{border-collapse:collapse}</style></head><body>${data?.packHtml ?? ''}</body></html>`}
        />
      </div>

      {card(
        <>
          {error && <p style={{ color: '#b91c1c', margin: '0 0 12px', fontSize: 13 }}>{error}</p>}
          {mode === 'view' && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => { setMode('approve'); setError(''); }} style={btn('#4F46E5', '#fff')}>Approve for submission</button>
              <button onClick={() => { setMode('changes'); setError(''); }} style={btn('#fff', '#334155', '#cbd5e1')}>Request changes</button>
            </div>
          )}
          {mode === 'approve' && (
            <div>
              <h2 style={{ fontSize: 15, margin: '0 0 10px', color: '#0f172a' }}>Sign to approve</h2>
              <p style={{ margin: '0 0 10px', color: '#475569', fontSize: 13 }}>By typing your full name below you confirm you approve these accounts for {data?.companyName} for submission.</p>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" style={input} />
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button disabled={busy || !name.trim()} onClick={() => submit('approve')} style={{ ...btn('#4F46E5', '#fff'), opacity: busy || !name.trim() ? 0.5 : 1 }}>{busy ? 'Submitting…' : 'Approve accounts'}</button>
                <button disabled={busy} onClick={() => setMode('view')} style={btn('#fff', '#334155', '#cbd5e1')}>Back</button>
              </div>
            </div>
          )}
          {mode === 'changes' && (
            <div>
              <h2 style={{ fontSize: 15, margin: '0 0 10px', color: '#0f172a' }}>Request changes</h2>
              <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="What would you like changed?" rows={4} style={{ ...input, resize: 'vertical' }} />
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button disabled={busy} onClick={() => submit('request_changes')} style={{ ...btn('#d97706', '#fff'), opacity: busy ? 0.5 : 1 }}>{busy ? 'Submitting…' : 'Send request'}</button>
                <button disabled={busy} onClick={() => setMode('view')} style={btn('#fff', '#334155', '#cbd5e1')}>Back</button>
              </div>
            </div>
          )}
        </>
      )}
      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 11.5, margin: '4px 0 24px' }}>Approval is recorded with your name, the date, and your IP address for audit purposes.</p>
    </>
  );
}

const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, color: '#0f172a', outline: 'none' };
function btn(bg: string, color: string, border?: string): React.CSSProperties {
  return { background: bg, color, border: border ? `1px solid ${border}` : 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' };
}
