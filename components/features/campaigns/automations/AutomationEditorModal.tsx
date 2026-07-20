'use client';

import { useEffect, useState } from 'react';
import { X, Sparkles, Loader2, Workflow, Mail, Clock, Target, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { CampaignAutomation, CampaignAudience, CampaignTemplate, AutomationTriggerType, AutomationMode, JourneyStep, JourneyGoal, JourneyBranchAction } from '@/types/campaigns';
import { TRIGGERS, TRIGGER_BY_TYPE } from '@/lib/campaigns/triggerMeta';
import { STARTER_TEMPLATES } from '@/lib/campaigns/starterTemplates';
import JourneyFlow from './JourneyFlow';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const GOAL_LABELS: Record<JourneyGoal, string> = {
  opened: 'opened the last email',
  clicked: 'clicked a link in it',
  uploaded_document: 'uploaded a document / records',
  paid_invoice: 'paid an invoice',
  completed_task: 'had a task completed',
};

function stepId(): string { try { return crypto.randomUUID(); } catch { return `s_${Math.random().toString(36).slice(2)}`; } }

/** Branch actions are edited as a single string so one <select> covers
 *  finish / continue / jump-to-step-N. */
function branchToValue(b: JourneyBranchAction | undefined, fallback: 'finish' | 'continue'): string {
  if (!b) return fallback;
  return b.action === 'jump' ? `jump:${b.toStepId}` : b.action;
}
function valueToBranch(v: string): JourneyBranchAction {
  if (v.startsWith('jump:')) return { action: 'jump', toStepId: v.slice(5) };
  return { action: v === 'finish' ? 'finish' : 'continue' };
}
function stepShortLabel(s: JourneyStep, i: number): string {
  const kind = s.type === 'email' ? 'Email' : s.type === 'wait' ? 'Wait' : 'Check';
  return `Step ${i + 1} — ${kind}`;
}

interface Props {
  automation?: CampaignAutomation | null;
  audiences: CampaignAudience[];
  onClose: () => void;
  onSaved: () => void;
}

export default function AutomationEditorModal({ automation, audiences, onClose, onSaved }: Props) {
  const [name, setName] = useState(automation?.name ?? '');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>(automation?.trigger_type ?? 'recurring');
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>(automation?.trigger_config?.frequency ?? 'monthly');
  const [day, setDay] = useState<number>(automation?.trigger_config?.day ?? 1);
  const [hour, setHour] = useState<number>(automation?.trigger_config?.hour ?? 9);
  const [days, setDays] = useState<number>(automation?.trigger_config?.days ?? 60);
  const [audienceId, setAudienceId] = useState<string>(automation?.audience_id ?? '');
  const [subject, setSubject] = useState(automation?.subject ?? '');
  const [previewText, setPreviewText] = useState(automation?.preview_text ?? '');
  const [body, setBody] = useState(automation?.body_html ?? '');
  const [mode, setMode] = useState<AutomationMode>(automation?.mode ?? 'single');
  const [steps, setSteps] = useState<JourneyStep[]>(automation?.steps ?? []);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [savedTemplates, setSavedTemplates] = useState<CampaignTemplate[]>([]);
  const meta = TRIGGER_BY_TYPE[triggerType];

  // Default the day sensibly when switching monthly/weekly.
  useEffect(() => { if (frequency === 'weekly' && day > 7) setDay(1); }, [frequency, day]);

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await fetch('/api/campaigns/templates');
      if (r.ok && live) setSavedTemplates((await r.json()).templates ?? []);
    })();
    return () => { live = false; };
  }, []);

  function applyTemplate(id: string) {
    if (!id) return;
    const t = savedTemplates.find(s => s.id === id) ?? STARTER_TEMPLATES.find(s => s.id === id);
    if (!t) return;
    setSubject(t.subject); setPreviewText(t.preview_text); setBody(t.body_html);
  }

  async function generate() {
    if (!aiPrompt.trim()) return;
    setAiBusy(true); setError(null);
    try {
      const r = await fetch('/api/campaigns/ai/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'full', prompt: aiPrompt, tone: 'professional' }),
      });
      if (!r.ok) { setError('Generation failed.'); return; }
      const d = await r.json();
      if (d.subject) setSubject(d.subject);
      if (d.previewText) setPreviewText(d.previewText);
      if (d.bodyHtml) setBody(d.bodyHtml);
    } finally { setAiBusy(false); }
  }

  function addStep(type: JourneyStep['type']) {
    const s: JourneyStep = type === 'email'
      ? { id: stepId(), type: 'email', subject: '', preview_text: '', body_html: '' }
      : type === 'wait' ? { id: stepId(), type: 'wait', days: 7 }
      : { id: stepId(), type: 'check', goal: 'uploaded_document' };
    setSteps(prev => [...prev, s]);
  }
  function updateStep(id: string, patch: Partial<JourneyStep>) {
    setSteps(prev => prev.map(s => (s.id === id ? ({ ...s, ...patch } as JourneyStep) : s)));
  }
  function removeStep(id: string) { setSteps(prev => prev.filter(s => s.id !== id)); }
  function moveStep(id: string, dir: -1 | 1) {
    setSteps(prev => {
      const i = prev.findIndex(s => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (!name.trim()) { setError('Give the automation a name.'); return; }
    if (meta.recurring && !audienceId) { setError('Choose an audience to send to.'); return; }
    if (mode === 'journey' && steps.filter(s => s.type === 'email').length === 0) { setError('Add at least one email step to the journey.'); return; }
    setSaving(true); setError(null);
    try {
      const trigger_config = meta.recurring ? { frequency, day, hour } : (meta.hasDays ? { days } : {});
      const payload = {
        name: name.trim(), mode, trigger_type: triggerType, trigger_config,
        audience_id: meta.recurring ? audienceId : null,
        ...(mode === 'journey'
          ? { steps }
          : { subject, preview_text: previewText, body_html: body }),
      };
      const url = automation ? `/api/campaigns/automations/${automation.id}` : '/api/campaigns/automations';
      const method = automation ? 'PATCH' : 'POST';
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!r.ok) { setError('Could not save the automation.'); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  const inputCls = 'w-full text-sm rounded-lg border border-[var(--border)] px-3 py-2 focus:outline-none focus:border-[var(--accent)]';

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="text-base font-semibold text-[var(--text-primary)] flex items-center gap-2"><Workflow size={16} style={{ color: 'var(--accent)' }} /> {automation ? 'Edit automation' : 'New automation'}</h3>
          <button onClick={onClose} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Trigger + schedule */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)]">Name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Monthly newsletter" className={`mt-1 ${inputCls}`} />
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--text-secondary)] mb-1 block">When should it run?</label>
              <div className="space-y-1.5">
                {TRIGGERS.map(t => (
                  <button key={t.type} onClick={() => setTriggerType(t.type)}
                    className={`w-full text-left flex items-start gap-2 p-2.5 rounded-lg border ${triggerType === t.type ? 'border-[var(--accent)] bg-[var(--accent-light)]/20' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>
                    <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${triggerType === t.type ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}>{triggerType === t.type && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}</div>
                    <div>
                      <div className="text-[13px] font-medium text-[var(--text-primary)]">{t.label}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{t.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Trigger-specific config */}
            {meta.recurring ? (
              <div className="space-y-3 p-3 rounded-lg bg-black/[0.015] border border-[var(--border)]">
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Audience</label>
                  <select value={audienceId} onChange={e => setAudienceId(e.target.value)} className={`mt-1 ${inputCls}`}>
                    <option value="">Choose an audience…</option>
                    {audiences.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">Every</label>
                    <select value={frequency} onChange={e => setFrequency(e.target.value as 'monthly' | 'weekly')} className={`mt-1 ${inputCls}`}>
                      <option value="monthly">Month</option>
                      <option value="weekly">Week</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">On</label>
                    {frequency === 'weekly' ? (
                      <select value={day} onChange={e => setDay(Number(e.target.value))} className={`mt-1 ${inputCls}`}>
                        {WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}
                      </select>
                    ) : (
                      <select value={day} onChange={e => setDay(Number(e.target.value))} className={`mt-1 ${inputCls}`}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[var(--text-secondary)]">At</label>
                    <select value={hour} onChange={e => setHour(Number(e.target.value))} className={`mt-1 ${inputCls}`}>
                      {Array.from({ length: 24 }, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ) : meta.hasDays ? (
              <div className="p-3 rounded-lg bg-black/[0.015] border border-[var(--border)]">
                <label className="text-xs font-semibold text-[var(--text-secondary)]">Lead time (days before the deadline)</label>
                <input type="number" value={days} onChange={e => setDays(Number(e.target.value) || 1)} className={`mt-1 ${inputCls} w-32`} />
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-black/[0.015] border border-[var(--border)] text-xs text-[var(--text-secondary)]">
                Runs daily and emails each affected client once, then waits {meta.cooldownDays} days before it could email the same client again.
              </div>
            )}
          </div>

          {/* Content */}
          <div className="space-y-3">
            {/* Single vs journey */}
            <div className="inline-flex rounded-lg border border-[var(--border)] overflow-hidden text-xs font-semibold">
              {(['single', 'journey'] as AutomationMode[]).map(m => (
                <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 ${mode === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
                  {m === 'single' ? 'Single email' : 'Multi-step journey'}
                </button>
              ))}
            </div>

            {mode === 'single' ? (
              <>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Start from a template <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
                  <select defaultValue="" onChange={e => { applyTemplate(e.target.value); e.target.value = ''; }} className={`mt-1 ${inputCls}`}>
                    <option value="">Choose a template…</option>
                    {savedTemplates.length > 0 && (
                      <optgroup label="Your templates">
                        {savedTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                    )}
                    <optgroup label="Starter templates">
                      {STARTER_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Subject line</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)} className={`mt-1 ${inputCls}`} placeholder="Use {{client.first_name}} etc." />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Preview text</label>
                  <input value={previewText} onChange={e => setPreviewText(e.target.value)} className={`mt-1 ${inputCls}`} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">Body (HTML)</label>
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className={`mt-1 ${inputCls} font-mono text-[13px] resize-y`} placeholder="<p>Dear {{client.first_name | default: &quot;client&quot;}},</p>" />
                </div>
                <div className="glass-solid rounded-xl border border-[var(--border)] p-3">
                  <div className="flex items-center gap-2 mb-2"><Sparkles size={14} style={{ color: 'var(--accent)' }} /><span className="text-xs font-semibold text-[var(--text-primary)]">Write with SMITH</span></div>
                  <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} rows={2} className={`${inputCls} text-[13px] resize-y`} placeholder="Describe the email…" />
                  <button onClick={generate} disabled={aiBusy || !aiPrompt.trim()} className="btn-primary text-xs mt-2 ml-auto">
                    {aiBusy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-[var(--text-secondary)]">Build a sequence. Each client moves through it on their own — send an email, wait, then check if they’ve acted, branching on the answer.</p>
                {steps.length === 0 && <div className="text-xs text-[var(--text-muted)] italic p-3 border border-dashed border-[var(--border)] rounded-lg">No steps yet — start with an email.</div>}
                <JourneyFlow steps={steps} />
                {steps.map((s, i) => (
                  <div key={s.id} className="rounded-xl border border-[var(--border)] p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-[11px] font-bold text-[var(--accent)] shrink-0">{i + 1}</span>
                      <span className="text-[13px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                        {s.type === 'email' && <><Mail size={13} style={{ color: 'var(--accent)' }} /> Send email</>}
                        {s.type === 'wait' && <><Clock size={13} style={{ color: 'var(--accent)' }} /> Wait</>}
                        {s.type === 'check' && <><Target size={13} style={{ color: 'var(--accent)' }} /> Check goal</>}
                      </span>
                      <div className="ml-auto flex items-center gap-0.5">
                        <button onClick={() => moveStep(s.id, -1)} disabled={i === 0} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="Move up"><ChevronUp size={14} /></button>
                        <button onClick={() => moveStep(s.id, 1)} disabled={i === steps.length - 1} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="Move down"><ChevronDown size={14} /></button>
                        <button onClick={() => removeStep(s.id)} className="p-1 text-[var(--text-muted)] hover:text-red-600" aria-label="Remove step"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    {s.type === 'email' && (
                      <div className="space-y-2">
                        <input value={s.subject} onChange={e => updateStep(s.id, { subject: e.target.value })} placeholder="Subject line" className={`${inputCls} text-[13px]`} />
                        <textarea value={s.body_html} onChange={e => updateStep(s.id, { body_html: e.target.value })} rows={5} placeholder="<p>Dear {{client.first_name | default: &quot;client&quot;}},</p>" className={`${inputCls} font-mono text-[12px] resize-y`} />
                      </div>
                    )}
                    {s.type === 'wait' && (
                      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        Wait <input type="number" min={0} value={s.days} onChange={e => updateStep(s.id, { days: Number(e.target.value) || 0 })} className={`${inputCls} w-20`} /> days before the next step.
                      </div>
                    )}
                    {s.type === 'check' && (
                      <div className="space-y-2 text-sm text-[var(--text-secondary)]">
                        <div>
                          Check whether the client has
                          <select value={s.goal} onChange={e => updateStep(s.id, { goal: e.target.value as JourneyGoal })} className={`${inputCls} mt-1`}>
                            {(Object.keys(GOAL_LABELS) as JourneyGoal[]).map(g => <option key={g} value={g}>{GOAL_LABELS[g]}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[11px] font-semibold text-[var(--text-secondary)]">If they have</label>
                            <select value={branchToValue(s.onMet, 'finish')} onChange={e => updateStep(s.id, { onMet: valueToBranch(e.target.value) })} className={`mt-1 ${inputCls}`}>
                              <option value="finish">Finish the journey</option>
                              <option value="continue">Continue to next step</option>
                              {steps.filter(o => o.id !== s.id).map(o => (
                                <option key={o.id} value={`jump:${o.id}`}>Jump to {stepShortLabel(o, steps.indexOf(o))}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[var(--text-secondary)]">If they haven’t</label>
                            <select value={branchToValue(s.onNotMet, 'continue')} onChange={e => updateStep(s.id, { onNotMet: valueToBranch(e.target.value) })} className={`mt-1 ${inputCls}`}>
                              <option value="continue">Continue to next step</option>
                              <option value="finish">Finish the journey</option>
                              {steps.filter(o => o.id !== s.id).map(o => (
                                <option key={o.id} value={`jump:${o.id}`}>Jump to {stepShortLabel(o, steps.indexOf(o))}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <div className="flex gap-2">
                  <button onClick={() => addStep('email')} className="btn-secondary text-xs"><Mail size={13} /> Email</button>
                  <button onClick={() => addStep('wait')} className="btn-secondary text-xs"><Clock size={13} /> Wait</button>
                  <button onClick={() => addStep('check')} className="btn-secondary text-xs"><Target size={13} /> Check goal</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-black/5">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save automation'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
