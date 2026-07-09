'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Landmark, Sparkles, MessagesSquare, ChevronLeft, ArrowLeft, Plus, ArrowRight, Clock3,
  Building2, ScrollText, ShieldCheck, PanelRightClose, PanelRightOpen,
  Loader2, Check, CloudOff, Search as SearchIcon, Mail, Lock,
} from 'lucide-react';
import ToolLayout from '@/components/ui/ToolLayout';
import ClientSelector, { type SelectedClient } from '@/components/ui/ClientSelector';
import ClientEmailLink from '@/components/features/email/ClientEmailLink';
import { canAccessAccountsStudio } from '@/lib/accounts-studio/access';
import HistoryView from './HistoryView';
import Stepper from './Stepper';
import AssistantPanel from './AssistantPanel';
import { StudioCard } from './primitives';
import StageImport from './stages/StageImport';
import StagePreparation from './stages/StagePreparation';
import StageDisclosures from './stages/StageDisclosures';
import StageFinalReview from './stages/StageFinalReview';
import StagePublish from './stages/StagePublish';
import { STAGES, ENTITY_LABELS, buildEngagement, entityFromBusinessType } from './data';
import { createEngagement, saveEngagement } from './persistence';
import { lookupCompany, applyCompany, lookupMessage, type StudioCompany } from './companyLookup';
import type { Engagement, StageId, EntityType } from './types';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const ALL_STAGES: StageId[] = ['import', 'preparation', 'disclosures', 'final-review', 'publish'];
const ENTITY_CHOICES: EntityType[] = ['limited_company', 'sole_trader', 'partnership', 'llp', 'cic', 'charity', 'trust', 'dormant_company'];

