import { promises as fsp } from 'fs';

interface StorageUriLike {
  fsPath: string;
}

interface ExtensionContextLike {
  globalStorageUri: StorageUriLike;
  storageUri?: StorageUriLike;
}

export interface ResetLocalDataTarget {
  label: 'global' | 'workspace';
  path: string;
  backupPath: string;
}

export function formatResetTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fsp.stat(targetPath);
    return true;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
}

async function getAvailableBackupPath(baseBackupPath: string): Promise<string> {
  if (!(await exists(baseBackupPath))) return baseBackupPath;

  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${baseBackupPath}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  throw new Error(`バックアップ先を決定できません: ${baseBackupPath}`);
}

export async function collectToriiLocalDataTargets(
  context: ExtensionContextLike,
  date = new Date(),
): Promise<ResetLocalDataTarget[]> {
  const stamp = formatResetTimestamp(date);
  const seen = new Set<string>();
  const candidates: Array<{ label: ResetLocalDataTarget['label']; path?: string }> = [
    { label: 'global', path: context.globalStorageUri?.fsPath },
    { label: 'workspace', path: context.storageUri?.fsPath },
  ];

  const targets: ResetLocalDataTarget[] = [];
  for (const candidate of candidates) {
    if (!candidate.path || seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (!(await exists(candidate.path))) continue;
    const backupBase = `${candidate.path}.backup-${stamp}`;
    targets.push({
      label: candidate.label,
      path: candidate.path,
      backupPath: await getAvailableBackupPath(backupBase),
    });
  }

  return targets;
}

export async function resetToriiLocalData(
  context: ExtensionContextLike,
  date = new Date(),
): Promise<ResetLocalDataTarget[]> {
  const targets = await collectToriiLocalDataTargets(context, date);
  for (const target of targets) {
    await fsp.rename(target.path, target.backupPath);
  }
  return targets;
}
