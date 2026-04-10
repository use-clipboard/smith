import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildFinalAccountsPrompt, buildWorkingPapersPrompt } from '@/prompts/final-accounts';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveOutput, saveDocumentsToVault } from '@/lib/driveUpload';

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  businessName: z.string().default(''),
  clientCode: z.string().default(''),
  clientId: z.string().nullable().optional(),
  saveToDrive: z.boolean().optional(),
  businessType: z.string(),
  isVatRegistered: z.boolean().default(false),
  periodStart: z.string(),
  periodEnd: z.string(),
  relevantContext: z.string().default(''),
  files: z.array(FileSchema),
});

const WorkingPapersSchema = z.object({
  businessName: z.string().default(''),
  clientCode: z.string().default(''),
  businessType: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  preparerName: z.string().default(''),
  reviewPoints: z.array(z.unknown()),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Auth + module check applies to both code paths in this route
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('final-accounts')) return moduleNotActive('final-accounts');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    if (body.action === 'working_papers') {
      const parsed = WorkingPapersSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

      // Only ask Claude for the A1 narrative — blank template sections are built in code
      // This avoids hitting the 8192 token output limit with 15+ sections of content
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: 'You are an expert UK chartered accountant. Always respond with valid JSON only.',
        messages: [{ role: 'user', content: buildWorkingPapersPrompt(parsed.data) }],
      });

      if (response.stop_reason === 'max_tokens') {
        console.error('[/api/final-accounts] working_papers A1 response truncated');
        return NextResponse.json({ error: 'Notes for principal was too long to generate. Please reduce the number of review points and try again.' }, { status: 500 });
      }

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response from AI' }, { status: 500 });
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
      if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
      if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

      let a1Content: string;
      try {
        const a1Data = JSON.parse(jsonText) as { a1Content?: string };
        a1Content = a1Data.a1Content ?? jsonText;
      } catch {
        console.error('[/api/final-accounts] working_papers A1 JSON parse failed:', jsonText.slice(0, 200));
        return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 });
      }

      const isLtd = parsed.data.businessType === 'limited_company';
      const SEP = '─'.repeat(72);

      // Pre-populate A2 with any suggested journals from the review points
      type ReviewPointInput = { issue?: string; suggestedJournal?: { debitAccount?: string; creditAccount?: string; amount?: number; description?: string } | null };
      const journalRows = (parsed.data.reviewPoints as ReviewPointInput[])
        .filter(p => p.suggestedJournal)
        .map(p => {
          const j = p.suggestedJournal!;
          const dr = (j.debitAccount ?? '').padEnd(30).slice(0, 30);
          const cr = (j.creditAccount ?? '').padEnd(30).slice(0, 30);
          const amt = `£${(j.amount ?? 0).toFixed(2)}`.padEnd(13).slice(0, 13);
          const desc = j.description ?? p.issue ?? '';
          return `${dr} ${cr} ${amt} ${desc}`;
        });

      const a2Content = journalRows.length > 0
        ? `Debit Account                  Credit Account                 Amount        Description\n${SEP}\n${journalRows.join('\n')}\n\n(Add further journals as required)\n`
        : `Debit Account                  Credit Account                 Amount        Description\n${SEP}\n`;

      const workingPapers = [
        { title: 'A1 - Notes for the Principal', content: a1Content },
        { title: 'A2 - Journals', content: a2Content },
        { title: 'B1 - Lead Asset Schedule', content: `Account                        B/Fwd          Additions      Disposals      C/Fwd\n${SEP}\n` },
        { title: 'B2 - Depreciation Calculation', content: `Asset                          Cost           Rate %         Depreciation Charge\n${SEP}\n` },
        { title: 'C1 - Debtors & Prepayments Reconciliation', content: `Customer Name                  Invoice No     Date           Amount         Notes\n${SEP}\n` },
        { title: 'D1 - Bank Account Reconciliations', content: `Balance per bank statement:\nLess: outstanding cheques:\nAdd: deposits in transit:\n\nAdjusted bank balance:\nBalance per books:\nDifference:\n` },
        { title: 'D2 - Cash Account', content: `Cash count performed by:\nDate of count:\nAmount counted:\nAmount per books:\nDifference:\nNotes:\n` },
        { title: 'E1 - Suppliers Control Reconciliation', content: `Supplier Name                  Invoice No     Date           Amount         Notes\n${SEP}\n` },
        { title: 'F1 - Creditors & Accruals Reconciliation', content: `Creditor Name                  Description    Amount         Reasonable?\n${SEP}\n` },
        ...(isLtd ? [{ title: 'G1 - Directors Emoluments', content: `Director Name                  Gross Salary   PAYE/NI        Pension        Net Pay\n${SEP}\n` }] : []),
        { title: 'G2 - Insurance', content: `Verify insurance cover is adequate and up to date.\n\nType of cover:\nInsurer:\nPolicy number:\nExpiry date:\nAnnual premium:\nNotes:\n` },
        { title: 'G3 - Repairs and Renewals', content: `Check for any capital items incorrectly expensed through repairs.\n\nItems reviewed:\nCapital items identified:\nAdjustment required (Y/N):\nNotes:\n` },
        { title: 'G4 - Legal and Professional', content: `Obtain breakdown of legal and professional charges.\n\nItem                           Amount         Capital/Revenue  Notes\n${SEP}\n` },
        { title: 'G5 - Rent, Rates, Service Charge', content: `Confirm rental agreements and rates in place.\n\nProperty                       Annual Rent    Rates          Service Charge\n${SEP}\n` },
        { title: 'G6 - Sundry', content: `Obtain breakdown of sundry expenses.\n\nItem                           Amount         Notes\n${SEP}\n` },
        { title: 'H1 - Other Notes', content: '' },
      ];

      if (userCtx) {
        void logAiUsage({ ...userCtx, clientId: null, feature: 'final_accounts_working_papers', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      }

      return NextResponse.json({ workingPapers });
    }

    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive, businessName, ...rest } = parsed.data;
    const prompt = buildFinalAccountsPrompt({ businessName, clientCode, ...rest });

    const fileContent = files.map(f => {
      if (f.mimeType === 'application/pdf') {
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      }
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: 'You are an expert UK chartered accountant. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[/api/final-accounts] main analysis response truncated — consider increasing max_tokens');
      return NextResponse.json({ error: 'The AI response was too large to complete. Try uploading fewer documents or removing prior-year files, then try again.' }, { status: 500 });
    }

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    type WpData = {
      fixedAssets?: { account: string; bfwd: number; additions: number; disposals: number; cfwd: number }[];
      depreciationSchedule?: { asset: string; cost: number; ratePercent: number | null; charge: number }[];
      debtorsAndPrepayments?: { name: string; amount: number; notes: string }[];
      bankAccounts?: { name: string; bookBalance: number }[];
      cashBalance?: number | null;
      creditorsAndAccruals?: { name: string; amount: number; notes: string }[];
      plItems?: { insurance?: number | null; repairsRenewals?: number | null; legalProfessional?: number | null; rent?: number | null; rates?: number | null; sundry?: number | null };
      directorsEmoluments?: { name: string; grossSalary: number; payeNi: number; pension: number; netPay: number }[];
    };
    type AnalysisResponse = { reviewPoints?: unknown[]; a1Notes?: string; workingPaperData?: WpData };
    let analysisData: AnalysisResponse;
    try {
      analysisData = JSON.parse(jsonText) as AnalysisResponse;
    } catch {
      console.error('[/api/final-accounts] JSON parse failed:', jsonText.slice(0, 300));
      return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 });
    }

    const reviewPoints = (analysisData.reviewPoints ?? []).filter(Boolean);
    const wpd = analysisData.workingPaperData ?? {};

    // Build full working papers from the analysis response
    const isLtd = parsed.data.businessType === 'limited_company';
    const SEP = '─'.repeat(72);
    const fmt = (n: number | null | undefined) => n != null ? `£${n.toFixed(2)}` : '';
    const col = (s: string, w: number) => String(s ?? '').padEnd(w).slice(0, w);

    // Helper — build a WorkingPaper with both content (for export) and table (for UI)
    function makeTable(
      title: string,
      columns: string[],
      rows: Record<string, string>[],
      textFallback: string,
      notes = '',
    ) {
      const SEP2 = '─'.repeat(Math.max(60, columns.length * 18));
      const cw = Math.floor(64 / columns.length);
      const p = (s: string) => String(s ?? '').padEnd(cw).slice(0, cw);
      const header = columns.map(p).join(' ');
      const dataRows = rows.map(r => columns.map(c => p(r[c] ?? '')).join(' ')).join('\n');
      const content = rows.length > 0
        ? `${header}\n${SEP2}\n${dataRows}${notes ? `\n\nUser Notes:\n${notes}` : ''}`
        : textFallback;
      return { title, content, table: { columns, rows }, notes };
    }

    // A2 — Journals (from suggestedJournal on each review point)
    type ReviewPointInput = { issue?: string; suggestedJournal?: { debitAccount?: string; creditAccount?: string; amount?: number; description?: string } | null };
    const a2TableRows = (reviewPoints as ReviewPointInput[])
      .filter(p => p.suggestedJournal && p.suggestedJournal.debitAccount && p.suggestedJournal.debitAccount !== 'None')
      .map(p => {
        const j = p.suggestedJournal!;
        return { 'DR Account': j.debitAccount ?? '', 'CR Account': j.creditAccount ?? '', 'Amount (£)': j.amount != null ? j.amount.toFixed(2) : '', 'Description': j.description ?? p.issue ?? '' };
      });

    // B1 — Lead Asset Schedule
    const b1TableRows = (wpd.fixedAssets ?? []).map(r => ({
      'Account': r.account, 'B/Fwd (£)': r.bfwd.toFixed(2), 'Additions (£)': r.additions.toFixed(2), 'Disposals (£)': r.disposals.toFixed(2), 'C/Fwd (£)': r.cfwd.toFixed(2),
    }));

    // B2 — Depreciation
    const b2TableRows = (wpd.depreciationSchedule ?? []).map(r => ({
      'Asset': r.asset, 'Cost (£)': r.cost.toFixed(2), 'Rate %': r.ratePercent != null ? `${r.ratePercent}%` : '', 'Charge (£)': r.charge.toFixed(2),
    }));

    // C1 — Debtors & Prepayments
    const c1TableRows = (wpd.debtorsAndPrepayments ?? []).map(r => ({
      'Name': r.name, 'Amount (£)': fmt(r.amount), 'Notes': r.notes ?? '',
    }));

    // D1 — Bank Account Reconciliations (text form)
    const pl = wpd.plItems ?? {};
    const d1Accounts = (wpd.bankAccounts ?? []).map(b =>
      `Account: ${b.name}\nBalance per bank statement:    (to be confirmed)\nLess: outstanding cheques:\nAdd: deposits in transit:\n\nAdjusted bank balance:\nBalance per books:             ${fmt(b.bookBalance)}\nDifference:\n`
    ).join('\n');
    const d1Content = d1Accounts || `Balance per bank statement:\nLess: outstanding cheques:\nAdd: deposits in transit:\n\nAdjusted bank balance:\nBalance per books:\nDifference:\n`;

    // D2 — Cash Account (text form)
    const d2Content = `Cash count performed by:\nDate of count:\nAmount counted:\nAmount per books:              ${wpd.cashBalance != null ? fmt(wpd.cashBalance) : ''}\nDifference:\nNotes:\n`;

    // F1 — Creditors & Accruals
    const f1TableRows = (wpd.creditorsAndAccruals ?? []).map(r => ({
      'Creditor Name': r.name, 'Description': r.notes ?? '', 'Amount (£)': fmt(r.amount), 'Reasonable?': '',
    }));

    // G1 — Directors Emoluments
    const g1TableRows = (wpd.directorsEmoluments ?? []).map(r => ({
      'Director Name': r.name, 'Gross Salary (£)': r.grossSalary.toFixed(2), 'PAYE/NI (£)': r.payeNi.toFixed(2), 'Pension (£)': r.pension.toFixed(2), 'Net Pay (£)': r.netPay.toFixed(2),
    }));

    // G4 — Legal & Professional
    const g4TableRows = pl.legalProfessional != null
      ? [{ 'Item': 'Legal & Professional (total per accounts)', 'Amount (£)': pl.legalProfessional.toFixed(2), 'Capital/Revenue': 'Revenue', 'Notes': 'Obtain full breakdown from client' }]
      : [];

    // G5 — Rent, Rates (text form with pre-populated amounts)
    const g5Content = `Confirm rental agreements and rates in place.\n\nRent per accounts:             ${fmt(pl.rent)}\nRates per accounts:            ${fmt(pl.rates)}\n\nProperty                       Annual Rent    Rates          Service Charge\n${SEP}\n`;

    // G2, G3, G6 — text sections with pre-populated amounts
    const g2Content = `Verify insurance cover is adequate and up to date.\n\nAnnual premium per accounts:   ${fmt(pl.insurance)}\nType of cover:\nInsurer:\nPolicy number:\nExpiry date:\nNotes:\n`;
    const g3Content = `Check for any capital items incorrectly expensed through repairs.\n\nTotal per accounts:            ${fmt(pl.repairsRenewals)}\nItems reviewed:\nCapital items identified:\nAdjustment required (Y/N):\nNotes:\n`;
    const g6Content = `Obtain breakdown of sundry expenses.\n\nTotal per accounts:            ${fmt(pl.sundry)}\n\nItem                           Amount         Notes\n${SEP}\n`;

    const workingPapers = [
      { title: 'A1 - Notes for the Principal', content: analysisData.a1Notes ?? '' },
      makeTable('A2 - Journals', ['DR Account', 'CR Account', 'Amount (£)', 'Description'], a2TableRows, `DR Account                     CR Account                     Amount (£)    Description\n${SEP}\n`),
      makeTable('B1 - Lead Asset Schedule', ['Account', 'B/Fwd (£)', 'Additions (£)', 'Disposals (£)', 'C/Fwd (£)'], b1TableRows, `Account                        B/Fwd (£)      Additions (£)  Disposals (£)  C/Fwd (£)\n${SEP}\n`),
      makeTable('B2 - Depreciation Calculation', ['Asset', 'Cost (£)', 'Rate %', 'Charge (£)'], b2TableRows, `Asset                          Cost (£)       Rate %         Charge (£)\n${SEP}\n`),
      makeTable('C1 - Debtors & Prepayments Reconciliation', ['Name', 'Amount (£)', 'Notes'], c1TableRows, `Name                           Amount (£)     Notes\n${SEP}\n`),
      { title: 'D1 - Bank Account Reconciliations', content: d1Content },
      { title: 'D2 - Cash Account', content: d2Content },
      makeTable('E1 - Suppliers Control Reconciliation', ['Supplier Name', 'Invoice No.', 'Date', 'Amount (£)', 'Notes'], [], `Supplier Name                  Invoice No     Date           Amount (£)     Notes\n${SEP}\n`),
      makeTable('F1 - Creditors & Accruals Reconciliation', ['Creditor Name', 'Description', 'Amount (£)', 'Reasonable?'], f1TableRows, `Creditor Name                  Description    Amount (£)     Reasonable?\n${SEP}\n`),
      ...(isLtd ? [makeTable('G1 - Directors Emoluments', ['Director Name', 'Gross Salary (£)', 'PAYE/NI (£)', 'Pension (£)', 'Net Pay (£)'], g1TableRows, `Director Name             Gross Salary (£) PAYE/NI (£) Pension (£) Net Pay (£)\n${SEP}\n`)] : []),
      { title: 'G2 - Insurance', content: g2Content },
      { title: 'G3 - Repairs and Renewals', content: g3Content },
      makeTable('G4 - Legal and Professional', ['Item', 'Amount (£)', 'Capital/Revenue', 'Notes'], g4TableRows, `Item                           Amount (£)     Capital/Revenue  Notes\n${SEP}\n`),
      { title: 'G5 - Rent, Rates, Service Charge', content: g5Content },
      { title: 'G6 - Sundry', content: g6Content },
      { title: 'H1 - Other Notes', content: '' },
    ];

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'final_accounts_review' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'final_accounts_review', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'final_accounts_review', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'final_accounts_review' });
    }

    return NextResponse.json({ reviewPoints, workingPapers });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/final-accounts]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
