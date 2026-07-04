export type PreviewUrlTarget =
  | { kind: 'iframe'; url: string }
  | { kind: 'simpleBrowser'; url: string }
  | { kind: 'invalid'; url: null };

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function normalizePreviewUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidate = toUrlCandidate(trimmed);
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function isLocalPreviewUrl(input: string): boolean {
  const normalized = normalizePreviewUrl(input);
  if (!normalized) return false;

  const url = new URL(normalized);
  const hostname = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(hostname);
}

export function getPreviewUrlTarget(input: string): PreviewUrlTarget {
  const normalized = normalizePreviewUrl(input);
  if (!normalized) return { kind: 'invalid', url: null };
  if (isLocalPreviewUrl(normalized)) return { kind: 'iframe', url: normalized };
  return { kind: 'simpleBrowser', url: normalized };
}

function toUrlCandidate(value: string): string {
  if (/^\d{2,5}(\/.*)?$/.test(value)) {
    return `http://localhost:${value}`;
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/.*)?$/i.test(value)) {
    return `http://${value}`;
  }
  return value;
}
