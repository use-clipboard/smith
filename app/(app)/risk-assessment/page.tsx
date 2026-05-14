'use client';
import { useState, useCallback, useEffect } from 'react';
import ProcessingView from '@/components/ui/ProcessingView';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient, peekPendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import { ShieldAlert, Download, ArrowLeft } from 'lucide-react';
import type { RiskAssessmentReport } from '@/types';
import { generateRiskReportHtml } from '@/utils/riskAssessmentReport';
import RiskAssessmentHistory, { type RiskAssessmentSeed } from '@/components/features/risk-assessment/RiskAssessmentHistory';

type AppState = 'idle' | 'loading' | 'success' | 'error';

const RISK_QUESTIONS = [
  { category: 'Client Identity & Background', questions: [
    { id: 'q1', text: 'Is the client a Politically Exposed Person (PEP) or closely associated with one?' },
    { id: 'q2', text: 'Does the client operate in or have significant ties to a high-risk or sanctioned jurisdiction?' },
    { id: 'q3', text: 'Is the ultimate beneficial ownership of the client complex or difficult to determine?' },
    { id: 'q4', text: 'Has the client been subject to any regulatory investigations or sanctions?' },
  ]},
  { category: 'Business Activities', questions: [
    { id: 'q5', text: 'Does the client operate a cash-intensive business (e.g., retail, hospitality, money services)?' },
    { id: 'q6', text: 'Does the client deal in high-value goods or assets (e.g., property, art, precious metals)?' },
    { id: 'q7', text: 'Are there unusual or complex transactions that lack clear commercial rationale?' },
    { id: 'q8', text: 'Does the client have a high volume of third-party payments or unusual payment methods?' },
  ]},
  { category: 'Geographic Risk', questions: [
    { id: 'q9', text: 'Does the client have business operations in countries with weak AML controls?' },
    { id: 'q10', text: 'Are there frequent cross-border transactions to high-risk jurisdictions?' },
  ]},
  { category: 'Relationship & Conduct', questions: [
    { id: 'q11', text: 'Has the client been reluctant to provide required identification or documentation?' },
    { id: 'q12', text: 'Is there anything unusual about how the client was introduced to the firm?' },
    { id: 'q13', text: 'Does the client request unusual levels of confidentiality?' },
  ]},
];


