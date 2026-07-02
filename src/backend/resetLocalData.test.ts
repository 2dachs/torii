import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectToriiLocalDataTargets,
  formatResetTimestamp,
  resetToriiLocalData,
} from './resetLocalData';

test('formatResetTimestamp creates a filesystem-safe local backup suffix', () => {
  const stamp = formatResetTimestamp(new Date(2026, 6, 1, 3, 4, 5));

  assert.equal(stamp, '20260701-030405');
});

test('collectToriiLocalDataTargets returns existing unique storage paths only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'torii-reset-test-'));
  const globalPath = join(root, 'global');
  const localPath = join(root, 'local');
  await mkdir(globalPath);
  await mkdir(localPath);

  const targets = await collectToriiLocalDataTargets({
    globalStorageUri: { fsPath: globalPath },
    storageUri: { fsPath: localPath },
  } as any, new Date(2026, 6, 1, 3, 4, 5));

  assert.deepEqual(targets.map((target) => target.path), [globalPath, localPath]);
  assert.equal(targets[0].backupPath, `${globalPath}.backup-20260701-030405`);
  assert.equal(targets[1].backupPath, `${localPath}.backup-20260701-030405`);
});

test('resetToriiLocalData renames storage paths into backups', async () => {
  const root = await mkdtemp(join(tmpdir(), 'torii-reset-test-'));
  const globalPath = join(root, 'global');
  await mkdir(globalPath);

  const targets = await resetToriiLocalData({
    globalStorageUri: { fsPath: globalPath },
    storageUri: undefined,
  } as any, new Date(2026, 6, 1, 3, 4, 5));

  assert.equal(targets.length, 1);
  await assert.rejects(stat(globalPath));
  const backup = await stat(`${globalPath}.backup-20260701-030405`);
  assert.equal(backup.isDirectory(), true);
});
