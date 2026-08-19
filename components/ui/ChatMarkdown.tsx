'use client';

/**
 * ChatMarkdown — the small markdown subset SMITH's chat replies actually use.
 *
 * Claude writes **bold**, bullet lists and the odd heading whether or not we
 * ask it to, and rendering that as raw text puts literal asterisks in front of
 * the user. This turns it into real formatting.
 *
 * Deliberately hand-rolled and deliberately small: headings, horizontal rules,
 * bullet/numbered lists, paragraphs, and inline **bold** / *italic* / `code`,
 * plus a pipe-table fallback for when a table slips through. No dependency, no
 * HTML parsing, so there is no injection surface — every branch emits React
 * elements from captured groups, never dangerouslySetInnerHTML.
 *
 * Extracted from the bookkeeping AI Adviser so every SMITH chat surface renders
 * identically. The Adviser wraps this with its own ```journal fence handling.
 */

import type React from 'react';

/** Inline: **bold**, *italic*, `code`. */
export function renderInline(text: string): React.ReactNode {
  const segments: React.ReactNode[] = [];
  const regex = /(\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|`([^`\n]+?)`)/g;
  let lastIndex = 0, key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) segments.push(text.slice(lastIndex, m.index));
    if (m[2] !== undefined) segments.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3] !== undefined) segments.push(<em key={key++}>{m[3]}</em>);
    else if (m[4] !== undefined) segments.push(<code key={key++} className="px-1 py-0.5 rounded bg-slate-100 text-[12px] text-slate-700 font-mono">{m[4]}</code>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) segments.push(text.slice(lastIndex));
  return segments;
}

/**
 * Block-level markdown: headings, horizontal rules, bullet/numbered lists,
 * paragraphs.
 */
export default function ChatMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(
      <p key={key++} className="my-1.5 first:mt-0">
        {para.map((l, i) => <span key={i}>{renderInline(l)}{i < para.length - 1 && <br />}</span>)}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(list.ordered
      ? <ol key={key++} className="my-1.5 list-decimal pl-5 space-y-0.5">{items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ol>
      : <ul key={key++} className="my-1.5 list-disc pl-5 space-y-0.5">{items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}</ul>);
    list = null;
  };

  const splitCells = (row: string) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trimEnd();
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { flushPara(); flushList(); blocks.push(<hr key={key++} className="my-2 border-slate-200" />); continue; }

    // Pipe-table fallback: a row with at least one |, followed by a |---|---|
    // separator. The model is told not to use tables, but if one slips through
    // we render it styled rather than as raw "| ... |" text.
    const next = lines[idx + 1]?.trim() ?? '';
    if (line.includes('|') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(next) && next.includes('-')) {
      flushPara(); flushList();
      const header = splitCells(line);
      const rows: string[][] = [];
      let j = idx + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim()) { rows.push(splitCells(lines[j])); j++; }
      blocks.push(
        <table key={key++} className="my-2 w-full text-[12px] border border-slate-200 rounded overflow-hidden">
          <thead><tr className="bg-slate-50">{header.map((h, i) => <th key={i} className="text-left font-semibold text-slate-600 px-2 py-1 border-b border-slate-200">{renderInline(h)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-slate-100">{r.map((c, ci) => <td key={ci} className="px-2 py-1 text-slate-700 align-top">{renderInline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      idx = j - 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara(); flushList();
      blocks.push(<p key={key++} className="mt-2.5 mb-1 text-[13px] font-semibold text-slate-900">{renderInline(heading[2])}</p>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
      continue;
    }
    if (numbered) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(numbered[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return <>{blocks}</>;
}
