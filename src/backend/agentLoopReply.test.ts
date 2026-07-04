import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAgentLoopReply } from './agentLoopReply';

test('chooseAgentLoopReply keeps the visible assistant review when attempt_completion only returns a short summary', () => {
  const visible = 'UI/UXの問題\n\n1. ボタンが小さい\n2. コントラストが不足\n\n改善案を提示します。';
  const completion = 'コードレビュー完了。UI/UX、セキュリティ、メンテナンス性の観点から問題点と改善案を提示しました。';

  assert.equal(chooseAgentLoopReply(completion, completion, visible), visible);
});

test('chooseAgentLoopReply uses completion output when it is the only substantive answer', () => {
  assert.equal(chooseAgentLoopReply('完了しました', '完了しました', ''), '完了しました');
});
