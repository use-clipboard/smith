import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildFinalAccountsPrompt, buildWorkingPapersPrompt } from '@/prompts/final-accounts';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveDocumentsToVault } from '@/lib/driveUpload';

// The work is split across two requests — the review (step 1) and the working
// papers (step 2) — so that neither AI response overflows the output-token
// limit, which previously truncated a single combined response. Each call can
// still run for a while, so allow up to 5 minutes (matches /api/performance).
export const maxDuration = 300;

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
  clientId: z.string().nullable().optional(),
  businessType: z.string(),
  isVatRegistered: z.boolean().default(false),
  periodStart: z.string(),
  periodEnd: z.string(),
  relevantContext: z.string().default(''),
  preparerName: z.string().default(''),
  reviewPoints: z.array(z.unknown()),
  // The documents are sent again so the figures can be extracted to populate
  // the schedules — the review response carries review points only.
  files: z.array(FileSchema),
});

type FileInput = z.infer<typeof FileSchema>;

// Turn uploaded files into Anthropic content blocks (PDFs as documents, images
// as images). Shared by both the review and the working-papers requests.
function toFileContent(files: FileInput[]) {
  return files.map(f => {
    if (f.mimeType === 'application/pdf') {
      return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
    }
    return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
  });
}

// Strip ```json fences the model occasionally wraps the JSON in.
function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) t = t.substring(7).trim();
  if (t.startsWith('```')) t = t.substring(3).trim();
  if (t.endsWith('```')) t = t.substring(0, t.length - 3).trim();
  return t;
}

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
type ReviewPointInput = { issue?: string; suggestedJournal?: { debitAccount?: string; creditAccount?: string; amount?: number; description?: string } | null };

// Build the full working-papers array (A1 narrative + the lettered schedules)
// from the extracted figures and the review points.
function buildWorkingPapers(reviewPoints: unknown[], wpd: WpData, a1Notes: string, businessType: string) {
  const isLtd = businessType === 'limited_company';
  const SEP = '─'.repeat(72);
  const fmt = (n: number | null | undefined) => n != null ? `£${n.toFixed(2)}` : '';

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

  return [
    { title: 'A1 - Notes for the Principal', content: a1Notes ?? '' },
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Auth + module check applies to both code paths in this route
    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('final-accounts')) return moduleNotActive('final-accounts');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    // ── Step 2: Working papers ────────────────────────────────────────────────
    // Runs after the review. Re-reads the documents to extract the schedule
    // figures and writes the A1 narrative, then builds the full working papers.
    if (body.action === 'working_papers') {
      const parsed = WorkingPapersSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

      const { files, reviewPoints, businessType } = parsed.data;
      const fileContent = toFileContent(files);
      const prompt = buildWorkingPapersPrompt(parsed.data);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        system: 'You are an expert UK chartered accountant. Always respond with valid JSON only.',
        messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
      });

      if (response.stop_reason === 'max_tokens') {
        console.error('[/api/final-accounts] working_papers response truncated');
        return NextResponse.json({ error: 'The working papers were too long to generate in one go. Try splitting the documents (e.g. current year, then prior year) and producing the working papers for each.' }, { status: 500 });
      }

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response from AI' }, { status: 500 });

      let a1Content = '';
      let wpd: WpData = {};
      try {
        const data = JSON.parse(stripJsonFences(textContent.text)) as { a1Content?: string; workingPaperData?: WpData };
        a1Content = data.a1Content ?? '';
        wpd = data.workingPaperData ?? {};
      } catch {
        console.error('[/api/final-accounts] working_papers JSON parse failed:', stripJsonFences(textContent.text).slice(0, 300));
        return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 });
      }

      const workingPapers = buildWorkingPapers(reviewPoints, wpd, a1Content, businessType);

      void logAiUsage({ ...userCtx, clientId: parsed.data.clientId ?? null, feature: 'final_accounts_working_papers', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });

      return NextResponse.json({ workingPapers });
    }

    // ── Step 1: Review ────────────────────────────────────────────────────────
    // Returns review points only — a small response that won't truncate.
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive, businessName, ...rest } = parsed.data;
    const prompt = buildFinalAccountsPrompt({ businessName, clientCode, ...rest });
    const fileContent = toFileContent(files);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: 'You are an expert UK chartered accountant. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });

    if (response.stop_reason === 'max_tokens') {
      console.error('[/api/final-accounts] review response truncated at max_tokens');
      return NextResponse.json({ error: 'There were too many review points to fit in one response. Try splitting the job — e.g. review the current year on its own, then the prior year — and run it again.' }, { status: 500 });
    }

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });

    let analysisData: { reviewPoints?: unknown[] };
    try {
      analysisData = JSON.parse(stripJsonFences(textContent.text)) as { reviewPoints?: unknown[] };
    } catch {
      console.error('[/api/final-accounts] JSON parse failed:', stripJsonFences(textContent.text).slice(0, 300));
      return NextResponse.json({ error: 'Failed to parse AI response. Please try again.' }, { status: 500 });
    }

    const reviewPoints = (analysisData.reviewPoints ?? []).filter(Boolean);

    if (saveToDrive && clientCode) {
      void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'final_accounts_review' });
      void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'final_accounts_review', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
    }
    void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'final_accounts_review', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
    // No auto-save to outputs — saving happens via /api/outputs/final-accounts
    // when the user clicks Save in SaveReportModal (onAfterSave).

    return NextResponse.json({ reviewPoints });
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/final-accounts]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
