'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ChevronDown, ChevronRight, ExternalLink, AlertTriangle, Sparkles, FileText, RefreshCw } from 'lucide-react';

interface BriefingSection {
  heading: string;
  body: string;
  sources: Array<{ label: string; url: string }>;
}
interface BriefingContent {
  summary: string;
  sections: BriefingSection[];
  action_items: string[];
  training_tips: string[];
}
interface BriefingRow {
  id: string;
  quarter: string;
  period_start: string;
  period_end: string;
  summary: string | null;
  content: BriefingContent | null;
  status: 'success' | 'failed';
  error_detail: string | null;
  generated_at: string;
}

interface Props {
  isAdmin: boolean;
}

const fmtRange = (start: string, end: string): string => {
  const f = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${f(start)} – ${f(end)}`;
};

export default function ManagerBriefingsTab({ isAdmin }: Props) {
  const [briefings, setBriefings] = useState<BriefingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/hr/manager-briefings');
    const data = await res.json();
    setBriefings(data.briefings ?? []);
    if (data.briefings?.length > 0) setOpenId(data.briefings[0].id);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function generateNow() {
    if (!confirm('Generate a new briefing for the previous completed quarter? This makes a Claude API call (web search) and may take 30–90 seconds.')) return;
    setGenerating(true); setError(null);
    try {
      const res = await fetch('/api/hr/manager-briefings', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generation failed');
      if (data.status === 'skipped') {
        alert(`Skipped: ${data.reason ?? 'already exists'}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally { setGenerating(false); }
  }

  return (
    <div className="space-y-4">
      {/* Banner + admin trigger */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-[var(--accent)] text-xs">
        <Sparkles size={14} className="shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold">Quarterly UK employment-law briefing for managers</p>
          <p className="mt-0.5 opacity-90">Auto-generated on the 1st of January, April, July and October. Drawn from gov.uk, ACAS, CIPD, HMRC, legislation.gov.uk and the Commons Library. Reading material — not legal advice.</p>
        </div>
        {isAdmin && (
          <button onClick={() => void generateNow()} disabled={generating} className="btn-secondary text-xs inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50">
            {generating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            Generate now
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />{error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin inline mr-1.5" />Loading briefings…</div>
      ) : briefings.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-[var(--border)]">
          <FileText size={28} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No briefings yet — the next one is scheduled for the start of the next quarter.</p>
          {isAdmin && <p className="text-xs text-[var(--text-muted)] mt-1">Or generate one now using the button above.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {briefings.map(b => {
            const isOpen = openId === b.id;
            return (
              <div key={b.id} className={`bg-white border rounded-xl overflow-hidden ${b.status === 'failed' ? 'border-red-200' : 'border-[var(--border)]'}`}>
                <button
                  onClick={() => setOpenId(isOpen ? null : b.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-nav-hover)] text-left"
                >
                  {isOpen ? <ChevronDown size={14} className="mt-0.5 text-[var(--accent)] shrink-0" /> : <ChevronRight size={14} className="mt-0.5 text-gray-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold">Briefing — {b.quarter}</h3>
                      <span className="text-[10px] text-[var(--text-muted)]">{fmtRange(b.period_start, b.period_end)}</span>
                      {b.status === 'failed' && <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded bg-red-100 text-red-700">Generation failed</span>}
                    </div>
                    {b.summary && <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{b.summary}</p>}
                    {b.status === 'failed' && b.error_detail && <p className="text-xs text-red-600 mt-1">{b.error_detail}</p>}
                  </div>
                </button>
                {isOpen && b.content && <ExpandedBriefing content={b.content} />}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-muted)] italic text-center">
        ⚠ This briefing is high-level guidance, not legal advice. For any specific situation, consult a qualified HR or employment-law adviser.
      </p>
    </div>
  );
}

function ExpandedBriefing({ content }: { content: BriefingContent }) {
  return (
    <div className="px-4 pb-4 pl-11 space-y-4 bg-gray-50/50 border-t border-gray-100">
      {content.sections.map((s, i) => (
        <div key={i}>
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mt-3">{s.heading}</h4>
          <p className="text-xs text-[var(--text-primary)] mt-1 leading-relaxed whitespace-pre-wrap">{s.body}</p>
          {s.sources.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1.5">
              {s.sources.map(src => (
                <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline">
                  <ExternalLink size={10} />{src.label}
                </a>
              ))}
            </div>
          )}
        </div>
      ))}

      {content.action_items.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Manager actions this quarter</p>
          <ul className="space-y-1.5 text-xs">
            {content.action_items.map((a, i) => (
              <li key={i} className="flex items-start gap-2"><span className="text-[var(--accent)] mt-0.5 shrink-0">•</span><span>{a}</span></li>
            ))}
          </ul>
        </div>
      )}

      {content.training_tips.length > 0 && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-purple-700 mb-1.5">Training & 1:1 prompts</p>
          <ul className="space-y-1.5 text-xs text-purple-900">
            {content.training_tips.map((t, i) => (
              <li key={i} className="flex items-start gap-2"><span className="mt-0.5 shrink-0">·</span><span>{t}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
