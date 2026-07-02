const CODE_FENCE_PATH_RE = /```[\w-]*:([^\s`\n]+)/g;
const FILE_EXTENSION_RE = /\.[A-Za-z0-9]{1,10}$/;
const TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/;

function normalizeCandidate(token: string): string {
  return token
    .trim()
    .replace(TRAILING_PUNCTUATION_RE, '')
    .replace(/^["'`([{]+/, '')
    .replace(/["'`\])}]+$/, '');
}

function isExplicitPath(token: string): boolean {
  if (token.startsWith('http://') || token.startsWith('https://')) return false;
  if (!(token.startsWith('./') || token.startsWith('../') || token.startsWith('/'))) return false;
  if (token.length > 500) return false;
  const lastSegment = token.split('/').pop() || '';
  return FILE_EXTENSION_RE.test(lastSegment);
}

export function extractMessageFilePaths(content: string): string[] {
  const paths = new Set<string>();

  for (const match of content.matchAll(CODE_FENCE_PATH_RE)) {
    const path = normalizeCandidate(match[1]);
    if (path && path.length <= 500 && FILE_EXTENSION_RE.test(path.split('/').pop() || '')) {
      paths.add(path);
    }
  }

  for (const rawToken of content.split(/\s+/)) {
    const token = normalizeCandidate(rawToken);
    if (isExplicitPath(token)) {
      paths.add(token);
    }
  }

  return [...paths];
}
