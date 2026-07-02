export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string };

const TOKEN_PATTERN =
  /^(https?:\/\/[^\s<]+|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/;
const NEXT_CANDIDATE = /https?:\/\/|`|\*\*|__|\*|_|\[/;

export function tokenizeInlineMarkdown(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === 'text') {
      last.text += value;
    } else {
      tokens.push({ type: 'text', text: value });
    }
  };

  while (index < text.length) {
    const rest = text.slice(index);
    const match = rest.match(TOKEN_PATTERN);

    if (!match) {
      // 閉じられていない記号（`[REMINDER: ...]` や奇数個の `_` 等）で先頭が
      // 候補記号のままトークン不成立になるケースでも、必ず1文字以上進める。
      // 進めないと while が無限ループし、Webviewレンダラー全体が停止する。
      const next = rest.slice(1).search(NEXT_CANDIDATE);
      const end = next === -1 ? rest.length : next + 1;
      pushText(rest.slice(0, end));
      index += end;
      continue;
    }

    const token = match[1];
    index += token.length;

    if (token.startsWith('http://') || token.startsWith('https://')) {
      tokens.push({ type: 'link', href: token, label: token });
      continue;
    }
    if (token.startsWith('`') && token.endsWith('`')) {
      tokens.push({ type: 'code', text: token.slice(1, -1) });
      continue;
    }
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      tokens.push({ type: 'strong', text: token.slice(2, -2) });
      continue;
    }
    if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      tokens.push({ type: 'em', text: token.slice(1, -1) });
      continue;
    }
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      tokens.push({ type: 'link', href: linkMatch[2], label: linkMatch[1] });
      continue;
    }
    pushText(token);
  }

  return tokens;
}
