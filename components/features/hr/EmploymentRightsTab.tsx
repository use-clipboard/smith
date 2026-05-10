'use client';

import { useState, useMemo } from 'react';
import {
  BookOpen, Search, Users, ShieldCheck, X, ChevronRight, ExternalLink, AlertTriangle, Sparkles,
} from 'lucide-react';
import { EMPLOYMENT_RIGHTS_BILL_TOPICS, type ErBillTopic, type ErBillAudience } from '@/lib/employmentRightsBill';

// ── Component ──────────────────────────────────────────────────────────
export default function EmploymentRightsTab() {
  const [search, setSearch] = useState('');
  const [audience, setAudience] = useState<'all-audiences' | ErBillAudience>('all-audiences');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const topics = useMemo(() => {
    const q = search.trim().toLowerCase();
    return EMPLOYMENT_RIGHTS_BILL_TOPICS.filter(t => {
      if (audience !== 'all-audiences' && t.audience !== audience && t.audience !== 'all') return false;
      if (!q) return true;
      const haystack = `${t.title} ${t.summary} ${t.keyPoints.join(' ')} ${t.forStaff ?? ''} ${t.forManagers ?? ''}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [search, audience]);

  function toggleOpen(id: string) {
    setOpenIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      {/* Disclaimer banner */}
      <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--accent-light)] border border-[var(--accent)]/20 text-[var(--accent)] text-xs">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">UK Employment Rights Bill 2026 — high-level reference</p>
          <p className="mt-0.5 opacity-90">Phasing in across 2026–2027. Provisions are still being shaped by secondary legislation, so check the live commencement details with a qualified HR or employment-law adviser before applying any of this to a specific case.</p>
        </div>
      </div>

      {/* Search + audience filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search topics — e.g. probation, harassment, sick pay…"
            className="input-base text-sm w-full pl-9 pr-9"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)]">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="inline-flex bg-white border border-[var(--border)] rounded-full p-0.5 text-xs">
          <FilterPill active={audience === 'all-audiences'} onClick={() => setAudience('all-audiences')} icon={Sparkles} label="Everyone" />
          <FilterPill active={audience === 'all'} onClick={() => setAudience('all')} icon={Users} label="For all staff" />
          <FilterPill active={audience === 'managers'} onClick={() => setAudience('managers')} icon={ShieldCheck} label="For managers" />
        </div>
      </div>

      {/* Topic list */}
      {topics.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-[var(--border)]">
          <BookOpen size={24} className="text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-[var(--text-muted)]">No topics match your filter.</p>
        </div>
      ) : (
        <div className="bg-white border border-[var(--border)] rounded-xl divide-y divide-gray-100">
          {topics.map(t => {
            const isOpen = openIds.has(t.id);
            return (
              <div key={t.id}>
                <button
                  onClick={() => toggleOpen(t.id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-indigo-50/30 transition-colors"
                >
                  <div className={`shrink-0 mt-0.5 transition-transform ${isOpen ? 'rotate-90 text-[var(--accent)]' : 'text-gray-400'}`}>
                    <ChevronRight size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t.title}</h3>
                      <AudienceBadge audience={t.audience} />
                      <span className="text-[10px] text-[var(--text-muted)]">·</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{t.status}</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{t.summary}</p>
                  </div>
                </button>

                {isOpen && <ExpandedTopic topic={t} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer disclaimer */}
      <p className="text-[11px] text-[var(--text-muted)] italic text-center">
        ⚠ This knowledge base is high-level guidance, not legal advice. For any individual situation, consult a qualified HR or employment-law adviser.
      </p>
    </div>
  );
}

// ── Filter pill ────────────────────────────────────────────────────────
function FilterPill({ active, onClick, icon: Icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full transition-colors ${active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)]'}`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// ── Audience badge ─────────────────────────────────────────────────────
function AudienceBadge({ audience }: { audience: ErBillAudience }) {
  const cls = audience === 'managers'
    ? 'bg-purple-100 text-purple-700'
    : 'bg-emerald-100 text-emerald-700';
  const Icon = audience === 'managers' ? ShieldCheck : Users;
  const label = audience === 'managers' ? 'For managers' : 'For all staff';
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${cls}`}>
      <Icon size={9} />{label}
    </span>
  );
}

// ── Expanded topic body ────────────────────────────────────────────────
function ExpandedTopic({ topic }: { topic: ErBillTopic }) {
  return (
    <div className="px-4 pb-4 pl-11 space-y-4 bg-gray-50/50">
      {/* Key points */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">Key points</p>
        <ul className="space-y-1.5 text-xs text-[var(--text-primary)] leading-relaxed">
          {topic.keyPoints.map((p, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-[var(--accent)] mt-0.5 shrink-0">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* For staff */}
      {topic.forStaff && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1.5 flex items-center gap-1.5">
            <Users size={11} />For all staff
          </p>
          <p className="text-xs text-emerald-900 leading-relaxed">{topic.forStaff}</p>
        </div>
      )}

      {/* For managers */}
      {topic.forManagers && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-purple-700 mb-1.5 flex items-center gap-1.5">
            <ShieldCheck size={11} />For managers
          </p>
          <p className="text-xs text-purple-900 leading-relaxed">{topic.forManagers}</p>
        </div>
      )}

      {/* Sources */}
      {topic.sources.length > 0 && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Sources & further reading</p>
          <div className="flex flex-wrap gap-2">
            {topic.sources.map(s => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
              >
                <ExternalLink size={11} />{s.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
