import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownBlocks } from './markdownBlocks';

test('parseMarkdownBlocks parses headings, lists, quotes and paragraphs', () => {
  const blocks = parseMarkdownBlocks([
    '# タイトル',
    '',
    '本文です。',
    '',
    '- 項目1',
    '- 項目2',
    '',
    '> 引用行',
  ].join('\n'));

  assert.deepEqual(blocks, [
    { type: 'heading', level: 1, text: 'タイトル' },
    { type: 'paragraph', text: '本文です。' },
    { type: 'list', ordered: false, items: ['項目1', '項目2'] },
    { type: 'quote', text: '引用行' },
  ]);
});

test('parseMarkdownBlocks parses fenced code with language', () => {
  const blocks = parseMarkdownBlocks('```ts\nconst a = 1;\n```');
  assert.deepEqual(blocks, [{ type: 'code', lang: 'ts', code: 'const a = 1;' }]);
});

test('parseMarkdownBlocks keeps an unterminated fence as code', () => {
  const blocks = parseMarkdownBlocks('```\nabc');
  assert.deepEqual(blocks, [{ type: 'code', lang: '', code: 'abc' }]);
});

test('parseMarkdownBlocks parses ordered lists', () => {
  const blocks = parseMarkdownBlocks('1. 一つ目\n2. 二つ目');
  assert.deepEqual(blocks, [{ type: 'list', ordered: true, items: ['一つ目', '二つ目'] }]);
});

test('parseMarkdownBlocks treats reminder-style bracket text as a paragraph (0.7.0回帰)', () => {
  const reminder = '[REMINDER: 元のタスクに集中し、完了までツールを使い続けよ。attempt_completion を呼ぶまで停止するな。]';
  const blocks = parseMarkdownBlocks(reminder);
  assert.deepEqual(blocks, [{ type: 'paragraph', text: reminder }]);
});

test('parseMarkdownBlocks handles image placeholders and odd underscores without hanging', () => {
  const inputs = [
    '[📷 1枚の画像 → gemini-2.5-flash]',
    'file_name_with_odd_underscores_',
    '*not closed emphasis',
  ];
  for (const input of inputs) {
    const blocks = parseMarkdownBlocks(input);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].type, 'paragraph');
  }
});
