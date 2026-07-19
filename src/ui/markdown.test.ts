import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('splits a run into text, bold, and code spans', () => {
    expect(parseInline('roll `d20` for **advantage** now')).toEqual([
      { type: 'text', value: 'roll ' },
      { type: 'code', value: 'd20' },
      { type: 'text', value: ' for ' },
      { type: 'strong', value: 'advantage' },
      { type: 'text', value: ' now' },
    ]);
  });

  it('treats an unterminated marker as literal text', () => {
    expect(parseInline('a **b')).toEqual([{ type: 'text', value: 'a **b' }]);
  });
});

describe('parseMarkdown', () => {
  it('parses headings at each supported level', () => {
    const blocks = parseMarkdown('# One\n\n## Two\n\n### Three');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, spans: [{ type: 'text', value: 'One' }] },
      { type: 'heading', level: 2, spans: [{ type: 'text', value: 'Two' }] },
      { type: 'heading', level: 3, spans: [{ type: 'text', value: 'Three' }] },
    ]);
  });

  it('groups consecutive bullet lines into one flat list with inline spans', () => {
    const blocks = parseMarkdown('- **PCs:** many\n- one die');
    expect(blocks).toEqual([
      {
        type: 'list',
        items: [
          [
            { type: 'strong', value: 'PCs:' },
            { type: 'text', value: ' many' },
          ],
          [{ type: 'text', value: 'one die' }],
        ],
      },
    ]);
  });

  it('folds soft-wrapped lines into a single paragraph and ignores blank lines', () => {
    const blocks = parseMarkdown('\nfirst line\nsecond line\n\n');
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ type: 'text', value: 'first line second line' }] },
    ]);
  });
});
