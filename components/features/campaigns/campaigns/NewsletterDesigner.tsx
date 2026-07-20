'use client';

import { Heading1, Type, Image as ImageIcon, MousePointerClick, Minus, MoveVertical, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { DesignBlock, NewsletterDesign } from '@/types/campaigns';
import { blockId, DEFAULT_BRAND_COLOR } from '@/lib/campaigns/newsletter';

const BLOCK_META: Record<DesignBlock['type'], { label: string; Icon: typeof Type }> = {
  heading: { label: 'Heading', Icon: Heading1 },
  text:    { label: 'Text',    Icon: Type },
  image:   { label: 'Image',   Icon: ImageIcon },
  button:  { label: 'Button',  Icon: MousePointerClick },
  divider: { label: 'Divider', Icon: Minus },
  spacer:  { label: 'Spacer',  Icon: MoveVertical },
};

function newBlock(type: DesignBlock['type']): DesignBlock {
  switch (type) {
    case 'heading': return { id: blockId(), type, text: 'Your headline' };
    case 'text':    return { id: blockId(), type, text: 'Write your message here.' };
    case 'image':   return { id: blockId(), type, src: '', alt: '', href: '' };
    case 'button':  return { id: blockId(), type, label: 'Read more', href: '' };
    case 'spacer':  return { id: blockId(), type, height: 16 };
    default:        return { id: blockId(), type: 'divider' };
  }
}

export default function NewsletterDesigner({ design, onChange }: { design: NewsletterDesign; onChange: (d: NewsletterDesign) => void }) {
  const inputCls = 'w-full text-[13px] rounded-lg border border-[var(--border)] px-2.5 py-1.5 focus:outline-none focus:border-[var(--accent)]';

  function setBlocks(blocks: DesignBlock[]) { onChange({ ...design, blocks }); }
  function add(type: DesignBlock['type']) { setBlocks([...design.blocks, newBlock(type)]); }
  function update(id: string, patch: Partial<DesignBlock>) {
    setBlocks(design.blocks.map(b => (b.id === id ? ({ ...b, ...patch } as DesignBlock) : b)));
  }
  function remove(id: string) { setBlocks(design.blocks.filter(b => b.id !== id)); }
  function move(id: string, dir: -1 | 1) {
    const i = design.blocks.findIndex(b => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= design.blocks.length) return;
    const next = [...design.blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  }

  return (
    <div className="space-y-3">
      {/* Branding */}
      <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-black/[0.015] border border-[var(--border)]">
        <div>
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Brand colour</label>
          <input type="color" value={design.brandColor || DEFAULT_BRAND_COLOR}
            onChange={e => onChange({ ...design, brandColor: e.target.value })}
            className="mt-1 block h-8 w-14 rounded border border-[var(--border)] bg-white p-0.5" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-semibold text-[var(--text-secondary)]">Logo URL <span className="text-[var(--text-muted)] font-normal">(optional)</span></label>
          <input value={design.logoUrl ?? ''} onChange={e => onChange({ ...design, logoUrl: e.target.value })}
            placeholder="https://…/logo.png" className={`mt-1 ${inputCls}`} />
        </div>
      </div>

      {/* Blocks */}
      {design.blocks.length === 0 && (
        <div className="text-xs text-[var(--text-muted)] italic p-3 border border-dashed border-[var(--border)] rounded-lg">
          No blocks yet — add a heading or some text to get started.
        </div>
      )}

      {design.blocks.map((b, i) => {
        const { label, Icon } = BLOCK_META[b.type] ?? BLOCK_META.text;
        return (
          <div key={b.id} className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={13} style={{ color: 'var(--accent)' }} />
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button onClick={() => move(b.id, -1)} disabled={i === 0} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="Move up"><ChevronUp size={14} /></button>
                <button onClick={() => move(b.id, 1)} disabled={i === design.blocks.length - 1} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30" aria-label="Move down"><ChevronDown size={14} /></button>
                <button onClick={() => remove(b.id)} className="p-1 text-[var(--text-muted)] hover:text-red-600" aria-label="Remove block"><Trash2 size={13} /></button>
              </div>
            </div>

            {b.type === 'heading' && (
              <input value={b.text} onChange={e => update(b.id, { text: e.target.value })} className={inputCls} placeholder="Headline" />
            )}

            {b.type === 'text' && (
              <textarea value={b.text} onChange={e => update(b.id, { text: e.target.value })} rows={4} className={`${inputCls} resize-y`}
                placeholder={'Your message. Blank line = new paragraph.\n**bold** and [link](https://example.com) work.'} />
            )}

            {b.type === 'image' && (
              <div className="space-y-2">
                <input value={b.src} onChange={e => update(b.id, { src: e.target.value })} className={inputCls} placeholder="Image URL (https://…)" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={b.alt} onChange={e => update(b.id, { alt: e.target.value })} className={inputCls} placeholder="Alt text" />
                  <input value={b.href} onChange={e => update(b.id, { href: e.target.value })} className={inputCls} placeholder="Link to (optional)" />
                </div>
              </div>
            )}

            {b.type === 'button' && (
              <div className="grid grid-cols-2 gap-2">
                <input value={b.label} onChange={e => update(b.id, { label: e.target.value })} className={inputCls} placeholder="Button label" />
                <input value={b.href} onChange={e => update(b.id, { href: e.target.value })} className={inputCls} placeholder="https://…" />
              </div>
            )}

            {b.type === 'spacer' && (
              <div className="flex items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                Height <input type="number" min={4} max={80} value={b.height} onChange={e => update(b.id, { height: Number(e.target.value) || 16 })} className={`${inputCls} w-20`} /> px
              </div>
            )}

            {b.type === 'divider' && <div className="text-xs text-[var(--text-muted)]">A horizontal rule.</div>}
          </div>
        );
      })}

      {/* Add */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(BLOCK_META) as DesignBlock['type'][]).map(t => {
          const { label, Icon } = BLOCK_META[t];
          return (
            <button key={t} onClick={() => add(t)} className="btn-secondary text-xs"><Icon size={13} /> {label}</button>
          );
        })}
      </div>

      <p className="text-[11px] text-[var(--text-muted)]">
        Compiles to table-based HTML with inline styles, so it renders consistently in Outlook and Gmail. Merge tags
        like <code className="bg-black/5 px-1 rounded">{'{{client.first_name}}'}</code> work inside any text.
      </p>
    </div>
  );
}
