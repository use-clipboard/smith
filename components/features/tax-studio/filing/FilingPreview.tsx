'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Printer, FileText, Search, Plus, Minus, ChevronRight, List, Pencil, Check, Loader2 } from 'lucide-react';
import type { TaxReturn } from '../types';
import type { PageId } from '../stages/StageReview';
import { buildFilingForms, type FilingForm, type FilingRow } from './filingModel';
import Sa100Facsimile from './Sa100Facsimile';
import EmploymentFacsimile from './EmploymentFacsimile';
import SelfEmploymentFacsimile from './SelfEmploymentFacsimile';
import SelfEmploymentShortFacsimile from './SelfEmploymentShortFacsimile';
import CapitalGainsFacsimile from './CapitalGainsFacsimile';
import ForeignFacsimile from './ForeignFacsimile';
import WelshParliamentFacsimile from './WelshParliamentFacsimile';
import NIAssemblyFacsimile from './NIAssemblyFacsimile';
import ParliamentFacsimile from './ParliamentFacsimile';
import ScottishParliamentFacsimile from './ScottishParliamentFacsimile';
import ResidenceFacsimile from './ResidenceFacsimile';
import AdditionalFacsimile from './AdditionalFacsimile';
import PropertyFacsimile from './PropertyFacsimile';
import LloydsFacsimile from './LloydsFacsimile';
import MinisterFacsimile from './MinisterFacsimile';
import TrustsFacsimile from './TrustsFacsimile';
import TaxCalcSummaryFacsimile from './TaxCalcSummaryFacsimile';
import PartnershipFacsimile from './PartnershipFacsimile';
import PartnershipShortFacsimile from './PartnershipShortFacsimile';
import { employmentTaxable, tradeTaxableProfit, sa108HasData, foreignTotals, welshAssemblyHasData, assemblyHasData, parliamentHasData, scottishParliamentHasData, lloydsHasData, ministerHasData } from '../calc';

