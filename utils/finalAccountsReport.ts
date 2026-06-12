import type { ReviewPoint, WorkingPaper } from '@/types';

/**
 * Build the full HTML for a Final Accounts Review report (or working-papers-only
 * if reviewPoints is empty). Used by both the live tool view (via SaveReportModal's
 * paperRef) AND the history dashboard (which renders directly from saved data).
 */
export function generateReportHtml(
  businessName: string,
  clientCode: string,
  businessType: string,
  periodStart: string,
  periodEnd: string,
  preparerName: string,
  relevantContext: string,
  reviewPoints: ReviewPoint[],
  workingPapers: WorkingPaper[],
): string {
  const isWorkingPapersOnly = reviewPoints.length === 0;
  const serious = reviewPoints.filter(p => p.severity === 'Serious');
  const minor = reviewPoints.filter(p => p.severity === 'Minor');
  const dateGenerated = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  function fmtDate(d: string) {
    if (!d) return '—';
    try { return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); } catch { return d; }
  }
  function fmtBiz(t: string) {
    return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
  }

  const SECTION_LABELS: Record<string, string> = {
    A: 'Review and Journals', B: 'Fixed Assets', C: 'Debtors',
    D: 'Bank and Cash', E: 'Suppliers', F: 'Creditors',
    G: 'Expenses', H: 'Other Notes',
  };

  // Drop empty working papers (no table rows and no written content) so blank
  // sections never appear in the document.
  const hasContent = (p: WorkingPaper) =>
    (!!p.table && p.table.rows.length > 0) ||
    (typeof p.content === 'string' && p.content.trim().length > 0);
  const filledPapers = workingPapers.filter(hasContent);

  const wpGroups: Record<string, WorkingPaper[]> = {};
  filledPapers.forEach(p => {
    const m = p.title.match(/^([A-Z])\d/);
    const letter = m ? m[1] : 'Z';
    if (!wpGroups[letter]) wpGroups[letter] = [];
    wpGroups[letter].push(p);
  });

  function parseTitle(title: string) {
    const m = title.match(/^([A-Z]\d+)\s*-\s*(.+)/);
    return m ? { code: m[1], name: m[2] } : { code: '', name: title };
  }

  function renderPaper(p: WorkingPaper): string {
    const { code, name } = parseTitle(p.title);
    const hasTable = p.table && p.table.rows.length > 0;
    let bodyHtml: string;
    if (hasTable) {
      bodyHtml = `<table class="wp-table">
          <thead><tr>${p.table!.columns.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${p.table!.rows.map(r => `<tr>${p.table!.columns.map(c => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>${p.notes ? `<div class="wp-notes"><strong>Notes:</strong> ${p.notes}</div>` : ''}`;
    } else if (p.content?.trim()) {
      if (p.content.includes('─')) {
        bodyHtml = `<pre>${p.content}</pre>`;
      } else {
        const paras = p.content.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        bodyHtml = paras.map(para => `<p class="wp-para">${para.replace(/\n/g, '<br>')}</p>`).join('');
      }
    } else {
      bodyHtml = '<p style="color:#9ca3af;font-style:italic;font-size:12px">(No content entered)</p>';
    }
    return `<div class="paper">
      <div class="paper-title-row">${code ? `<span class="paper-code">${code}</span>` : ''}<span class="paper-name">${name}</span></div>
      ${bodyHtml}
    </div>`;
  }

  const titlePageHtml = `
    <div class="title-page">
      <div class="title-header">
        <div class="title-header-tag">${isWorkingPapersOnly ? 'Working Papers' : 'Final Accounts Review'}</div>
        <div class="title-header-name">${businessName || 'Client Name'}</div>
        ${clientCode ? `<div class="title-header-code">${clientCode}</div>` : ''}
      </div>
      <div class="title-body">
        <div class="title-meta">
          <div class="title-meta-item"><label>Business Type</label><span>${fmtBiz(businessType)}</span></div>
          <div class="title-meta-item"><label>Period</label><span>${fmtDate(periodStart)} to ${fmtDate(periodEnd)}</span></div>
          <div class="title-meta-item"><label>Prepared by</label><span>${preparerName || '—'}</span></div>
          <div class="title-meta-item"><label>Date</label><span>${dateGenerated}</span></div>
        </div>
        ${relevantContext ? `<div class="title-context"><div class="title-context-label">Business Description</div><div>${relevantContext}</div></div>` : ''}
      </div>
      <div class="title-footer">Confidential — Prepared for Internal Use Only</div>
    </div>`;

  const tocGroupsHtml = Object.entries(wpGroups).map(([letter, papers]) => `
    <div class="toc-group">
      <div class="toc-group-header">${letter} &mdash; ${SECTION_LABELS[letter] ?? `Section ${letter}`}</div>
      ${papers.map(p => {
        const { code, name } = parseTitle(p.title);
        return `<div class="toc-entry"><span class="toc-code">${code}</span><span class="toc-entry-name">${name}</span></div>`;
      }).join('')}
    </div>`).join('');

  const tocHtml = `
    <div class="force-page-start toc-section">
      <h2 class="toc-heading">Contents</h2>
      ${reviewPoints.length > 0 ? `
        <div class="toc-group">
          <div class="toc-group-header">Review Points</div>
          <div class="toc-entry"><span class="toc-code">—</span><span class="toc-entry-name">${reviewPoints.length} point${reviewPoints.length !== 1 ? 's' : ''} identified (${serious.length} serious, ${minor.length} minor)</span></div>
        </div>` : ''}
      ${tocGroupsHtml}
    </div>`;

  const reviewSectionHtml = reviewPoints.length > 0 ? `
    <div class="force-page-start section-divider">
      <div class="sd-letter">R</div>
      <div class="sd-content">
        <div class="sd-name">Review Points</div>
        <div class="sd-sub">${reviewPoints.length} point${reviewPoints.length !== 1 ? 's' : ''} identified &mdash; ${serious.length} serious, ${minor.length} minor</div>
      </div>
    </div>
    <div class="review-summary">
      <div class="rsbox serious-box"><div class="rsnum">${serious.length}</div><div class="rslbl">Serious</div></div>
      <div class="rsbox minor-box"><div class="rsnum">${minor.length}</div><div class="rslbl">Minor</div></div>
    </div>
    ${reviewPoints.map(p => {
      const hasJournal = p.suggestedJournal && p.suggestedJournal.debitAccount && p.suggestedJournal.debitAccount !== 'None' && (p.suggestedJournal.amount ?? 0) > 0;
      const journalHtml = hasJournal ? `
        <div class="journal-section">
          <div class="journal-label">Suggested Journal</div>
          <table class="journal-table">
            <thead><tr><th>Account</th><th>Debit (£)</th><th>Credit (£)</th></tr></thead>
            <tbody>
              <tr><td>${p.suggestedJournal!.debitAccount ?? ''}</td><td style="text-align:right">${p.suggestedJournal!.amount?.toFixed(2) ?? ''}</td><td></td></tr>
              <tr style="font-style:italic"><td style="padding-left:20px">${p.suggestedJournal!.creditAccount ?? ''}</td><td></td><td style="text-align:right">${p.suggestedJournal!.amount?.toFixed(2) ?? ''}</td></tr>
            </tbody>
          </table>
          ${p.suggestedJournal!.description ? `<div class="journal-desc">${p.suggestedJournal!.description}</div>` : ''}
        </div>` : '';
      return `
        <div class="review-point ${p.severity === 'Serious' ? 'serious' : 'minor'}">
          <div class="rp-header">
            <div><span class="rp-area">${p.area ?? ''}</span><div class="rp-issue">${p.issue ?? ''}</div></div>
            <span class="badge ${p.severity === 'Serious' ? 'badge-serious' : 'badge-minor'}">${p.severity}</span>
          </div>
          <p class="rp-expl">${p.explanation ?? ''}</p>
          ${journalHtml}
        </div>`;
    }).join('')}
  ` : '';

  const wpSectionsHtml = Object.entries(wpGroups).map(([letter, papers]) => {
    const groupName = SECTION_LABELS[letter] ?? `Section ${letter}`;
    const codes = papers.map(p => parseTitle(p.title).code).filter(Boolean).join(', ');
    return `
      <div class="force-page-start section-divider">
        <div class="sd-letter">${letter}</div>
        <div class="sd-content">
          <div class="sd-name">${groupName}</div>
          <div class="sd-sub">${codes}</div>
        </div>
      </div>
      ${papers.map(renderPaper).join('')}`;
  }).join('');

  const css = `
    body { font-family: Arial, Helvetica, sans-serif; color: #1f2937; margin: 0; padding: 40px; font-size: 13px; line-height: 1.6; max-width: 860px; background: #fff; }
    .title-page { min-height: 960px; display: flex; flex-direction: column; }
    .title-header { background: #12458F; padding: 24px 40px 22px; margin: -40px -40px 0; border-top: 4px solid #1C73D1; }
    .title-header-tag { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 2.5px; color: #8CBAF2; margin-bottom: 10px; }
    .title-header-name { font-size: 30px; font-weight: 900; color: #fff; line-height: 1.2; }
    .title-header-code { font-size: 13px; color: rgba(255,255,255,0.6); margin-top: 6px; font-weight: 500; }
    .title-body { flex: 1; padding: 44px 0 32px; }
    .title-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 48px; padding-top: 24px; border-top: 2px solid #e5e7eb; }
    .title-meta-item label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; display: block; margin-bottom: 3px; }
    .title-meta-item span { font-size: 14px; color: #374151; font-weight: 500; }
    .title-context { margin-top: 28px; padding: 12px 16px; background: #EDF5FF; border-left: 3px solid #1C73D1; font-size: 12px; color: #374151; }
    .title-context-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; margin-bottom: 5px; }
    .title-footer { text-align: center; font-size: 11px; color: #d1d5db; letter-spacing: 0.5px; padding-top: 20px; border-top: 1px solid #f3f4f6; margin-top: auto; }
    .toc-section { padding-bottom: 40px; }
    .toc-heading { font-size: 20px; font-weight: 900; color: #111827; border-bottom: 2px solid #12458F; padding-bottom: 10px; margin-bottom: 22px; margin-top: 0; }
    .toc-group { margin-bottom: 18px; }
    .toc-group-header { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #1C73D1; background: #EDF5FF; border-left: 3px solid #1C73D1; padding: 5px 10px; margin-bottom: 6px; }
    .toc-entry { display: flex; align-items: baseline; gap: 10px; padding: 3px 8px; border-bottom: 1px dotted #e5e7eb; }
    .toc-code { font-size: 11px; font-weight: 700; color: #1C73D1; width: 32px; flex-shrink: 0; }
    .toc-entry-name { font-size: 12px; color: #4b5563; }
    .section-divider { background: #EDF5FF; border-left: 3px solid #1C73D1; padding: 12px 16px; margin: 36px 0 20px; display: flex; align-items: center; gap: 14px; }
    .sd-letter { font-size: 13px; font-weight: 900; color: #fff; background: #1C73D1; width: 28px; height: 28px; line-height: 28px; text-align: center; border-radius: 4px; flex-shrink: 0; }
    .sd-name { font-size: 15px; font-weight: 800; color: #12458F; }
    .sd-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; font-weight: 500; }
    .review-summary { display: flex; gap: 14px; margin-bottom: 20px; margin-top: 16px; }
    .rsbox { padding: 14px 22px; border-radius: 8px; text-align: center; border: 1px solid; min-width: 90px; }
    .rsnum { font-size: 28px; font-weight: 900; }
    .rslbl { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .serious-box { background: #fef2f2; border-color: #fca5a5; color: #b91c1c; }
    .minor-box { background: #fffbeb; border-color: #fcd34d; color: #92400e; }
    .review-point { border-left: 4px solid #e5e7eb; padding: 14px 16px; margin-bottom: 12px; background: #fafafa; page-break-inside: avoid; break-inside: avoid; border-radius: 0 6px 6px 0; }
    .review-point.serious { border-left-color: #ef4444; background: #fef9f9; }
    .review-point.minor   { border-left-color: #f59e0b; background: #fffdf5; }
    .rp-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
    .rp-area { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #9ca3af; display: block; margin-bottom: 2px; }
    .rp-issue { font-size: 14px; font-weight: 700; color: #111827; }
    .rp-expl { font-size: 12px; color: #4b5563; margin: 0; }
    .badge { font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 999px; white-space: nowrap; margin-left: 12px; display: inline-flex; align-items: center; justify-content: center; line-height: 1; flex-shrink: 0; }
    .badge-serious { background: #fee2e2; color: #b91c1c; }
    .badge-minor   { background: #fef3c7; color: #92400e; }
    .journal-section { margin-top: 10px; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .journal-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; color: #1C73D1; padding: 6px 12px; background: #EDF5FF; border-bottom: 1px solid #cde0f8; }
    .journal-desc  { font-size: 11px; color: #6b7280; padding: 5px 12px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .journal-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .journal-table th { text-align: left; padding: 6px 12px; background: #1C73D1; color: #fff; font-weight: 700; border: 1px solid #1C73D1; }
    .journal-table td { padding: 5px 12px; border-bottom: 1px solid #f3f4f6; }
    .paper { margin-bottom: 28px; page-break-inside: avoid; break-inside: avoid; }
    .paper-title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 9px 14px; background: #EDF5FF; border-left: 3px solid #1C73D1; }
    .paper-code { font-size: 10px; font-weight: 700; color: #fff; background: #1C73D1; display: inline-block; min-width: 26px; height: 20px; line-height: 20px; text-align: center; padding: 0 6px; border-radius: 3px; flex-shrink: 0; }
    .paper-name { font-size: 13px; font-weight: 700; color: #12458F; }
    .wp-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .wp-table th { text-align: left; padding: 7px 10px; background: #1C73D1; color: #fff; font-weight: 700; border: 1px solid #1C73D1; }
    .wp-table td { padding: 6px 10px; border: 1px solid #e5e7eb; }
    .wp-table tr:nth-child(even) td { background: #F5F5F8; }
    .wp-notes { margin-top: 10px; font-size: 12px; color: #4b5563; padding: 8px 12px; background: #EDF5FF; border-left: 3px solid #8CBAF2; }
    pre { background: #F5F5F8; border: 1px solid #e5e7eb; border-radius: 4px; padding: 12px 14px; font-size: 11px; line-height: 1.7; white-space: pre-wrap; word-wrap: break-word; font-family: 'Courier New', Courier, monospace; }
    .wp-para { font-size: 12px; color: #374151; margin: 0 0 10px; line-height: 1.8; page-break-inside: avoid; break-inside: avoid; }
    .wp-para:last-child { margin-bottom: 0; }
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${isWorkingPapersOnly ? 'Working Papers' : 'Final Accounts Review'} — ${businessName}</title>
  <style>${css}</style>
</head>
<body>
  ${titlePageHtml}
  ${tocHtml}
  ${reviewSectionHtml}
  ${wpSectionsHtml}
</body>
</html>`;
}
