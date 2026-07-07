import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = process.cwd();

const checkedFiles = [
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'DESIGN.md',
  'BRIEFING.md',
  'src/backend/tools.ts',
  'package.json',
  'webview/package.json',
  'webview/package-lock.json',
];

const allowedPatterns = [
  /\.pettal/,
  /pettalConfig/,
  /PettalConfig/,
  /PettalProjectConfig/,
  /PettalRoutingRule/,
  /PettalModelLimit/,
  /loadPettalConfig/,
  /savePettalConfig/,
  /MSG_LOAD_PETTAL_CONFIG/,
  /MSG_SAVE_PETTAL_CONFIG/,
  /pettal\.torii/,
  /publisher:\s*`?pettal`?/,
  /"publisher":\s*"pettal"/,
  /pettal-git-main-daisuke-webapps-projects\.vercel\.app/,
  /jp\.pettal\./,
  /Pettalの事業/,
  /Copyright \(c\) 2025 Pettal/,
];

test('public branding surfaces use Torii, except compatibility identifiers', () => {
  const violations: string[] = [];

  for (const file of checkedFiles) {
    const absolutePath = path.join(repoRoot, file);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (!/\bPettal\b|\bpettal\b/.test(line)) {
        return;
      }
      if (allowedPatterns.some((pattern) => pattern.test(line))) {
        return;
      }
      violations.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }

  assert.deepEqual(violations, []);
});

test('CLAUDE.md delegates project instructions to AGENTS.md', () => {
  const content = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf-8');
  const lines = content.split(/\r?\n/);

  assert.equal(lines[0], '@AGENTS.md');
  assert.match(content, /最初に必ず `AGENTS\.md` を読む/);
  assert.doesNotMatch(content, /## 実装済み機能/);
  assert.doesNotMatch(content, /## 修正・変更ログ/);
  assert.ok(lines.length <= 20, 'CLAUDE.md should stay as a thin pointer, not a duplicated handbook');
});
