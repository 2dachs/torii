import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentWindowProgressText } from './agentWindowProgress';

test('getAgentWindowProgressText describes review thinking in Japanese while loading', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    prompt: 'コードレビューをお願いします',
    streamingText: '',
    events: [{ type: 'thinking_start', iteration: 1 }],
  });

  assert.equal(text, 'コードレビューについて思考中...');
});

test('getAgentWindowProgressText shows answer assembly while text is streaming', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    prompt: 'コードレビューをお願いします',
    streamingText: '問題点は',
    events: [],
  });

  assert.equal(text, '回答を組み立て中...');
});

test('getAgentWindowProgressText surfaces context warnings as a problem state', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    prompt: 'コードレビューをお願いします',
    streamingText: '',
    events: [{ type: 'context_warning', message: '添付が大きすぎます' }],
  });

  assert.equal(text, 'コンテキストの問題があります');
});
