// Raw import: Vite inlines RULES.md as a string at build time (typed by
// vite/client's `?raw` declaration). RULES.md lives inside the Vite root, so the
// bundled JS carries the full rules text — no runtime fetch.
import rulesMarkdown from '../../RULES.md?raw';
import { parseMarkdown, type Block, type Inline } from './markdown';

function renderInline(spans: Inline[]) {
  return spans.map((span, i) => {
    if (span.type === 'strong') return <strong key={i}>{span.value}</strong>;
    if (span.type === 'code') return <code key={i}>{span.value}</code>;
    return <span key={i}>{span.value}</span>;
  });
}

function renderBlock(block: Block, key: number) {
  if (block.type === 'heading') {
    const children = renderInline(block.spans);
    if (block.level === 1) return <h1 key={key}>{children}</h1>;
    if (block.level === 2) return <h2 key={key}>{children}</h2>;
    return <h3 key={key}>{children}</h3>;
  }
  if (block.type === 'list') {
    return (
      <ul key={key}>
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }
  return <p key={key}>{renderInline(block.spans)}</p>;
}

// Full-panel rules reference. Overlays the board (rendered in App in place of the
// session content), so it works in every phase and for both GM and player.
export function RulesView({ onClose }: { onClose: () => void }) {
  const blocks = parseMarkdown(rulesMarkdown);
  return (
    <section className="rules">
      <div className="rules__bar">
        <h2 className="rules__title">Rules</h2>
        <button className="rules__close" onClick={onClose} aria-label="Close rules">
          ✕ Close
        </button>
      </div>
      <div className="rules__body">{blocks.map((block, i) => renderBlock(block, i))}</div>
    </section>
  );
}
