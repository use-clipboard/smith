'use client';

// Convert a Word (.docx) document into plain text so it can be sent to Claude
// as a text block (the AI can't read a .docx binary or a non-image media type).
// A .docx is a zip whose word/document.xml holds the body; we unzip it with
// fflate (already a dependency) and strip the XML down to readable text — no
// extra library needed. Layout is lost, but Word "invoices" are typically simple
// enough that the figures and supplier still come through.
//
// The legacy binary .doc format is NOT a zip and can't be read this way; those
// throw and fall through to the normal failed-scan handling (flagged for manual
// entry).

/** True for Word files we convert to text rather than send as a PDF/image. */
export function isWordFile(file: File): boolean {
  return /\.docx$/i.test(file.name)
    || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

/** Extract readable text from a .docx file. */
export async function wordToText(file: File): Promise<string> {
  if (/\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name)) {
    throw new Error('Old-format .doc files aren’t supported — please save as .docx or PDF.');
  }
  const { unzipSync } = await import('fflate');
  const buf = new Uint8Array(await file.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buf);
  } catch {
    throw new Error('Could not open the Word document — it may be corrupted or an old .doc format.');
  }

  const docXml = entries['word/document.xml'];
  if (!docXml) throw new Error('Could not read the Word document contents.');

  let xml = new TextDecoder().decode(docXml);
  xml = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')   // tab → tab
    .replace(/<w:br\b[^>]*\/?>/g, '\n')    // line break → newline
    .replace(/<\/w:p>/g, '\n')             // end of paragraph → newline
    .replace(/<[^>]+>/g, '');              // strip all remaining tags

  const text = xml
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) throw new Error('The Word document appears to be empty.');
  return text;
}
