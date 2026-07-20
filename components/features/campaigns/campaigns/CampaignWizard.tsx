'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, ArrowRight, Check, Users, PenLine, Sparkles, Eye, Send,
  CalendarClock, Loader2, X, CheckCircle2, AlertTriangle, ShieldAlert,
} from 'lucide-react';

const ACTION_TEXT: Record<string, string> = {
  submitted: 'submitted it for review',
  approved: 'approved it',
  changes_requested: 'requested changes',
  withdrawn: 'withdrew it',
  sent: 'sent it',
};
import Spinner from '@/components/ui/Spinner';
import ClientSearchInput from '@/components/ui/ClientSearchInput';
import type { Campaign, CampaignAudience, NewsletterDesign } from '@/types/campaigns';
import { CAMPAIGN_MERGE_TAGS, resolveCampaignMergeTags } from '@/lib/campaigns/mergeFields';
import { compileDesign, designFromSettings, emptyDesign } from '@/lib/campaigns/newsletter';
import NewsletterDesigner from './NewsletterDesigner';

const STEPS = [
  { id: 1, label: 'Audience',        icon: Users },
  { id: 2, label: 'Content',         icon: PenLine },
  { id: 3, label: 'Personalisation', icon: Sparkles },
  { id: 4, label: 'Preview & Test',  icon: Eye },
  { id: 5, label: 'Schedule',        icon: CalendarClock },
  { id: 6, label: 'Results',         icon: Send },
];

interface Meta { team: { id: string; name: string }[]; gmail: { connected: boolean; email: string | null }; emailTriageActive: boolean }

