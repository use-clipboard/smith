'use client';
import { useState, useCallback, useEffect } from 'react';
import ProcessingView from '@/components/ui/ProcessingView';
import { useTabActivitySync } from '@/components/ui/TabActivityContext';
import ErrorDisplay from '@/components/ui/ErrorDisplay';
import SaveReportModal from '@/components/ui/SaveReportModal';
import ClientSelector, { SelectedClient } from '@/components/ui/ClientSelector';
import { consumePendingClient } from '@/lib/pendingClient';
import ToolLayout from '@/components/ui/ToolLayout';
import { ShieldAlert, Download } from 'lucide-react';
import type { RiskAssessmentReport } from '@/types';

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

function generateRiskReportHtml(
  clientName: string,
  clientCode: string,
  usersName: string,
  report: RiskAssessmentReport,
): string {
  const riskColour = report.overallRiskLevel === 'High' ? '#dc2626' : report.overallRiskLevel === 'Medium' ? '#d97706' : '#16a34a';
  const dateGenerated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AML Risk Assessment — ${clientName}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 40px; font-size: 13px; line-height: 1.6; max-width: 800px; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 32px; }
    .risk-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #555; margin-bottom: 8px; }
    .risk-badge { display: inline-block; padding: 10px 28px; border-radius: 8px; font-size: 32px; font-weight: 900; color: ${riskColour}; border: 2px solid ${riskColour}; margin-bottom: 32px; }
    section { margin-bottom: 28px; page-break-inside: avoid; }
    h2 { font-size: 14px; font-weight: 700; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px; }
    p { margin: 0 0 8px; white-space: pre-wrap; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
    th { text-align: left; padding: 6px 10px; background: #f3f4f6; font-weight: 700; border: 1px solid #e5e7eb; }
    td { padding: 6px 10px; border: 1px solid #e5e7eb; vertical-align: top; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>AML Client Risk Assessment</h1>
  <div class="meta">Client: <strong>${clientName}</strong>${clientCode ? ` (${clientCode})` : ''} &nbsp;·&nbsp; Prepared by: ${usersName} &nbsp;·&nbsp; Date: ${dateGenerated}</div>
  <div class="risk-label">Overall Risk Level</div>
  <div class="risk-badge">${report.overallRiskLevel}</div>
  <section>
    <h2>Risk Justification</h2>
    <p>${report.riskJustification}</p>
  </section>
  <section>
    <h2>Suggested Controls</h2>
    <p>${report.suggestedControls}</p>
  </section>
  <section>
    <h2>Training Suggestions</h2>
    <p>${report.trainingSuggestions}</p>
  </section>
  ${report.summaryOfAnswers?.length ? `
  <section>
    <h2>Question Summary</h2>
    <table>
      <thead><tr><th>Question</th><th>Answer</th><th>Comment</th></tr></thead>
      <tbody>
        ${report.summaryOfAnswers.map(a => `<tr><td>${a.question}</td><td>${a.answer}</td><td>${a.userComment || '—'}</td></tr>`).join('')}
      </tbody>
    </table>
  </section>` : ''}
</body>
</html>`;
}

export default function RiskAssessmentPage() {
  const [appState, setAppState] = useState<AppState>('idle');
  useTabActivitySync('/risk-assessment', appState);
  const [error, setError] = useState<string | null>(null);
  const [selectedClient, setSelectedClient] = useState<SelectedClient | null>(null);
  const [raUsersName, setRaUsersName] = useState('');
  const [raClientName, setRaClientName] = useState('');
  const [raClientCode, setRaClientCode] = useState('');

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
  if (appState === 'error') return <ToolLayout title="Risk Assessment" icon={ShieldAlert} iconColor="#DC2626"><ErrorDisplay error={error || ''} onRetry={() => setAppState('idle')} /></ToolLayout>;

  return (
    <ToolLayout title="Risk Assessment" description="Conduct an AML client risk assessment and produce a risk report." icon={ShieldAlert} iconColor="#DC2626">
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
