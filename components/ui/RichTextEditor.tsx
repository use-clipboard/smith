'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import Link from '@tiptap/extension-link';
import { useCallback, useRef, useState } from 'react';
import {
  Bold, Italic, UnderlineIcon, Strikethrough, Link2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Minus, Undo2, Redo2,
  Highlighter, Palette, ChevronDown, Link2Off,
} from 'lucide-react';

// ── Colour palettes ───────────────────────────────────────────────────────────

const TEXT_COLOURS = [
  '#111827', '#374151', '#6B7280', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#14B8A6', '#3B82F6', '#6366F1',
  '#8B5CF6', '#EC4899', '#FFFFFF',
];

const HIGHLIGHT_COLOURS = [
  '#FEF08A', '#FED7AA', '#FCA5A5', '#BBF7D0', '#BAE6FD',
  '#C7D2FE', '#F5D0FE', '#FFFFFF', 'transparent',
];

const HEADING_OPTIONS = [
  { label: 'Paragraph', value: 'paragraph' },
  { label: 'Heading 1', value: 'h1' },
  { label: 'Heading 2', value: 'h2' },
  { label: 'Heading 3', value: 'h3' },
  { label: 'Heading 4', value: 'h4' },
];

// ── Toolbar button ────────────────────────────────────────────────────────────