// Print stylesheet: when printing, show only the preview sheets (the browser's
// "Save as PDF" then produces a clean, vector, multi-page client copy). The
// contents sidebar, toolbar and zoom are all neutralised for print.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #sa-filing-preview, #sa-filing-preview * { visibility: visible !important; }
  #sa-filing-preview { position: absolute; inset: 0; margin: 0; padding: 0; background: #fff; overflow: visible; }
  #sa-filing-preview .no-print { display: none !important; }
  #sa-filing-preview .sa-body { display: block !important; }
  #sa-filing-preview .sa-main-scroll { overflow: visible !important; position: static !important; }
  #sa-filing-preview .sa-sheets-wrap { zoom: 1 !important; padding: 0 !important; }
  #sa-filing-preview .sa-sheet { box-shadow: none !important; margin: 0 auto 0 auto !important; page-break-after: always; border: none !important; }
  @page { size: A4; margin: 0; }
}`;

// Friendly names for each HMRC form code, shown in the contents list.
const FORM_NAMES: Record<string, string> = {
  SA100: 'Tax return', SA101: 'Additional information', SA102: 'Employment',
  SA102M: 'Ministers of religion', SA102MS: 'Welsh Parliament (Senedd)', SA102WAM: 'Welsh Parliament (Senedd)',
  SA102MLA: 'NI Legislative Assembly', SA102MP: 'Parliament (MPs)', SA102MSP: 'Scottish Parliament',
  SA103F: 'Self-employment (full)', SA103S: 'Self-employment (short)', SA103L: 'Lloyd’s underwriters',
  SA104F: 'Partnership (full)', SA104S: 'Partnership (short)', SA105: 'UK property', SA106: 'Foreign',
  SA107: 'Trusts etc', SA108: 'Capital gains', SA109: 'Residence & FIG', SA110: 'Tax calculation summary',
};

// Each HMRC form code → the Review & Adjust editor page that edits it. Forms not
// listed (SA110 tax-calc summary) are derived and have no editable inputs.
const FORM_TO_PAGE: Record<string, PageId> = {
  SA100: 'core', SA102: 'employment', SA103F: 'selfemp', SA103S: 'selfemp', SA103L: 'lloyds',
  SA104F: 'partnership', SA104S: 'partnership', SA105: 'property', SA106: 'foreign', SA107: 'trusts',
  SA108: 'cgt', SA109: 'residence', SA101: 'additional', SA102M: 'minister', SA102MLA: 'niassembly',
  SA102MP: 'parliament', SA102MSP: 'scottishparliament', SA102MS: 'welshassembly', SA102WAM: 'welshassembly',
};
// Auto-calculated ("blue") boxes per form — never editable (would break the sums).
// The Review editor already renders these as read-only BoxCalc, so this is belt-
// and-braces: it also suppresses the purple hover on the preview.
const COMPUTED_BOXES: Record<string, Set<string>> = {
  // Each set is exactly the boxes the Review editor renders as a read-only BoxCalc
  // for that form (a box number is unique within an HMRC form, so this can never
  // hide an editable box). SA106 also lists the per-column/summary totals that are
  // pure facsimile computations with no editor box at all (28/29).
  SA103F: new Set(['31', '46', '47', '48', '57', '61', '63', '64', '65', '73', '76', '77', '80', '90', '94', '96', '99']),
  SA103S: new Set(['20', '21', '22', '28', '31', '32', '35']),
  SA104F: new Set(['16', '18', '20', '21', '24', '30', '34', '35', '41', '48', '51', '55', '60', '63', '67', '70', '73', '76', '80']),
  SA104S: new Set(['16', '18', '20', '21', '24']),
  SA105: new Set(['38', '40', '41', '43']),
  SA106: new Set(['3', '4', '6', '7.3', '7.4', '8', '9', '10', '11', '12', '13', '18', '24', '25', '27', '28', '29', '30', '32', '50', '51', '52', '53']),
  SA103L: new Set(['5', '11', '18', '26', '27', '40', '41', '42', '43', '48', '49', '52', '53', '55', '58', '60', '61', '62']),
  SA102M: new Set(['12', '19', '20', '26', '27', '31', '32', '34', '35', '38', '39']),
  SA107: new Set(['22', '23', '24']),
};
function isEditableBox(code: string, num: string, page: string): boolean {
  if (!(code in FORM_TO_PAGE)) return false;
  // SA100 TR1 (personal details — lives in Setup) and TR2 (the derived "what
  // makes up your return" checklist) aren't editable via the Review core editor.
  if (code === 'SA100' && (page === 'TR 1' || page === 'TR 2')) return false;
  if (code === 'SA100' && num === '22') return false; // declaration/signature — not entered online
  if (code === 'SA100' && page === 'TR 6' && num === '14') return false; // nominee authorisation signature — not entered online
  if (code === 'SA100' && page === 'TR 8' && num === '21') return false; // "enclosing supplementary pages" — auto-derived from the return, not entered
  return !(COMPUTED_BOXES[code]?.has(num));
}
// SA100 TR1 personal-detail boxes are entered in the Setup stage, not the Review
// editor. Clicking one jumps to Setup and focuses the matching field (keyed here).
const TR1_SETUP_FIELD: Record<string, string> = {
  '1': 'dob', '2': 'change', '3': 'phone', '4': 'nino',
};
function setupFieldFor(code: string, num: string, page: string): string | null {
  if (code === 'SA100' && page === 'TR 1') return TR1_SETUP_FIELD[num] ?? null;
  return null;
}

interface OutlineBox { key: string; id: string; num: string; label: string }
interface OutlineSection { key: string; id: string; title: string; boxes: OutlineBox[] }
interface OutlineForm { key: string; code: string; name: string; sections: OutlineSection[] }

// Walk the rendered sheets and build a form → section → box outline. Every
// facsimile uses the shared primitives, so sheets carry data-sa-code/-page and
// each box chip carries data-boxnum — we assign scroll-target ids as we go.
function buildOutline(root: HTMLElement, editablePreview: boolean): OutlineForm[] {
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.sa-sheet'));
  const forms: OutlineForm[] = [];
  const byCode = new Map<string, OutlineForm>();
  let uid = 0;
  for (const sheet of sheets) {
    const code = sheet.dataset.saCode || sheet.getAttribute('data-sa-code') || '—';
    let form = byCode.get(code);
    if (!form) { form = { key: `f${forms.length}`, code, name: FORM_NAMES[code] || code, sections: [] }; byCode.set(code, form); forms.push(form); }
    let section: OutlineSection | null = null;
    const nodes = Array.from(sheet.querySelectorAll<HTMLElement>('h3, h4, [data-sa-subhead], [data-boxnum]'));
    for (const el of nodes) {
      if (el.matches('h3, h4, [data-sa-subhead]')) {
        if (!el.id) el.id = `sao-${uid++}`;
        const title = (el.textContent || '').trim();
        if (!title) continue;
        section = { key: el.id, id: el.id, title, boxes: [] };
        form.sections.push(section);
      } else {
        const num = el.getAttribute('data-boxnum') || '';
        const wrap = el.parentElement;                       // chip wrapper span
        const textSpan = wrap?.nextElementSibling as HTMLElement | null;
        // The whole "field area" (chip + label + input/tick): a marked fieldroot,
        // else walk up from the chip to the LARGEST ancestor that still holds only
        // this one box — self-correcting whether the box is a tick row (include
        // the tick below the label) or a grid cell (don't grab its neighbours).
        let field = el.closest('[data-sa-fieldroot]') as HTMLElement | null;
        if (!field) {
          field = el;
          // Walk up while the parent holds only this box AND isn't a coloured
          // panel wrapper (panels carry an inline background) — so the field is
          // the box's own block, never a whole panel that the hover would shift.
          while (field.parentElement && field.parentElement !== sheet
            && field.parentElement.querySelectorAll('[data-boxnum]').length <= 1
            && !field.parentElement.style.background) {
            field = field.parentElement;
          }
          // Free-text boxes ("Any other information", etc.) render the numbered
          // label and a big writing area as siblings inside a background panel,
          // so the walk stops at the label. When the field's next sibling is that
          // writing area, extend to the enclosing panel (if it holds this one
          // box) so the hover / click covers the whole box, not just the title.
          const sib = field.nextElementSibling as HTMLElement | null;
          if (sib && /whitespace-pre-wrap/.test(sib.getAttribute('class') || '')
            && field.parentElement && field.parentElement !== sheet
            && field.parentElement.querySelectorAll('[data-boxnum]').length === 1) {
            field = field.parentElement;
          }
        }
        if (!field.id) field.id = `sao-${uid++}`;
        let label = (textSpan?.textContent || '').trim();
        if (!label) label = (field.textContent || '').trim().replace(new RegExp('^' + num.replace(/[.]/g, '\\.')), '').trim();
        if (!section) { section = { key: `${sheet.id || (sheet.id = `sao-${uid++}`)}-top`, id: sheet.id, title: FORM_NAMES[code] || code, boxes: [] }; form.sections.push(section); }
        const setupField = setupFieldFor(code, num, sheet.dataset.saPage || '');
        if (editablePreview && (setupField || isEditableBox(code, num, sheet.dataset.saPage || ''))) {
          field.dataset.saEditable = '1';
          field.dataset.saBox = num;
          field.dataset.saFormcode = code;
          field.dataset.saSection = section.title;
          // A TR1 personal-detail box routes to the Setup stage, not the editor.
          if (setupField) field.dataset.saSetup = setupField;
          // Multi-record forms (several employers / trades / partnerships) stamp
          // the record id on the sheet so the hunt can scope to the right card.
          const rec = sheet.dataset.saRecord;
          if (rec) field.dataset.saRecord = rec;
        }
        section.boxes.push({ key: field.id, id: field.id, num, label: label.slice(0, 120) });
      }
    }
  }
  return forms;
}

function navTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const prev = el.style.backgroundColor;
  el.style.transition = 'background-color 0.25s';
  el.style.backgroundColor = 'rgba(99,102,241,0.16)';
  setTimeout(() => { el.style.backgroundColor = prev; }, 950);
}

function Row({ r }: { r: FilingRow }) {
  if (r.heading) return <p className="col-span-full mt-2 text-[11px] font-semibold text-slate-500">{r.label}</p>;
  return (
    <div className={`flex items-baseline gap-2 py-[3px] ${r.strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      {r.box != null ? <span className="mt-px inline-flex min-w-[26px] shrink-0 justify-center rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{r.box}</span> : <span className="min-w-[26px] shrink-0" />}
      <span className="flex-1 text-[11.5px] leading-snug">{r.label}</span>
      <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums">{r.value ?? r.text ?? ''}</span>
    </div>
  );
}

