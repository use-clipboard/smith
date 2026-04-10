interface PerformancePromptOptions {
  paBusinessName: string;
  paBusinessType: string;
  paBusinessTrade: string;
  paTradingLocation: string;
  paRelevantInfo: string;
  paAnalysisPeriod: string;
  paAnalysisPeriodDescription: string;
  selectedSections: string[];
}

// Full descriptions for each section — used to build the dynamic prompt
const SECTION_PROMPTS: Record<string, string> = {
  executive_summary: `
<h1>Executive Summary</h1>
<h2>Key Insights at a Glance</h2>
<p>Provide a concise high-level overview of the business's performance. Highlight the most critical financial trends, notable achievements, and key concerns. Keep it to 3-5 punchy bullet points followed by a short narrative paragraph.</p>`,

  financial_performance: `
<h1>Financial Performance Analysis</h1>
<h2>Deep Dive into the Numbers</h2>
<h3>Profit & Loss Analysis</h3>
<p>Analyse revenue, cost of sales, gross profit margin, and net profit margin. Use a clear \`<table>\` for key figures, using \`<span class="highlight-positive">\` or \`<span class="highlight-negative">\` within table cells for significant changes.</p>
<h3>Balance Sheet Analysis</h3>
<p>Comment on liquidity (current ratio), solvency, working capital, and key balance sheet movements.</p>`,

  margin_analysis: `
<h1>Margin Analysis</h1>
<h2>Profitability Breakdown</h2>
<p>Calculate and explain gross margin, operating margin, and net margin. Show these in a clear table. Identify the key drivers of margin expansion or compression. Compare to prior period where data is available.</p>`,

  comparative: `
<h1>Year-on-Year Comparative Analysis</h1>
<h2>Performance vs Prior Period</h2>
<p>Only include this section if prior period data is available in the uploaded documents. Perform a detailed comparison, calculate key variances (£ and %). Present in a multi-column table using highlight tags for variances exceeding 10%.</p>`,

  kpi_dashboard: `
<h1>KPI Dashboard</h1>
<h2>Key Performance Indicators</h2>
<p>Present a clear summary table of the most important KPIs for this business type. Include: Revenue, Gross Profit %, Net Profit %, Current Ratio, Debtor Days, Creditor Days, and any sector-specific KPIs relevant to a ${'{trade}'} business.</p>`,

  industry_benchmarking: `
<h1>Actual vs Industry Averages</h1>
<h2>How Does the Business Stack Up?</h2>
<p>Using your knowledge of typical industry benchmarks for a \`${'{trade}'}\` business in \`${'{location}'}\`, compare the company's KPIs against sector averages. Present in a table with columns: "KPI", "Company", "Industry Average", "Assessment". Use highlight tags for cells where performance is above or below benchmark.</p>`,

  swot: `
<h1>SWOT Analysis</h1>
<h2>Strengths, Weaknesses, Opportunities, Threats</h2>
<p>Based on the financial analysis, provide four distinct sections using \`<h3>\` headings and \`<ul>\` lists. Be specific and reference actual figures from the accounts.</p>`,

  budget_vs_actual: `
<h1>Budget vs Actual Analysis</h1>
<h2>Variance Report</h2>
<p>If budget figures are available in the uploaded documents, provide a detailed budget vs actual variance analysis. For each major P&L line: show Budget, Actual, Variance (£), Variance (%) and a brief explanation. Use highlight tags for material variances. If no budget data is available, state this clearly and provide commentary on what a budget process would look like for this business.</p>`,

  cashflow_forecast: `
<h1>Rolling Cashflow Forecast</h1>
<h2>12-Month Cash Flow Projection</h2>
<p>Based on the current financial position and trading patterns, produce a month-by-month rolling cash flow forecast for the next 12 months. Present as a table with rows for: Opening Balance, Cash Receipts, Cash Payments (broken into key categories), Net Cash Flow, and Closing Balance. Highlight months where the closing balance falls below a safe threshold. State key assumptions clearly.</p>`,

  projections: `
<h1>Forecasts & Projections</h1>
<h2>Future Financial Outlook</h2>
<p>Produce a projected P&L forecast with columns: "P&L Item", "Current Period", "Year 1 (Trend)", "Year 3 (Trend)", "Year 5 (Trend)", and "Year 1 (With Recommendations)". Use highlight tags for key projected figures. Follow with a short narrative explaining the key assumptions and risks to the projections.</p>`,

  strategy_advice: `
<h1>Performance Strategy Advice</h1>
<h2>Actionable Recommendations</h2>
<p>For each identified weakness, risk or underperforming area, provide a specific, practical and actionable recommendation. Use \`<h3>\` for each recommendation title and \`<p>\` for the detail. Prioritise by potential impact. Where prior analysis has been uploaded, comment on whether previous recommendations have been actioned.</p>`,

  tax_strategy: `
<h1>Tax Strategy Planning</h1>
<h2>Tax Efficiency Opportunities</h2>
<p>Based on the business's financial position, identify tax planning opportunities and considerations relevant to a UK ${'{type}'} business. Cover areas such as: timing of income/expenditure, capital allowances, pension contributions, remuneration strategy (where applicable), VAT planning, and any reliefs relevant to the sector. Present as a structured list with brief explanations. This is not formal tax advice — recommend the client discusses specifics with their tax adviser.</p>`,
};

