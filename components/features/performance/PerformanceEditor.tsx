'use client';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Underline } from '@tiptap/extension-underline';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import TextAlign from '@tiptap/extension-text-align';
import FontFamily from '@tiptap/extension-font-family';
import { TableKit } from '@tiptap/extension-table';
import { PaginationPlus } from 'tiptap-pagination-plus';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold, Italic, UnderlineIcon,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo2, Redo2,
  Highlighter, Palette, ChevronDown,
  Table as TableIcon, Layers, ChevronUp, Eye, EyeOff, Download,
  LayoutTemplate, Upload, ExternalLink,
} from 'lucide-react';
import type { CoverOptions, CoverStyleId } from '@/app/(app)/performance/page';
import Tooltip from '@/components/ui/Tooltip';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  html: string;
  visible: boolean;
  order: number;
}

// ─── Cover themes ─────────────────────────────────────────────────────────────

const COVER_THEMES = [
  { id: 'navy',     label: 'Navy',     color: '#1a3558', gradient: 'linear-gradient(150deg,#0f2540 0%,#1a3558 50%,#1e4a82 100%)' },
  { id: 'forest',   label: 'Forest',   color: '#14532d', gradient: 'linear-gradient(150deg,#052e16 0%,#14532d 50%,#166534 100%)' },
  { id: 'slate',    label: 'Slate',    color: '#1e293b', gradient: 'linear-gradient(150deg,#0f172a 0%,#1e293b 50%,#334155 100%)' },
  { id: 'burgundy', label: 'Burgundy', color: '#7f1d1d', gradient: 'linear-gradient(150deg,#450a0a 0%,#7f1d1d 50%,#991b1b 100%)' },
  { id: 'charcoal', label: 'Charcoal', color: '#1f2937', gradient: 'linear-gradient(150deg,#111827 0%,#1f2937 50%,#374151 100%)' },
  { id: 'indigo',   label: 'Indigo',   color: '#312e81', gradient: 'linear-gradient(150deg,#1e1b4b 0%,#312e81 50%,#4338ca 100%)' },
] as const;

export function getThemeColor(gradient: string): string {
  return COVER_THEMES.find(t => t.gradient === gradient)?.color ?? '#1a3558';
}

const DEFAULT_GRADIENT = COVER_THEMES[0].gradient;

// ─── Page Break extension ─────────────────────────────────────────────────────

// A4 page geometry for the live paginator (PaginationPlus). 794×1123 = A4 at 96dpi.
const A4_PAGE_WIDTH  = 794;
const A4_PAGE_HEIGHT = 1123;
const PAGE_MARGIN    = 48; // inner page margin (matches the report's content inset)
const PAGE_GAP       = 26; // grey gap shown between pages

// ─── Section helpers ──────────────────────────────────────────────────────────

function parseHtmlIntoSections(html: string): Section[] {
  const parts = html.split(/(?=<h2[^>]*>)/i);
  const sections: Section[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    const headingMatch = part.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = headingMatch
      ? headingMatch[1].replace(/<[^>]+>/g, '').trim()
      : i === 0 ? 'Introduction' : `Section ${i + 1}`;
    sections.push({ id: `sec-${i}`, title, html: part, visible: true, order: i });
  }
  return sections.length > 0
    ? sections
    : [{ id: 'sec-0', title: 'Report', html, visible: true, order: 0 }];
}

function buildHtmlFromSections(sections: Section[]): string {
  return [...sections].filter(s => s.visible).sort((a, b) => a.order - b.order).map(s => s.html).join('\n');
}

function syncEditorToSections(sections: Section[], editorHtml: string): Section[] {
  const currentParsed = parseHtmlIntoSections(editorHtml);
  const sortedVisible = [...sections].filter(s => s.visible).sort((a, b) => a.order - b.order);
  return sections.map(section => {
    const vi = sortedVisible.findIndex(s => s.id === section.id);
    if (vi < 0 || vi >= currentParsed.length) return section;
    return { ...section, html: currentParsed[vi].html };
  });
}

// The live paginator (PaginationPlus) creates page breaks automatically from
// content height, so we no longer inject manual <div data-page-break> markers.
// We just strip any that linger in older saved reports so they don't leave stray
// empty blocks in the editor.
function stripPageBreaks(html: string): string {
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<div[^>]*data-page-break[^>]*>\s*<\/div>/gi, '');
  }
  try {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const root = doc.body;
    if (!root) return html;
    root.querySelectorAll('div[data-page-break]').forEach(n => n.remove());
    return root.innerHTML;
  } catch {
    return html;
  }
}

