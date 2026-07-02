// Self-contained styled PDF export for Timesheets reports.
//
// Rather than scrape the live app DOM, we compose a clean, fully self-contained
// HTML document (no Tailwind, no external assets) in a popup window and trigger
// the browser's print dialog — the user then "Save as PDF". Colours are forced
// to print via print-color-adjust so the bars survive.

export interface ReportPdfRow {
  label: string;
  primary: string;
  secondary?: string;
  ratio: number;
  color: string;
  target?: number;
}

export interface ReportPdfOptions {
  title: string;
  periodLabel: string;
  summary: { label: string; value: string }[];
  rows: ReportPdfRow[];
  preparedBy?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function ukDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function exportReportPdf(opts: ReportPdfOptions): void {
  const generated = ukDate(new Date());

  const summaryHtml = opts.summary.map(s => `
    <div class="stat">
      <div class="stat-val">${escapeHtml(s.value)}</div>
      <div class="stat-lbl">${escapeHtml(s.label)}</div>
    </div>`).join('');

  const rowsHtml = opts.rows.map((r, i) => {
    const pct = Math.max(2, Math.min(100, r.ratio * 100));
    const targetMark = r.target != null
      ? `<span class="target" style="left:${Math.min(100, r.target * 100)}%"></span>` : '';
    return `
    <tr>
      <td class="num">${i + 1}</td>
      <td class="name">${escapeHtml(r.label)}</td>
      <td class="bar-cell">
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%;background:${r.color}"></div>
          ${targetMark}
        </div>
      </td>
      <td class="val">${escapeHtml(r.primary)}</td>
      <td class="sec">${r.secondary ? escapeHtml(r.secondary) : ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(opts.title)} — Timesheets</title>
<style>
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #0F0F1A; padding: 16mm 16mm 12mm; font-size: 12px; line-height: 1.5;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #4F46E5; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; letter-spacing: -0.02em;
    background: linear-gradient(120deg,#4F46E5,#7C3AED); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .brand-sub { font-size: 10px; color: #6B7280; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; margin-top: 2px; }
  .doc-title { font-size: 17px; font-weight: 700; text-align: right; }
  .doc-meta { font-size: 10.5px; color: #6B7280; text-align: right; margin-top: 3px; }
  .stats { display: flex; gap: 10px; margin-bottom: 18px; }
  .stat { flex: 1; border: 1px solid #ECECF3; border-radius: 12px; padding: 10px 12px; background: #FAFAFE; }
  .stat-val { font-size: 18px; font-weight: 700; }
  .stat-lbl { font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7280; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #6B7280; padding: 0 8px 6px; border-bottom: 1px solid #ECECF3; }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #F3F3F8; vertical-align: middle; }
  tr { page-break-inside: avoid; }
  td.num { width: 22px; color: #9CA3AF; font-size: 10px; }
  td.name { font-weight: 600; width: 26%; }
  td.bar-cell { width: 40%; }
  td.val { text-align: right; font-weight: 700; white-space: nowrap; width: 14%; }
  td.sec { text-align: right; color: #6B7280; font-size: 10.5px; white-space: nowrap; }
  .bar-track { position: relative; height: 14px; background: #F1F1F7; border-radius: 7px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 7px; }
  .target { position: absolute; top: -1px; bottom: -1px; width: 2px; background: rgba(15,15,26,0.45); }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #ECECF3; font-size: 9.5px; color: #9CA3AF; display: flex; justify-content: space-between; }
  @page { size: A4 portrait; margin: 0; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">SMITH</div>
      <div class="brand-sub">Timesheets</div>
    </div>
    <div>
      <div class="doc-title">${escapeHtml(opts.title)}</div>
      <div class="doc-meta">${escapeHtml(opts.periodLabel)} · Generated ${generated}</div>
    </div>
  </div>

  ${opts.summary.length ? `<div class="stats">${summaryHtml}</div>` : ''}

  <table>
    <thead>
      <tr><th></th><th>Name</th><th></th><th style="text-align:right">Value</th><th style="text-align:right">Detail</th></tr>
    </thead>
    <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:#9CA3AF;padding:24px">No data for this period.</td></tr>'}</tbody>
  </table>

  <div class="foot">
    <span>${opts.preparedBy ? `Prepared by ${escapeHtml(opts.preparedBy)}` : 'SMITH for Accountants'}</span>
    <span>${escapeHtml(opts.periodLabel)}</span>
  </div>
</body>
</html>`;

  const popup = window.open('', '_blank', 'width=900,height=1100');
  if (!popup) { window.print(); return; }
  popup.document.write(html);
  popup.document.close();

  const fire = () => {
    popup.focus();
    popup.print();
    setTimeout(() => { try { popup.close(); } catch { /* user closed it */ } }, 500);
  };
  if (popup.document.readyState === 'complete') setTimeout(fire, 120);
  else popup.addEventListener('load', fire);
}
