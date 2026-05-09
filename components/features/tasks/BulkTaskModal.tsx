'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import {
  X, Users, Building2, Loader2, Download, Upload, Plus, Trash2,
  AlertCircle, CheckCircle2, Info, RefreshCw, ChevronRight, FileSpreadsheet,
  ToggleLeft, ToggleRight, Zap, Clock, Filter, Search, CheckSquare, Square,
} from 'lucide-react';
import { TEMPLATE_CATEGORY_LABELS } from '@/config/defaultTaskTemplates';
import Tooltip from '@/components/ui/Tooltip';
import type { TaskTemplate, TaskTemplateStep } from '@/types';
import ClientSearchInput from '@/components/ui/ClientSearchInput';

// ─── Local types ──────────────────────────────────────────────────────────────

interface Client    {
  id: string;
  name: string;
  client_ref: string;
  business_type?: string | null;
  status?: string | null;
}
interface TeamMember { id: string; full_name: string | null; email: string; }

// ─── Client type / status metadata ───────────────────────────────────────────

const CLIENT_TYPE_LABELS: Record<string, string> = {
  sole_trader:      'Sole Trader',
  partnership:      'Partnership',
  limited_company:  'Limited Company',
  individual:       'Individual',
  trust:            'Trust',
  charity:          'Charity',
  rental_landlord:  'Rental Landlord',
};

const CLIENT_STATUS_LABELS: Record<string, { label: string; colour: string }> = {
  active:   { label: 'Active',   colour: 'bg-green-100 text-green-700 border-green-200' },
  hold:     { label: 'Hold',     colour: 'bg-amber-100 text-amber-700 border-amber-200' },
  inactive: { label: 'Inactive', colour: 'bg-gray-100 text-gray-500 border-gray-200'   },
};

const RECURRENCE_META: Record<string, { label: string; colour: string }> = {
  weekly:      { label: 'Weekly',     colour: 'bg-sky-100 text-sky-700' },
  'bi-weekly': { label: 'Bi-weekly',  colour: 'bg-cyan-100 text-cyan-700' },
  monthly:     { label: 'Monthly',    colour: 'bg-blue-100 text-blue-700' },
  quarterly:   { label: 'Quarterly',  colour: 'bg-violet-100 text-violet-700' },
  annually:    { label: 'Annually',   colour: 'bg-orange-100 text-orange-700' },
  custom:      { label: 'Custom',     colour: 'bg-gray-100 text-gray-600' },
  once:        { label: 'One-off',    colour: 'bg-gray-100 text-gray-500' },
};

interface OnboardingRow {
  id: string;
  templateId: string;
  deadline: string;
}

interface AllocationRow {
  id: string;
  clientId: string;
  clientName: string; // stored so display never relies on the truncated parent prop
  clientRef: string;  // stored for the CODE column display
  deadline: string;
  stepAssignees: Record<string, string>; // step_key → '' | 'client' | member_id
}

interface BulkResult {
  label: string;
  success: boolean;
  error?: string;
}

type ModalStep = 'mode' | 'configure' | 'review' | 'results';
type BulkMode  = 'onboarding' | 'mass_allocation';

interface Props {
  templates: TaskTemplate[];
  clients: Client[];
  teamMembers: TeamMember[];
  onClose: () => void;
  onComplete: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 10); }

/** Return non-structural steps sorted by vertical position */
function getStepCols(template: TaskTemplate): TaskTemplateStep[] {
  return (template.steps ?? [])
    .filter(s => s.step_type !== 'start' && s.step_type !== 'end')
    .sort((a, b) => (a.position_y ?? 0) - (b.position_y ?? 0));
}

/** Default assignee value for a step */
function defaultStepAssignee(s: TaskTemplateStep): string {
  if (s.assignee_role === 'client') return 'client';
  return s.default_assignee_id ?? '';
}

/** Build default assignee map for all steps in a template */
function defaultAssignees(steps: TaskTemplateStep[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of steps) out[s.step_key] = defaultStepAssignee(s);
  return out;
}

