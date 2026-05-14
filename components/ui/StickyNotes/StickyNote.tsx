'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import {
  Bold, Italic, ListChecks, LinkIcon, X, Palette, GripVertical, Minus,
} from 'lucide-react';
import Tooltip from '@/components/ui/Tooltip';
import { useStickyNotes, StickyColor, type StickyNote as StickyNoteData } from './StickyNotesProvider';

interface Props {
  note: StickyNoteData;
}

const COLOR_STYLES: Record<StickyColor, { bg: string; border: string; chip: string; pickerBg: string }> = {
  yellow: { bg: 'bg-amber-100',  border: 'border-amber-300',  chip: 'bg-amber-300',  pickerBg: '#fde68a' },
  pink:   { bg: 'bg-pink-100',   border: 'border-pink-300',   chip: 'bg-pink-300',   pickerBg: '#fbcfe8' },
  blue:   { bg: 'bg-sky-100',    border: 'border-sky-300',    chip: 'bg-sky-300',    pickerBg: '#bae6fd' },
  green:  { bg: 'bg-emerald-100',border: 'border-emerald-300',chip: 'bg-emerald-300',pickerBg: '#a7f3d0' },
  purple: { bg: 'bg-violet-100', border: 'border-violet-300', chip: 'bg-violet-300', pickerBg: '#ddd6fe' },
  gray:   { bg: 'bg-gray-100',   border: 'border-gray-300',   chip: 'bg-gray-300',   pickerBg: '#e5e7eb' },
};
const COLORS: StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'];

const MIN_W = 200, MIN_H = 160;
const MAX_W = 600, MAX_H = 700;

