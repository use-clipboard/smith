'use client';

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function exportToCsv(
  data: Record<string, unknown>[],
  filename: string,
  type?: string,
  options?: { header?: string }
): void {
  if (!data || data.length === 0) return;

  let csvContent = '';

  if (options?.header) {
    csvContent += options.header + '\n';
  }

  const headers = Object.keys(data[0]);
  csvContent += headers.map(h => `"${h}"`).join(',') + '\n';

  data.forEach(row => {
    const values = headers.map(header => {
      const val = row[header];
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    });
    csvContent += values.join(',') + '\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface LedgerAccount {
  name: string;
  code?: string;
}

export function parseLedgerCsv(text: string): LedgerAccount[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  // Try to detect header row
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('name') || firstLine.includes('account') || firstLine.includes('code');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines
    .map(line => {
      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 2) {
        return { name: parts[0] || parts[1], code: parts[1] };
      }
      return { name: parts[0] };
    })
    .filter(a => a.name);
}

export function findBestMatch(
  str: string,
  options: LedgerAccount[]
): { bestMatch: LedgerAccount | null; score: number } {
  if (!str || options.length === 0) return { bestMatch: null, score: 0 };

  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const target = normalize(str);

  let bestMatch: LedgerAccount | null = null;
  let bestScore = 0;

  options.forEach(option => {
    const candidate = normalize(option.name);
    const score = similarity(target, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = option;
    }
  });

  return { bestMatch, score: bestScore };
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const aWords = new Set(a.split(' '));
  const bWords = new Set(b.split(' '));
  const intersection = Array.from(aWords).filter(w => bWords.has(w)).length;
  const union = new Set(Array.from(aWords).concat(Array.from(bWords))).size;

  return union === 0 ? 0 : intersection / union;
}

export function parseTrialBalance(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  const lines = text.split('\n').filter(l => l.trim());

  lines.forEach(line => {
    const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
    if (parts.length >= 2) {
      const name = parts[0];
      const amount = parseFloat(parts[1]);
      if (name && !isNaN(amount)) {
        result[name] = amount;
      }
    }
  });

  return result;
}

export async function compressImage(file: File): Promise<File> {
  // Only compress images
  if (!file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const MAX_DIMENSION = 1600;
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round((height * MAX_DIMENSION) / width);
          width = MAX_DIMENSION;
        } else {
          width = Math.round((width * MAX_DIMENSION) / height);
          height = MAX_DIMENSION;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        blob => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.85
      );
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