// ─── Colour constants ─────────────────────────────────────────────────────────

const TEXT_COLOURS = [
  '#111827', '#374151', '#6B7280', '#1a3558', '#1d4ed8',
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#6366F1', '#8B5CF6', '#EC4899', '#FFFFFF',
];

const HIGHLIGHT_COLOURS = [
  '#FEF08A', '#FED7AA', '#FCA5A5', '#BBF7D0', '#BAE6FD',
  '#C7D2FE', '#F5D0FE', '#FFFFFF', 'transparent',
];

const FONT_FAMILIES = [
  { label: 'Arial',           value: 'Arial, sans-serif'        },
  { label: 'Georgia',         value: 'Georgia, serif'           },
  { label: 'Times New Roman', value: "'Times New Roman', serif" },
  { label: 'Calibri',         value: 'Calibri, sans-serif'      },
  { label: 'Courier New',     value: "'Courier New', monospace" },
];

const HEADING_OPTIONS = [
  { label: 'Paragraph', value: 'paragraph' },
  { label: 'Heading 1', value: 'h1'        },
  { label: 'Heading 2', value: 'h2'        },
  { label: 'Heading 3', value: 'h3'        },
];

// ─── Toolbar primitives ───────────────────────────────────────────────────────

function ToolBtn({ onClick, active = false, disabled = false, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode;
}) {
  return (
    <Tooltip label={title} className="shrink-0">
      <button type="button" onMouseDown={e => { e.preventDefault(); onClick(); }} disabled={disabled} aria-label={title}
        className={`w-8 h-8 flex items-center justify-center rounded-md text-sm transition-colors
          ${active ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)]'}
          disabled:opacity-30 disabled:cursor-not-allowed`}>
        {children}
      </button>
    </Tooltip>
  );
}

function PanelBtn({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <Tooltip label={`${label} panel`} className="shrink-0">
      <button type="button" onMouseDown={e => { e.preventDefault(); onClick(); }} aria-label={`${label} panel`}
        className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium transition-colors border
          ${active ? 'bg-[var(--accent)] text-white border-[var(--accent)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] border-[var(--border)]'}`}>
        {icon}{label}
      </button>
    </Tooltip>
  );
}

function TDivider() { return <div className="w-px h-5 bg-[var(--border)] mx-0.5 shrink-0" />; }
function VDivider() { return <div className="h-px bg-[var(--border)] w-full" />; }

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer shrink-0">
      {label && <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">{label}</span>}
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 rounded-full transition-colors shrink-0 ${checked ? 'bg-[var(--accent)]' : 'bg-[var(--border-input)]'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform mt-0.5 ml-0.5 ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
    </label>
  );
}

function ColourPicker({ colours, currentColour, onSelect, icon, title }: {
  colours: string[]; currentColour?: string; onSelect: (c: string) => void; icon: React.ReactNode; title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <Tooltip label={title}>
        <button type="button" aria-label={title} onMouseDown={e => { e.preventDefault(); setOpen(v => !v); }}
          className="w-8 h-8 flex items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] transition-colors">
          <div className="flex flex-col items-center gap-0">
            {icon}
            <div className="w-4 h-1 rounded-sm mt-0.5 border border-black/10"
              style={{ background: currentColour && currentColour !== 'transparent' ? currentColour : '#111827' }} />
          </div>
        </button>
      </Tooltip>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown p-2.5 w-44">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2 px-0.5">{title}</p>
          <div className="grid grid-cols-6 gap-1.5">
            {colours.map(c => (
              <Tooltip key={c} label={c}>
                <button type="button" onMouseDown={e => { e.preventDefault(); onSelect(c); setOpen(false); }} aria-label={c}
                  className="w-6 h-6 rounded border border-black/10 hover:scale-110 transition-transform"
                  style={{ background: c === 'transparent' ? 'linear-gradient(135deg,#fff 45%,#f00 45%,#f00 55%,#fff 55%)' : c }} />
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sections sub-toolbar ─────────────────────────────────────────────────────

function SectionsBar({ sections, onToggle, onMove }: {
  sections: Section[];
  onToggle: (id: string) => void;
  onMove: (id: string, dir: 'up' | 'down') => void;
}) {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--border)] bg-white/[0.78] backdrop-blur-md overflow-x-auto scrollbar-thin">
      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest shrink-0 mr-1">Sections</span>
      {sorted.map((section, idx) => (
        <div key={section.id}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] shrink-0 transition-opacity
            ${section.visible ? 'border-[var(--border)] bg-[var(--bg-card)]' : 'border-dashed border-[var(--border)] opacity-45'}`}>
          <button type="button" onMouseDown={e => { e.preventDefault(); onMove(section.id, 'up'); }} disabled={idx === 0}
            className="p-0.5 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-20 text-[var(--text-muted)]">
            <ChevronUp size={10} />
          </button>
          <button type="button" onMouseDown={e => { e.preventDefault(); onMove(section.id, 'down'); }} disabled={idx === sorted.length - 1}
            className="p-0.5 rounded hover:bg-[var(--bg-nav-hover)] disabled:opacity-20 text-[var(--text-muted)]">
            <ChevronDown size={10} />
          </button>
          <span className="text-[var(--text-primary)] font-medium max-w-[120px] truncate">{section.title}</span>
          <Tooltip label={section.visible ? 'Hide' : 'Show'}>
            <button type="button" onMouseDown={e => { e.preventDefault(); onToggle(section.id); }}
              aria-label={section.visible ? 'Hide section' : 'Show section'}
              className="p-0.5 rounded hover:bg-[var(--bg-nav-hover)] text-[var(--text-muted)] ml-0.5">
              {section.visible ? <Eye size={11} /> : <EyeOff size={11} />}
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}