export function buildPerformancePrompt(opts: PerformancePromptOptions): string {
  const today = new Date().toLocaleDateString('en-GB');
  const periodDesc = opts.paAnalysisPeriodDescription ? `(${opts.paAnalysisPeriodDescription})` : '';
  const businessName = opts.paBusinessName || 'the Business';
  const trade = opts.paBusinessTrade || 'the business';
  const location = opts.paTradingLocation || 'the UK';
  const type = opts.paBusinessType || 'business';

  // Build the section content — substitute placeholders for trade/location/type
  const sections = opts.selectedSections
    .filter(id => SECTION_PROMPTS[id])
    .map(id => SECTION_PROMPTS[id]
      .replace(/\$\{'{trade}'\}/g, trade)
      .replace(/\$\{'{location}'\}/g, location)
      .replace(/\$\{'{type}'\}/g, type)
    )
    .join('\n');

  const sectionList = opts.selectedSections
    .map(id => {
      const labels: Record<string, string> = {
        executive_summary: 'Executive Summary',
        financial_performance: 'Financial Performance Analysis',
        margin_analysis: 'Margin Analysis',
        comparative: 'Year-on-Year Comparative Analysis',
        kpi_dashboard: 'KPI Dashboard',
        industry_benchmarking: 'Actual vs Industry Averages',
        swot: 'SWOT Analysis',
        budget_vs_actual: 'Budget vs Actual Analysis',
        cashflow_forecast: 'Rolling Cashflow Forecast',
        projections: 'Forecasts & Projections',
        strategy_advice: 'Performance Strategy Advice',
        tax_strategy: 'Tax Strategy Planning',
      };
      return labels[id] ?? id;
    })
    .map(l => `<li>${l}</li>`)
    .join('');

  return `You are a world-class UK business analyst. Create a professional business performance analysis report.

**Output Requirements (CRITICAL):**
Your output MUST be a single JSON object with exactly two keys: "reportHtml" and "chartDataJson".

1. **reportHtml**: A string containing the full report as clean, well-structured HTML.
   - Use semantic tags: \`<h1>\`, \`<h2>\`, \`<h3>\`, \`<p>\`, \`<ul>\`, \`<li>\`, \`<strong>\`, \`<em>\`.
   - For tables, use \`<table>\` with \`<thead>\`, \`<tbody>\`, \`<tr>\`, \`<th>\`, \`<td>\`.
   - **Highlighting (tables only):** Use \`<span class="highlight-positive">...\` or \`<span class="highlight-negative">...\` inside table cells only.
   - **Cover page:** Start with: \`<div class="report-cover"><h1>Business Performance Report ${periodDesc}</h1><h2>Prepared for: ${businessName}</h2><p>Date of Issue: ${today}</p></div>\`
   - **Contents:** Follow the cover page with: \`<h1>Report Contents</h1><ul>${sectionList}</ul>\`
   - **Only generate the sections listed in the contents above.** Do not add sections that are not listed.

2. **chartDataJson**: A JSON **string** containing KPI benchmarking data for a bar chart.
   - Format: \`[{"label": "KPI Name", "company": 25, "benchmark": 22}, ...]\`
   - Include 3-5 of the most relevant KPIs for this business type.
   - Only include this if the "Actual vs Industry Averages" or "KPI Dashboard" section is selected; otherwise return an empty array string: \`"[]"\`.

**Client & Business Context:**
- Business Name: ${opts.paBusinessName}
- Business Type: ${opts.paBusinessType}
- Business Trade / Sector: ${opts.paBusinessTrade}
- Trading Location: ${opts.paTradingLocation || 'Not specified'}
- Analysis Period: ${opts.paAnalysisPeriod} ${periodDesc}
- Other Relevant Info / Key Priorities: ${opts.paRelevantInfo || 'None provided'}

**Report Sections to Generate:**
${sections}`;
}