function Sheet({ form }: { form: FilingForm }) {
  return (
    <div data-sa-code={form.code} data-sa-page={form.pageTag} className="sa-sheet mx-auto mb-6 w-[210mm] max-w-full rounded-sm border border-slate-200 bg-white p-[14mm] shadow-sm">
      <div className="mb-4 flex items-baseline justify-between border-b-2 border-slate-800 pb-2">
        <h2 className="text-[15px] font-bold text-slate-900">{form.name}</h2>
        <span className="text-[11px] font-semibold text-slate-500">{form.code} · Page {form.pageTag}</span>
      </div>
      <div className="space-y-3">
        {form.sections.filter(s => s.rows.length > 0).map((s, si) => (
          <div key={si}>
            <p className="mb-1 text-[12px] font-bold uppercase tracking-wide text-slate-600">{s.title}</p>
            <div className="border-t border-slate-100">
              {s.rows.map((r, ri) => <Row key={ri} r={r} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function FilingPreview({ ret, onClose, renderEditor, onEditInSetup }: { ret: TaxReturn; onClose: () => void; renderEditor?: (page: PageId) => React.ReactNode; onEditInSetup?: (field: string) => void }) {
  const sheetsRef = useRef<HTMLDivElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<OutlineForm[]>([]);
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [openForms, setOpenForms] = useState<Record<string, boolean>>({});
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  const [sidebar, setSidebar] = useState(true);
  const [edit, setEdit] = useState<{ page: PageId; box: string; formCode: string; section: string; record: string; topTab?: string; subTab?: string } | null>(null);
  const [focusing, setFocusing] = useState(false);
  const editablePreview = !!renderEditor;

  // Click an editable field on a facsimile → open its editor section in a lightbox.
  function onSheetClick(e: React.MouseEvent) {
    if (!editablePreview) return;
    const target = e.target as HTMLElement;
    const field = target.closest<HTMLElement>('[data-sa-editable]');
    if (field) {
      const code = field.dataset.saFormcode || '';
      // TR1 personal details are edited back in the Setup stage — jump there and
      // focus the field instead of opening the Review editor lightbox.
      if (field.dataset.saSetup) { onEditInSetup?.(field.dataset.saSetup); return; }
      const page = FORM_TO_PAGE[code];
      if (!page) return;
      setEdit({ page, box: field.dataset.saBox || '', formCode: code, section: field.dataset.saSection || '', record: field.dataset.saRecord || '' });
      return;
    }
    // Table-based sections (foreign income, CGT disposals) aren't numbered boxes,
    // so instead of a box hunt we jump to that table's tab in the editor.
    const sec = target.closest<HTMLElement>('[data-sa-sectionedit]');
    if (sec) {
      const code = sec.dataset.saFormcode || '';
      const page = FORM_TO_PAGE[code];
      if (!page) return;
      const [topTab, subTab] = (sec.dataset.saSectionedit || '').split('|');
      setEdit({ page, box: '', formCode: code, section: '', record: '', topTab, subTab });
    }
  }

  // Once the editor lightbox is up, hunt for the clicked box (navigating the
  // editor's own tabs if needed), then scroll to it, highlight and focus it.
  useEffect(() => {
    if (!edit) return;
    let cancelled = false;
    setFocusing(true);
    // Section jump (table-based foreign income / CGT disposals): navigate the
    // editor to the target top+sub tab and reveal it — there's no box to focus.
    if (edit.subTab) {
      let n = 0;
      const step = () => {
        if (cancelled || n++ > 60) { setFocusing(false); return; }
        const root = lightboxRef.current;
        if (!root) { setTimeout(step, 50); return; }
        if (edit.topTab) {
          const top = Array.from(root.querySelectorAll<HTMLElement>('[data-review-tab]')).find(t => t.getAttribute('data-review-tab') === edit.topTab);
          if (top && !top.className.includes('border-[var(--accent)]')) { top.click(); setTimeout(step, 60); return; }
        }
        const sub = Array.from(root.querySelectorAll<HTMLElement>('[data-review-subtab]')).find(s => s.getAttribute('data-review-subtab') === edit.subTab);
        if (!sub) { setTimeout(step, 60); return; }
        if (!sub.className.includes('bg-white')) { sub.click(); setTimeout(step, 60); return; }
        sub.scrollIntoView({ block: 'nearest' });
        const prev = sub.style.boxShadow;
        sub.style.transition = 'box-shadow 0.25s';
        sub.style.boxShadow = '0 0 0 3px rgba(99,102,241,0.5)';
        setTimeout(() => { sub.style.boxShadow = prev; }, 1200);
        setFocusing(false);
      };
      requestAnimationFrame(step);
      return () => { cancelled = true; setFocusing(false); };
    }
    const triedTop = new Set<string>();
    let triedSub = new Set<string>();
    let origTop: string | null = null, origSub: string | null = null, captured = false;
    // After clicking a tab we must wait for that view to (a) become active and
    // (b) render its fields before judging whether our box lives there — a fresh
    // sub-panel mounts lazily. But once it HAS rendered fields and ours is not
    // among them, we move on immediately instead of burning a fixed poll budget,
    // so crawling a many-tab form stays quick. pendingV is the tab we just
    // clicked and are waiting to settle; mountPolls bounds that wait.
    let pendingV: string | null = null, mountPolls = 0;
    // Two-pass hunt: pass 1 ("targeted") uses the section score to skip whole tops
    // whose subs don't match, which is fast; if that misses, pass 2 ("exhaustive")
    // crawls every tab so a box whose sub label shares no words with the section is
    // still found.
    let exhaustive = false;
    // SA100 / SA101 restart box numbers per section, so a box number alone is
    // ambiguous — only accept a match when the editor's active tab matches the
    // facsimile section the box was clicked in (word overlap).
    const ambiguous = edit.formCode === 'SA100' || edit.formCode === 'SA101';
    // Multi-record forms (SA102/103/104) render every employer/trade/partnership
    // as its own editor card, so a bare box number is ambiguous across records.
    // When the clicked facsimile page carried a record id, confine the whole hunt
    // to that record's card (matched by data-review-record) so we edit the right
    // one instead of always the first.
    const recordId = edit.record || '';
    function scopeOf(root: HTMLElement): HTMLElement {
      if (!recordId) return root;
      return root.querySelector<HTMLElement>(`[data-review-record="${recordId}"]`) || root;
    }
    // Grammatical / generic filler only — topic nouns (income, interest,
    // dividends, pension, charitable, signing…) are kept so a section's words
    // actually distinguish it. 'uk' is dropped (too common across UK-x sections).
    const STOP = new Set(['and', 'the', 'from', 'for', 'your', 'you', 'with', 'into', 'this', 'that', 'not', 'have', 'had', 'has', 'are', 'was', 'were', 'been', 'etc', 'received', 'read', 'notes', 'amount', 'amounts', 'taken', 'off', 'out', 'any', 'all', 'before', 'after', 'which', 'more', 'than', 'less', 'included', 'include', 'supplementary', 'pages', 'page', 'box', 'boxes', 'uk', 'allowance', 'allowances', 'relief', 'reliefs', 'person', 'tax']);
    const words = (s: string) => new Set((s || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)));
    const secWords = words(edit.section);
    function overlaps(label: string): boolean {
      const lw = words(label);
      for (const w of lw) if (secWords.has(w)) return true;
      return false;
    }
    // Looser score used only to PRIORITISE which tab to open first (not to accept
    // a box) — counts bidirectional substring hits so e.g. the facsimile section
    // "…NICs" still steers to the editor sub "NIC & other Info" (nic ⊂ nics).
    const secLc = (edit.section || '').toLowerCase();
    function navScore(label: string): number {
      const ll = (label || '').toLowerCase();
      let s = 0;
      for (const w of secWords) if (ll.includes(w)) s++;
      for (const w of words(label)) if (secLc.includes(w)) s++;
      return s;
    }
    const bestBy = (els: HTMLElement[]) => {
      let best: HTMLElement | undefined, bestScore = 0;
      for (const el of els) { const sc = navScore(el.textContent || ''); if (sc > bestScore) { bestScore = sc; best = el; } }
      return best;
    };
    function sectionMatchesView(root: HTMLElement): boolean {
      if (!ambiguous || secWords.size === 0) return true;
      const sub = Array.from(root.querySelectorAll<HTMLElement>('[data-review-subtab]')).find(x => x.className.includes('bg-white'));
      const top = Array.from(root.querySelectorAll<HTMLElement>('[data-review-tab]')).find(x => x.className.includes('border-[var(--accent)]'));
      return (sub != null && overlaps(sub.textContent || '')) || (top != null && overlaps(top.textContent || ''));
    }
    function activeTab(root: HTMLElement, sel: string, attr: string, activeCls: string): string | null {
      const el = Array.from(root.querySelectorAll<HTMLElement>(sel)).find(x => x.className.includes(activeCls));
      return el ? el.getAttribute(attr) : null;
    }
    function restore() {
      setFocusing(false);
      const root = lightboxRef.current;
      if (!root || origTop == null) return;
      const scope = scopeOf(root);
      const t = Array.from(scope.querySelectorAll<HTMLElement>('[data-review-tab]')).find(x => x.getAttribute('data-review-tab') === origTop);
      t?.click();
      if (origSub != null) setTimeout(() => {
        const sc = lightboxRef.current ? scopeOf(lightboxRef.current) : null;
        const s = Array.from(sc?.querySelectorAll<HTMLElement>('[data-review-subtab]') || []).find(x => x.getAttribute('data-review-subtab') === origSub);
        s?.click();
      }, 60);
    }
    function focusBox(chip: HTMLElement) {
      let field: HTMLElement | null = chip.closest('label') || chip.closest('div') || chip;
      if (field && !field.querySelector('input,textarea,select') && field.parentElement) field = field.parentElement;
      (field || chip).scrollIntoView({ block: 'center', behavior: 'smooth' });
      const input = (field || chip).querySelector<HTMLElement>('input,textarea,select');
      if (input) setTimeout(() => input.focus(), 320);
      const el = field || chip;
      const prev = el.style.backgroundColor;
      el.style.transition = 'background-color 0.25s';
      el.style.backgroundColor = 'rgba(139,92,246,0.16)';
      setTimeout(() => { el.style.backgroundColor = prev; }, 1200);
      setFocusing(false);
    }
    function attempt(n: number) {
      if (cancelled || n > 200) { restore(); return; }
      const root = lightboxRef.current;
      if (!root) { setTimeout(() => attempt(n + 1), 50); return; }
      const scope = scopeOf(root);
      // Record-scoped hunt: the target card may not have mounted yet — wait for it
      // before searching (falls back to the whole lightbox after the budget so a
      // stale/absent record id still resolves something rather than hanging).
      if (recordId && scope === root && mountPolls < 12) { mountPolls++; setTimeout(() => attempt(n + 1), 40); return; }
      if (!captured) { origTop = activeTab(scope, '[data-review-tab]', 'data-review-tab', 'border-[var(--accent)]'); origSub = activeTab(scope, '[data-review-subtab]', 'data-review-subtab', 'bg-white'); captured = true; }
      const curSub = activeTab(scope, '[data-review-subtab]', 'data-review-subtab', 'bg-white');
      const curTop = activeTab(scope, '[data-review-tab]', 'data-review-tab', 'border-[var(--accent)]');
      // A just-clicked tab may not have taken effect yet — wait for it to become
      // active before judging whether our box lives in the new view.
      if (pendingV && curSub !== pendingV && curTop !== pendingV) {
        if (mountPolls < 12) { mountPolls++; setTimeout(() => attempt(n + 1), 40); return; }
      }
      const chip = scope.querySelector<HTMLElement>(`[data-editbox="${edit!.box}"]`);
      if (chip && sectionMatchesView(scope)) { focusBox(chip); return; }
      // View is active but may still be lazily rendering its fields (also covers
      // the editor's initial cold mount): keep waiting only while it has none.
      // Once it has rendered fields and ours is not among them, move on at once —
      // no fixed poll budget wasted per wrong tab.
      if (scope.querySelectorAll('[data-editbox]').length === 0 && mountPolls < 12) { mountPolls++; setTimeout(() => attempt(n + 1), 40); return; }
      pendingV = null; mountPolls = 0;
      const useSection = secWords.size > 0;
      const subsAll = Array.from(scope.querySelectorAll<HTMLElement>('[data-review-subtab]'));
      const subs = subsAll.filter(s => !triedSub.has(s.getAttribute('data-review-subtab') || ''));
      // Prefer the untried sub whose label best matches the clicked section, so we
      // jump straight to it instead of crawling every sub (each settle-poll costs
      // time). On the section-disambiguated forms (SA100/SA101) a box can ONLY
      // live under its matching sub, so if none matches we skip the rest of this
      // top; other forms fall back to ordered traversal to stay exhaustive.
      let nextSub: HTMLElement | undefined = useSection ? bestBy(subs) : undefined;
      if (!nextSub) {
        if (useSection && !exhaustive) subsAll.forEach(s => triedSub.add(s.getAttribute('data-review-subtab') || ''));
        else nextSub = subs[0];
      }
      if (nextSub) { const v = nextSub.getAttribute('data-review-subtab') || ''; triedSub.add(v); pendingV = v; nextSub.click(); setTimeout(() => attempt(n + 1), 40); return; }
      const tops = Array.from(scope.querySelectorAll<HTMLElement>('[data-review-tab]')).filter(t => !triedTop.has(t.getAttribute('data-review-tab') || ''));
      const nextTop = (useSection && bestBy(tops)) || tops[0];
      if (nextTop) { const v = nextTop.getAttribute('data-review-tab') || ''; triedTop.add(v); triedSub = new Set(); pendingV = v; nextTop.click(); setTimeout(() => attempt(n + 1), 40); return; }
      // Targeted pass skipped non-matching tops; if it found nothing, fall back to
      // a full ordered crawl of every tab before giving up.
      if (!exhaustive) { exhaustive = true; triedTop.clear(); triedSub = new Set(); pendingV = null; mountPolls = 0; setTimeout(() => attempt(n + 1), 40); return; }
      restore();
    }
    const raf = requestAnimationFrame(() => attempt(0));
    return () => { cancelled = true; cancelAnimationFrame(raf); setFocusing(false); };
  }, [edit]);

  const emps = useMemo(() => ret.income.employment.filter(e => employmentTaxable(e) !== 0 || e.employer), [ret]);
  const trades = useMemo(() => ret.income.selfEmployment.filter(t => t.form !== 'short' && (tradeTaxableProfit(t) !== 0 || t.name)), [ret]);
  const shortTrades = useMemo(() => ret.income.selfEmployment.filter(t => t.form === 'short' && (tradeTaxableProfit(t) !== 0 || t.name)), [ret]);
  const showCgt = useMemo(() => sa108HasData(ret.income.sa108), [ret]);
  const showForeign = useMemo(() => { const t = foreignTotals(ret.income); return !!(t.interest || t.dividends || t.other || t.taxClaimed); }, [ret]);
  const showWelsh = useMemo(() => welshAssemblyHasData(ret.income.welshAssembly), [ret]);
  const showNI = useMemo(() => assemblyHasData(ret.income.niAssembly), [ret]);
  const showMP = useMemo(() => parliamentHasData(ret.income.parliament), [ret]);
  const showScottish = useMemo(() => scottishParliamentHasData(ret.income.scottishParliament), [ret]);
  const showResidence = useMemo(() => { const r = ret.income.residence; return !!r && Object.values(r).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : !!v)); }, [ret]);
  const showAdditional = useMemo(() => { const r = ret.income.additional; return !!r && Object.values(r).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : !!v)); }, [ret]);
  const showProperty = useMemo(() => (ret.income.property ?? []).length > 0, [ret]);
  const showLloyds = useMemo(() => lloydsHasData(ret.income.lloyds), [ret]);
  const showMinister = useMemo(() => ministerHasData(ret.income.minister), [ret]);
  const showTrusts = useMemo(() => { const s = ret.income.sa107; return !!s && Object.values(s).some(v => (typeof v === 'number' ? v !== 0 : typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : !!v)); }, [ret]);
  const fullPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form !== 'short' && (p.profit || p.name || p.utr)), [ret]);
  const shortPartners = useMemo(() => (ret.income.partnerships ?? []).filter(p => p.form === 'short' && (p.profit || p.name || p.utr)), [ret]);
  const rest = useMemo(() => buildFilingForms(ret).slice(1).filter(f => f.code !== 'SA102' && f.code !== 'SA103F' && f.code !== 'SA103S' && f.code !== 'SA108' && f.code !== 'SA106' && f.code !== 'SA102WAM' && f.code !== 'SA102MLA' && f.code !== 'SA102MP' && f.code !== 'SA102MSP' && f.code !== 'SA104F' && f.code !== 'SA104S' && f.code !== 'SA109' && f.code !== 'SA105' && f.code !== 'SA103L' && f.code !== 'SA101' && f.code !== 'SA102M' && !(f.code === 'SA107' && showTrusts)), [ret, showTrusts]);
  const totalForms = rest.length + 2 + emps.length + trades.length + shortTrades.length + (showCgt ? 1 : 0) + (showForeign ? 1 : 0) + (showWelsh ? 1 : 0) + (showNI ? 1 : 0) + (showMP ? 1 : 0) + (showScottish ? 1 : 0) + (showResidence ? 1 : 0) + (showProperty ? 1 : 0) + (showLloyds ? 1 : 0) + (showAdditional ? 1 : 0) + (showMinister ? 1 : 0) + (showTrusts ? 1 : 0) + fullPartners.length + shortPartners.length;

  // Build the contents outline once the sheets are in the DOM.
  useEffect(() => {
    const root = sheetsRef.current;
    if (!root) return;
    const raf = requestAnimationFrame(() => setOutline(buildOutline(root, editablePreview)));
    return () => cancelAnimationFrame(raf);
  }, [ret, totalForms, editablePreview]);

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);

  return (
    <div id="sa-filing-preview" className="fixed inset-0 z-50 flex flex-col bg-slate-100">
      <style>{PRINT_CSS}</style>
      <style>{`
        #sa-filing-preview [data-sa-editable] { cursor: pointer; border-radius: 3px; transition: outline-color 0.1s; }
        #sa-filing-preview [data-sa-editable]:hover { outline: 2px solid #8b5cf6; outline-offset: 3px; background: rgba(139,92,246,0.06); }
        /* Table-based sections (foreign income / CGT disposals) jump to a whole
           editor table, so they get a distinct dashed affordance + a hint badge,
           not the solid box outline. */
        #sa-filing-preview [data-sa-sectionedit] { cursor: pointer; transition: box-shadow 0.12s; }
        #sa-filing-preview [data-sa-sectionedit]:hover { outline: 1.5px dashed rgba(99,102,241,0.65); outline-offset: -2px; box-shadow: inset 0 0 0 999px rgba(99,102,241,0.06); }
        #sa-filing-preview [data-sa-sectionedit]:hover::after { content: '✎ Edit this section'; position: absolute; top: 0; right: 8px; background: #6366f1; color: #fff; font-size: 8.5px; font-weight: 700; letter-spacing: .02em; padding: 1px 6px; border-radius: 0 0 4px 4px; pointer-events: none; z-index: 6; }
        @media print { #sa-filing-preview [data-sa-editable]:hover { outline: none; background: none; } #sa-filing-preview [data-sa-sectionedit]:hover { outline: none; box-shadow: none; } #sa-filing-preview [data-sa-sectionedit]:hover::after { display: none; } }
      `}</style>
      {/* Toolbar */}
      <div className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setSidebar(s => !s)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50" aria-label="Toggle contents">
            <List size={15} /> Contents
          </button>
          <FileText size={16} className="ml-1 text-[var(--accent)]" />
          <div>
            <p className="text-[13px] font-bold text-slate-900">Filing preview — {ret.clientName}</p>
            <p className="text-[11px] text-slate-500">SA100 {ret.taxYear} · {totalForms} form{totalForms === 1 ? '' : 's'} · supplementary pages shown only where there are entries</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Zoom */}
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 px-1 py-0.5">
            <button onClick={() => setZoom(z => Math.max(0.4, +(z - 0.1).toFixed(2)))} className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Zoom out"><Minus size={14} /></button>
            <button onClick={() => setZoom(1)} className="w-11 text-center text-[11px] font-semibold tabular-nums text-slate-600 hover:text-slate-900" aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(z => Math.min(2, +(z + 0.1).toFixed(2)))} className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Zoom in"><Plus size={14} /></button>
          </div>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90">
            <Printer size={14} /> Print / Save as PDF
          </button>
          <button onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50">
            <X size={14} /> Close
          </button>
        </div>
      </div>

      <div className="sa-body flex min-h-0 flex-1">
        {/* Contents sidebar */}
        {sidebar && (
          <div className="no-print flex w-[288px] shrink-0 flex-col border-r border-slate-200 bg-white">
            <div className="border-b border-slate-100 p-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                <Search size={14} className="text-slate-400" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search boxes, headings, forms…" className="w-full bg-transparent text-[12px] text-slate-700 outline-none placeholder:text-slate-400" />
                {query && <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600"><X size={13} /></button>}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
              {outline.map(form => {
                const formMatch = matches(form.name) || matches(form.code);
                const secs = form.sections.map(sec => {
                  const secMatch = formMatch || matches(sec.title);
                  const boxes = sec.boxes.filter(b => secMatch || matches(b.num) || matches(b.label));
                  return { sec, boxes, show: secMatch || boxes.length > 0 };
                }).filter(s => s.show);
                if (q && !formMatch && secs.length === 0) return null;
                const formOpen = q ? true : (openForms[form.key] ?? false);
                return (
                  <div key={form.key} className="px-1">
                    <button onClick={() => setOpenForms(o => ({ ...o, [form.key]: !formOpen }))}
                      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left hover:bg-slate-50">
                      <ChevronRight size={13} className={`shrink-0 text-slate-400 transition-transform ${formOpen ? 'rotate-90' : ''}`} />
                      <span className="inline-flex shrink-0 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--accent)]">{form.code}</span>
                      <span className="flex-1 truncate text-[12px] font-semibold text-slate-700">{form.name}</span>
                    </button>
                    {formOpen && secs.map(({ sec, boxes }) => {
                      const secOpen = q ? true : (openSecs[sec.key] ?? false);
                      return (
                        <div key={sec.key} className="ml-4">
                          <div className="flex items-center">
                            <button onClick={() => setOpenSecs(o => ({ ...o, [sec.key]: !secOpen }))} className="shrink-0 rounded p-0.5 text-slate-300 hover:text-slate-500">
                              <ChevronRight size={12} className={`transition-transform ${secOpen ? 'rotate-90' : ''}`} />
                            </button>
                            <button onClick={() => navTo(sec.id)} className="flex-1 truncate rounded px-1 py-1 text-left text-[11.5px] font-medium text-slate-600 hover:bg-slate-50 hover:text-[var(--accent)]" title={sec.title}>{sec.title}</button>
                          </div>
                          {secOpen && boxes.map(b => (
                            <button key={b.key} onClick={() => navTo(b.id)} className="flex w-full items-start gap-1.5 rounded px-1 py-[3px] pl-7 text-left hover:bg-slate-50" title={b.label}>
                              <span className="mt-px inline-flex min-w-[22px] shrink-0 justify-center rounded bg-slate-100 px-1 text-[9px] font-bold text-slate-500">{b.num}</span>
                              <span className="flex-1 truncate text-[11px] leading-snug text-slate-500">{b.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {outline.length === 0 && <p className="px-4 py-6 text-center text-[11px] text-slate-400">Building contents…</p>}
            </div>
          </div>
        )}

        {/* Sheets */}
        <div className="sa-main-scroll min-w-0 flex-1 overflow-auto" onClick={onSheetClick}>
          {editablePreview && (
            <p className="no-print mx-auto mt-4 flex max-w-[210mm] items-center justify-center gap-1.5 text-[11px] font-medium text-slate-500">
              <Pencil size={12} className="text-[#8b5cf6]" /> Click any editable field to change it — updates the return live.
            </p>
          )}
          <div ref={sheetsRef} className="sa-sheets-wrap px-4 py-6" style={{ zoom }}>
            <Sa100Facsimile ret={ret} editable={editablePreview} />
            {emps.map((e, idx) => <EmploymentFacsimile key={`emp-${idx}`} ret={ret} emp={e} />)}
            {trades.map((tr, idx) => <SelfEmploymentFacsimile key={`se-${idx}`} ret={ret} trade={tr} />)}
            {shortTrades.map((tr, idx) => <SelfEmploymentShortFacsimile key={`ses-${idx}`} ret={ret} trade={tr} />)}
            {showLloyds && <LloydsFacsimile ret={ret} />}
            {showCgt && <CapitalGainsFacsimile ret={ret} />}
            {showForeign && <ForeignFacsimile ret={ret} />}
            {showWelsh && ret.income.welshAssembly && <WelshParliamentFacsimile ret={ret} office={ret.income.welshAssembly} />}
            {showNI && ret.income.niAssembly && <NIAssemblyFacsimile ret={ret} office={ret.income.niAssembly} />}
            {showMP && ret.income.parliament && <ParliamentFacsimile ret={ret} office={ret.income.parliament} />}
            {showScottish && ret.income.scottishParliament && <ScottishParliamentFacsimile ret={ret} office={ret.income.scottishParliament} />}
            {showMinister && <MinisterFacsimile ret={ret} />}
            {fullPartners.map((pt, idx) => <PartnershipFacsimile key={`ptf-${idx}`} ret={ret} partner={pt} />)}
            {shortPartners.map((pt, idx) => <PartnershipShortFacsimile key={`pts-${idx}`} ret={ret} partner={pt} />)}
            {showProperty && <PropertyFacsimile ret={ret} />}
            {showTrusts && <TrustsFacsimile ret={ret} />}
            {showResidence && <ResidenceFacsimile ret={ret} />}
            {showAdditional && <AdditionalFacsimile ret={ret} />}
            <TaxCalcSummaryFacsimile ret={ret} />
            {rest.map((f, idx) => <Sheet key={`${f.code}-${idx}`} form={f} />)}
            <p className="no-print mx-auto mb-8 max-w-[210mm] text-center text-[11px] text-slate-400">
              This is a working copy of the return as entered. It becomes the client’s filed copy once the return is submitted to HMRC. For mortgage use, provide the tax calculation together with the HMRC Tax Year Overview.
            </p>
          </div>
        </div>
      </div>

      {/* Edit-a-field lightbox — the real Review & Adjust editor for that form,
          focused to the clicked box; edits flow live to the return + preview. */}
      {edit && renderEditor && createPortal(
        <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-auto bg-black/50 p-4 py-8" onClick={() => setEdit(null)}>
          <div ref={lightboxRef} className="w-full max-w-3xl rounded-2xl bg-[var(--surface,#fff)] shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-2xl border-b border-slate-200 bg-white px-5 py-3">
              <div className="flex items-center gap-2">
                <Pencil size={15} className="text-[#8b5cf6]" />
                <div>
                  <p className="text-[13px] font-bold text-slate-900">Edit {FORM_NAMES[edit.formCode] || edit.formCode}{edit.box ? ` — box ${edit.box}` : ''}</p>
                  <p className="text-[11px] text-slate-500">Changes apply to the return and Review &amp; Adjust in real time.</p>
                </div>
              </div>
              <button onClick={() => setEdit(null)} className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:opacity-90">
                <Check size={14} /> Done
              </button>
            </div>
            <div className="relative max-h-[76vh] overflow-auto p-5">
              {/* While the editor tabs to the clicked box, cover the shuffle. */}
              {focusing && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-[1px]">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-500">
                    <Loader2 size={16} className="animate-spin text-[var(--accent)]" /> Opening…
                  </div>
                </div>
              )}
              {renderEditor(edit.page)}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
