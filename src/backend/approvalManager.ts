const pending = new Map<string, (ok: boolean) => void>();

export function requestApproval(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    // 30分でタイムアウト（承認カードを見落とした場合の保険）
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve(false);
      }
    }, 30 * 60 * 1000);
  });
}

export function resolveApproval(id: string, approved: boolean): void {
  const resolve = pending.get(id);
  if (resolve) {
    pending.delete(id);
    resolve(approved);
  }
}

export function clearAllPending(): void {
  for (const [, resolve] of pending) {
    resolve(false);
  }
  pending.clear();
}