function ToolBtn({
  onClick, active = false, disabled = false, title, children,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onMouseDown={e => { e.preventDefault(); onClick(); }}
      disabled={disabled} title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-md text-sm transition-colors
        ${active
          ? 'bg-[var(--accent)] text-white'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'}
        disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />;
}

// ── Colour picker popover ─────────────────────────────────────────────────────

function ColourPicker({
  colours, currentColour, onSelect, icon, title,
}: {
  colours: string[]; currentColour?: string; onSelect: (c: string) => void; icon: React.ReactNode; title: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button" title={title} onMouseDown={e => { e.preventDefault(); setOpen(v => !v); }}
        className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        <div className="flex flex-col items-center gap-0">
          {icon}
          <div className="w-4 h-1 rounded-sm mt-0.5 border border-black/10" style={{ background: currentColour && currentColour !== 'transparent' ? currentColour : '#111827' }} />
        </div>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-2.5 w-44">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2 px-0.5">{title}</p>
          <div className="grid grid-cols-6 gap-1.5">
            {colours.map(c => (
              <button key={c} type="button"
                onMouseDown={e => { e.preventDefault(); onSelect(c); setOpen(false); }}
                title={c}
                className="w-6 h-6 rounded border border-black/10 hover:scale-110 transition-transform"
                style={{ background: c === 'transparent' ? 'linear-gradient(135deg, #fff 45%, #f00 45%, #f00 55%, #fff 55%)' : c }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main editor ───────────────────────────────────────────────────────────────

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

export default function RichTextEditor({ content, onChange, placeholder }: RichTextEditorProps) {
  const [headingOpen, setHeadingOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: 'policy-link' } }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: 'policy-editor focus:outline-none min-h-[400px] leading-relaxed text-sm',
      },
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); }
    else { editor.chain().focus().extendMarkRange('link').setLink({ href: url.startsWith('http') ? url : `https://${url}` }).run(); }
    setLinkOpen(false); setLinkUrl('');
  }, [editor, linkUrl]);

  if (!editor) return null;

  // Current heading label
  const activeHeading = editor.isActive('heading', { level: 1 }) ? 'Heading 1'
    : editor.isActive('heading', { level: 2 }) ? 'Heading 2'
    : editor.isActive('heading', { level: 3 }) ? 'Heading 3'
    : editor.isActive('heading', { level: 4 }) ? 'Heading 4'
    : 'Paragraph';

  return (
    <div className="flex flex-col flex-1 min-h-0 glass-solid rounded-xl border border-[var(--border)] overflow-hidden">

      {/* ── Ribbon ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-0.5 flex-wrap px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-page)]">

        {/* Heading / Paragraph dropdown */}
        <div className="relative mr-1">
          <button type="button" onMouseDown={e => { e.preventDefault(); setHeadingOpen(v => !v); }}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-md text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors border border-[var(--border)] min-w-[110px] justify-between">
            <span className="text-xs">{activeHeading}</span>
            <ChevronDown size={12} />
          </button>
          {headingOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown overflow-hidden w-40">
              {HEADING_OPTIONS.map(opt => (
                <button key={opt.value} type="button"
                  onMouseDown={e => {
                    e.preventDefault();
                    if (opt.value === 'paragraph') editor.chain().focus().setParagraph().run();
                    else editor.chain().focus().toggleHeading({ level: parseInt(opt.value[1]) as 1 | 2 | 3 | 4 }).run();
                    setHeadingOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-nav-hover)] transition-colors
                    ${opt.value === 'h1' ? 'text-lg font-bold text-[var(--text-primary)]' : ''}
                    ${opt.value === 'h2' ? 'text-base font-bold text-[var(--text-primary)]' : ''}
                    ${opt.value === 'h3' ? 'text-sm font-semibold text-[var(--text-primary)]' : ''}
                    ${opt.value === 'h4' ? 'text-sm font-medium text-[var(--text-secondary)]' : ''}
                    ${opt.value === 'paragraph' ? 'text-sm text-[var(--text-secondary)]' : ''}
                  `}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <Divider />

        {/* Text style */}
        <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <Bold size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <Italic size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <UnderlineIcon size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough size={14} />
        </ToolBtn>

        <Divider />

        {/* Colour + Highlight */}
        <ColourPicker
          colours={TEXT_COLOURS}
          currentColour={editor.getAttributes('textStyle').color}
          onSelect={c => editor.chain().focus().setColor(c).run()}
          icon={<Palette size={14} />}
          title="Text colour"
        />
        <ColourPicker
          colours={HIGHLIGHT_COLOURS}
          currentColour={editor.getAttributes('highlight').color}
          onSelect={c => {
            if (c === 'transparent') editor.chain().focus().unsetHighlight().run();
            else editor.chain().focus().setHighlight({ color: c }).run();
          }}
          icon={<Highlighter size={14} />}
          title="Highlight colour"
        />

        <Divider />

        {/* Alignment */}
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
          <AlignLeft size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align centre">
          <AlignCenter size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
          <AlignRight size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">
          <AlignJustify size={14} />
        </ToolBtn>

        <Divider />

        {/* Lists */}
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
          <ListOrdered size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote">
          <Quote size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
          <Minus size={14} />
        </ToolBtn>

        <Divider />

        {/* Link */}
        <div className="relative">
          <ToolBtn onClick={() => { setLinkUrl(editor.getAttributes('link').href ?? ''); setLinkOpen(v => !v); }} active={editor.isActive('link')} title="Insert link">
            <Link2 size={14} />
          </ToolBtn>
          {linkOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-3 w-64 space-y-2">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Insert Link</p>
              <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setLink()}
                placeholder="https://example.com" autoFocus
                className="input-base w-full text-sm" />
              <div className="flex gap-2">
                <button type="button" onMouseDown={e => { e.preventDefault(); setLink(); }} className="btn-primary text-xs flex-1">Set Link</button>
                {editor.isActive('link') && (
                  <button type="button" onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetLink().run(); setLinkOpen(false); }}
                    className="btn-secondary text-xs">
                    <Link2Off size={12} />Remove
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <Divider />

        {/* Undo / Redo */}
        <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
          <Redo2 size={14} />
        </ToolBtn>
      </div>

      {/* ── Editor body ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto relative">
        {!editor.getText() && (
          <p className="absolute top-4 left-6 text-[var(--text-muted)] text-sm pointer-events-none select-none opacity-60">
            {placeholder ?? 'Start writing your policy…'}
          </p>
        )}
        <EditorContent editor={editor} className="h-full p-6" />
      </div>
    </div>
  );
}
