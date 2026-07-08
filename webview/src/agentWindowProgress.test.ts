import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentWindowProgressText } from './agentWindowProgress';

test('getAgentWindowProgressText describes review thinking in Japanese while loading', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    pendingApprovalCount: 0,
    prompt: 'コードレビューをお願いします',
    streamingText: '',
    events: [{ type: 'thinking_start', iteration: 1 }],
  });

  assert.equal(text, 'コードレビューについて思考中...');
});

test('getAgentWindowProgressText shows answer assembly while text is streaming', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    pendingApprovalCount: 0,
    prompt: 'コードレビューをお願いします',
    streamingText: '問題点は',
    events: [],
  });

  assert.equal(text, '回答を組み立て中...');
});

test('getAgentWindowProgressText surfaces context warnings as a problem state', () => {
  const text = getAgentWindowProgressText({
    loading: true,
    pendingApprovalCount: 0,
    prompt: 'コードレビューをお願いします',
    streamingText: '',
    events: [{ type: 'context_warning', message: '添付が大きすぎます' }],
  });

  assert.equal(text, 'コンテキストの問題があります');
});


test("getAgentWindowProgressText prioritizes pending approvals over streaming text", () => {
  const text = getAgentWindowProgressText({
    loading: true,
    pendingApprovalCount: 1,
    prompt: "UI/UX面のコードレビューをお願いします",
    streamingText: "回答をまとめています",
    events: [{ type: "tool_use", id: "tool-1", tool: "replace_in_file", input: {} }],
  });

  assert.equal(text, "承認が必要な操作があります");
});