function exportCsv(headers: string[], rows: string[][], filename: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], inQ = false, cell = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQ && text[i + 1] === '"') { cell += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQ) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); if (row.some(c => c.trim())) rows.push(row); }
  return rows;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEP_LABELS: Record<ModalStep, string> = {
  mode:      '1. Mode',
  configure: '2. Configure',
  review:    '3. Review',
  results:   '4. Results',
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function BulkTaskModal({ templates, clients, teamMembers, onClose, onComplete }: Props) {

  // ── Navigation ──────────────────────────────────────────────────────────────
  const [step, setStep]   = useState<ModalStep>('mode');
  const [mode, setMode]   = useState<BulkMode | null>(null);
  const [configError, setConfigError] = useState('');

  // ── Onboarding state ─────────────────────────────────────────────────────────
  const [obClientId, setObClientId]     = useState('');
  const [obClientName, setObClientName] = useState('');
  const [obRows, setObRows]             = useState<OnboardingRow[]>([]);
  const [obTemplSearch, setObTemplSearch] = useState('');
  const [showTemplPicker, setShowTemplPicker] = useState(false);
  const templPickerRef = useRef<HTMLDivElement>(null);

  // ── Mass allocation state ────────────────────────────────────────────────────
  const [maTemplateId, setMaTemplateId]       = useState('');
  const [maRows, setMaRows]                   = useState<AllocationRow[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateSearch, setTemplateSearch]   = useState('');
  const templatePickerRef = useRef<HTMLDivElement>(null);

  // ── MA row selection + bulk edit ────────────────────────────────────────────
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [bulkDeadline, setBulkDeadline]     = useState('');
  const [bulkStepKey, setBulkStepKey]       = useState('');
  const [bulkAssignee, setBulkAssignee]     = useState('');

  // ── Client Select panel state (mass allocation only) ─────────────────────────
  const [showClientSelect, setShowClientSelect] = useState(false);
  const [csSearch, setCsSearch]             = useState('');
  const [csTypeFilter, setCsTypeFilter]     = useState('');
  const [csStatusFilter, setCsStatusFilter] = useState('');
  const [csSelected, setCsSelected]         = useState<Set<string>>(new Set());
  // Clients fetched directly from API — avoids parent-prop truncation issue
  const [csClients, setCsClients]   = useState<Client[]>([]);
  const [csLoading, setCsLoading]   = useState(false);

  // ── Review / submit ──────────────────────────────────────────────────────────
  const [createImmediately, setCreateImmediately] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults]       = useState<BulkResult[]>([]);
  const [successCount, setSuccessCount] = useState(0);

  const obCsvRef  = useRef<HTMLInputElement>(null);
  const maCsvRef  = useRef<HTMLInputElement>(null);
  const csvMenuRef = useRef<HTMLDivElement>(null);
  const [showCsvMenu, setShowCsvMenu] = useState(false);

  // ── Derived ──────────────────────────────────────────────────────────────────
  const selectedTemplate = useMemo(() =>
    templates.find(t => t.id === maTemplateId) ?? null,
  [templates, maTemplateId]);

  const stepCols = useMemo(() =>
    selectedTemplate ? getStepCols(selectedTemplate) : [],
  [selectedTemplate]);

  // kept for review screen; uses stored name so it works even if prop is truncated
  const selectedClient = obClientId ? { id: obClientId, name: obClientName, client_ref: '' } : null;

  const usedTemplateIds = useMemo(() =>
    new Set(obRows.map(r => r.templateId)),
  [obRows]);

  const filteredObTemplates = useMemo(() =>
    templates.filter(t =>
      !usedTemplateIds.has(t.id) &&
      t.name.toLowerCase().includes(obTemplSearch.toLowerCase())
    ),
  [templates, usedTemplateIds, obTemplSearch]);

  // IDs already added to the MA table
  const maExistingClientIds = useMemo(() => new Set(maRows.map(r => r.clientId)), [maRows]);

  // ── Client Select panel — fetch from API (server-side search + filters) ──────
  // This is the canonical pattern: never filter a parent-provided prop of all
  // clients (Supabase PostgREST caps rows). Always call the API directly.
  useEffect(() => {
    if (!showClientSelect) return;
    const params = new URLSearchParams();
    if (csSearch)       params.set('search', csSearch);
    if (csTypeFilter)   params.set('type',   csTypeFilter);
    if (csStatusFilter) params.set('status', csStatusFilter);
    setCsLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clients?${params.toString()}`);
        if (r.ok) { const d = await r.json(); setCsClients(d.clients ?? []); }
      } finally { setCsLoading(false); }
    }, csSearch ? 200 : 0); // immediate on filter-only changes, debounced on text
    return () => clearTimeout(timer);
  }, [showClientSelect, csSearch, csTypeFilter, csStatusFilter]);

  // Close template picker on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (templPickerRef.current && !templPickerRef.current.contains(e.target as Node))
        setShowTemplPicker(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Reset MA rows + selection when template changes
  useEffect(() => { setMaRows([]); setSelectedRowIds(new Set()); setBulkStepKey(''); }, [maTemplateId]);

  // Close template picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (templatePickerRef.current && !templatePickerRef.current.contains(e.target as Node))
        setShowTemplatePicker(false);
      if (csvMenuRef.current && !csvMenuRef.current.contains(e.target as Node))
        setShowCsvMenu(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Templates grouped by category for the rich picker
  const groupedMaTemplates = useMemo(() => {
    const q = templateSearch.toLowerCase();
    const filtered = templates.filter(t =>
      !q || t.name.toLowerCase().includes(q) ||
      (TEMPLATE_CATEGORY_LABELS[t.category] ?? '').toLowerCase().includes(q)
    );
    const groups: { category: string; label: string; items: TaskTemplate[] }[] = [];
    const seen = new Set<string>();
    // Use TEMPLATE_CATEGORY_LABELS key order for consistent grouping
    for (const cat of Object.keys(TEMPLATE_CATEGORY_LABELS)) {
      const items = filtered.filter(t => t.category === cat);
      if (items.length) { groups.push({ category: cat, label: TEMPLATE_CATEGORY_LABELS[cat], items }); seen.add(cat); }
    }
    // Catch any templates with an unknown category
    const rest = filtered.filter(t => !seen.has(t.category));
    if (rest.length) groups.push({ category: 'other', label: 'Other', items: rest });
    return groups;
  }, [templates, templateSearch]);

  // ── Onboarding helpers ───────────────────────────────────────────────────────
  function addObRow(templateId: string) {
    setObRows(prev => [...prev, { id: uid(), templateId, deadline: '' }]);
    setObTemplSearch(''); setShowTemplPicker(false);
  }
  function removeObRow(id: string) { setObRows(prev => prev.filter(r => r.id !== id)); }
  function setObDeadline(id: string, v: string) {
    setObRows(prev => prev.map(r => r.id === id ? { ...r, deadline: v } : r));
  }

  // ── Mass allocation helpers ──────────────────────────────────────────────────
  function addMaRow() {
    setMaRows(prev => [...prev, {
      id: uid(), clientId: '', clientName: '', clientRef: '', deadline: '',
      stepAssignees: defaultAssignees(stepCols),
    }]);
  }
  function removeMaRow(id: string) { setMaRows(prev => prev.filter(r => r.id !== id)); }
  function setMaClient(id: string, clientId: string, clientName: string, clientRef: string) {
    setMaRows(prev => prev.map(r => r.id === id ? { ...r, clientId, clientName, clientRef } : r));
  }
  function setMaDeadline(id: string, v: string) {
    setMaRows(prev => prev.map(r => r.id === id ? { ...r, deadline: v } : r));
  }
  function setMaAssignee(rowId: string, stepKey: string, v: string) {
    setMaRows(prev => prev.map(r =>
      r.id === rowId ? { ...r, stepAssignees: { ...r.stepAssignees, [stepKey]: v } } : r
    ));
  }

  // ── MA row selection helpers ──────────────────────────────────────────────────
  function toggleRowSelection(rowId: string) {
    setSelectedRowIds(prev => {
      const next = new Set(prev);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  }

  function toggleAllRowsSelection() {
    if (selectedRowIds.size === maRows.length && maRows.length > 0) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(maRows.map(r => r.id)));
    }
  }

  function applyBulkDeadline() {
    if (!bulkDeadline) return;
    setMaRows(prev => prev.map(r =>
      selectedRowIds.has(r.id) ? { ...r, deadline: bulkDeadline } : r
    ));
  }

  function applyBulkStepAssignee() {
    if (!bulkStepKey) return;
    setMaRows(prev => prev.map(r =>
      selectedRowIds.has(r.id)
        ? { ...r, stepAssignees: { ...r.stepAssignees, [bulkStepKey]: bulkAssignee } }
        : r
    ));
  }

  function deleteSelectedRows() {
    setMaRows(prev => prev.filter(r => !selectedRowIds.has(r.id)));
    setSelectedRowIds(new Set());
  }

  // ── CSV helpers ───────────────────────────────────────────────────────────────
  function downloadObCsvTemplate() {
    exportCsv(['Template Name', 'Deadline (YYYY-MM-DD)'], [], 'onboarding_template.csv');
  }

  function handleObCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCsv(ev.target?.result as string).slice(1); // skip header
      const newRows: OnboardingRow[] = [];
      for (const row of rows) {
        const name = row[0]?.trim() ?? '';
        const deadline = row[1]?.trim() ?? '';
        const tmpl = templates.find(t => t.name === name);
        if (tmpl && !usedTemplateIds.has(tmpl.id)) {
          newRows.push({ id: uid(), templateId: tmpl.id, deadline });
        }
      }
      setObRows(prev => [...prev, ...newRows]);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function downloadMaCsvTemplate() {
    if (!selectedTemplate) return;
    const stepHeaders = stepCols.map((_, i) => `Step ${i + 1}`);
    exportCsv(
      ['Client Name', 'Client Code', 'Deadline (YYYY-MM-DD)', ...stepHeaders],
      [],
      'mass_allocation_template.csv'
    );
  }

  function downloadMaCurrentData() {
    if (!selectedTemplate || maRows.length === 0) return;
    const stepHeaders = stepCols.map((_, i) => `Step ${i + 1}`);
    const rows = maRows.map(r => {
      const stepValues = stepCols.map(s => {
        const val = r.stepAssignees[s.step_key] ?? '';
        if (!val)           return ''; // blank = Default
        if (val === 'client') return 'Client';
        const member = teamMembers.find(m => m.id === val);
        return member?.full_name ?? member?.email ?? val;
      });
      return [r.clientName, r.clientRef, r.deadline, ...stepValues];
    });
    const safeName = selectedTemplate.name.replace(/[^a-z0-9_\-\s]/gi, '').trim().replace(/\s+/g, '_');
    exportCsv(
      ['Client Name', 'Client Code', 'Deadline (YYYY-MM-DD)', ...stepHeaders],
      rows,
      `${safeName}_data.csv`
    );
  }

  function handleMaCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file || !selectedTemplate) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const rows = parseCsv(ev.target?.result as string).slice(1);
      const newRows: AllocationRow[] = [];
      for (const row of rows) {
        const clientName = row[0]?.trim() ?? '';
        const deadline   = row[2]?.trim() ?? '';
        const client     = clients.find(c => c.name === clientName);
        if (!client) continue;
        const assignees = defaultAssignees(stepCols);
        stepCols.forEach((s, i) => {
          const val = row[3 + i]?.trim() ?? '';
          if (!val) return;
          if (val.toLowerCase() === 'client') { assignees[s.step_key] = 'client'; return; }
          const member = teamMembers.find(m =>
            (m.full_name ?? '').toLowerCase() === val.toLowerCase() ||
            m.email.toLowerCase() === val.toLowerCase()
          );
          if (member) assignees[s.step_key] = member.id;
        });
        newRows.push({ id: uid(), clientId: client.id, clientName: client.name, clientRef: client.client_ref, deadline, stepAssignees: assignees });
      }
      setMaRows(prev => [...prev, ...newRows]);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Client Select helpers ──────────────────────────────────────────────────────
  function openClientSelect() {
    setCsSelected(new Set());
    setCsSearch('');
    setCsTypeFilter('');
    setCsStatusFilter('');
    setShowClientSelect(true);
  }

  function toggleCsClient(id: string) {
    setCsSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleCsSelectAll() {
    const eligible = csClients.filter(c => !maExistingClientIds.has(c.id));
    const allSelected = eligible.every(c => csSelected.has(c.id));
    setCsSelected(prev => {
      const next = new Set(prev);
      if (allSelected) { eligible.forEach(c => next.delete(c.id)); }
      else             { eligible.forEach(c => next.add(c.id)); }
      return next;
    });
  }

  function handleClientSelectConfirm() {
    const newRows: AllocationRow[] = [];
    for (const id of csSelected) {
      if (!maExistingClientIds.has(id)) {
        const found = csClients.find(c => c.id === id);
        newRows.push({ id: uid(), clientId: id, clientName: found?.name ?? '', clientRef: found?.client_ref ?? '', deadline: '', stepAssignees: defaultAssignees(stepCols) });
      }
    }
    setMaRows(prev => [...prev, ...newRows]);
    setShowClientSelect(false);
    setCsSelected(new Set());
  }

  // ── Validation ────────────────────────────────────────────────────────────────
  function validate(): string {
    if (mode === 'onboarding') {
      if (!obClientId) return 'Please select a client to onboard.';
      if (obRows.length === 0) return 'Add at least one template row.';
    }
    if (mode === 'mass_allocation') {
      if (!maTemplateId) return 'Please select a template.';
      if (maRows.length === 0) return 'Add at least one client row.';
      if (maRows.some(r => !r.clientId)) return 'Every row must have a client selected.';
    }
    return '';
  }

  function handleContinue() {
    const err = validate();
    if (err) { setConfigError(err); return; }
    setConfigError(''); setStep('review');
  }

  // ── Submit ────────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    setSubmitting(true);
    try {
      const rows = mode === 'onboarding'
        ? obRows.map(r => ({
            template_id: r.templateId,
            client_id: obClientId,
            deadline: r.deadline || null,
            step_assignees: {},
          }))
        : maRows.map(r => ({
            template_id: maTemplateId,
            client_id: r.clientId,
            deadline: r.deadline || null,
            // Strip out any undefined/empty values so Zod validation passes
            step_assignees: Object.fromEntries(
              Object.entries(r.stepAssignees).filter(([, v]) => v !== undefined && v !== null)
            ),
          }));

      const res = await fetch('/api/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, create_immediately: createImmediately }),
      });

      // Guard against empty / non-JSON responses (e.g. server crash)
      const text = await res.text();
      let data: { results?: { label: string; success: boolean; error?: string }[]; successCount?: number; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        setResults([{ label: 'Request', success: false, error: `Server error (HTTP ${res.status}) — please try again. If the problem persists, check the server logs.` }]);
        setSuccessCount(0);
        setStep('results');
        return;
      }

      if (!res.ok && !data.results) {
        setResults([{ label: 'Request', success: false, error: data.error ?? `HTTP ${res.status}` }]);
        setSuccessCount(0);
        setStep('results');
        return;
      }

      setResults(data.results ?? [{ label: 'Request', success: false, error: data.error ?? 'Unknown error' }]);
      setSuccessCount(data.successCount ?? 0);
      setStep('results');
    } catch (err) {
      setResults([{ label: 'Request', success: false, error: String(err) }]);
      setSuccessCount(0);
      setStep('results');
    } finally {
      setSubmitting(false);
    }
  }

  function handleBack() {
    if (step === 'review')    { setStep('configure'); return; }
    if (step === 'configure') { setStep('mode'); return; }
  }

  // ── Assignee display helpers ──────────────────────────────────────────────────
  function assigneeLabel(val: string): string {
    if (!val) return '— Default —';
    if (val === 'client') return 'Client';
    const m = teamMembers.find(m => m.id === val);
    return m?.full_name ?? m?.email ?? '?';
  }

  const assigneeOptions = useMemo(() => [
    { value: '',       label: '— Default —' },
    { value: 'client', label: 'Client' },
    ...teamMembers.map(m => ({ value: m.id, label: m.full_name ?? m.email })),
  ], [teamMembers]);

  // ══════════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════════

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0 bg-gray-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
            <h1 className="text-base font-bold text-gray-900">Bulk Tasks</h1>
          </div>
          {/* Step indicator */}
          <div className="hidden sm:flex items-center gap-1">
            {(['mode', 'configure', 'review', 'results'] as ModalStep[]).map((s, i) => (
              <div key={s} className="flex items-center gap-1">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  step === s
                    ? 'bg-indigo-600 text-white'
                    : ['mode','configure','review','results'].indexOf(s) < ['mode','configure','review','results'].indexOf(step)
                      ? 'bg-indigo-100 text-indigo-600'
                      : 'text-gray-400'
                }`}>{STEP_LABELS[s]}</span>
                {i < 3 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
              </div>
            ))}
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-400">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">

        {/* ── SCREEN 1: Mode selection ──────────────────────────────────────── */}
        {step === 'mode' && (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-2xl">
              <h2 className="text-xl font-bold text-gray-900 text-center mb-2">What would you like to do?</h2>
              <p className="text-sm text-gray-500 text-center mb-8">Choose a bulk operation type. Admin access required.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Onboarding */}
                <button
                  onClick={() => { setMode('onboarding'); setStep('configure'); }}
                  className="group text-left border-2 border-gray-200 hover:border-indigo-400 rounded-2xl p-6 transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-green-50 group-hover:bg-green-100 flex items-center justify-center mb-4 transition-colors">
                    <Users className="h-6 w-6 text-green-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1">Client Onboarding</h3>
                  <p className="text-sm text-gray-500">
                    Assign many task templates to a single client at once. Ideal for onboarding a new client.
                  </p>
                  <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-green-600">
                    Many templates → One client <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </button>
                {/* Mass allocation */}
                <button
                  onClick={() => { setMode('mass_allocation'); setStep('configure'); }}
                  className="group text-left border-2 border-gray-200 hover:border-indigo-400 rounded-2xl p-6 transition-all"
                >
                  <div className="w-12 h-12 rounded-xl bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center mb-4 transition-colors">
                    <Building2 className="h-6 w-6 text-indigo-600" />
                  </div>
                  <h3 className="font-bold text-gray-900 mb-1">Mass Allocation</h3>
                  <p className="text-sm text-gray-500">
                    Assign one task template to many clients at once. Set deadlines and step assignments per client.
                  </p>
                  <div className="mt-4 flex items-center gap-1.5 text-xs font-medium text-indigo-600">
                    One template → Many clients <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCREEN 2a: Onboarding configure ──────────────────────────────── */}
        {step === 'configure' && mode === 'onboarding' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4">

            {/* Client selector */}
            <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700">Client:</span>
                <ClientSearchInput
                  value={obClientId}
                  valueName={obClientName}
                  onChange={(id, name, _ref) => { setObClientId(id); setObClientName(name); }}
                  placeholder="— Select client —"
                  className="min-w-[240px]"
                />
              </div>
              {obClientId && obClientName && (
                <span className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-1 rounded-lg font-medium">
                  {obClientName}
                </span>
              )}
            </div>

            {/* Template picker + grid */}
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="relative" ref={templPickerRef}>
                <button
                  onClick={() => setShowTemplPicker(v => !v)}
                  className="flex items-center gap-2 text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium"
                >
                  <Plus className="h-4 w-4" /> Add Template
                </button>
                {showTemplPicker && (
                  <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl z-20">
                    <div className="p-2 border-b border-gray-100">
                      <input
                        autoFocus
                        value={obTemplSearch}
                        onChange={e => setObTemplSearch(e.target.value)}
                        placeholder="Search templates…"
                        className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="max-h-52 overflow-y-auto py-1">
                      {filteredObTemplates.length === 0
                        ? <p className="text-xs text-gray-400 text-center py-4">No templates available</p>
                        : filteredObTemplates.map(t => (
                          <button
                            key={t.id}
                            onClick={() => addObRow(t.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors"
                          >
                            <span className="font-medium text-gray-800">{t.name}</span>
                            <span className="ml-2 text-xs text-gray-400">{TEMPLATE_CATEGORY_LABELS[t.category] ?? t.category}</span>
                          </button>
                        ))
                      }
                    </div>
                  </div>
                )}
              </div>

              {/* CSV */}
              <button onClick={downloadObCsvTemplate} className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:border-indigo-400 hover:text-indigo-700 transition-colors">
                <Download className="h-3.5 w-3.5" /> CSV Template
              </button>
              <button onClick={() => obCsvRef.current?.click()} className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:border-indigo-400 hover:text-indigo-700 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Upload CSV
              </button>
              <input ref={obCsvRef} type="file" accept=".csv" className="hidden" onChange={handleObCsvUpload} />
              <span className="text-xs text-gray-400 ml-1">{obRows.length} row{obRows.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-xl">
              {obRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-16">
                  <FileSpreadsheet className="h-10 w-10 text-gray-200" />
                  <p className="text-sm">Add templates using the button above or upload a CSV</p>
                </div>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 border-b border-gray-200 w-64">Template</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 border-b border-gray-200 w-32">Category</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 border-b border-gray-200 w-28">Recurrence</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 border-b border-gray-200 w-44">Deadline</th>
                      <th className="border-b border-gray-200 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {obRows.map((row, i) => {
                      const tmpl = templates.find(t => t.id === row.templateId);
                      return (
                        <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                          <td className="px-4 py-2 font-medium text-gray-800">{tmpl?.name ?? '—'}</td>
                          <td className="px-4 py-2 text-xs text-gray-500">
                            {tmpl ? (TEMPLATE_CATEGORY_LABELS[tmpl.category] ?? tmpl.category) : '—'}
                          </td>
                          <td className="px-4 py-2">
                            {tmpl?.recurrence_type ? (
                              <span className="flex items-center gap-1 text-xs text-gray-500">
                                <RefreshCw className="h-3 w-3" /> {tmpl.recurrence_type}
                              </span>
                            ) : (
                              <span className="text-xs text-gray-400">One-off</span>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            <input
                              type="date"
                              value={row.deadline}
                              onChange={e => setObDeadline(row.id, e.target.value)}
                              className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-40"
                            />
                          </td>
                          <td className="px-2 py-2 text-center">
                            <button onClick={() => removeObRow(row.id)} className="p-1 text-gray-300 hover:text-red-400 rounded">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── SCREEN 2b: Mass allocation configure ─────────────────────────── */}
        {step === 'configure' && mode === 'mass_allocation' && (
          <div className="flex-1 flex flex-col min-h-0 p-6 gap-4">

            {/* Template selector + legend note */}
            <div className="flex items-center gap-4 flex-wrap flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-700 flex-shrink-0">Template:</span>

                {/* Rich template picker */}
                <div ref={templatePickerRef} className="relative">
                  {/* Trigger */}
                  <button
                    onClick={() => { setTemplateSearch(''); setShowTemplatePicker(v => !v); }}
                    className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-1.5 bg-white transition-colors min-w-[260px] text-left ${
                      showTemplatePicker ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-gray-200 hover:border-indigo-400'
                    }`}
                  >
                    {selectedTemplate ? (
                      <>
                        <span className="flex-1 font-medium text-gray-900 truncate">{selectedTemplate.name}</span>
                        {selectedTemplate.recurrence_type && RECURRENCE_META[selectedTemplate.recurrence_type] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${RECURRENCE_META[selectedTemplate.recurrence_type].colour}`}>
                            {RECURRENCE_META[selectedTemplate.recurrence_type].label}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex-1 text-gray-400">— Select a template —</span>
                    )}
                    <ChevronRight className={`h-3.5 w-3.5 text-gray-400 flex-shrink-0 transition-transform ${showTemplatePicker ? 'rotate-90' : ''}`} />
                  </button>

                  {/* Dropdown panel */}
                  {showTemplatePicker && (
                    <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden flex flex-col" style={{ width: '420px', maxHeight: '480px' }}>
                      {/* Search */}
                      <div className="p-2.5 border-b border-gray-100 flex-shrink-0">
                        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg">
                          <Search className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                          <input
                            autoFocus
                            type="text"
                            value={templateSearch}
                            onChange={e => setTemplateSearch(e.target.value)}
                            placeholder="Search templates…"
                            className="flex-1 text-sm bg-transparent outline-none text-gray-800 placeholder-gray-400"
                          />
                        </div>
                      </div>

                      {/* Grouped list */}
                      <div className="overflow-y-auto flex-1">
                        {groupedMaTemplates.length === 0 ? (
                          <p className="text-xs text-center text-gray-400 py-8">No templates found</p>
                        ) : (
                          groupedMaTemplates.map(group => (
                            <div key={group.category}>
                              {/* Category header */}
                              <div className="flex items-center gap-2 px-3 pt-3 pb-1.5 sticky top-0 bg-white z-10">
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{group.label}</span>
                                <div className="flex-1 h-px bg-gray-100" />
                              </div>
                              {/* Template rows */}
                              {group.items.map(t => {
                                const rec = t.recurrence_type ? RECURRENCE_META[t.recurrence_type] : null;
                                const stepCount = (t.steps ?? []).filter(s => s.step_type !== 'start' && s.step_type !== 'end').length;
                                const isSelected = t.id === maTemplateId;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => { setMaTemplateId(t.id); setShowTemplatePicker(false); }}
                                    className={`w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors ${
                                      isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                                    }`}
                                  >
                                    {/* Selected indicator */}
                                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSelected ? 'bg-indigo-600' : 'bg-transparent'}`} />
                                    {/* Name */}
                                    <span className={`flex-1 text-sm truncate ${isSelected ? 'font-semibold text-indigo-700' : 'font-medium text-gray-800'}`}>
                                      {t.name}
                                    </span>
                                    {/* Badges */}
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {rec && (
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${rec.colour}`}>
                                          {rec.label}
                                        </span>
                                      )}
                                      {stepCount > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                                          {stepCount} step{stepCount !== 1 ? 's' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          ))
                        )}
                      </div>

                      {/* Footer count */}
                      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex-shrink-0">
                        <span className="text-xs text-gray-400">{templates.length} template{templates.length !== 1 ? 's' : ''} available</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {selectedTemplate && (
                <span className="flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-lg">
                  <Info className="h-3 w-3" /> Hover step column headers to see step details
                </span>
              )}
            </div>

            {/* Toolbar */}
            {selectedTemplate && (
              <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
                <button
                  onClick={addMaRow}
                  className="flex items-center gap-2 text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 font-medium"
                >
                  <Plus className="h-4 w-4" /> Add Row
                </button>
                {/* CSV download — split button with dropdown */}
                <div ref={csvMenuRef} className="relative">
                  <button
                    onClick={() => setShowCsvMenu(v => !v)}
                    className={`flex items-center gap-1.5 text-xs border px-2.5 py-1.5 rounded-lg transition-colors ${
                      showCsvMenu
                        ? 'border-indigo-400 text-indigo-700 bg-indigo-50'
                        : 'text-gray-600 border-gray-200 hover:border-indigo-400 hover:text-indigo-700'
                    }`}
                  >
                    <Download className="h-3.5 w-3.5" /> CSV Template
                    <ChevronRight className={`h-3 w-3 ml-0.5 transition-transform ${showCsvMenu ? 'rotate-90' : ''}`} />
                  </button>

                  {showCsvMenu && (
                    <div className="absolute top-full left-0 mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden w-64">
                      <button
                        onClick={() => { downloadMaCsvTemplate(); setShowCsvMenu(false); }}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <Download className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-800">Empty template</span>
                        </div>
                        <p className="text-xs text-gray-400 pl-5">Download blank CSV with column headers only</p>
                      </button>
                      <button
                        onClick={() => { downloadMaCurrentData(); setShowCsvMenu(false); }}
                        disabled={maRows.length === 0}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          <Download className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-800">Current data</span>
                          {maRows.length > 0 && (
                            <span className="ml-auto text-xs text-gray-400">{maRows.length} rows</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 pl-5">Export the table as it stands, including all entries</p>
                      </button>
                    </div>
                  )}
                </div>

                <button onClick={() => maCsvRef.current?.click()} className="flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 px-2.5 py-1.5 rounded-lg hover:border-indigo-400 hover:text-indigo-700 transition-colors">
                  <Upload className="h-3.5 w-3.5" /> Upload CSV
                </button>
                <input ref={maCsvRef} type="file" accept=".csv" className="hidden" onChange={handleMaCsvUpload} />
                <button
                  onClick={openClientSelect}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-100 hover:border-indigo-400 transition-colors"
                >
                  <Filter className="h-3.5 w-3.5" /> Client Select
                </button>
                <span className="text-xs text-gray-400">{maRows.length} row{maRows.length !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* ── Bulk-action bar (shown when rows are selected) ─────────────── */}
            {selectedRowIds.size > 0 && selectedTemplate && (
              <div className="flex items-center gap-3 flex-shrink-0 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5 flex-wrap">
                {/* Selection count */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-semibold text-indigo-700">
                    {selectedRowIds.size} of {maRows.length} selected
                  </span>
                  <button
                    onClick={() => setSelectedRowIds(new Set())}
                    className="text-xs text-indigo-500 hover:text-indigo-700 underline"
                  >
                    Clear
                  </button>
                </div>

                <div className="w-px h-5 bg-indigo-200 flex-shrink-0" />

                {/* Bulk deadline */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-xs text-indigo-600 font-medium">Deadline:</span>
                  <input
                    type="date"
                    value={bulkDeadline}
                    onChange={e => setBulkDeadline(e.target.value)}
                    className="text-xs border border-indigo-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 w-36"
                  />
                  <button
                    onClick={applyBulkDeadline}
                    disabled={!bulkDeadline}
                    className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium transition-colors"
                  >
                    Apply
                  </button>
                </div>

                <div className="w-px h-5 bg-indigo-200 flex-shrink-0" />

                {/* Bulk step assignee */}
                <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                  <span className="text-xs text-indigo-600 font-medium">Set step:</span>
                  <select
                    value={bulkStepKey}
                    onChange={e => setBulkStepKey(e.target.value)}
                    className="text-xs border border-indigo-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">— Step —</option>
                    {stepCols.map((s, i) => (
                      <option key={s.step_key} value={s.step_key}>Step {i + 1}: {s.title}</option>
                    ))}
                  </select>
                  <select
                    value={bulkAssignee}
                    onChange={e => setBulkAssignee(e.target.value)}
                    className="text-xs border border-indigo-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {assigneeOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={applyBulkStepAssignee}
                    disabled={!bulkStepKey}
                    className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 disabled:opacity-40 font-medium transition-colors"
                  >
                    Apply
                  </button>
                </div>

                <div className="w-px h-5 bg-indigo-200 flex-shrink-0" />

                {/* Delete selected */}
                <button
                  onClick={deleteSelectedRows}
                  className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete selected
                </button>
              </div>
            )}

            {/* Grid */}
            <div className="flex-1 min-h-0 overflow-auto border border-gray-200 rounded-xl">
              {!selectedTemplate ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-16">
                  <Building2 className="h-10 w-10 text-gray-200" />
                  <p className="text-sm">Select a template above to begin</p>
                </div>
              ) : maRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 gap-2 py-16">
                  <FileSpreadsheet className="h-10 w-10 text-gray-200" />
                  <p className="text-sm">Click <strong>Add Row</strong> or upload a CSV to add clients</p>
                </div>
              ) : (
                <table className="text-sm border-collapse" style={{ minWidth: `${500 + stepCols.length * 130}px` }}>
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      {/* Select-all checkbox */}
                      <th className="px-3 py-2.5 border-b border-gray-200 sticky left-0 bg-gray-50 z-20 w-10">
                        <input
                          type="checkbox"
                          checked={selectedRowIds.size === maRows.length && maRows.length > 0}
                          ref={el => {
                            if (el) el.indeterminate = selectedRowIds.size > 0 && selectedRowIds.size < maRows.length;
                          }}
                          onChange={toggleAllRowsSelection}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 border-b border-gray-200 sticky left-10 bg-gray-50 z-20 w-52">Client</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 border-b border-gray-200 w-28">Code</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 border-b border-gray-200 w-40">Deadline</th>
                      {stepCols.map((s, i) => (
                        <th
                          key={s.step_key}
                          className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 border-b border-gray-200 w-32"
                        >
                          <Tooltip label={s.title} side="top">
                            <span className="flex items-center gap-1 cursor-help">
                              Step {i + 1}
                              <Info className="h-3 w-3 text-gray-300 flex-shrink-0" />
                            </span>
                          </Tooltip>
                        </th>
                      ))}
                      <th className="border-b border-gray-200 w-10 sticky right-0 bg-gray-50" />
                    </tr>
                  </thead>
                  <tbody>
                    {maRows.map((row, ri) => {
                      const isSelected = selectedRowIds.has(row.id);
                      const rowBg = isSelected
                        ? 'bg-indigo-50'
                        : ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40';
                      return (
                        <tr key={row.id} className={`${rowBg} transition-colors`}>
                          {/* Row checkbox */}
                          <td className="px-3 py-1.5 sticky left-0 bg-inherit z-10">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRowSelection(row.id)}
                              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </td>
                          <td className="px-3 py-1.5 sticky left-10 bg-inherit z-10 border-r border-gray-100">
                            <ClientSearchInput
                              value={row.clientId}
                              valueName={row.clientName}
                              onChange={(id, name, ref) => setMaClient(row.id, id, name, ref)}
                              placeholder="— Select —"
                              className="w-full"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">{row.clientRef || '—'}</td>
                          <td className="px-3 py-1.5">
                            <input
                              type="date"
                              value={row.deadline}
                              onChange={e => setMaDeadline(row.id, e.target.value)}
                              className="text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-36"
                            />
                          </td>
                          {stepCols.map(s => (
                            <td key={s.step_key} className="px-3 py-1.5">
                              <select
                                value={row.stepAssignees[s.step_key] ?? ''}
                                onChange={e => setMaAssignee(row.id, s.step_key, e.target.value)}
                                className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full bg-white"
                              >
                                {assigneeOptions.map(o => (
                                  <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                              </select>
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center sticky right-0 bg-inherit">
                            <button onClick={() => removeMaRow(row.id)} className="p-1 text-gray-300 hover:text-red-400 rounded">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── SCREEN 3: Review ─────────────────────────────────────────────── */}
        {step === 'review' && (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Review & Confirm</h2>
                <p className="text-sm text-gray-500">Check the details below before creating tasks.</p>
              </div>

              {/* Summary card */}
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h3 className="text-sm font-semibold text-gray-700">
                    {mode === 'onboarding' ? 'Client Onboarding' : 'Mass Allocation'}
                  </h3>
                </div>
                <div className="p-4 space-y-3">
                  {mode === 'onboarding' && (
                    <>
                      <div className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-24 flex-shrink-0">Client</span>
                        <span className="font-semibold text-gray-900">{selectedClient?.name} ({selectedClient?.client_ref})</span>
                      </div>
                      <div className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-24 flex-shrink-0">Templates</span>
                        <span className="font-semibold text-gray-900">{obRows.length} task{obRows.length !== 1 ? 's' : ''} to create</span>
                      </div>
                      <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                        {obRows.map(row => {
                          const t = templates.find(t => t.id === row.templateId);
                          return (
                            <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                              <span className="font-medium text-gray-800">{t?.name}</span>
                              <span className="text-gray-400 text-xs">{row.deadline || 'No deadline'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {mode === 'mass_allocation' && (
                    <>
                      <div className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-24 flex-shrink-0">Template</span>
                        <span className="font-semibold text-gray-900">{selectedTemplate?.name}</span>
                      </div>
                      <div className="flex gap-3 text-sm">
                        <span className="text-gray-500 w-24 flex-shrink-0">Clients</span>
                        <span className="font-semibold text-gray-900">{maRows.length} task{maRows.length !== 1 ? 's' : ''} to create</span>
                      </div>
                      <div className="mt-3 divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
                        {maRows.map(row => {
                          const c = clients.find(c => c.id === row.clientId);
                          return (
                            <div key={row.id} className="flex items-center justify-between px-3 py-2 text-sm">
                              <span className="font-medium text-gray-800">{c?.name ?? '—'}</span>
                              <span className="text-gray-400 text-xs">{row.deadline || 'No deadline'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Create immediately toggle */}
              <div className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-800">
                      {createImmediately ? 'Create tasks immediately' : 'Save as drafts'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {createImmediately
                        ? 'Tasks will be created as active and visible to the team right away.'
                        : 'Tasks will be saved as drafts. Go to the Drafts tab to review and activate them.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setCreateImmediately(v => !v)}
                    className="flex-shrink-0 ml-4"
                  >
                    {createImmediately
                      ? <ToggleRight className="h-8 w-8 text-indigo-600" />
                      : <ToggleLeft className="h-8 w-8 text-gray-400" />
                    }
                  </button>
                </div>
                {!createImmediately && (
                  <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <Clock className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">
                      Draft tasks won't appear in team views until activated. Find them under <strong>Drafts</strong> in the sidebar.
                    </p>
                  </div>
                )}
              </div>

              {/* Submit button */}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating tasks…</>
                  : <><Zap className="h-4 w-4" /> Create {mode === 'onboarding' ? obRows.length : maRows.length} task{(mode === 'onboarding' ? obRows.length : maRows.length) !== 1 ? 's' : ''}</>
                }
              </button>
            </div>
          </div>
        )}

        {/* ── SCREEN 4: Results ────────────────────────────────────────────── */}
        {step === 'results' && (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="text-center">
                {successCount === results.length
                  ? <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
                  : <AlertCircle className="h-12 w-12 text-amber-500 mx-auto mb-3" />
                }
                <h2 className="text-lg font-bold text-gray-900">
                  {successCount === results.length ? 'All tasks created!' : `${successCount} of ${results.length} succeeded`}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {createImmediately
                    ? 'Tasks are now active and visible in the task views.'
                    : 'Draft tasks are saved — activate them from the Drafts tab.'}
                </p>
              </div>

              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    {r.success
                      ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      : <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
                    }
                    <span className="text-sm font-medium text-gray-800 flex-1">{r.label}</span>
                    {r.error && <span className="text-xs text-red-500">{r.error}</span>}
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => { onComplete(); onClose(); }}
                  className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl font-semibold hover:bg-indigo-700 transition-colors text-sm"
                >
                  View Tasks
                </button>
                <button
                  onClick={() => { if (successCount > 0) onComplete(); else onClose(); }}
                  className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-semibold hover:bg-gray-200 transition-colors text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Client Select panel ─────────────────────────────────────────────── */}
      {showClientSelect && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold text-gray-900">Select Clients</h2>
                <p className="text-xs text-gray-500 mt-0.5">Filter then pick the clients to add to the allocation</p>
              </div>
              <button onClick={() => setShowClientSelect(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Filters */}
            <div className="px-5 py-3 border-b border-gray-100 flex-shrink-0 space-y-2.5">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  autoFocus
                  value={csSearch}
                  onChange={e => setCsSearch(e.target.value)}
                  placeholder="Search by name or code…"
                  className="w-full text-sm pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {/* Status pills */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 mr-1">Status:</span>
                <button
                  onClick={() => setCsStatusFilter('')}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${!csStatusFilter ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                >All</button>
                {Object.entries(CLIENT_STATUS_LABELS).map(([val, { label, colour }]) => (
                  <button
                    key={val}
                    onClick={() => setCsStatusFilter(csStatusFilter === val ? '' : val)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${csStatusFilter === val ? `${colour} border-current` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                  >{label}</button>
                ))}
              </div>
              {/* Type pills */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-500 mr-1">Type:</span>
                <button
                  onClick={() => setCsTypeFilter('')}
                  className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${!csTypeFilter ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                >All</button>
                {Object.entries(CLIENT_TYPE_LABELS).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setCsTypeFilter(csTypeFilter === val ? '' : val)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors ${csTypeFilter === val ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
                  >{label}</button>
                ))}
              </div>
            </div>

            {/* Select all row */}
            <div className="px-5 py-2.5 border-b border-gray-100 bg-gray-50 flex-shrink-0 flex items-center justify-between">
              {(() => {
                const eligible = csClients.filter(c => !maExistingClientIds.has(c.id));
                const allSel = eligible.length > 0 && eligible.every(c => csSelected.has(c.id));
                const someSel = eligible.some(c => csSelected.has(c.id));
                return (
                  <button
                    onClick={toggleCsSelectAll}
                    className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-700 transition-colors"
                  >
                    {allSel
                      ? <CheckSquare className="h-4 w-4 text-indigo-600" />
                      : someSel
                        ? <CheckSquare className="h-4 w-4 text-indigo-400" />
                        : <Square className="h-4 w-4 text-gray-400" />
                    }
                    Select all filtered ({eligible.length} eligible)
                  </button>
                );
              })()}
              <span className="text-xs text-indigo-600 font-semibold">
                {csSelected.size > 0 ? `${csSelected.size} selected` : ''}
              </span>
            </div>

            {/* Client list */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {csLoading ? (
                <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Loading clients…</span>
                </div>
              ) : csClients.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Users className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No clients match the current filters</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {csClients.map(c => {
                    const alreadyAdded = maExistingClientIds.has(c.id);
                    const isSelected   = csSelected.has(c.id);
                    const typeLabel    = c.business_type ? (CLIENT_TYPE_LABELS[c.business_type] ?? c.business_type) : null;
                    const statusMeta   = c.status ? CLIENT_STATUS_LABELS[c.status] : null;
                    return (
                      <div
                        key={c.id}
                        onClick={() => !alreadyAdded && toggleCsClient(c.id)}
                        className={`flex items-center gap-3 px-5 py-2.5 transition-colors select-none ${
                          alreadyAdded
                            ? 'opacity-40 cursor-not-allowed bg-gray-50'
                            : isSelected
                              ? 'bg-indigo-50 cursor-pointer'
                              : 'cursor-pointer hover:bg-gray-50'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className="flex-shrink-0">
                          {alreadyAdded
                            ? <CheckSquare className="h-4 w-4 text-gray-400" />
                            : isSelected
                              ? <CheckSquare className="h-4 w-4 text-indigo-600" />
                              : <Square className="h-4 w-4 text-gray-300" />
                          }
                        </div>
                        {/* Client info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 truncate">{c.name}</span>
                            <span className="text-xs text-gray-400 flex-shrink-0">{c.client_ref}</span>
                          </div>
                          {(typeLabel || statusMeta) && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {typeLabel && (
                                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{typeLabel}</span>
                              )}
                              {statusMeta && (
                                <span className={`text-xs px-1.5 py-0.5 rounded border ${statusMeta.colour}`}>{statusMeta.label}</span>
                              )}
                            </div>
                          )}
                        </div>
                        {alreadyAdded && (
                          <span className="text-xs text-gray-400 flex-shrink-0 italic">Already added</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="flex items-center justify-between px-5 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
              <button
                onClick={() => setShowClientSelect(false)}
                className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleClientSelectConfirm}
                disabled={csSelected.size === 0}
                className="flex items-center gap-2 bg-indigo-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add {csSelected.size > 0 ? csSelected.size : ''} client{csSelected.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer nav ──────────────────────────────────────────────────────── */}
      {(step === 'configure' || step === 'review') && (
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 flex-shrink-0 bg-gray-50">
          <button
            onClick={handleBack}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            ← Back
          </button>
          <div className="flex items-center gap-3">
            {configError && (
              <span className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertCircle className="h-3.5 w-3.5" /> {configError}
              </span>
            )}
            {step === 'configure' && (
              <button
                onClick={handleContinue}
                className="flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition-colors text-sm"
              >
                Continue <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