export default function StickyNote({ note }: Props) {
  const { patchNote, deleteNote, bringToFront, setMinimised } = useStickyNotes();
  const styles = COLOR_STYLES[note.color] ?? COLOR_STYLES.yellow;

  const containerRef = useRef<HTMLDivElement>(null);
  const [showPalette, setShowPalette] = useState(false);

  // ── Tiptap editor ────────────────────────────────────────────────────────
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: 'underline text-current' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: (note.content && Object.keys(note.content).length > 0)
      ? (note.content as Record<string, unknown>)
      : { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none text-gray-900 leading-snug sticky-note-prose',
      },
    },
    onUpdate: ({ editor }) => {
      patchNote(note.id, { content: editor.getJSON() as unknown as Record<string, unknown> });
    },
  });

  // ── Drag (whole note via header) ─────────────────────────────────────────
  const dragStateRef = useRef<{
    startX: number; startY: number; origX: number; origY: number;
  } | null>(null);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [data-no-drag]')) return;
    e.preventDefault();
    bringToFront(note.id);
    dragStateRef.current = {
      startX: e.clientX, startY: e.clientY,
      origX: note.position_x, origY: note.position_y,
    };

    function onMove(ev: MouseEvent) {
      const s = dragStateRef.current;
      if (!s || !containerRef.current) return;
      const dx = ev.clientX - s.startX;
      const dy = ev.clientY - s.startY;
      const w = containerRef.current.offsetWidth;
      const h = containerRef.current.offsetHeight;
      // Clamp inside the viewport (leave at least 60px of header visible)
      const maxX = window.innerWidth  - 60;
      const maxY = window.innerHeight - 40;
      const minX = -(w - 60);
      const minY = 0;
      const nx = Math.max(minX, Math.min(maxX, s.origX + dx));
      const ny = Math.max(minY, Math.min(maxY, s.origY + dy));
      patchNote(note.id, { position_x: nx, position_y: ny });
    }
    function onUp() {
      dragStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [note.id, note.position_x, note.position_y, patchNote, bringToFront]);

  // ── Resize (bottom-right corner) ─────────────────────────────────────────
  const resizeStateRef = useRef<{ startX: number; startY: number; origW: number; origH: number; } | null>(null);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    bringToFront(note.id);
    resizeStateRef.current = {
      startX: e.clientX, startY: e.clientY,
      origW: note.width, origH: note.height,
    };
    function onMove(ev: MouseEvent) {
      const s = resizeStateRef.current;
      if (!s) return;
      const dw = ev.clientX - s.startX;
      const dh = ev.clientY - s.startY;
      const w = Math.max(MIN_W, Math.min(MAX_W, s.origW + dw));
      const h = Math.max(MIN_H, Math.min(MAX_H, s.origH + dh));
      patchNote(note.id, { width: w, height: h });
    }
    function onUp() {
      resizeStateRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [note.id, note.width, note.height, patchNote, bringToFront]);

  // ── Close palette on outside click ───────────────────────────────────────
  useEffect(() => {
    if (!showPalette) return;
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setShowPalette(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showPalette]);

  // Add a checklist item via the toolbar
  const insertChecklist = useCallback(() => {
    editor?.chain().focus().toggleTaskList().run();
  }, [editor]);

  const toggleBold = useCallback(() => editor?.chain().focus().toggleBold().run(), [editor]);
  const toggleItalic = useCallback(() => editor?.chain().focus().toggleItalic().run(), [editor]);
  const insertLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL', previous ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  }, [editor]);

  return (
    <div
      ref={containerRef}
      onMouseDown={() => bringToFront(note.id)}
      className={`pointer-events-auto absolute rounded-xl shadow-2xl ring-1 ring-black/10 ${styles.bg} ${styles.border} border flex flex-col overflow-hidden`}
      style={{
        left:   `${note.position_x}px`,
        top:    `${note.position_y}px`,
        width:  `${note.width}px`,
        height: `${note.height}px`,
        zIndex: 40 + note.z_order,
      }}
    >
      {/* Header / drag handle */}
      <div
        onMouseDown={onHeaderMouseDown}
        className="flex items-center justify-between px-2 py-1 cursor-move select-none border-b border-black/5 shrink-0"
        style={{ background: 'rgba(0,0,0,0.04)' }}
      >
        <div className="flex items-center gap-1 text-gray-600">
          <GripVertical size={12} className="opacity-60" />
          <Tooltip label="Change colour">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowPalette(v => !v)}
              aria-label="Change colour"
              className="p-1 rounded hover:bg-black/10"
              data-no-drag
            >
              <Palette size={12} />
            </button>
          </Tooltip>
        </div>
        <div className="flex items-center gap-0.5" data-no-drag>
          <Tooltip label="Bold">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={toggleBold}
              aria-label="Bold"
              className={`p-1 rounded hover:bg-black/10 ${editor?.isActive('bold') ? 'bg-black/10' : ''}`}
            >
              <Bold size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Italic">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={toggleItalic}
              aria-label="Italic"
              className={`p-1 rounded hover:bg-black/10 ${editor?.isActive('italic') ? 'bg-black/10' : ''}`}
            >
              <Italic size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Insert link">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={insertLink}
              aria-label="Insert link"
              className={`p-1 rounded hover:bg-black/10 ${editor?.isActive('link') ? 'bg-black/10' : ''}`}
            >
              <LinkIcon size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Toggle checklist">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={insertChecklist}
              aria-label="Toggle checklist"
              className={`p-1 rounded hover:bg-black/10 ${editor?.isActive('taskList') ? 'bg-black/10' : ''}`}
            >
              <ListChecks size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Minimise note">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setMinimised(note.id, true)}
              aria-label="Minimise note"
              className="p-1 rounded hover:bg-black/10 text-gray-600 hover:text-gray-900"
            >
              <Minus size={12} />
            </button>
          </Tooltip>
          <Tooltip label="Delete note">
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                if (window.confirm('Delete this sticky note? This cannot be undone.')) {
                  deleteNote(note.id);
                }
              }}
              aria-label="Delete note"
              className="p-1 rounded hover:bg-red-500/15 text-gray-600 hover:text-red-700"
            >
              <X size={12} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Colour palette */}
      {showPalette && (
        <div
          data-no-drag
          onMouseDown={e => e.stopPropagation()}
          className="absolute left-2 top-8 z-10 flex items-center gap-1 p-1.5 rounded-lg bg-white shadow-lg ring-1 ring-black/10"
        >
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { patchNote(note.id, { color: c }); setShowPalette(false); }}
              aria-label={`Use ${c}`}
              className={`w-5 h-5 rounded-full border-2 transition-transform ${note.color === c ? 'border-gray-900 scale-110' : 'border-white'}`}
              style={{ background: COLOR_STYLES[c].pickerBg }}
            />
          ))}
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 cursor-text" data-no-drag>
        <EditorContent editor={editor} />
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        aria-label="Resize"
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        data-no-drag
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-gray-500/60">
          <path d="M14 14L4 14M14 14L14 4M14 14L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {/* Inline styles for Tiptap task-list rendering */}
      <style jsx global>{`
        .sticky-note-prose ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0;
          margin: 0.25em 0;
        }
        .sticky-note-prose ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 6px;
          margin: 0.1em 0;
        }
        .sticky-note-prose ul[data-type="taskList"] li > label {
          margin-top: 2px;
          flex-shrink: 0;
        }
        .sticky-note-prose ul[data-type="taskList"] li > div {
          flex: 1;
          min-width: 0;
        }
        .sticky-note-prose ul[data-type="taskList"] li[data-checked="true"] > div p {
          text-decoration: line-through;
          opacity: 0.6;
        }
        .sticky-note-prose p {
          margin: 0.25em 0;
        }
      `}</style>
    </div>
  );
}
