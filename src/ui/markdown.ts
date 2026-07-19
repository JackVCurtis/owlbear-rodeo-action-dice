// A deliberately tiny Markdown-subset parser for the in-app Rules reference. It
// supports exactly what RULES.md uses and nothing more: '#'/'##'/'###' headings,
// blank-line-separated paragraphs, flat '-' bullet lists, inline **bold**, and
// inline `code`. Output is a plain data AST so it can be unit-tested without a
// DOM and rendered by rules.tsx. Anything unrecognized falls back to literal text.

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'code'; value: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; spans: Inline[] }
  | { type: 'paragraph'; spans: Inline[] }
  | { type: 'list'; items: Inline[][] };

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^-\s+(.*)$/;

// Split a text run into text / strong / code spans. Unterminated markers are
// emitted as literal text so malformed input never throws or drops characters.
export function parseInline(text: string): Inline[] {
  const spans: Inline[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) {
      spans.push({ type: 'text', value: buf });
      buf = '';
    }
  };
  while (i < text.length) {
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end !== -1) {
        flush();
        spans.push({ type: 'strong', value: text.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        spans.push({ type: 'code', value: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return spans;
}

const isHeading = (line: string) => HEADING.test(line);
const isBullet = (line: string) => BULLET.test(line);

// Parse a full Markdown document into blocks. Consecutive plain lines fold into
// one paragraph (soft-wrap); consecutive '-' lines fold into one list.
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '') {
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2].trim()),
      });
      i += 1;
      continue;
    }

    if (isBullet(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && isBullet(lines[i].trim())) {
        const [, body] = BULLET.exec(lines[i].trim())!;
        items.push(parseInline(body.trim()));
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (l === '' || isHeading(l) || isBullet(l)) break;
      paraLines.push(l);
      i += 1;
    }
    blocks.push({ type: 'paragraph', spans: parseInline(paraLines.join(' ')) });
  }

  return blocks;
}
