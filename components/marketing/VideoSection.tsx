'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';

/**
 * "See SMITH in action" — a hero welcome video plus a row of short tutorial
 * clips. Each card holds an optional `youtubeId`; until the real videos are
 * supplied it renders a branded placeholder, and clicking embeds the iframe.
 *
 * To wire a real video, set `youtubeId` (the bit after `watch?v=`) on the entry
 * below — no other change needed.
 */
type Clip = { id: string; title: string; length: string; youtubeId?: string };

const WELCOME: Clip = {
  id: 'welcome',
  title: 'The AI workspace for accounting firms',
  length: '3:58',
  youtubeId: undefined, // ← drop the welcome video ID here
};

const TUTORIALS: Clip[] = [
  { id: 't1', title: 'Triage your inbox with AI', length: '2:10' },
  { id: 't2', title: 'Run an accounts review', length: '3:24' },
  { id: 't3', title: 'Bookkeeping, start to export', length: '4:02' },
];

function VideoFrame({ clip, large }: { clip: Clip; large?: boolean }) {
  const [playing, setPlaying] = useState(false);

  if (playing && clip.youtubeId) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube.com/embed/${clip.youtubeId}?autoplay=1`}
          title={clip.title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      onClick={() => clip.youtubeId && setPlaying(true)}
      className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#3b3a8c] via-[#4f46e5] to-[#6366f1] text-left shadow-[0_24px_60px_-20px_rgba(79,70,229,0.5)]"
    >
      {/* Faux app-window dressing */}
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute right-6 top-6 h-24 w-40 rounded-lg bg-white/20" />
        <div className="absolute bottom-6 left-6 h-16 w-56 rounded-lg bg-white/15" />
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
        <span className="flex items-center gap-2 text-sm font-semibold text-white/90">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-5 w-5 rounded brightness-0 invert" />
          SMITH
        </span>
        <div
          className={`flex items-center justify-center rounded-full bg-white text-primary-700 shadow-xl transition-transform group-hover:scale-110 ${
            large ? 'h-16 w-16' : 'h-12 w-12'
          }`}
        >
          <Play className={large ? 'h-7 w-7 fill-current' : 'h-5 w-5 fill-current'} />
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/50 to-transparent p-4">
        <span className={`font-medium text-white ${large ? 'text-base' : 'text-xs'}`}>{clip.title}</span>
        <span className="rounded bg-black/30 px-1.5 py-0.5 text-[11px] text-white/90">{clip.length}</span>
      </div>

      {!clip.youtubeId && (
        <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          Coming soon
        </span>
      )}
    </button>
  );
}

export default function VideoSection() {
  return (
    <div className="relative px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-600">
            Product tour
          </span>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[2.1rem]">
            See SMITH{' '}
            <span className="text-primary-600">in action</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">
            A quick overview of how SMITH helps accounting firms save time and work
            smarter — then short tutorials for every tool, so your team is up and
            running in minutes.
          </p>
          <a
            href="/signup"
            className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(79,70,229,0.35)] transition-all hover:-translate-y-0.5 hover:bg-primary-700"
          >
            Start free trial
          </a>
        </div>

        <VideoFrame clip={WELCOME} large />
      </div>

      {/* Tutorials */}
      <div className="mt-12">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
          Tutorials
        </h3>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          {TUTORIALS.map((c) => (
            <VideoFrame key={c.id} clip={c} />
          ))}
        </div>
      </div>
    </div>
  );
}