// ── Page wrapper: history dashboard or tool ─────────────────────────────────
export default function RiskAssessmentPage() {
  // Skip the history view when arriving via a Quick Launch pill (pending client present).
  const [view, setView] = useState<'history' | 'tool'>(
    () => peekPendingClient('/risk-assessment') ? 'tool' : 'history',
  );
  const [seed, setSeed] = useState<RiskAssessmentSeed | null>(null);
  const [me, setMe]     = useState<{ userId: string; userRole: 'admin' | 'staff' }>({ userId: '', userRole: 'staff' });

  useEffect(() => {
    fetch('/api/users/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setMe({ userId: d.userId ?? '', userRole: d.userRole === 'admin' ? 'admin' : 'staff' }); })
      .catch(() => {/* ignore */});
  }, []);

  // Subsequent pill clicks while the tab is already open
  useEffect(() => {
    function onPending(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/risk-assessment') return;
      setSeed(null);
      setView('tool');
    }
    window.addEventListener('smith:pending-client', onPending);
    return () => window.removeEventListener('smith:pending-client', onPending);
  }, []);

  return view === 'history' ? (
    <RiskAssessmentHistory
      currentUserId={me.userId}
      isAdmin={me.userRole === 'admin'}
      onNew={() => { setSeed(null); setView('tool'); }}
      onOpen={s => { setSeed(s); setView('tool'); }}
    />
  ) : (
    <RiskAssessmentTool seed={seed} onBack={() => { setSeed(null); setView('history'); }} />
  );
}

function BackToHistory({ onBack }: { onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="inline-flex items-center gap-1.5 mb-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
    >
      <ArrowLeft size={13} />
      Back to history
    </button>
  );
}

function RiskAssessmentTool({ seed, onBack }: { seed: RiskAssessmentSeed | null; onBack: () => void }) {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/risk-assessment', appState);
  const [error, setError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [raUsersName, setRaUsersName] = useState('');
  const [raClientName, setRaClientName] = useState('');
  const [raClientCode, setRaClientCode] = useState('');

  // ── Seed loader: when opened from history dashboard, hydrate the success view
  useEffect(() => {
    if (!seed) return;
    if (seed.client) {
      setSelectedClient({
        id: seed.client.id,
        name: seed.client.name,
        client_ref: seed.client.client_ref,
        business_type: seed.client.business_type ?? null,
        vat_number: seed.client.vat_number ?? null,
        status: 'active',
      });
    }
    setRaUsersName(seed.raUsersName ?? '');
    setRaClientName(seed.raClientName ?? '');
    setRaClientCode(seed.raClientCode ?? '');
    setRaClientType(seed.raClientType ?? '');
    setAnswers(seed.answers ?? {});
    setReport(seed.report);
    setAppState('success');
    // run only on first seed change — subsequent edits to seed shouldn't override user changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Quick Launch: pre-fill client from client detail page ──────────────────
  useEffect(() => {
    const pending = consumePendingClient('/risk-assessment');
    if (pending) { setSelectedClient(pending); return; }
    function handle(e: Event) {
      if ((e as CustomEvent<{ route: string }>).detail.route !== '/risk-assessment') return;
      const p = consumePendingClient('/risk-assessment');
      if (p) setSelectedClient(p);
    }
    window.addEventListener('smith:pending-client', handle);
    return () => window.removeEventListener('smith:pending-client', handle);
  }, []);
  const [raClientType, setRaClientType] = useState('');
  const [answers, setAnswers] = useState<Record<string, { answer: boolean; comment: string }>>({});
  const [report, setReport] = useState<RiskAssessmentReport | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  useEffect(() => {
    if (!selectedClient) return;
    if (selectedClient.name) setRaClientName(selectedClient.name);
    if (selectedClient.client_ref) setRaClientCode(selectedClient.client_ref);
    if (selectedClient.business_type) {
      const typeMap: Record<string, string> = {
        limited_company: 'limited_company',
        llp: 'llp',
        trust: 'trust',
        charity: 'charity',
        sole_trader: 'individual',
        partnership: 'individual',
      };
      const mapped = typeMap[selectedClient.business_type];
      if (mapped) setRaClientType(mapped);
    }
  }, [selectedClient]);

  const canProcess = !!(raUsersName && raClientName && raClientType);
  const handleAnswer = (id: string, answer: boolean) => setAnswers(a => ({ ...a, [id]: { answer, comment: a[id]?.comment || '' } }));
  const handleComment = (id: string, comment: string) => setAnswers(a => ({ ...a, [id]: { answer: a[id]?.answer ?? false, comment } }));

  const handleProcess = useCallback(async () => {
    if (!canProcess) return;
    setAppState('loading'); setError(null);
    const allQuestions = RISK_QUESTIONS.flatMap(c => c.questions);
    const answersText = Object.entries(answers).map(([key, value]) => {
      const q = allQuestions.find(q => q.id === key)?.text || key;
      return `- Question ID: ${key}\n  Question: "${q}"\n  Answer: ${value.answer ? 'Yes' : 'No'}\n  Comment: "${value.comment || 'None'}"`;
    }).join('\n');
    try {
      const res = await fetch('/api/risk-assessment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ raUsersName, raClientName, raClientCode, raClientType, answersText, clientId: selectedClient?.id ?? null }) });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const data = await res.json();
      setReport(data); setAppState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error'); setAppState('error');
    }
  }, [canProcess, raUsersName, raClientName, raClientCode, raClientType, answers, selectedClient?.id]);

  const riskStyles = {
    High: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-900/40',
    Medium: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900/40',
    Low: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/20 dark:text-green-400 dark:border-green-900/40',
  };
  const riskStyle = report?.overallRiskLevel ? riskStyles[report.overallRiskLevel as keyof typeof riskStyles] : '';

  const reportHtml = report ? generateRiskReportHtml(raClientName, raClientCode, raUsersName, report) : '';
  const reportFileName = `AML_Risk_Assessment_${raClientName.replace(/\s+/g, '_') || 'Report'}`;

  if (appState === 'loading') return (
    <ProcessingView
      title="Generating Risk Report"
      steps={['Processing questionnaire', 'Assessing risk factors', 'Evaluating AML controls', 'Generating recommendations', 'Compiling report']}
    />
  );
  if (appState === 'error') return (
    <ToolLayout title="Risk Assessment" icon={ShieldAlert} iconColor="#DC2626">
      <BackToHistory onBack={onBack} />
      <ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} />
    </ToolLayout>
  );

  // Persist a snapshot of the current assessment to outputs history.
  const persistRunToHistory = (currentClient: SelectedClient | null) => {
    if (!report) return;
    fetch('/api/outputs/risk-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClient?.id ?? null,
        clientName: currentClient?.name ?? raClientName ?? null,
        clientCode: currentClient?.client_ref ?? raClientCode ?? null,
        raUsersName,
        raClientName,
        raClientCode,
        raClientType,
        answers,
        report,
      }),
    }).catch(err => console.error('[RiskAssessment] history save failed:', err));
  };

  return (
    <ToolLayout title="Risk Assessment" description="Conduct an AML client risk assessment and produce a risk report." icon={ShieldAlert} iconColor="#DC2626">
      <BackToHistory onBack={onBack} />
      {appState === 'idle' && (
        <div className="space-y-5">
          <div className="glass-solid rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Assessment Details</h3>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-[var(--text-secondary)]">Client</span>
              <ClientSelector value={selectedClient} onSelect={setSelectedClient} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <input value={raUsersName} onChange={e => setRaUsersName(e.target.value)} placeholder="* Your Name" className="input-base" />
              <input value={raClientName} onChange={e => setRaClientName(e.target.value)} placeholder="* Client Name" className="input-base" />
              <input value={raClientCode} onChange={e => setRaClientCode(e.target.value)} placeholder="Client Code (Optional)" className="input-base" />
              <select value={raClientType} onChange={e => setRaClientType(e.target.value)} className="input-base">
                <option value="">* Select Client Type</option>
                <option value="individual">Individual</option>
                <option value="limited_company">Limited Company</option>
                <option value="llp">LLP</option>
                <option value="trust">Trust</option>
                <option value="charity">Charity</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {RISK_QUESTIONS.map(cat => (
              <div key={cat.category} className="glass-solid rounded-xl p-5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">{cat.category}</h3>
                <div className="space-y-4">
                  {cat.questions.map(q => (
                    <div key={q.id} className="border-b border-[var(--border)] pb-4 last:border-0 last:pb-0">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">{q.text}</p>
                      <div className="flex gap-2 mb-2">
                        <button onClick={() => handleAnswer(q.id, true)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${answers[q.id]?.answer === true ? 'bg-red-500 text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:bg-red-50 dark:hover:bg-red-900/20'}`}>Yes</button>
                        <button onClick={() => handleAnswer(q.id, false)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${answers[q.id]?.answer === false && answers[q.id] ? 'bg-green-500 text-white' : 'bg-[var(--bg-nav-hover)] text-[var(--text-secondary)] hover:bg-green-50 dark:hover:bg-green-900/20'}`}>No</button>
                      </div>
                      <input value={answers[q.id]?.comment || ''} onChange={e => handleComment(q.id, e.target.value)} placeholder="Add a comment (optional)" className="input-base text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={handleProcess} disabled={!canProcess} className="btn-primary"><ShieldAlert size={15} />Generate Risk Report</button>
          </div>
        </div>
      )}
      {appState === 'success' && report && (
        <div className="space-y-5">
          <div className={`rounded-xl border p-8 text-center ${riskStyle}`}>
            <p className="text-sm font-semibold uppercase tracking-widest mb-2">Overall Risk Level</p>
            <p className="text-5xl font-bold">{report.overallRiskLevel}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {[
              { title: 'Risk Justification', content: report.riskJustification },
              { title: 'Suggested Controls', content: report.suggestedControls },
              { title: 'Training Suggestions', content: report.trainingSuggestions },
            ].map(section => (
              <div key={section.title} className="glass-solid rounded-xl p-5">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{section.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{section.content}</p>
              </div>
            ))}
          </div>

          <SaveReportModal
            isOpen={saveModalOpen}
            reportHtml={reportHtml}
            reportFileName={reportFileName}
            feature="risk_assessment"
            documentType="risk_assessment"
            initialClient={selectedClient}
            onAfterSave={ctx => persistRunToHistory(ctx.client)}
            onClose={() => setSaveModalOpen(false)}
          />

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => setAppState('idle')} className="btn-secondary">New Assessment</button>
            <button onClick={() => setSaveModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Download size={14} />
              Save Report
            </button>
          </div>
        </div>
      )}
    </ToolLayout>
  );
}
