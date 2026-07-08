import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './systemPrompt';

test('buildSystemPrompt instructs the agent to write commit messages in English', async () => {
  const prompt = await buildSystemPrompt(process.cwd());
  assert.match(prompt, /コミットメッセージは英語で書く/);
  assert.match(prompt, /type: summary/);
});
