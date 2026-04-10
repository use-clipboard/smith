import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAnthropicForFirm, ApiKeyNotConfiguredError } from '@/lib/getAnthropicForFirm';
import { buildLandlordPrompt, buildAddressGroupingPrompt } from '@/prompts/landlord';
import { getUserContext } from '@/lib/getUserContext';
import { buildModuleChecker, moduleNotActive } from '@/lib/modules';
import { uploadDocumentsToDrive, logAiUsage, saveOutput, saveDocumentsToVault } from '@/lib/driveUpload';

const FileSchema = z.object({ name: z.string(), mimeType: z.string(), base64: z.string() });

const RequestSchema = z.object({
  files: z.array(FileSchema),
  clientId: z.string().nullable().optional(),
  clientCode: z.string().nullable().optional(),
  saveToDrive: z.boolean().optional(),
});

/**
 * After AI grouping, do a deterministic pass to catch partial address matches
 * e.g. "9 Rothley Close" vs "9 Rothley Close, Shrewsbury, SY3 6AN"
 */
function mergePartialAddresses(addressMap: Record<string, string>): Record<string, string> {
  // Collect unique canonical values and sort longest-first (most complete)
  const canonicals = Array.from(new Set(Object.values(addressMap)))
    .filter(a => a !== 'No Address')
    .sort((a, b) => b.length - a.length);

  const norm = (s: string) => s.toLowerCase().replace(/[,\s]+/g, ' ').trim();

  // Build a merge map: shorter canonical → longer canonical
  const mergeMap = new Map<string, string>();
  for (let i = 0; i < canonicals.length; i++) {
    for (let j = i + 1; j < canonicals.length; j++) {
      const longer = norm(canonicals[i]);
      const shorter = norm(canonicals[j]);
      // shorter is a prefix of longer (ignoring punctuation/spacing)
      if (longer.startsWith(shorter)) {
        mergeMap.set(canonicals[j], canonicals[i]);
      }
    }
  }

  if (mergeMap.size === 0) return addressMap;

  // Apply the merge: any value that should be replaced, follow chain to final canonical
  const resolve = (addr: string): string => {
    let current = addr;
    const visited = new Set<string>();
    while (mergeMap.has(current) && !visited.has(current)) {
      visited.add(current);
      current = mergeMap.get(current)!;
    }
    return current;
  };

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(addressMap)) {
    result[key] = resolve(value);
  }
  return result;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const { files, clientId, clientCode, saveToDrive } = parsed.data;

    const userCtx = await getUserContext();
    if (!userCtx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { isModuleActive } = buildModuleChecker(userCtx.activeModules);
    if (!isModuleActive('landlord')) return moduleNotActive('landlord');

    const anthropic = await getAnthropicForFirm(userCtx.firmId);
    const prompt = buildLandlordPrompt();

    const fileContent = files.map(f => {
      if (f.mimeType === 'application/pdf') {
        return { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: f.base64 } };
      }
      return { type: 'image' as const, source: { type: 'base64' as const, media_type: f.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: f.base64 } };
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are an expert UK bookkeeper for landlords. Always respond with valid JSON only.',
      messages: [{ role: 'user', content: [...fileContent, { type: 'text', text: prompt }] }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') return NextResponse.json({ error: 'No response from AI' }, { status: 500 });

    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) jsonText = jsonText.substring(7).trim();
    if (jsonText.startsWith('```')) jsonText = jsonText.substring(3).trim();
    if (jsonText.endsWith('```')) jsonText = jsonText.substring(0, jsonText.length - 3).trim();

    const result = JSON.parse(jsonText);

    // AI-powered address grouping
    const allAddresses = [
      ...((result.income || []).map((t: { PropertyAddress: string }) => t.PropertyAddress)),
      ...((result.expenses || []).map((t: { PropertyAddress: string }) => t.PropertyAddress)),
    ].filter(Boolean);
    const uniqueAddresses = Array.from(new Set(allAddresses)) as string[];

    if (uniqueAddresses.length > 1) {
      try {
        const groupingPrompt = buildAddressGroupingPrompt(uniqueAddresses);
        const groupingResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: 'You are an address normalization expert. Always respond with valid JSON only.',
          messages: [{ role: 'user', content: groupingPrompt }],
        });
        const groupingText = groupingResponse.content.find(c => c.type === 'text');
        if (groupingText && groupingText.type === 'text') {
          let gJson = groupingText.text.trim();
          if (gJson.startsWith('```json')) gJson = gJson.substring(7).trim();
          if (gJson.startsWith('```')) gJson = gJson.substring(3).trim();
          if (gJson.endsWith('```')) gJson = gJson.substring(0, gJson.length - 3).trim();
          const groupingResult = JSON.parse(gJson);
          if (groupingResult.addressMap) {
            const map = mergePartialAddresses(groupingResult.addressMap);
            result.income = (result.income || []).map((t: { PropertyAddress: string }) => ({ ...t, PropertyAddress: map[t.PropertyAddress] || t.PropertyAddress }));
            result.expenses = (result.expenses || []).map((t: { PropertyAddress: string }) => ({ ...t, PropertyAddress: map[t.PropertyAddress] || t.PropertyAddress }));
          }
        }
      } catch (groupingError) {
        console.warn('[/api/landlord] Address grouping failed, using original addresses:', groupingError);
      }
    }

    if (userCtx) {
      if (saveToDrive && clientCode) {
        void uploadDocumentsToDrive({ files, clientId: clientId ?? null, clientCode, ...userCtx, feature: 'landlord_analysis' });
        void saveDocumentsToVault({ files, clientId: clientId ?? null, ...userCtx, sourceTool: 'landlord_analysis', siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? '', cookieHeader: req.headers.get('cookie') ?? '' });
      }
      void logAiUsage({ ...userCtx, clientId: clientId ?? null, feature: 'landlord_analysis', inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens });
      void saveOutput({ clientId: clientId ?? null, userId: userCtx.userId, feature: 'landlord_analysis' });
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiKeyNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    console.error('[/api/landlord]', err);
    return NextResponse.json({ error: 'Processing failed. Please try again.' }, { status: 500 });
  }
}