export default function AccountsStudioModule({ userEmail }: { userEmail: string | null }) {
  const allowed = canAccessAccountsStudio(userEmail);
  const [view, setView] = useState<'history' | 'new'>('history');
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [stage, setStage] = useState<StageId>('import');
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Autosave plumbing. `lastSaved` holds the JSON we last persisted (or loaded)
  // so we don't re-save an untouched engagement — e.g. right after opening one.
  const lastSaved = useRef<string>('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave whenever the engagement changes and differs from what's
  // stored. Skips engagements without a persisted id (shouldn't happen — every
  // engagement is created server-side before it opens).
  useEffect(() => {
    if (!engagement) return;
    const snapshot = JSON.stringify(engagement);
    if (snapshot === lastSaved.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      const toSave = engagement;
      saveEngagement(toSave)
        .then(() => { lastSaved.current = snapshot; setSaveState('saved'); })
        .catch(() => setSaveState('error'));
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [engagement]);

  // ── Preview gate ────────────────────────────────────────────────────────────
  if (!allowed) return <ComingSoon />;

  function patch(updater: (e: Engagement) => Engagement) {
    setEngagement(prev => (prev ? updater(prev) : prev));
  }

  function openEngagement(e: Engagement) {
    lastSaved.current = JSON.stringify(e); // freshly loaded — nothing to save yet
    setSaveState('idle');
    setEngagement(e);
    // Land on the stage the user was last working in: the active stage, else the
    // first incomplete stage, else the final stage (published / all-complete).
    const active =
      ALL_STAGES.find(s => e.stageStatus[s] === 'active')
      ?? (e.published ? 'publish' : ALL_STAGES.find(s => e.stageStatus[s] !== 'complete') ?? 'publish');
    setStage(active);
    setAssistantOpen(active !== 'disclosures');
  }

  /** Create the engagement server-side, then open it. */
  async function startNewEngagement(built: Engagement) {
    const created = await createEngagement(built);
    openEngagement(created);
  }

  async function closeEngagement() {
    // Flush any unsaved edits so the history list reflects the latest state.
    if (engagement && JSON.stringify(engagement) !== lastSaved.current) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      try { await saveEngagement(engagement); } catch { /* leave draft; user can retry */ }
    }
    setEngagement(null);
    setView('history');
  }

  function goToStage(id: StageId) {
    setStage(id);
  }

  function advanceFrom(id: StageId) {
    const idx = ALL_STAGES.indexOf(id);
    const next = ALL_STAGES[idx + 1];
    patch(e => {
      const status = { ...e.stageStatus, [id]: 'complete' as const };
      if (next) status[next] = 'active';
      return { ...e, stageStatus: status };
    });
    if (next) {
      setStage(next);
      if (next === 'disclosures') setAssistantOpen(false);
    }
  }

  // ── History + New (no active engagement) ─────────────────────────────────────
  if (!engagement) {
    if (view === 'new') {
      return (
        <ToolLayout
          title="Accounts Studio"
          description="Produce a new set of statutory accounts."
          icon={Landmark}
          iconColor="#6366F1"
          wide
        >
          <NewAccounts onStart={startNewEngagement} onBack={() => setView('history')} />
        </ToolLayout>
      );
    }
    return <HistoryView onNew={() => setView('new')} onOpen={openEngagement} />;
  }

  // ── Workflow shell ───────────────────────────────────────────────────────────
  const stageMeta = STAGES.find(s => s.id === stage)!;

  return (
    <ToolLayout
      title="Accounts Studio"
      description="Statutory accounts production."
      icon={Landmark}
      iconColor="#6366F1"
      wide
      headerRight={
        <div className="flex items-center gap-2">
          <SaveIndicator state={saveState} />
          <button onClick={() => setAssistantOpen(v => !v)} className="btn-secondary">
            {assistantOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Assistant
          </button>
        </div>
      }
    >
      {/* Back to history — standard app style */}
      <button
        onClick={closeEngagement}
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] drop-shadow-sm transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={13} /> Back to history
      </button>

      {/* Submitted — read-only lock */}
      {engagement.approvalStatus === 'submitted' && (
        <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-emerald-200/70 bg-emerald-50/70 px-4 py-2.5 text-[12.5px] text-emerald-800">
          <Lock size={14} className="shrink-0" />
          <span className="flex-1">Submitted to Companies House — these accounts are view-only. To prepare amended accounts, use <span className="font-semibold">Copy</span> on the history list.</span>
        </div>
      )}

      {/* Company header */}
      <CompanyHeader engagement={engagement} patch={patch} />

      {/* Stepper */}
      <div className="mb-4 mt-4 rounded-[18px] border border-white/60 bg-white/60 px-3 py-2 backdrop-blur-md">
        <Stepper engagement={engagement} current={stage} onSelect={goToStage} />
      </div>

      {/* Stage title */}
      <div className="mb-4 flex items-baseline gap-2">
        <h3 className="text-[17px] font-bold text-[var(--text-primary)]">{stageMeta.label}</h3>
        <p className="text-[13px] text-[var(--text-muted)]">{stageMeta.blurb}</p>
      </div>

      {/* Stage + assistant */}
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          {stage === 'import' && <StageImport engagement={engagement} patch={patch} advance={() => advanceFrom('import')} />}
          {stage === 'preparation' && <StagePreparation engagement={engagement} patch={patch} advance={() => advanceFrom('preparation')} readOnly={engagement.approvalStatus === 'submitted'} />}
          {stage === 'disclosures' && <StageDisclosures engagement={engagement} patch={patch} advance={() => advanceFrom('disclosures')} readOnly={engagement.approvalStatus === 'submitted'} />}
          {stage === 'final-review' && <StageFinalReview engagement={engagement} advance={() => advanceFrom('final-review')} />}
          {stage === 'publish' && <StagePublish engagement={engagement} patch={patch} />}
        </div>
        {assistantOpen && (
          <div className="hidden w-[340px] shrink-0 xl:block" style={{ height: 'calc(100vh - 240px)' }}>
            <AssistantPanel engagement={engagement} />
          </div>
        )}
      </div>
    </ToolLayout>
  );
}

// ─── Autosave indicator ────────────────────────────────────────────────────────
function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<Exclude<SaveState, 'idle'>, { icon: React.ReactNode; text: string; cls: string }> = {
    saving: { icon: <Loader2 size={12} className="animate-spin" />, text: 'Saving…',  cls: 'text-[var(--text-muted)]' },
    saved:  { icon: <Check size={12} />,                            text: 'Saved',     cls: 'text-emerald-600' },
    error:  { icon: <CloudOff size={12} />,                         text: 'Not saved', cls: 'text-red-600' },
  };
  const m = map[state];
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.cls}`}>{m.icon}{m.text}</span>;
}

// ─── Company header card ───────────────────────────────────────────────────────
function CompanyHeader({ engagement: e, patch }: { engagement: Engagement; patch: (u: (e: Engagement) => Engagement) => void }) {
  const initials = e.companyName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <StudioCard className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent)]/10 text-[15px] font-bold text-[var(--accent)]">{initials}</div>
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-[var(--text-primary)]">{e.companyName}</h3>
          <p className="text-[12px] text-[var(--text-muted)]">{e.periodEnd ? `Year ending ${e.periodEnd}` : 'Year end set on import'}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-2">
          <HeaderField label="Entity" value={ENTITY_LABELS[e.entityType]} />
          <HeaderField label="Framework" value={e.framework} />
          <HeaderField label="Company no." value={e.companyNumber} />
          <HeaderField label="Client ref" value={e.clientRef ?? '—'} />
          <ClientEmailField engagement={e} />
          <HeaderField label="Prepared by" value={e.preparedBy} />
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">Status</p>
            <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ${e.published ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--accent)]/10 text-[var(--accent)]'}`}>
              {e.published ? 'Published' : 'In progress'}
            </span>
          </div>
          <ChLinkButton engagement={e} patch={patch} />
        </div>
      </div>
    </StudioCard>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
      <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{value || '—'}</p>
    </div>
  );
}

