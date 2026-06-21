/**
 * Command Guard - AIが危険なコマンドを実行するのを防ぐフィルタリング層
 *
 * ユーザーメッセージ内のコマンド提案や実行指示を検査し、
 * 危険と判断された場合はブロックする
 */

// ブロック対象の危険なコマンドパターン
const DANGEROUS_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-rf\s+\/\b/, reason: '危険: rm -rf / は禁止されています' },
  { pattern: /\brm\s+-rf\s+\/\*/ , reason: '危険: システム全体の削除は禁止されています' },
  { pattern: /\brm\s+-rf\s+~/, reason: '危険: ホームディレクトリの削除は禁止されています' },
  { pattern: /\brm\s+-rf\s+\$\{?HOME\}?/, reason: '危険: ホームディレクトリの削除は禁止されています' },
  { pattern: /:\s*\(\)\s*\{\s*:\s*\|:\s*&\s*\};\s*:/, reason: '危険: フォークボムは禁止されています' },
  { pattern: /\bdd\s+if=.+\s+of=\/dev\//, reason: '危険: /dev/ への直接書き込みは禁止されています' },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: '危険: ディスクへの直接書き込みは禁止されています' },
  { pattern: /\bmkfs\./, reason: '危険: ファイルシステムの作成は禁止されています' },
  { pattern: /\bfind\b[\s\S]*?-delete\b/, reason: '危険: find -delete は広範囲の削除につながるため禁止されています' },
  { pattern: /\bkill\s+-9\b/, reason: '危険: kill -9 はプロセスを強制終了するため禁止されています' },
  { pattern: /\b(sudo|su)\b/, reason: '危険: sudo/su は実行を禁止しています' },
  { pattern: /\b(shutdown|reboot|poweroff|halt)\b/, reason: '危険: システム停止コマンドは禁止されています' },
  { pattern: /\bchmod\s+(-R\s+)?777\s+\//, reason: '危険: ルートディレクトリのパーミッション変更は禁止されています' },
  { pattern: /\bchown\s+(-R\s+)?[^:]+:[^\s]+\s+\//, reason: '危険: ルートディレクトリの所有者変更は禁止されています' },
  { pattern: /\bgit\s+clean\s+-fdx\b/, reason: '危険: git clean -fdx は未追跡ファイルも含めて削除します' },
  // eval 系（空白なし含む）
  { pattern: /\beval\s*\$\(/, reason: '危険: eval $() は禁止されています' },
  { pattern: /\beval\s+".*"/, reason: '危険: eval による文字列実行は禁止されています' },
  // curl/wget パイプ実行
  { pattern: /curl\s+.*\|\s*(ba)?sh\b/, reason: '危険: curlパイプでのsh実行は禁止されています' },
  { pattern: /curl\s+.*\|\s*bash\b/, reason: '危険: curlパイプでのbash実行は禁止されています' },
  { pattern: /wget\s+.*\|\s*(ba)?sh\b/, reason: '危険: wgetパイプでのsh実行は禁止されています' },
  { pattern: /sh\s+<\s*\(\s*curl/, reason: '危険: sh <(curl ...) は禁止されています' },
  { pattern: /bash\s+<\s*\(\s*curl/, reason: '危険: bash <(curl ...) は禁止されています' },
  // bash/sh -c による任意実行
  { pattern: /\b(bash|sh|zsh|fish|ksh)\s+-c\s+["']?\s*(rm|curl|wget|python|perl|ruby|node)/, reason: '危険: シェル -c による危険なコマンド実行は禁止されています' },
  // base64 デコードパイプ
  { pattern: /base64\s+(--decode|-d)\s*\|/, reason: '危険: base64デコードのパイプ実行は禁止されています' },
  { pattern: /\|\s*base64\s+(--decode|-d)\s*\|/, reason: '危険: base64デコードのパイプ実行は禁止されています' },
  // インタプリタ経由の任意実行
  { pattern: /\bpython[23]?\s+-c\s+["'].*os\.(system|popen|exec)/, reason: '危険: Python経由のOS操作は禁止されています' },
  { pattern: /\bperl\s+-e\s+["'].*system\s*\(/, reason: '危険: Perl経由のOS操作は禁止されています' },
  { pattern: /\bruby\s+-e\s+["'].*`.*`/, reason: '危険: Ruby経由のコマンド実行は禁止されています' },
  // source/. による外部スクリプト実行
  { pattern: /\b(source|\.)(\s+)https?:\/\//, reason: '危険: 外部スクリプトのsourceは禁止されています' },
  // git 操作
  { pattern: /\bgit\s+push\s+--force\s+origin\s+(main|master)\b/, reason: '危険: main/masterブランチへのforce pushは禁止されています' },
  { pattern: /\bgit\s+push\s+-f\s+origin\s+(main|master)\b/, reason: '危険: main/masterブランチへのforce pushは禁止されています' },
  // Docker
  { pattern: /\bdocker\s+rm\s+-f\s+\$\(docker\s+ps/, reason: '危険: 全コンテナの強制削除は禁止されています' },
  { pattern: /\bdocker\s+system\s+prune\s+-af?\b/, reason: '危険: 全Dockerリソースの完全削除は禁止されています' },
  // SQL
  { pattern: /\bDROP\s+(TABLE|DATABASE)\b/i, reason: '危険: SQL DROP文は注意が必要です' },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: '危険: SQL TRUNCATE文は注意が必要です' },
];

// 警告対象の注意すべきパターン（ブロックはしないが警告を出す）
const WARNING_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\brm\s+-rf\s+\.[^\s]*/, reason: '警告: カレントディレクトリのファイル削除が含まれています' },
  { pattern: /\brm\s+-rf\s+node_modules\b/, reason: '警告: node_modulesの削除が含まれています' },
  { pattern: /\bnpm\s+publish\b/, reason: '注意: npm publishが含まれています。公開前に確認してください' },
  { pattern: /\bgit\s+reset\s+--hard\b/, reason: '警告: git reset --hardは変更を破棄します' },
  { pattern: /\bgit\s+clean\s+-fd/, reason: '警告: git clean -fdは未追跡ファイルを削除します' },
  { pattern: /\bDROP\s+COLUMN\b/i, reason: '警告: SQL DROP COLUMNはデータを削除します' },
];

export interface GuardResult {
  safe: boolean;
  reason?: string;
  warning?: string;
}

/**
 * メッセージに危険なコマンドが含まれていないか検査する
 */
export function isCommandSafe(message: string): GuardResult {
  // コードブロック内のコマンドのみを検査
  // ```bash ... ``` または ```sh ... ``` ブロックを抽出
  const codeBlockRegex = /```(?:ba)?sh?\s*\n([\s\S]*?)```/g;
  const inlineCodeRegex = /`([^`]+)`/g;

  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null;

  // コードブロックを抽出
  while ((match = codeBlockRegex.exec(message)) !== null) {
    codeBlocks.push(match[1]);
  }

  // インラインコードを抽出
  while ((match = inlineCodeRegex.exec(message)) !== null) {
    codeBlocks.push(match[1]);
  }

  // コードブロックがなければ安全
  if (codeBlocks.length === 0) {
    return { safe: true };
  }

  // 全コードブロックを連結して検査
  const allCode = codeBlocks.join('\n');

  // 危険パターンをチェック
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(allCode)) {
      return { safe: false, reason };
    }
  }

  // 警告パターンをチェック
  for (const { pattern } of WARNING_PATTERNS) {
    if (pattern.test(allCode)) {
      const warning = WARNING_PATTERNS.find(w => w.pattern.test(allCode))?.reason;
      return { safe: true, warning };
    }
  }

  return { safe: true };
}

/**
 * 実行前の最終チェック（ターミナルに送信する前）
 */
export function isTerminalCommandSafe(command: string): GuardResult {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason };
    }
  }
  return { safe: true };
}