export default function CampaignWizard({ campaignId, onClose }: { campaignId: string | null; onClose: (opts?: { sent?: boolean }) => void }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [audiences, setAudiences] = useState<CampaignAudience[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Local editable copy of the fields we touch.
  const [form, setForm] = useState({ name: '', subject: '', preview_text: '', body_html: '', audience_id: '' as string | null });
  // Non-null when the campaign is built with the newsletter designer; the
  // compiled HTML still lives in form.body_html so every send path is unchanged.
  const [design, setDesign] = useState<NewsletterDesign | null>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // ── Load / create ────────────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [audRes, metaRes] = await Promise.all([fetch('/api/campaigns/audiences'), fetch('/api/campaigns/meta')]);
        if (live && audRes.ok) setAudiences((await audRes.json()).audiences ?? []);
        if (live && metaRes.ok) setMeta(await metaRes.json());

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prefill = (window as any).__campaignPrefill as { audienceId?: string; name?: string; subject?: string; preview_text?: string; body_html?: string } | undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__campaignPrefill = undefined;

        let c: Campaign | null = null;
        if (campaignId) {
          const r = await fetch(`/api/campaigns/${campaignId}`);
          if (r.ok) c = (await r.json()).campaign;
        } else {
          const r = await fetch('/api/campaigns', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: prefill?.name || 'Untitled campaign',
              audience_id: prefill?.audienceId ?? null,
              subject: prefill?.subject ?? '',
              preview_text: prefill?.preview_text ?? '',
              body_html: prefill?.body_html ?? '',
            }),
          });
          if (r.ok) c = (await r.json()).campaign;
        }
        if (live && c) {
          setCampaign(c);
          setForm({ name: c.name, subject: c.subject, preview_text: c.preview_text, body_html: c.body_html, audience_id: c.audience_id });
          setDesign(designFromSettings(c.settings));
          if (c.status === 'sent') setStep(6);
        }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [campaignId]);

  const save = useCallback(async (patch: Partial<typeof form>) => {
    if (!campaign) return;
    setSaving(true);
    try {
      await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
    } finally { setSaving(false); }
  }, [campaign]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(f => ({ ...f, [key]: value }));
  }

  async function goTo(next: number) {
    // Persist the design alongside the form so the block structure survives a
    // reopen (null clears it when the author switches back to plain HTML).
    await save({
      ...form,
      settings: { ...((campaign?.settings ?? {}) as Record<string, unknown>), design },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    setStep(next);
  }

  function insertTag(tag: string) {
    const token = `{{${tag}}}`;
    if (lastFocused.current === 'subject') {
      const el = subjectRef.current;
      const pos = el?.selectionStart ?? form.subject.length;
      const v = form.subject.slice(0, pos) + token + form.subject.slice(pos);
      set('subject', v);
    } else {
      const el = bodyRef.current;
      const pos = el?.selectionStart ?? form.body_html.length;
      const v = form.body_html.slice(0, pos) + token + form.body_html.slice(pos);
      set('body_html', v);
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full py-24"><Spinner className="w-6 h-6 text-[var(--accent)]" /></div>;
  if (!campaign) return (
    <div className="p-8 text-center">
      <p className="text-sm text-[var(--text-secondary)]">Couldn’t open this campaign.</p>
      <button onClick={() => onClose()} className="btn-secondary mt-3 mx-auto">Back</button>
    </div>
  );

  const selectedAudience = audiences.find(a => a.id === form.audience_id) ?? null;
  const isSent = campaign.status === 'sent' || step === 6;

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => onClose()} className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--text-secondary)]"><ArrowLeft size={18} /></button>
        <input
          value={form.name}
          onChange={e => set('name', e.target.value)}
          onBlur={() => save({ name: form.name })}
          className="text-xl font-semibold text-[var(--text-primary)] tracking-tight bg-transparent border-none focus:outline-none focus:ring-0 flex-1 min-w-0"
        />
        <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
          {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Check size={12} /> Saved</>}
        </span>
        <button onClick={() => onClose()} className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--text-secondary)]"><X size={18} /></button>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto scrollbar-thin">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const active = s.id === step;
          const done = s.id < step;
          return (
            <button
              key={s.id}
              onClick={() => !isSent && s.id <= 5 && goTo(s.id)}
              disabled={isSent && s.id !== 6}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors
                ${active ? 'bg-[var(--accent)] text-white' : done ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${active ? 'bg-white/25' : done ? 'bg-[var(--accent-light)]' : 'bg-black/5'}`}>
                {done ? <Check size={11} /> : <Icon size={11} />}
              </span>
              {s.label}
              {i < STEPS.length - 1 && <span className="mx-0.5 text-[var(--text-muted)]">›</span>}
            </button>
          );
        })}
      </div>

      {/* Steps */}
      {step === 1 && (
        <StepAudience audiences={audiences} value={form.audience_id} onChange={id => { set('audience_id', id); save({ audience_id: id }); }} selected={selectedAudience} />
      )}
      {step === 2 && (
        <StepContent
          form={form} set={set}
          subjectRef={subjectRef} bodyRef={bodyRef} lastFocused={lastFocused}
          design={design}
          onDesignChange={(d: NewsletterDesign | null) => {
            setDesign(d);
            if (d) set('body_html', compileDesign(d));
          }}
        />
      )}
      {step === 3 && (
        <StepPersonalise onInsert={insertTag} body={form.body_html} subject={form.subject} />
      )}
      {step === 4 && (
        <StepPreviewTest campaign={campaign} form={form} meta={meta} />
      )}
      {step === 5 && (
        <StepSchedule campaign={campaign} form={form} meta={meta} audienceChosen={!!form.audience_id}
          onSent={() => { setStep(6); }} save={save} />
      )}
      {step === 6 && (
        <StepResults campaign={campaign} onClose={onClose} />
      )}

      {/* Footer nav */}
      {!isSent && step < 6 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-black/5">
          <button onClick={() => step > 1 ? goTo(step - 1) : onClose()} className="btn-secondary">
            <ArrowLeft size={15} /> {step > 1 ? 'Back' : 'Cancel'}
          </button>
          {step < 5 && (
            <button onClick={() => goTo(step + 1)} className="btn-primary">Next <ArrowRight size={15} /></button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Step 1: Audience ────────────────────────────────────────────────────────────
function StepAudience({ audiences, value, onChange, selected }: {
  audiences: CampaignAudience[]; value: string | null; onChange: (id: string) => void; selected: CampaignAudience | null;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 max-w-5xl">
      <div className="lg:col-span-2">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Who is this campaign for?</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-4">Pick a saved audience. Dynamic audiences re-resolve at send time, so they’re always current. Build new audiences on the Audiences tab.</p>
        {audiences.length === 0 ? (
          <div className="text-sm text-[var(--text-secondary)] p-4 rounded-xl border border-dashed border-[var(--border)]">
            No saved audiences yet. Head to the Audiences tab to build one, then come back.
          </div>
        ) : (
          <div className="space-y-2">
            {audiences.map(a => (
              <button
                key={a.id}
                onClick={() => onChange(a.id)}
                className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border transition-colors ${value === a.id ? 'border-[var(--accent)] bg-[var(--accent-light)]/20' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${value === a.id ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>
                  {value === a.id && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)]">{a.name}</div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">{a.description || 'Dynamic audience'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        {selected ? (
          <AudiencePreviewInline audience={selected} />
        ) : (
          <div className="glass-solid rounded-2xl border border-[var(--border)] p-4 text-sm text-[var(--text-secondary)]">
            Select an audience to see how many clients will receive this campaign.
          </div>
        )}
      </div>
    </div>
  );
}

// Small inline preview that reuses the preview endpoint for a chosen audience.
function AudiencePreviewInline({ audience }: { audience: CampaignAudience }) {
  const [count, setCount] = useState<{ sendable: number; total: number } | null>(null);
  useEffect(() => {
    let live = true;
    setCount(null);
    (async () => {
      const r = await fetch('/api/campaigns/audiences/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: audience.source, definition: audience.definition, member_client_ids: audience.member_client_ids }),
      });
      if (r.ok && live) { const d = await r.json(); setCount({ sendable: d.sendable, total: d.total }); }
    })();
    return () => { live = false; };
  }, [audience]);
  return (
    <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center gap-2 mb-2"><Users size={15} style={{ color: 'var(--accent)' }} /><h4 className="text-sm font-semibold text-[var(--text-primary)]">Live audience</h4></div>
      {count ? (
        <div><span className="text-3xl font-semibold text-[var(--text-primary)]">{count.sendable}</span> <span className="text-sm text-[var(--text-secondary)]">will receive it</span>
          <div className="text-xs text-[var(--text-secondary)] mt-1">{count.total} clients matched</div></div>
      ) : <Loader2 size={16} className="animate-spin text-[var(--text-muted)]" />}
    </div>
  );
}

// ── Step 2: Content ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StepContent({ form, set, subjectRef, bodyRef, lastFocused, design, onDesignChange }: any) {
  const [aiPrompt, setAiPrompt] = useState('');
  const [tone, setTone] = useState('professional');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function generate() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true); setAiError(null);
    try {
      const r = await fetch('/api/campaigns/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full', prompt: aiPrompt, tone }),
      });
      if (!r.ok) { setAiError('Generation failed. Try again.'); return; }
      const d = await r.json();
      if (d.subject) set('subject', d.subject);
      if (d.previewText) set('preview_text', d.previewText);
      if (d.bodyHtml) set('body_html', d.bodyHtml);
    } finally { setAiBusy(false); }
  }

  async function quick(mode: string) {
    setAiBusy(true); setAiError(null);
    try {
      const r = await fetch('/api/campaigns/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tone, currentBody: form.body_html }),
      });
      if (!r.ok) { setAiError('That didn’t work. Try again.'); return; }
      const d = await r.json();
      if (d.html) set('body_html', d.html);
    } finally { setAiBusy(false); }
  }

  const TONES = ['professional', 'friendly', 'concise', 'firm', 'urgent', 'educational'];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Subject line</label>
          <input
            ref={subjectRef}
            value={form.subject}
            onFocus={() => { lastFocused.current = 'subject'; }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('subject', e.target.value)}
            placeholder="e.g. Your records checklist for the year ahead"
            className="mt-1 w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Preview text <span className="text-[var(--text-muted)] font-normal">(inbox snippet)</span></label>
          <input
            value={form.preview_text}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('preview_text', e.target.value)}
            className="mt-1 w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="text-xs font-semibold text-[var(--text-secondary)]">Body</label>
            <div className="flex items-center gap-2">
              {!design && (
                <div className="flex gap-1">
                  {['rewrite', 'shorten', 'expand'].map(m => (
                    <button key={m} onClick={() => quick(m)} disabled={aiBusy} className="text-[11px] px-2 py-0.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] capitalize">{m}</button>
                  ))}
                </div>
              )}
              <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-[11px] font-semibold">
                <button
                  onClick={() => onDesignChange(null)}
                  className={`px-2 py-1 ${!design ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}
                >Plain HTML</button>
                <button
                  onClick={() => {
                    if (design) return;
                    if (form.body_html.trim() && !confirm('Switching to the designer replaces the current email body. Continue?')) return;
                    onDesignChange(emptyDesign());
                  }}
                  className={`px-2 py-1 ${design ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}
                >Designer</button>
              </div>
            </div>
          </div>

          {design ? (
            <div className="mt-2">
              <NewsletterDesigner design={design} onChange={onDesignChange} />
            </div>
          ) : (
            <textarea
              ref={bodyRef}
              value={form.body_html}
              onFocus={() => { lastFocused.current = 'body'; }}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => set('body_html', e.target.value)}
              rows={14}
              placeholder="<p>Dear {{client.first_name | default: &quot;client&quot;}},</p>"
              className="mt-1 w-full text-[13px] font-mono rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)] resize-y"
            />
          )}
        </div>
      </div>

      <div className="space-y-4">
        {/* AI writer */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-2"><Sparkles size={15} style={{ color: 'var(--accent)' }} /><h4 className="text-sm font-semibold text-[var(--text-primary)]">Write with SMITH</h4></div>
          <textarea
            value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={3}
            placeholder="Describe the email — e.g. remind March year-end limited companies to send their records by 31 July."
            className="w-full text-[13px] rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)] resize-y"
          />
          <div className="flex items-center gap-2 mt-2">
            <select value={tone} onChange={e => setTone(e.target.value)} className="text-xs rounded-lg border border-[var(--border)] px-2 py-1.5 capitalize">
              {TONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={generate} disabled={aiBusy || !aiPrompt.trim()} className="btn-primary text-xs ml-auto">
              {aiBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
            </button>
          </div>
          {aiError && <p className="text-xs text-red-600 mt-2">{aiError}</p>}
          <p className="text-[11px] text-[var(--text-muted)] mt-2">SMITH won’t invent tax figures or dates — it uses merge tags or clear placeholders for anything specific.</p>
        </div>

        {/* Live preview */}
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
          <div className="flex items-center gap-2 mb-2"><Eye size={15} style={{ color: 'var(--accent)' }} /><h4 className="text-sm font-semibold text-[var(--text-primary)]">Preview</h4></div>
          <div className="text-xs text-[var(--text-muted)] mb-1">{form.subject || '(no subject)'}</div>
          <div className="rounded-lg border border-[var(--border)] p-3 bg-white max-h-[360px] overflow-y-auto scrollbar-thin text-sm prose-sm"
            dangerouslySetInnerHTML={{ __html: form.body_html || '<p style="color:#9ca3af">Your email preview appears here.</p>' }} />
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Personalisation ─────────────────────────────────────────────────────
function StepPersonalise({ onInsert, body, subject }: { onInsert: (tag: string) => void; body: string; subject: string }) {
  const groups = ['Client', 'Company', 'Billing'] as const;
  const used = new Set((`${subject} ${body}`.match(/\{\{\s*([a-z_.]+)/gi) ?? []).map(s => s.replace(/[{\s]/g, '')));
  return (
    <div className="max-w-4xl">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Personalise with merge tags</h3>
      <p className="text-xs text-[var(--text-secondary)] mb-4">Click a tag to insert it where you last clicked in the subject or body. Add a fallback so nobody sees a blank: <code className="bg-black/5 px-1 rounded">{'{{client.first_name | default: "there"}}'}</code>.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {groups.map(g => (
          <div key={g} className="glass-solid rounded-2xl border border-[var(--border)] p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">{g}</h4>
            <div className="space-y-1.5">
              {CAMPAIGN_MERGE_TAGS.filter(t => t.group === g).map(t => (
                <button key={t.tag} onClick={() => onInsert(t.tag)} className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-[var(--accent-light)]/40 group">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                      {t.label}
                      {used.has(t.tag) && <Check size={12} className="text-green-600" />}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] font-mono truncate">{`{{${t.tag}}}`}</div>
                  </div>
                  <span className="text-[11px] text-[var(--accent)] opacity-0 group-hover:opacity-100">Insert</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Step 4: Preview & Test ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StepPreviewTest({ campaign, form, meta }: { campaign: Campaign; form: any; meta: Meta | null }) {
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');
  const [mergeData, setMergeData] = useState<Record<string, string>>({});
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) { setMergeData({}); return; }
    let live = true;
    (async () => {
      const r = await fetch('/api/campaigns/audiences/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual', member_client_ids: [clientId] }),
      });
      if (r.ok && live) { const d = await r.json(); setMergeData(d.sample?.[0]?.merge_data ?? {}); }
    })();
    return () => { live = false; };
  }, [clientId]);

  async function sendTest() {
    setTestBusy(true); setTestMsg(null);
    try {
      const r = await fetch(`/api/campaigns/${campaign.id}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: clientId || undefined }),
      });
      const d = await r.json();
      setTestMsg(r.ok ? `Test sent to ${d.to}.` : (d.error || 'Failed to send test.'));
    } finally { setTestBusy(false); }
  }

  const renderedSubject = resolveCampaignMergeTags(form.subject, mergeData) || '(no subject)';
  const renderedBody = resolveCampaignMergeTags(form.body_html, mergeData);

  const checks = [
    { ok: !!form.audience_id, label: 'Audience selected' },
    { ok: !!form.subject.trim(), label: 'Subject line present' },
    { ok: !!form.body_html.trim(), label: 'Body written' },
    { ok: !!meta?.gmail.connected, label: 'Gmail connected for sending' },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 glass-solid rounded-2xl border border-[var(--border)] p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Eye size={15} style={{ color: 'var(--accent)' }} />
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">Preview as</h4>
          <div className="min-w-[240px]">
            <ClientSearchInput value={clientId} valueName={clientName} onChange={(id, name) => { setClientId(id); setClientName(name); }} placeholder="a specific client…" />
          </div>
        </div>
        <div className="text-xs text-[var(--text-muted)] mb-1">Subject: <span className="text-[var(--text-secondary)]">{renderedSubject}</span></div>
        <div className="rounded-lg border border-[var(--border)] p-4 bg-white max-h-[420px] overflow-y-auto scrollbar-thin text-sm"
          dangerouslySetInnerHTML={{ __html: renderedBody || '<p style="color:#9ca3af">Nothing to preview yet.</p>' }} />
      </div>

      <div className="space-y-4">
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Pre-send checklist</h4>
          <div className="space-y-2">
            {checks.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 size={16} className="text-green-600" /> : <AlertTriangle size={16} className="text-amber-500" />}
                <span className={c.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)] font-medium'}>{c.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-solid rounded-2xl border border-[var(--border)] p-4">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Send a test</h4>
          <p className="text-xs text-[var(--text-secondary)] mb-3">A test copy goes to your own inbox{clientId ? ', personalised as the selected client' : ''}.</p>
          <button onClick={sendTest} disabled={testBusy || !meta?.gmail.connected} className="btn-secondary w-full justify-center">
            {testBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send test to me
          </button>
          {!meta?.gmail.connected && <p className="text-[11px] text-amber-600 mt-2">Connect Gmail in Email Triage to send.</p>}
          {testMsg && <p className="text-xs text-[var(--text-secondary)] mt-2">{testMsg}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Step 5: Schedule / Send ─────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StepSchedule({ campaign, meta, audienceChosen, onSent, save }: { campaign: Campaign; form: any; meta: Meta | null; audienceChosen: boolean; onSent: () => void; save: (p: any) => Promise<void> }) {
  const [mode, setMode] = useState<'now' | 'schedule'>('now');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(campaign.status);
  const [comment, setComment] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [approval, setApproval] = useState<{ trail: any[]; canApprove: boolean; isAuthor: boolean; approvalRequired: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/campaigns/${campaign.id}/approval`);
      if (r.ok && live) {
        const d = await r.json();
        setApproval({ trail: d.trail ?? [], canApprove: !!d.canApprove, isAuthor: !!d.isAuthor, approvalRequired: !!d.approvalRequired });
        if (d.status) setStatus(d.status);
      }
    })();
    return () => { live = false; };
  }, [campaign.id]);

  const approvalRequired = approval?.approvalRequired ?? false;
  const approved = status === 'approved';
  const gateOpen = !approvalRequired || approved;
  const canSend = audienceChosen && !!meta?.gmail.connected && gateOpen;

  async function act(action: 'submit' | 'approve' | 'request_changes' | 'withdraw') {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/campaigns/${campaign.id}/approval`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not update the approval.'); return; }
      setStatus(d.status);
      setApproval(a => (a ? { ...a, trail: d.trail ?? a.trail } : a));
      setComment('');
    } finally { setBusy(false); }
  }

  async function sendNow() {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/campaigns/${campaign.id}/send`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Send failed.'); return; }
      onSent();
    } finally { setBusy(false); }
  }

  async function schedule() {
    if (!when) { setError('Choose a date and time.'); return; }
    setBusy(true); setError(null);
    try {
      await save({ scheduled_at: new Date(when).toISOString(), status: 'scheduled' });
      onSent(); // move to results, which will show it's scheduled
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-xl">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">Approve &amp; schedule</h3>
      <p className="text-xs text-[var(--text-secondary)] mb-4">Campaigns send from your connected Gmail ({meta?.gmail.email || 'not connected'}).</p>

      {/* Approval gate */}
      {approvalRequired && (
        <div className={`rounded-xl border p-4 mb-4 ${approved ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            {approved ? <CheckCircle2 size={15} className="text-green-600" /> : <ShieldAlert size={15} className="text-amber-600" />}
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {approved ? 'Approved — ready to send'
                : status === 'awaiting_review' ? 'Awaiting review'
                : status === 'changes_requested' ? 'Changes requested'
                : 'Approval required'}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">
            {approved ? 'This campaign has been signed off and can go out.'
              : status === 'awaiting_review' ? 'A reviewer needs to approve this before it can send.'
              : status === 'changes_requested' ? 'A reviewer asked for changes — update it and resubmit.'
              : 'Your firm requires campaigns to be approved before sending.'}
          </p>

          {(status === 'awaiting_review' && approval?.canApprove) && (
            <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Optional comment for the author…"
              className="w-full text-[13px] rounded-lg border border-[var(--border)] px-3 py-2 mb-2 focus:outline-none focus:border-[var(--accent)]" />
          )}

          <div className="flex flex-wrap gap-2">
            {(status === 'draft' || status === 'changes_requested') && (
              <button onClick={() => act('submit')} disabled={busy} className="btn-primary text-xs">Submit for review</button>
            )}
            {status === 'awaiting_review' && approval?.canApprove && (
              <>
                <button onClick={() => act('approve')} disabled={busy} className="btn-primary text-xs">Approve</button>
                <button onClick={() => act('request_changes')} disabled={busy} className="btn-secondary text-xs">Request changes</button>
              </>
            )}
            {status === 'awaiting_review' && approval?.isAuthor && (
              <button onClick={() => act('withdraw')} disabled={busy} className="btn-secondary text-xs">Withdraw</button>
            )}
            {status === 'awaiting_review' && !approval?.canApprove && !approval?.isAuthor && (
              <span className="text-xs text-[var(--text-secondary)]">Waiting on an admin to review.</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2 mb-4">
        {(['now', 'schedule'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)} className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border ${mode === m ? 'border-[var(--accent)] bg-[var(--accent-light)]/20' : 'border-[var(--border)]'}`}>
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${mode === m ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>{mode === m && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}</div>
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">{m === 'now' ? 'Send now' : 'Schedule for later'}</div>
              <div className="text-xs text-[var(--text-secondary)]">{m === 'now' ? 'Send to everyone in the audience right away.' : 'SMITH sends it automatically at the time you choose.'}</div>
            </div>
          </button>
        ))}
      </div>

      {mode === 'schedule' && (
        <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)}
          className="w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 mb-4 focus:outline-none focus:border-[var(--accent)]" />
      )}

      {!canSend && (
        <div className="flex items-center gap-2 text-xs text-amber-600 mb-3">
          <AlertTriangle size={14} />
          {!audienceChosen ? 'Choose an audience first.'
            : !meta?.gmail.connected ? 'Connect Gmail (Email Triage) to send.'
            : 'This campaign needs approval before it can send.'}
        </div>
      )}
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {mode === 'now' ? (
        <button onClick={sendNow} disabled={busy || !canSend} className="btn-primary">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send campaign
        </button>
      ) : (
        <button onClick={schedule} disabled={busy || !canSend} className="btn-primary">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CalendarClock size={15} />} Schedule campaign
        </button>
      )}

      {/* Audit trail */}
      {approval && approval.trail.length > 0 && (
        <div className="mt-6 pt-4 border-t border-black/5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">Audit trail</h4>
          <div className="space-y-1.5">
            {approval.trail.map(t => (
              <div key={t.id} className="text-xs text-[var(--text-secondary)]">
                <span className="font-medium text-[var(--text-primary)]">{t.user_name}</span> {ACTION_TEXT[t.action] ?? t.action}
                {' · '}
                {new Date(t.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {t.comment && <span className="block italic text-[var(--text-muted)]">“{t.comment}”</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 6: Results ─────────────────────────────────────────────────────────────
function StepResults({ campaign, onClose }: { campaign: Campaign; onClose: (opts?: { sent?: boolean }) => void }) {
  const [stats, setStats] = useState<Record<string, number> | null>((campaign.stats as Record<string, number>) ?? null);
  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch(`/api/campaigns/${campaign.id}`);
      if (r.ok && live) setStats(((await r.json()).campaign?.stats) ?? null);
    })();
    return () => { live = false; };
  }, [campaign.id]);

  const scheduled = campaign.status === 'scheduled';

  return (
    <div className="max-w-lg mx-auto text-center py-8">
      <div className="w-14 h-14 rounded-2xl bg-green-100 flex items-center justify-center mx-auto mb-4">
        {scheduled ? <CalendarClock size={26} className="text-green-600" /> : <CheckCircle2 size={26} className="text-green-600" />}
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{scheduled ? 'Campaign scheduled' : 'Campaign sent'}</h3>
      <p className="text-sm text-[var(--text-secondary)] mt-1 mb-5">
        {scheduled ? 'SMITH will send it automatically at the scheduled time.' : 'Opens and clicks will appear here and in Reports as they come in.'}
      </p>
      {!scheduled && stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[['Sent', stats.sent ?? 0], ['Delivered', stats.delivered ?? 0], ['Failed', stats.failed ?? 0]].map(([label, val]) => (
            <div key={label} className="glass-solid rounded-xl border border-[var(--border)] p-3">
              <div className="text-2xl font-semibold text-[var(--text-primary)]">{val}</div>
              <div className="text-xs text-[var(--text-secondary)]">{label}</div>
            </div>
          ))}
        </div>
      )}
      <button onClick={() => onClose({ sent: true })} className="btn-primary mx-auto">Done</button>
    </div>
  );
}