// ─── Cover sub-toolbar ────────────────────────────────────────────────────────

function CoverBar({ firmLogoUrl, options, onChange, onFirmLogoUpload }: {
  firmLogoUrl: string | null;
  options: CoverOptions;
  onChange: (opts: CoverOptions) => void;
  onFirmLogoUpload: (file: File) => Promise<void>;
}) {
  const clientLogoRef = useRef<HTMLInputElement>(null);
  const firmLogoRef   = useRef<HTMLInputElement>(null);
  const [uploadingFirmLogo, setUploadingFirmLogo] = useState(false);
  const update = (patch: Partial<CoverOptions>) => onChange({ ...options, ...patch });

  const handleClientLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { alert('Max file size is 3 MB'); return; }
    const reader = new FileReader();
    reader.onload = () => update({ clientLogoUrl: reader.result as string });
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleFirmLogoFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadingFirmLogo(true);
    try { await onFirmLogoUpload(file); } finally { setUploadingFirmLogo(false); }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-[var(--border)] bg-white/[0.78] backdrop-blur-md overflow-x-auto scrollbar-thin">

      {/* Include toggle */}
      <Toggle checked={options.showCover} onChange={v => update({ showCover: v })} label="Cover page" />

      {options.showCover && (<>
        <TDivider />

        {/* Cover style thumbnails */}
        {([
          { id: 'gradient' as CoverStyleId, label: 'Gradient' },
          { id: 'split'    as CoverStyleId, label: 'Split'    },
          { id: 'minimal'  as CoverStyleId, label: 'Minimal'  },
          { id: 'corporate'as CoverStyleId, label: 'Corporate'},
        ]).map(({ id: sid, label }) => {
          const isActive = (options.coverStyle ?? 'gradient') === sid;
          const tc = getThemeColor(options.gradient);
          return (
            <Tooltip key={sid} label={label} className="shrink-0">
            <button type="button" aria-label={label}
              onMouseDown={e => { e.preventDefault(); update({ coverStyle: sid }); }}
              className={`relative w-9 h-[52px] rounded overflow-hidden border-2 transition-all
                ${isActive ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}>
              {sid === 'gradient' && <div style={{ width: '100%', height: '100%', background: options.gradient }} />}
              {sid === 'split' && (
                <div style={{ display: 'flex', height: '100%' }}>
                  <div style={{ width: '36%', background: options.gradient }} />
                  <div style={{ flex: 1, background: '#fff' }} />
                </div>
              )}
              {sid === 'minimal' && (
                <div style={{ background: '#fff', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ height: '4px', background: options.gradient }} />
                  <div style={{ flex: 1, padding: '4px 5px' }}>
                    <div style={{ height: '3px', background: tc, marginBottom: 3, borderRadius: 1 }} />
                    <div style={{ height: '1px', background: '#e5e7eb', marginBottom: 2 }} />
                    <div style={{ height: '1px', background: '#e5e7eb' }} />
                  </div>
                </div>
              )}
              {sid === 'corporate' && (
                <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ height: '46%', background: options.gradient }} />
                  <div style={{ flex: 1, background: '#fff' }} />
                </div>
              )}
              <div className="absolute bottom-0 left-0 right-0 text-center leading-none"
                style={{ fontSize: 7, background: 'rgba(255,255,255,0.92)', padding: '2px 0', color: '#374151' }}>
                {label}
              </div>
            </button>
            </Tooltip>
          );
        })}

        <TDivider />

        {/* Title */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">Title</span>
          <input type="text" value={options.titleOverride ?? ''} onChange={e => update({ titleOverride: e.target.value })}
            placeholder="Business name"
            className="h-7 px-2 rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-36" />
        </div>

        {/* Period */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">Period</span>
          <input type="text" value={options.periodOverride ?? ''} onChange={e => update({ periodOverride: e.target.value })}
            placeholder="e.g. FY2024"
            className="h-7 px-2 rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-32" />
        </div>

        {/* Firm label */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">Firm</span>
          <input type="text" value={options.firmLabel ?? ''} onChange={e => update({ firmLabel: e.target.value })}
            placeholder="Firm name (optional)"
            className="h-7 px-2 rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-36" />
        </div>

        {/* Subtitle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">Subtitle</span>
          <input type="text" value={options.subtitle ?? ''} onChange={e => update({ subtitle: e.target.value })}
            placeholder="Report subtitle"
            className="h-7 px-2 rounded-md border border-[var(--border-input)] bg-[var(--bg-input)] text-[12px] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-44" />
        </div>

        <TDivider />

        {/* Firm logo */}
        {firmLogoUrl ? (
          <div className="flex items-center gap-2 shrink-0">
            <img src={firmLogoUrl} alt="Firm" className="h-6 max-w-[64px] object-contain rounded border border-[var(--border)] bg-white px-1" />
            <Toggle checked={options.showFirmLogo} onChange={v => update({ showFirmLogo: v })} label="Show" />
            <button type="button" onClick={() => firmLogoRef.current?.click()} disabled={uploadingFirmLogo}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] hover:underline disabled:opacity-40 whitespace-nowrap">
              {uploadingFirmLogo ? 'Uploading…' : 'Replace'}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-amber-600 dark:text-amber-400 whitespace-nowrap">No firm logo —</span>
            <a href="/settings?tab=account" className="text-[10px] text-[var(--accent)] underline whitespace-nowrap flex items-center gap-0.5">
              Settings <ExternalLink size={9} />
            </a>
            <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">or</span>
            <button type="button" onClick={() => firmLogoRef.current?.click()} disabled={uploadingFirmLogo}
              className="flex items-center gap-1 h-6 px-2 rounded border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-40 whitespace-nowrap">
              <Upload size={9} /> {uploadingFirmLogo ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        )}
        <input ref={firmLogoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleFirmLogoFileChange} />

        <TDivider />

        {/* Client logo */}
        {options.clientLogoUrl ? (
          <div className="flex items-center gap-2 shrink-0">
            <img src={options.clientLogoUrl} alt="Client" className="h-6 max-w-[64px] object-contain rounded border border-[var(--border)] bg-white px-1" />
            <button type="button" onClick={() => update({ clientLogoUrl: null })}
              className="text-[10px] text-red-500 hover:underline whitespace-nowrap">Remove</button>
          </div>
        ) : (
          <button type="button" onClick={() => clientLogoRef.current?.click()}
            className="flex items-center gap-1 h-6 px-2 rounded border border-dashed border-[var(--border)] text-[10px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors shrink-0 whitespace-nowrap">
            <Upload size={9} /> Client logo
          </button>
        )}
        <input ref={clientLogoRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleClientLogoUpload} />

      </>)}
    </div>
  );
}

// ─── Theme sub-toolbar ───────────────────────────────────────────────────────

function ThemeBar({ options, onChange }: {
  options: CoverOptions;
  onChange: (opts: CoverOptions) => void;
}) {
  const activeTheme = COVER_THEMES.find(t => t.gradient === options.gradient);
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-[var(--border)] bg-white/[0.78] backdrop-blur-md overflow-x-auto scrollbar-thin">
      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest shrink-0">Theme</span>
      <div className="flex items-center gap-2 shrink-0">
        {COVER_THEMES.map(theme => (
          <Tooltip key={theme.id} label={theme.label} className="shrink-0">
          <button type="button"
            onClick={() => onChange({ ...options, gradient: theme.gradient })}
            aria-label={theme.label}
            className={`flex items-center gap-2 h-7 pl-1.5 pr-2.5 rounded-lg border-2 text-[11px] font-medium transition-all
              ${activeTheme?.id === theme.id
                ? 'border-[var(--accent)] text-[var(--text-primary)] bg-[var(--bg-card)]'
                : 'border-transparent hover:border-[var(--border)] text-[var(--text-secondary)]'}`}>
            <span className="w-4 h-4 rounded-sm shrink-0" style={{ background: theme.gradient }} />
            {theme.label}
          </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ─── Table toolbar ────────────────────────────────────────────────────────────

function TableBar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;
  const btn = (label: string, cmd: () => boolean, title?: string) => (
    <Tooltip label={title ?? label} className="shrink-0">
      <button type="button" aria-label={title ?? label}
        onMouseDown={e => { e.preventDefault(); cmd(); }}
        className="flex items-center gap-1 h-7 px-2.5 rounded-md border border-[var(--border)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap">
        {label}
      </button>
    </Tooltip>
  );
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-[var(--border)] bg-white/[0.78] backdrop-blur-md overflow-x-auto scrollbar-thin">
      <span className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-widest shrink-0 mr-1">Table</span>

      {/* Rows */}
      {btn('+ Row Above',  () => editor.chain().focus().addRowBefore().run())}
      {btn('+ Row Below',  () => editor.chain().focus().addRowAfter().run())}
      {btn('Delete Row',   () => editor.chain().focus().deleteRow().run())}
      <TDivider />

      {/* Columns */}
      {btn('+ Col Left',   () => editor.chain().focus().addColumnBefore().run())}
      {btn('+ Col Right',  () => editor.chain().focus().addColumnAfter().run())}
      {btn('Delete Col',   () => editor.chain().focus().deleteColumn().run())}
      <TDivider />

      {/* Cells */}
      {btn('Merge Cells',  () => editor.chain().focus().mergeCells().run())}
      {btn('Split Cell',   () => editor.chain().focus().splitCell().run())}
      <TDivider />

      {/* Header */}
      {btn('Toggle Header Row', () => editor.chain().focus().toggleHeaderRow().run())}
      {btn('Toggle Header Col', () => editor.chain().focus().toggleHeaderColumn().run())}
      <TDivider />

      {/* Delete */}
      <Tooltip label="Delete table" className="shrink-0">
        <button type="button" aria-label="Delete table"
          onMouseDown={e => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }}
          className="flex items-center gap-1 h-7 px-2.5 rounded-md border border-red-200 text-[11px] font-medium text-red-500 hover:bg-red-50 transition-colors whitespace-nowrap">
          Delete Table
        </button>
      </Tooltip>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

interface PerformanceEditorProps {
  initialHtml: string;
  titlePageHtml?: string;
  firmLogoUrl?: string | null;
  defaultTitle?: string;
  defaultPeriod?: string;

  /** Ref forwarded to the A4 paper div — used by SaveReportModal to clone the
   *  live DOM for pixel-perfect PDF rendering (same CSS as the editor view). */
  paperRef?: React.RefObject<HTMLDivElement | null>;

  onHtmlChange: (html: string) => void;
  onCoverChange?: (opts: CoverOptions) => void;
  onFirmLogoUploaded?: (url: string) => void;
  onSave?: () => void;
  onNewAnalysis?: () => void;
}

export default function PerformanceEditor({
  initialHtml, titlePageHtml, firmLogoUrl: firmLogoUrlProp = null,
  defaultTitle = '', defaultPeriod = '',
  paperRef,
  onHtmlChange, onCoverChange, onFirmLogoUploaded, onSave, onNewAnalysis,
}: PerformanceEditorProps) {
  const [sections, setSections]             = useState<Section[]>(() => parseHtmlIntoSections(initialHtml));
  const [activePanel, setActivePanel]       = useState<'sections' | 'cover' | 'theme' | null>(null);
  const [headingOpen, setHeadingOpen]       = useState(false);
  const [fontOpen, setFontOpen]             = useState(false);
  const [localFirmLogoUrl, setLocalFirmLogoUrl] = useState<string | null>(firmLogoUrlProp);
  const [coverOptions, setCoverOptions]     = useState<CoverOptions>({
    showCover: true, showFirmLogo: false, clientLogoUrl: null, gradient: DEFAULT_GRADIENT,
    titleOverride: defaultTitle, periodOverride: defaultPeriod, coverStyle: 'gradient',
    firmLabel: '', subtitle: 'Performance Analysis Report',
  });

  // Local ref to the A4 paper element, forwarded to the optional `paperRef` prop
  // so SaveReportModal can clone the live DOM for the PDF.
  const localPaperRef = useRef<HTMLDivElement | null>(null);
  const setPaperRef = useCallback((node: HTMLDivElement | null) => {
    localPaperRef.current = node;
    if (paperRef) (paperRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, [paperRef]);

  const handleFirmLogoUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { alert('Max file size is 2MB'); return; }
    try {
      const ext = file.name.split('.').pop() ?? 'png';
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/firm/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mimeType: file.type, ext }),
      });
      if (!res.ok) throw new Error('Upload failed');
      const { logoUrl } = await res.json() as { logoUrl: string };
      setLocalFirmLogoUrl(logoUrl);
      onFirmLogoUploaded?.(logoUrl);
      handleCoverOptionsChange({ ...coverOptions, showFirmLogo: true });
    } catch {
      alert('Failed to upload firm logo. Please try again.');
    }
  };

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline, TextStyle, Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      FontFamily,
      TableKit.configure({ table: { resizable: true } }),
      PaginationPlus.configure({
        pageHeight: A4_PAGE_HEIGHT,
        pageWidth: A4_PAGE_WIDTH,
        pageGap: PAGE_GAP,
        pageGapBorderSize: 0,
        pageGapBorderColor: '#c8d1dc',
        pageBreakBackground: '#c8d1dc',
        marginTop: PAGE_MARGIN, marginBottom: PAGE_MARGIN,
        marginLeft: PAGE_MARGIN, marginRight: PAGE_MARGIN,
        contentMarginTop: 0, contentMarginBottom: 0,
        headerLeft: '', headerRight: '', footerLeft: '', footerRight: '',
      }),
    ],
    content: stripPageBreaks(buildHtmlFromSections(sections)),
    onUpdate: ({ editor }) => onHtmlChange(editor.getHTML()),
    editorProps: { attributes: { class: 'performance-prose focus:outline-none' } },
  });

  const applyNewSections = useCallback((newSections: Section[]) => {
    setSections(newSections);
    if (editor) {
      const html = stripPageBreaks(buildHtmlFromSections(newSections));
      editor.commands.setContent(html);
      onHtmlChange(html);
    }
  }, [editor, onHtmlChange]);

  const handleToggle = (id: string) => {
    if (!editor) return;
    applyNewSections(syncEditorToSections(sections, editor.getHTML()).map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  const handleMove = (id: string, dir: 'up' | 'down') => {
    if (!editor) return;
    const synced = syncEditorToSections(sections, editor.getHTML());
    const sorted = [...synced].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex(s => s.id === id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    applyNewSections(synced.map(s => {
      if (s.id === sorted[idx].id)     return { ...s, order: sorted[swapIdx].order };
      if (s.id === sorted[swapIdx].id) return { ...s, order: sorted[idx].order };
      return s;
    }));
  };

  const handleCoverOptionsChange = (opts: CoverOptions) => {
    setCoverOptions(opts);
    onCoverChange?.(opts);
  };

  // ── A4 pagination ───────────────────────────────────────────────────────────
  // Walk the content block-by-block and break it into true A4 pages. Whole blocks
  // (paragraphs, lists, tables) are pushed to the next page rather than split, so a
  // table never straddles a gutter. Section headings always start a new page. Each
  // closed page is filled to a full A4 height with white space, then a grey gutter
  // band (drawn as an overlay from `gutters`) separates it from the next page.
  // A block taller than a whole page (an oversized table) can't be kept off the
  // boundary — pages still break through it, because pages matter more.
  // Runs on mount, on edits, on resize and after fonts load.
  // On first mount, sync the (page-break-stripped) content up to the parent so the
  // exported PDF matches what's shown in the editor.
  const didInitHtml = useRef(false);
  useEffect(() => {
    if (editor && !didInitHtml.current) {
      didInitHtml.current = true;
      onHtmlChange(editor.getHTML());
    }
  }, [editor, onHtmlChange]);

  if (!editor) return null;

  const themeColor = getThemeColor(coverOptions.gradient);

  const activeHeading =
    editor.isActive('heading', { level: 1 }) ? 'Heading 1' :
    editor.isActive('heading', { level: 2 }) ? 'Heading 2' :
    editor.isActive('heading', { level: 3 }) ? 'Heading 3' : 'Paragraph';

  const togglePanel = (panel: 'sections' | 'cover' | 'theme') =>
    setActivePanel(p => p === panel ? null : panel);

  return (
    <div className="rounded-xl border border-[var(--border)]">

      {/* ── Sticky toolbar block (both rows stick together) ──────────────── */}
      <div className="sticky top-0 z-20 rounded-t-xl border-b border-[var(--border)]">

        {/* Row 1 — main formatting tools */}
        <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 bg-white/[0.78] backdrop-blur-md rounded-t-xl">

          <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)"><Undo2 size={14} /></ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)"><Redo2 size={14} /></ToolBtn>
          <TDivider />
          <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()}      active={editor.isActive('bold')}      title="Bold (Ctrl+B)">      <Bold size={14} />         </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()}    active={editor.isActive('italic')}    title="Italic (Ctrl+I)">    <Italic size={14} />       </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (Ctrl+U)"> <UnderlineIcon size={14} /> </ToolBtn>
          <TDivider />

          {/* Heading dropdown */}
          <div className="relative">
            <button type="button" onMouseDown={e => { e.preventDefault(); setHeadingOpen(v => !v); setFontOpen(false); }}
              className="flex items-center gap-1.5 px-2 h-8 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] transition-colors border border-[var(--border)] min-w-[100px] justify-between">
              <span>{activeHeading}</span><ChevronDown size={11} />
            </button>
            {headingOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown overflow-hidden w-36">
                {HEADING_OPTIONS.map(opt => (
                  <button key={opt.value} type="button"
                    onMouseDown={e => {
                      e.preventDefault();
                      if (opt.value === 'paragraph') editor.chain().focus().setParagraph().run();
                      else editor.chain().focus().toggleHeading({ level: parseInt(opt.value[1]) as 1|2|3 }).run();
                      setHeadingOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-nav-hover)] transition-colors text-[var(--text-primary)]">{opt.label}</button>
                ))}
              </div>
            )}
          </div>

          {/* Font family dropdown */}
          <div className="relative">
            <button type="button" onMouseDown={e => { e.preventDefault(); setFontOpen(v => !v); setHeadingOpen(false); }}
              className="flex items-center gap-1.5 px-2 h-8 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-nav-hover)] transition-colors border border-[var(--border)] min-w-[72px] justify-between">
              <span>Font</span><ChevronDown size={11} />
            </button>
            {fontOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 glass-solid border border-[var(--border)] rounded-xl shadow-dropdown overflow-hidden w-44">
                {FONT_FAMILIES.map(f => (
                  <button key={f.value} type="button"
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setFontFamily(f.value).run(); setFontOpen(false); }}
                    style={{ fontFamily: f.value }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--bg-nav-hover)] transition-colors text-[var(--text-primary)]">{f.label}</button>
                ))}
              </div>
            )}
          </div>

          <TDivider />
          <ColourPicker colours={TEXT_COLOURS} currentColour={editor.getAttributes('textStyle').color}
            onSelect={c => editor.chain().focus().setColor(c).run()} icon={<Palette size={14} />} title="Text colour" />
          <ColourPicker colours={HIGHLIGHT_COLOURS} currentColour={editor.getAttributes('highlight').color}
            onSelect={c => { if (c === 'transparent') editor.chain().focus().unsetHighlight().run(); else editor.chain().focus().setHighlight({ color: c }).run(); }}
            icon={<Highlighter size={14} />} title="Highlight colour" />
          <TDivider />
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('left').run()}    active={editor.isActive({ textAlign: 'left'    })} title="Align left">    <AlignLeft size={14} />    </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('center').run()}  active={editor.isActive({ textAlign: 'center'  })} title="Align centre">  <AlignCenter size={14} />  </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('right').run()}   active={editor.isActive({ textAlign: 'right'   })} title="Align right">   <AlignRight size={14} />   </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify">        <AlignJustify size={14} /> </ToolBtn>
          <TDivider />
          <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()}  active={editor.isActive('bulletList')}  title="Bullet list">   <List size={14} />        </ToolBtn>
          <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list"> <ListOrdered size={14} /> </ToolBtn>
          <TDivider />
          <ToolBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table">
            <TableIcon size={14} />
          </ToolBtn>
          <TDivider />
          <PanelBtn label="Sections" icon={<Layers size={13} />}        active={activePanel === 'sections'} onClick={() => togglePanel('sections')} />
          <PanelBtn label="Cover"    icon={<LayoutTemplate size={13} />} active={activePanel === 'cover'}    onClick={() => togglePanel('cover')}    />
          <PanelBtn label="Theme"    icon={<Palette size={13} />}        active={activePanel === 'theme'}    onClick={() => togglePanel('theme')}    />

          <div className="ml-auto flex items-center gap-2">
            {onSave && (
              <button type="button" onClick={onSave} className="btn-secondary text-xs flex items-center gap-1.5 h-8 px-3">
                <Download size={13} /> Save Report
              </button>
            )}
            {onNewAnalysis && (
              <button type="button" onClick={onNewAnalysis} className="btn-secondary text-xs h-8 px-3">New Analysis</button>
            )}
          </div>
        </div>

        {/* Row 2 — sub-toolbar (sections, cover, or theme), appears below when active */}
        {activePanel === 'sections' && (
          <SectionsBar sections={sections} onToggle={handleToggle} onMove={handleMove} />
        )}
        {activePanel === 'cover' && (
          <CoverBar
            firmLogoUrl={localFirmLogoUrl}
            options={coverOptions}
            onChange={handleCoverOptionsChange}
            onFirmLogoUpload={handleFirmLogoUpload}
          />
        )}
        {activePanel === 'theme' && (
          <ThemeBar options={coverOptions} onChange={handleCoverOptionsChange} />
        )}

        {/* Row 3 — table controls, appear automatically when cursor is inside a table */}
        {editor.isActive('table') && <TableBar editor={editor} />}
      </div>


      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div style={{ minHeight: 700, background: '#c8d1dc', padding: '28px 0 64px' }}>
        <div ref={setPaperRef} style={{ width: 'fit-content', maxWidth: '100%', margin: '0 auto' }}>

          <style>{`
            .performance-prose h1 { color: ${themeColor}; border-bottom-color: ${themeColor}; }
            .performance-prose h2 { color: ${themeColor}; }
            .performance-prose h3 { color: ${themeColor}; }
            .performance-prose strong { color: ${themeColor}; }
            .performance-prose th { background: ${themeColor}; border-color: ${themeColor}; }

            /* PaginationPlus turns the editor itself into the white A4 page(s). */
            .performance-prose.rm-with-pagination {
              background: #fff;
              margin: 0 auto;
              box-shadow: 0 10px 30px rgba(15,23,42,0.12);
              border-radius: 2px;
              border-color: #e5e7eb !important;
            }

            /* Protect our standard tables from the paginator's table-splitting CSS
               (which targets companion table extensions we don't use). Keep them
               rendering as normal, whole tables. */
            .performance-prose.rm-with-pagination table { display: table !important; width: 100% !important; }
            .performance-prose.rm-with-pagination table > tr { display: table-row !important; }
            .performance-prose.rm-with-pagination table thead { display: table-header-group !important; }
            .performance-prose.rm-with-pagination table tbody { display: table-row-group !important; max-height: none !important; overflow: visible !important; }
            .performance-prose.rm-with-pagination table tbody > tr { display: table-row !important; }
            .performance-prose.rm-with-pagination table td,
            .performance-prose.rm-with-pagination table th { word-break: normal !important; }

            /* Column resize affordance for tables (TableKit resizable). */
            .performance-prose .tableWrapper { overflow-x: auto; }
            .performance-prose .column-resize-handle {
              position: absolute;
              right: -2px;
              top: 0;
              bottom: -2px;
              width: 4px;
              background: var(--accent);
              pointer-events: none;
            }
            .performance-prose table { position: relative; }
            .performance-prose.resize-cursor { cursor: col-resize; }
          `}</style>

          {/* Cover / title page — its own A4 sheet above the paginated body. */}
          {titlePageHtml && (
            <div style={{
              width: A4_PAGE_WIDTH, maxWidth: '100%', margin: '0 auto 26px',
              padding: PAGE_MARGIN, background: '#fff', overflow: 'clip',
              boxShadow: '0 10px 30px rgba(15,23,42,0.12)', position: 'relative', borderRadius: 2,
            }}>
              <div data-cover dangerouslySetInnerHTML={{ __html: titlePageHtml }} />
            </div>
          )}

          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
