import { memo, useMemo } from 'react';
import type { ReactNode } from 'react';
import { tokenizeInlineMarkdown } from './inlineMarkdown';
import { parseMarkdownBlocks } from './markdownBlocks';

export function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return tokenizeInlineMarkdown(text).map((token, i) => {
    const key = `${keyPrefix}-${token.type}-${i}`;
    switch (token.type) {
      case 'link':
        return (
          <a key={key} href={token.href} target="_blank" rel="noreferrer">
            {token.label}
          </a>
        );
      case 'code':
        return <code key={key}>{token.text}</code>;
      case 'strong':
        return <strong key={key}>{token.text}</strong>;
      case 'em':
        return <em key={key}>{token.text}</em>;
      default:
        return token.text;
    }
  });
}

export const MarkdownContent = memo(function MarkdownContent({ content, className = '' }: { content: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

  return (
    <div className={`markdown-content ${className}`.trim()}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as const;
          return (
            <Tag key={`${block.type}-${index}`} className={`md-heading level-${block.level}`}>
              {renderInlineMarkdown(block.text, `${block.type}-${index}`)}
            </Tag>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <p key={`${block.type}-${index}`} className="md-paragraph">
              {renderInlineMarkdown(block.text, `${block.type}-${index}`)}
            </p>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={`${block.type}-${index}`} className="md-blockquote">
              {block.text.split('\n').map((line, lineIndex) => (
                <p key={lineIndex}>{renderInlineMarkdown(line, `${block.type}-${index}-${lineIndex}`)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag key={`${block.type}-${index}`} className="md-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item, `${block.type}-${index}-${itemIndex}`)}</li>
              ))}
            </ListTag>
          );
        }
        return (
          <div key={`${block.type}-${index}`} className="md-code-block">
            <div className="md-code-header">
              <span>{block.lang || 'text'}</span>
              <button
                className="md-code-copy-btn"
                onClick={() => navigator.clipboard.writeText(block.code)}
                title="コードをコピー"
                aria-label="コードをコピー"
              >
                コピー
              </button>
            </div>
            <pre className="md-code-pre">
              <code>{block.code || ' '}</code>
            </pre>
          </div>
        );
      })}
    </div>
  );
});
