export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; lang: string; code: string };

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  const flushParagraph = (buffer: string[]) => {
    if (buffer.length > 0) {
      blocks.push({ type: 'paragraph', text: buffer.join(' ') });
      buffer.length = 0;
    }
  };

  const paragraphBuffer: string[] = [];

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraphBuffer);
      i += 1;
      continue;
    }

    const fence = trimmed.match(/^```([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph(paragraphBuffer);
      const lang = fence[1] || '';
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) i += 1;
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph(paragraphBuffer);
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph(paragraphBuffer);
      const quoteLines = [quote[1]];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (!next.startsWith('>')) break;
        quoteLines.push(next.replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join('\n') });
      continue;
    }

    const listItem = trimmed.match(/^([-*+])\s+(.*)$/) || trimmed.match(/^\d+\.\s+(.*)$/);
    if (listItem) {
      flushParagraph(paragraphBuffer);
      const ordered = /^\d+\./.test(trimmed);
      const items: string[] = [ordered ? (trimmed.match(/^\d+\.\s+(.*)$/)?.[1] || '') : (listItem[2] || '')];
      i += 1;
      while (i < lines.length) {
        const next = lines[i].trim();
        if (ordered) {
          const m = next.match(/^\d+\.\s+(.*)$/);
          if (!m) break;
          items.push(m[1]);
        } else {
          const m = next.match(/^[-*+]\s+(.*)$/);
          if (!m) break;
          items.push(m[1]);
        }
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    paragraphBuffer.push(trimmed);
    i += 1;
  }

  flushParagraph(paragraphBuffer);
  return blocks;
}
