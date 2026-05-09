import type { RiskAssessmentReport } from '@/types';

/**
 * Build the full standalone HTML for a Risk Assessment report. Used by both
 * the live tool view AND the history dashboard (which rebuilds the PDF
 * directly from saved data).
 */
export function generateRiskReportHtml(
  clientName: string,
  clientCode: string,
  usersName: string,
  report: RiskAssessmentReport,
): string {
  const riskColour = report.overallRiskLevel === 'High' ? '#dc2626'
                   : report.overallRiskLevel === 'Medium' ? '#d97706'
                   : '#16a34a';
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
