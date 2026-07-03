'use client';

import { useState, useEffect } from 'react';
import {
  FileText, FileCode2, Package, Calculator, PenLine, ClipboardSignature, FileStack,
  Check, Loader2, Send, Signature, Landmark, Archive, PartyPopper, Sparkles, Download,
} from 'lucide-react';
import { StudioCard } from '../primitives';
import { OUTPUT_DOCS } from '../data';
import type { Engagement, OutputDoc } from '../types';

const DOC_ICON: Record<string, typeof FileText> = {
  statutory: FileText, ixbrl: FileCode2, 'ch-package': Package, ct: Calculator,
  approval: ClipboardSignature, 'rep-letter': PenLine, management: FileStack,
};

const ACTIONS = [
  { id: 'send',    label: 'Send to Client',           icon: Send,      sub: 'Email the approval pack' },
  { id: 'approve', label: 'Digital Approval',         icon: Signature, sub: 'E-signature via Client Portal' },
  { id: 'ch',      label: 'Submit to Companies House', icon: Landmark,  sub: 'File iXBRL accounts' },
  { id: 'ct',      label: 'Send to Corporation Tax',   icon: Calculator,sub: 'Feed the CT600 module' },
  { id: 'archive', label: 'Archive in Document Vault', icon: Archive,   sub: 'Store every generated file' },
];

export default function StagePublish({
  engagement, patch,
}: {
  engagement: Engagement;
  patch: (u: (e: Engagement) => Engagement) => void;
}) {
  const [generated, setGenerated] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [genIdx, setGenIdx] = useState(-1);
  const [publishing, setPublishing] = useState(false);

  const allGenerated = generated.size === OUTPUT_DOCS.length;

  useEffect(() => {
    if (!generating) return;
    if (genIdx >= OUTPUT_DOCS.length) { setGenerating(false); return; }
    const t = setTimeout(() => {
      setGenerated(prev => new Set(prev).add(OUTPUT_DOCS[genIdx].id));
      setGenIdx(i => i + 1);
    }, 380);
    return () => clearTimeout(t);
  }, [generating, genIdx]);

  function generateAll() {
    setGenerated(new Set());
    setGenIdx(0);
    setGenerating(true);
  }

  function publish() {
    setPublishing(true);
    setTimeout(() => {
      patch(e => ({
        ...e,
        published: true,
        stageStatus: { ...e.stageStatus, publish: 'complete' },
      }));
      setPublishing(false);
    }, 1400);
  }

  // ── Success screen ──────────────────────────────────────────────────────────
  if (engagement.published) {
    return (
      <div className="mx-auto max-w-xl">
        <StudioCard className="overflow-hidden text-center">
          <div className="relative flex flex-col items-center gap-3 px-8 py-12 text-white"
            style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
            <div className="pointer-events-none absolute -left-10 -top-12 h-44 w-44 rounded-full bg-white/15 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-14 -right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/20 backdrop-blur">
              <PartyPopper size={32} className="text-white" />
            </div>
            <h2 className="text-2xl font-bold">Accounts Published</h2>
            <p className="max-w-sm text-[13px] text-white/85">{engagement.companyName} — statutory accounts for the year ended {engagement.periodEnd} are complete.</p>
          </div>
          <div className="space-y-2 px-8 py-7">
            {[
              'Companies House Ready',
              'Corporation Tax Ready',
              'Client Approved',
              'Archive Complete',
            ].map(item => (
              <div key={item} className="flex items-center gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-4 py-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white"><Check size={14} /></div>
                <span className="text-[13.5px] font-semibold text-emerald-800">{item}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-black/5 px-8 py-5">
            <button className="btn-primary w-full justify-center"><Download size={15} /> Download filing package</button>
          </div>
        </StudioCard>
      </div>
    );
  }

  // ── Pre-publish ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-5">
      {/* Documents */}
      <StudioCard className="overflow-hidden lg:col-span-3">
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div>
            <h3 className="text-[15px] font-bold text-[var(--text-primary)]">Generate documents</h3>
            <p className="text-[12px] text-[var(--text-muted)]">Everything you need to file and get sign-off.</p>
          </div>
          {!allGenerated && (
            <button onClick={generateAll} disabled={generating} className="btn-primary">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate all
            </button>
          )}
        </div>
        <div className="divide-y divide-black/5">
          {OUTPUT_DOCS.map((doc: OutputDoc, i) => {
            const Icon = DOC_ICON[doc.id] ?? FileText;
            const isGen = generated.has(doc.id);
            const isGenerating = generating && genIdx === i;
            return (
              <div key={doc.id} className="flex items-center gap-3 px-6 py-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isGen ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                  <Icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{doc.title}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{doc.description}</p>
                </div>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-500">{doc.format}</span>
                {isGenerating ? <Loader2 size={16} className="animate-spin text-[var(--accent)]" />
                  : isGen ? <Check size={17} className="text-emerald-500" />
                  : <span className="h-4 w-4 rounded-full border border-slate-200" />}
              </div>
            );
          })}
        </div>
      </StudioCard>

      {/* Actions */}
      <div className="space-y-3 lg:col-span-2">
        <StudioCard className="p-4">
          <h4 className="mb-2 px-1 text-[13px] font-bold text-[var(--text-primary)]">Publish &amp; distribute</h4>
          <div className="space-y-1.5">
            {ACTIONS.map(a => (
              <button
                key={a.id}
                disabled={!allGenerated}
                className="flex w-full items-center gap-3 rounded-xl border border-black/5 bg-white/60 px-3 py-2.5 text-left transition-all hover:border-[var(--accent)]/30 hover:bg-[var(--accent)]/5 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                  <a.icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">{a.label}</p>
                  <p className="text-[11px] text-[var(--text-muted)]">{a.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </StudioCard>

        <button
          onClick={publish}
          disabled={!allGenerated || publishing}
          className="btn-primary w-full justify-center py-3 text-[14px] disabled:opacity-45"
        >
          {publishing ? <><Loader2 size={16} className="animate-spin" /> Publishing…</> : <><PartyPopper size={16} /> Publish accounts</>}
        </button>
        {!allGenerated && <p className="text-center text-[11px] text-[var(--text-muted)]">Generate the documents first to enable publishing.</p>}
      </div>
    </div>
  );
}
