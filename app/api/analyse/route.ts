import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildStaticInstructions, buildDynamicContext } from '@/prompts/full-analysis';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveDocumentsToVault, saveOutput } from '@/lib/driveUpload';

// Allow up to 2 minutes on Vercel (covers parallel batches for large uploads)
export const maxDuration = 120;

const BATCH_SIZE = 3;

const FileSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  base64: z.string(),
});

const RequestSchema = z.object({
  clientName: z.string().default(''),
  clientAddress: z.string().default(''),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  saveToDrive: z.boolean().optional(),
  isVatRegistered: z.boolean().default(false),
  targetSoftware: z.enum(['vt', 'capium', 'xero', 'quickbooks', 'freeagent', 'sage', 'general']),
  files: z.array(FileSchema),
  pastTransactionsContent: z.string().nullable().optional(),
  ledgersContent: z.string().nullable().optional(),
});

type ParsedFile = z.infer<typeof FileSchema>;

interface BatchResult {
  validTransactions: unknown[];
  flaggedEntries: unknown[];
  inputTokens: number;
  outputTokens: number;
}

async function runBatch(
  batchFiles: ParsedFile[],
  staticInstructions: string,
  context: {
    clientName: string;
    clientAddress: string;
    pastTransactionsContent?: string | null;
    ledgersContent?: string | null;
  },
  anthropic: Anthropic
): Promise<BatchResult> {
  const fileNames = batchFiles.map(f => f.name);
  const dynamicContext = buildDynamicContext({ fileNames, ...context });

  const contentBlocks = batchFiles.map(f => {
    if (f.mimeType === 'application/pdf') {
      return {
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 },
      };
    }
    return {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: f.base64,
      },
    };
  });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    // Cache the system prompt — identical for every call, saves re-processing on each request
    system: [
      {
        type: 'text',
        text: 'You are an expert UK bookkeeper. Always respond with valid JSON only — no markdown, no explanation, just the JSON object.',
        cache_control: { type: 'ephemeral' },
      },
    ] as Anthropic.Messages.MessageCreateParamsNonStreaming['system'],
    messages: [
      {
        role: 'user',
        content: [
          // Static instructions go first and are cached — same for all requests with same
          // software + VAT combo, so Anthropic reuses the cached KV rather than reprocessing
          { type: 'text', text: staticInstructions, cache_control: { type: 'ephemeral' } },
          // File content (dynamic — changes every request, cannot be cached)
          ...contentBlocks,
          // Dynamic context: client info, file names, past transactions
          { type: 'text', text: dynamicContext },
        ] as Anthropic.Messages.MessageParam['content'],
      },
    ],
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') throw new Error('No text response from AI');

  let jsonText = textContent.text.trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
  if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
  if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

  const parsed = JSON.parse(jsonText);
  return {
    validTransactions: parsed.validTransactions || [],
    flaggedEntries: parsed.flaggedEntries || [],
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const {
      clientName, clientAddress, clientId, clientCode, saveToDrive,
      isVatRegistered, targetSoftware, files, pastTransactionsContent, ledgersContent,
    } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('full-analysis')) return moduleNotActive('full-analysis');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);

    // Build the static instructions once — shared across all batches
    const staticInstructions = buildStaticInstructions(targetSoftware, isVatRegistered);

    // Split files into batches of BATCH_SIZE and run in parallel
    const batches: ParsedFile[][] = [];
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      batches.push(files.slice(i, i + BATCH_SIZE));
    }

    const batchResults = await Promise.all(
      batches.map(batch =>
        runBatch(batch, staticInstructions, { clientName, clientAddress, pastTransactionsContent, ledgersContent }, anthropic)
      )
    );

    // Merge results from all batches
    const result = {
      validTransactions: batchResults.flatMap(r => r.validTransactions),
      flaggedEntries: batchResults.flatMap(r => r.flaggedEntries),
    };
    const totalInputTokens = batchResults.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutputTokens = batchResults.reduce((s, r) => s + r.outputTokens, 0);

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'full_analysis' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'full_analysis', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'full_analysis', inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'full_analysis', targetSoftware });
    }

    // Stream the response back — prevents browser/Vercel timeouts on slow connections
    const jsonStr = JSON.stringify(result);
    return new Response(jsonStr, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  } catch (err: unknown) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/analyse]', err);

    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (err as any)?.status;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errType = (err as any)?.error?.error?.type;

    if (status === 413 || errType === 'request_too_large') {
      return NextResponse.json({ error: 'Your files are too large to send to the AI in one request. Try uploading fewer documents at a time — we recommend a maximum of 5 files per run. Large or high-resolution scans should be compressed or split into smaller PDFs before uploading.', code: 'FILES_TOO_LARGE' }, { status: 422 });
    }
    if (message.includes('Could not process document') || errType === 'invalid_request_error') {
      return NextResponse.json({ error: 'One or more files could not be read by the AI. This usually means a file is corrupted, password-protected, or in an unsupported format. Please check your uploads and try again.', code: 'FILE_UNREADABLE' }, { status: 422 });
    }
    if (message.includes('maximum context') || message.includes('too large') || message.includes('context_length')) {
      return NextResponse.json({ error: 'The files you uploaded are too large to process in one go. Try uploading fewer documents at a time (5 max), or split large PDFs into smaller batches.', code: 'FILES_TOO_LARGE' }, { status: 422 });
    }
    if (message.includes('rate_limit') || message.includes('429')) {
      return NextResponse.json({ error: 'The AI service is currently busy. Please wait 30 seconds and try again.', code: 'RATE_LIMIT' }, { status: 429 });
    }
    if (message.includes('overloaded') || message.includes('529')) {
      return NextResponse.json({ error: 'The AI service is temporarily overloaded. Please try again in a minute.', code: 'AI_OVERLOADED' }, { status: 503 });
    }
    if (message.includes('authentication') || message.includes('401') || message.includes('API key')) {
      return NextResponse.json({ error: 'The AI service could not be reached due to an authentication issue. Please contact your system administrator to check the API key configuration.', code: 'AUTH_ERROR' }, { status: 500 });
    }
    if (message.includes('JSON') || message.includes('Unexpected token') || message.includes('parse')) {
      return NextResponse.json({ error: 'The AI returned a response that could not be parsed. This can happen with very complex or unusual documents. Try removing any problematic files and re-running the analysis.', code: 'PARSE_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ error: 'Processing failed unexpectedly. Please try again. If the problem persists, try uploading fewer files or contact support.', code: 'UNKNOWN' }, { status: 500 });
  }
}