// Client email — fetched from the client record (not stored on the engagement).
// Renders the shared ClientEmailLink: opens the Email Triage compose window with
// the client pre-filled + allocated when triage is on, or a mailto: fallback.
function ClientEmailField({ engagement: e }: { engagement: Engagement }) {
  const [email, setEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!e.clientId) { setEmail(null); setLoaded(true); return; }
    setLoaded(false);
    fetch(`/api/clients/${e.clientId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) { setEmail(d?.client?.contact_email ?? null); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [e.clientId]);

  return (
    <div className="min-w-0 max-w-[220px]">
      <p className="text-[10.5px] uppercase tracking-wide text-[var(--text-muted)]">Client email</p>
      {email && e.clientId ? (
        <ClientEmailLink
          email={email}
          client={{ id: e.clientId, name: e.companyName, client_ref: e.clientRef, contact_email: email }}
          className="flex max-w-full items-center gap-1 text-[13px] font-semibold text-[var(--accent)] hover:underline"
        >
          <Mail size={12} className="shrink-0" />
          <span className="truncate">{email}</span>
        </ClientEmailLink>
      ) : (
        <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{loaded ? '—' : '…'}</p>
      )}
    </div>
  );
}

// ─── Companies House lookup (header) ────────────────────────────────────────────
function ChLinkButton({ engagement: e, patch }: { engagement: Engagement; patch: (u: (e: Engagement) => Engagement) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const res = await lookupCompany({ clientId: e.clientId });
    if (res.found) {
      patch(prev => applyCompany(prev, res.company));
      setMsg(`Linked ${res.company.companyNumber}`);
    } else {
      setMsg(lookupMessage(res.reason));
    }
    setBusy(false);
    setTimeout(() => setMsg(null), 4000);
  }

  return (
    <div className="relative">
      <button onClick={run} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-nav-hover)] disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <SearchIcon size={13} />}
        {e.chLinked ? 'Refresh CH' : 'Companies House'}
      </button>
      {msg && (
        <span className="absolute right-0 top-full mt-1 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10.5px] font-medium text-white shadow-lg">{msg}</span>
      )}
    </div>
  );
}

// ─── New accounts setup (mirrors the Performance "Business Details" step) ─────────
function NewAccounts({ onStart, onBack }: { onStart: (e: Engagement) => Promise<void>; onBack: () => void }) {
  const [client, setClient] = useState<SelectedClient | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [entity, setEntity] = useState<EntityType>('limited_company');
  const [nameEdited, setNameEdited] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Companies House lookup during setup.
  const [ch, setCh] = useState<StudioCompany | null>(null);
  const [chBusy, setChBusy] = useState(false);
  const [chMsg, setChMsg] = useState('');
  const [chNumber, setChNumber] = useState('');

  function applyCh(c: StudioCompany) {
    setCh(c);
    setEntity(c.entityType as EntityType);
    if (!nameEdited && c.companyName) setCompanyName(c.companyName);
  }

  async function runLookup(params: { clientId?: string | null; number?: string }) {
    setChBusy(true); setChMsg('');
    const res = await lookupCompany(params);
    if (res.found) applyCh(res.company);
    else { setCh(null); setChMsg(lookupMessage(res.reason)); }
    setChBusy(false);
  }

  function selectClient(c: SelectedClient | null) {
    setClient(c);
    setCh(null); setChMsg(''); setChNumber('');
    if (c) {
      if (!nameEdited) setCompanyName(c.name);
      setEntity(entityFromBusinessType(c.business_type));
      void runLookup({ clientId: c.id }); // auto-lookup from the client's CH number
    }
  }

  const canStart = !!client && !creating;

  async function startNew() {
    if (!client) return;
    setCreating(true); setError('');
    try {
      await onStart(buildEngagement({
        clientId: client.id,
        clientRef: client.client_ref,
        companyName: (companyName.trim() || client.name),
        entityType: entity,
        companyNumber: ch?.companyNumber,
        registeredOffice: ch?.registeredOffice ?? null,
        incorporationDate: ch?.incorporationDate ?? null,
        sicCodes: ch?.sicCodes,
        directors: ch?.directors,
        accountsDue: ch?.accountsNextDue ?? undefined,
        chDeadline: ch?.accountsNextDue ?? undefined,
        chLinked: !!ch,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the engagement.');
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] drop-shadow-sm transition-colors hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={13} /> Back to history
      </button>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* Form card */}
        <div className="space-y-4 rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
          <div>
            <h3 className="text-base font-bold text-[var(--text-primary)]">Company details</h3>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">Choose the client and confirm how the accounts should be prepared.</p>
          </div>

          <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                Client <span className="text-red-500">*</span>
              </label>
              <ClientSelector value={client} onSelect={selectClient} align="left" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                Company name <span className="text-red-500">*</span>
              </label>
              <input
                value={companyName}
                onChange={e => { setCompanyName(e.target.value); setNameEdited(true); }}
                placeholder={client ? 'Company name' : 'Select a client first'}
                disabled={!client}
                className="input-base py-1.5 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                Entity type <span className="text-red-500">*</span>
              </label>
              <select
                value={entity}
                onChange={e => setEntity(e.target.value as EntityType)}
                className="input-base py-1.5 text-sm"
              >
                {ENTITY_CHOICES.map(et => (
                  <option key={et} value={et}>{ENTITY_LABELS[et]}</option>
                ))}
              </select>
              {client && (
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">Auto-detected from the client record — change if needed.</p>
              )}
            </div>
          </div>

          {/* Companies House */}
          {client && (
            <div className="rounded-xl border border-[var(--border)] bg-white/60 p-3">
              <div className="flex items-center gap-2">
                <Landmark size={14} className="text-[var(--accent)]" />
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">Companies House</p>
                {chBusy && <Loader2 size={13} className="animate-spin text-[var(--text-muted)]" />}
              </div>
              {ch ? (
                <div className="mt-2 space-y-1 text-[12px] text-[var(--text-secondary)]">
                  <p><span className="font-semibold text-[var(--text-primary)]">{ch.companyNumber}</span> · {ch.status || '—'}{ch.incorporationDate ? ` · incorporated ${ch.incorporationDate}` : ''}</p>
                  {ch.registeredOffice && <p className="text-[11.5px] text-[var(--text-muted)]">{ch.registeredOffice}</p>}
                  {ch.directors.length > 0 && <p className="text-[11.5px] text-[var(--text-muted)]">Directors: {ch.directors.join(', ')}</p>}
                </div>
              ) : (
                <div className="mt-2">
                  {chMsg && <p className="mb-2 text-[11.5px] text-amber-700">{chMsg}</p>}
                  <div className="flex items-center gap-2">
                    <input
                      value={chNumber}
                      onChange={e => setChNumber(e.target.value)}
                      placeholder="Company number"
                      className="input-base py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => chNumber.trim() && runLookup({ number: chNumber.trim() })}
                      disabled={chBusy || !chNumber.trim()}
                      className="btn-secondary shrink-0 disabled:opacity-50"
                    >
                      <SearchIcon size={13} /> Look up
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!canStart && (
            <p className="text-[11.5px] text-[var(--text-muted)]">Select a client to continue.</p>
          )}
        </div>

        {/* What happens next + how it fits */}
        <div className="space-y-5">
          <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
            <h3 className="flex items-center gap-1.5 text-base font-bold text-[var(--text-primary)]">
              <Clock3 size={15} className="text-[var(--accent)]" /> What happens next
            </h3>
            <div className="mt-4 space-y-3.5">
              {['Import the ledger or trial balance', 'SMITH prepares the statutory accounts', 'Validate the numbers in Accounts Review', 'Finalise notes & disclosures', 'Compliance check, then approve & file'].map((t, i) => (
                <div key={t} className="flex gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-light)] text-[11px] font-bold text-[var(--accent)]">{i + 1}</div>
                  <p className="pt-0.5 text-[12.5px] text-[var(--text-secondary)]">{t}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white/[0.78] p-5 backdrop-blur-md">
            <h3 className="mb-2 text-base font-bold text-[var(--text-primary)]">How it fits together</h3>
            <ul className="space-y-2.5 text-[12px] text-[var(--text-secondary)]">
              {[
                { icon: Building2, text: 'Capture & Bookkeeping organise the ledger' },
                { icon: ShieldCheck, text: 'Accounts Review validates the numbers' },
                { icon: Landmark, text: 'Accounts Studio produces the statutory accounts' },
                { icon: ScrollText, text: 'Corporation Tax & Performance take it from here' },
              ].map(i => (
                <li key={i.text} className="flex items-center gap-2.5">
                  <i.icon size={15} className="shrink-0 text-[var(--accent)]" /> {i.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-right text-[12px] font-medium text-red-600">{error}</p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="btn-secondary bg-white text-[var(--text-primary)]">
          <ChevronLeft size={14} /> Back
        </button>
        <button onClick={startNew} disabled={!canStart} className="btn-primary disabled:opacity-40">
          {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {creating ? 'Starting…' : 'Start accounts production'}
          {!creating && <ArrowRight size={15} />}
        </button>
      </div>
    </div>
  );
}

// ─── Preview "coming soon" gate ─────────────────────────────────────────────────
function ComingSoon() {
  return (
    <ToolLayout title="Accounts Studio" description="Statutory accounts production for accountancy firms." icon={Landmark} iconColor="#6366F1">
      <div className="mx-auto mt-6 max-w-lg">
        <div className="overflow-hidden rounded-[24px] border border-white/60 bg-white/70 text-center shadow-[0_8px_32px_rgba(31,38,88,0.10)] backdrop-blur-md">
          <div className="relative flex flex-col items-center gap-3 px-8 py-10"
            style={{ background: 'linear-gradient(140deg,#4F46E5 0%,#7C3AED 55%,#9333EA 100%)' }}>
            <div className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/20 backdrop-blur"><Landmark size={28} className="text-white" /></div>
            <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">Coming soon</span>
            <h2 className="text-xl font-bold text-white">Accounts Studio is almost here</h2>
            <p className="max-w-sm text-[13px] text-white/80">Statutory accounts production, AI-first. SMITH prepares compliant financial statements from your bookkeeping — you review, approve and file.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 px-8 py-7 sm:grid-cols-3">
            {[
              { icon: Sparkles, label: 'AI-prepared', sub: 'Statements built for you' },
              { icon: ShieldCheck, label: 'Compliance-checked', sub: 'Companies House & iXBRL' },
              { icon: MessagesSquare, label: 'Disclosure assistant', sub: 'FRS 102 wording on tap' },
            ].map(f => (
              <div key={f.label} className="flex flex-col items-center gap-1.5 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent)]/10 text-[var(--accent)]"><f.icon size={18} /></div>
                <p className="text-[12.5px] font-semibold text-[var(--text-primary)]">{f.label}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{f.sub}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-black/5 px-8 py-4">
            <p className="text-[12px] text-[var(--text-muted)]">We&apos;re polishing it now — it&apos;ll appear here for your firm shortly.</p>
          </div>
        </div>
      </div>
    </ToolLayout>
  );
}
