import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeInlineMarkdown } from './inlineMarkdown';

test('tokenizeInlineMarkdown handles basic markdown tokens', () => {
  assert.deepEqual(tokenizeInlineMarkdown('a **b** `c` [d](https://e.example) f'), [
    { type: 'text', text: 'a ' },
    { type: 'strong', text: 'b' },
    { type: 'text', text: ' ' },
    { type: 'code', text: 'c' },
    { type: 'text', text: ' ' },
    { type: 'link', href: 'https://e.example', label: 'd' },
    { type: 'text', text: ' f' },
  ]);
});

// 実際に保存済みチャット履歴でWebviewを無限ループさせていたパターン。
// 閉じられていない記号で始まるセグメントでも必ず走査が前進すること。
test('tokenizeInlineMarkdown terminates on unclosed bracket (agent REMINDER text)', () => {
  const content = '[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]';
  const tokens = tokenizeInlineMarkdown(content);
  assert.equal(tokens.map((t) => ('text' in t ? t.text : t.label)).join(''), content);
});

test('tokenizeInlineMarkdown terminates on odd underscores and lone asterisks', () => {
  for (const content of [
    '_name）がそのまま一覧表示されている',
    '[📷 1枚の画像 → Gemini 2.5 Flash で読み取り済み]',
    '[プラン変更][停止]ボタン | なし |',
    'a * b',
    '`unclosed code',
    '___',
  ]) {
    const tokens = tokenizeInlineMarkdown(content);
    assert.ok(tokens.length > 0, `no tokens for: ${content}`);
  }
});

test('tokenizeInlineMarkdown finishes quickly on long pathological input', () => {
  const content = `[${'あ'.repeat(50_000)}`;
  const start = Date.now();
  tokenizeInlineMarkdown(content);
  assert.ok(Date.now() - start < 1_000, 'tokenizer took too long');
});
