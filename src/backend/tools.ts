import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import type { AgentTool } from '@cline/agents';
import { isTerminalCommandSafe } from './commandGuard';
import { requestApproval } from './approvalManager';
import { CONFIG_COMMAND_ALLOWLIST, CONFIG_SECTION } from '../constants';
import { getDiffPreviewDecision } from './diffPreviewPolicy';
import { appendTaskReminderForToolResult, TASK_REMINDER } from './toolResultReminder';
import { buildSystemPrompt, buildWorkspaceTree, SKIP_DIRS } from './systemPrompt';

export { buildSystemPrompt, buildWorkspaceTree, SKIP_DIRS };

let _outputChannel: vscode.OutputChannel | null = null;
function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) _outputChannel = vscode.window.createOutputChannel('Torii Agent');
  return _outputChannel;
}

interface FileCheckpoint {
  id: string;
  path: string;
  absPath: string;
  oldContent: string;
  existed: boolean;
  createdAt: number;
  undone: boolean;
}

const fileCheckpoints = new Map<string, FileCheckpoint>();

function normalizeAllowedCommand(command: string): string {
  return command.trim();
}

function getCommandAllowlist(): string[] {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.get<string[]>(CONFIG_COMMAND_ALLOWLIST, []).map(normalizeAllowedCommand).filter(Boolean);
}

function recordFileCheckpoint(pathLabel: string, absPath: string, oldContent: string, existed: boolean): FileCheckpoint {
  const checkpoint: FileCheckpoint = {
    id: uuidv4(),
    path: pathLabel,
    absPath,
    oldContent,
    existed,
    createdAt: Date.now(),
    undone: false,
  };
  fileCheckpoints.set(checkpoint.id, checkpoint);
  return checkpoint;
}

export async function undoFileCheckpoint(id: string): Promise<{ path: string; message: string }> {
  const checkpoint = fileCheckpoints.get(id);
  if (!checkpoint) {
    throw new Error('元に戻す対象が見つかりません');
  }
  if (checkpoint.undone) {
    return { path: checkpoint.path, message: `${checkpoint.path} は既に元に戻されています。` };
  }

  if (checkpoint.existed) {
    fs.writeFileSync(checkpoint.absPath, checkpoint.oldContent, 'utf-8');
    checkpoint.undone = true;
    return { path: checkpoint.path, message: `${checkpoint.path} を変更前の内容に戻しました。` };
  }

  try {
    fs.unlinkSync(checkpoint.absPath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  checkpoint.undone = true;
  return { path: checkpoint.path, message: `${checkpoint.path} を削除して新規作成前の状態に戻しました。` };
}

// ── SDK ツール構築 ──

type ToolOnEvent = (event:
  | { type: 'approval_required'; id: string; tool: string; data: Record<string, unknown> }
  | { type: 'file_change_applied'; undoId: string; path: string; action: 'create' | 'update' }
  | { type: 'text_delta'; text: string }
) => void;

export async function buildClineTools(
  workspacePath: string,
  autoApplyFiles: boolean,
  onEvent: ToolOnEvent,
): Promise<AgentTool<any, any>[]> {
  const { createTool } = await import('@cline/agents');

  const workspaceReal = fs.realpathSync(path.resolve(workspacePath));
  const resolvePath = (rel: string): string => {
    if (typeof rel !== 'string' || rel.length === 0) {
      throw new Error('パスが空です');
    }
    if (path.isAbsolute(rel)) {
      throw new Error('絶対パスは禁止されています（ワークスペース相対パスを指定してください）');
    }
    const abs = path.resolve(workspaceReal, rel);
    if (abs !== workspaceReal && !abs.startsWith(workspaceReal + path.sep)) {
      throw new Error('ワークスペース外へのアクセスは禁止されています');
    }
    // シンボリックリンク経由エスケープ防止（新規パスは ENOENT になるため許容）
    try {
      const real = fs.realpathSync(abs);
      if (real !== workspaceReal && !real.startsWith(workspaceReal + path.sep)) {
        throw new Error('シンボリックリンク経由のワークスペース外アクセスは禁止されています');
      }
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    return abs;
  };

  const awaitApproval = async (id: string, tool: string, data: Record<string, unknown>): Promise<boolean> => {
    onEvent({ type: 'approval_required', id, tool, data });
    return requestApproval(id);
  };

  const showDiffAndWaitApproval = async (
    id: string,
    tool: string,
    data: Record<string, unknown>,
    oldContent: string,
    newContent: string,
    label: string,
  ): Promise<boolean> => {
    const tmpOld = path.join(os.tmpdir(), `torii-old-${id}`);
    const tmpNew = path.join(os.tmpdir(), `torii-new-${id}`);
    const diffTitle = `Torii diff: ${label}`;
    const previewDecision = getDiffPreviewDecision(oldContent, newContent);
    try {
      fs.writeFileSync(tmpOld, oldContent, 'utf-8');
      fs.writeFileSync(tmpNew, newContent, 'utf-8');
    } catch { /* temp diff の作成に失敗しても承認フローは続行 */ }

    const { oldContent: _oldContent, newContent: _newContent, ...approvalData } = data as Record<string, unknown>;
    onEvent({
      type: 'approval_required',
      id,
      tool,
      data: {
        ...approvalData,
        oldSize: oldContent.length,
        newSize: newContent.length,
        diffPreviewSkipped: !previewDecision.openDiff,
        diffPreviewSkippedReason: previewDecision.reason,
        diffTitle,
        approvalDiffOldPath: tmpOld,
        approvalDiffNewPath: tmpNew,
        ...(previewDecision.openDiff ? { oldContent, newContent } : {}),
      },
    });
    const approved = await requestApproval(id);

    // diffタブを閉じる（VSCode 1.71+ tabGroups API）
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.label === diffTitle) {
            await vscode.window.tabGroups.close(tab);
          }
        }
      }
    } catch { /* 閉じられない場合は無視 */ }

    try { fs.unlinkSync(tmpOld); } catch { /* ignore */ }
    try { fs.unlinkSync(tmpNew); } catch { /* ignore */ }

    return approved;
  };

  const readFileCache = new Map<string, { content: string; mtimeMs: number; size: number }>();
  const fileWriteCountMap = new Map<string, number>();

  const rawTools: AgentTool<any, any>[] = [
    // ── read_file ──
    createTool({
      name: 'read_file',
      description: 'ワークスペース内のファイルを読み取る。コードを変更する前に必ず実行して現在の状態を確認する。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルの相対パス (例: src/App.tsx)' },
        },
        required: ['path'],
      },
      execute: async (input: { path: string }) => {
        const absPath = resolvePath(input.path);
        try {
          const stat = fs.statSync(absPath);
          const cached = readFileCache.get(input.path);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached.content;
          }
          const content = fs.readFileSync(absPath, 'utf-8');
          const lineCount = content.split('\n').length;
          const result = `${content}\n\n// [${lineCount}行 | ${path.relative(workspacePath, absPath)}]`;
          readFileCache.set(input.path, { content: result, mtimeMs: stat.mtimeMs, size: stat.size });
          return result;
        } catch (err: any) {
          throw new Error(`ファイル読み取りエラー: ${err.message}`);
        }
      },
    }),

    // ── write_file ──
    createTool({
      name: 'write_file',
      description: 'ファイルを作成または上書きする。必ず read_file で現在の内容を確認してから使用する。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルの相対パス' },
          content: { type: 'string', description: 'ファイルに書き込む内容（全体）' },
        },
        required: ['path', 'content'],
      },
      execute: async (input: { path: string; content: string }) => {
        const fp = input.path;
        const count = fileWriteCountMap.get(fp) ?? 0;
        if (count >= 3) {
          return `[lint-loop-guard] ${fp} への書き込みが3回に達しました。繰り返し修正を中断します。現在の状況をユーザーに報告してください。`;
        }
        fileWriteCountMap.set(fp, count + 1);

        const absPath = resolvePath(fp);
        const existed = fs.existsSync(absPath);
        let oldContent = '';
        try { oldContent = fs.readFileSync(absPath, 'utf-8'); } catch { /* 新規ファイル */ }

        if (!autoApplyFiles) {
          const id = uuidv4();
          const approved = await showDiffAndWaitApproval(
            id, 'write_file', { path: fp, oldContent, newContent: input.content },
            oldContent, input.content, fp,
          );
          if (!approved) return 'ユーザーによってキャンセルされました。';
        }

        try {
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, input.content, 'utf-8');
          const checkpoint = recordFileCheckpoint(fp, absPath, oldContent, existed);
          onEvent({
            type: 'file_change_applied',
            undoId: checkpoint.id,
            path: fp,
            action: existed ? 'update' : 'create',
          });
          readFileCache.delete(fp);
          return `${fp} を書き込みました。`;
        } catch (err: any) {
          throw new Error(`ファイル書き込みエラー: ${err.message}`);
        }
      },
    }),

    // ── replace_in_file ──
    createTool({
      name: 'replace_in_file',
      description: `既存ファイルの一部を SEARCH/REPLACE ブロックで置換する。小さい変更に推奨。
形式:
<<<<<<< SEARCH
[既存のテキスト（完全一致）]
=======
[置き換え後のテキスト]
>>>>>>> REPLACE`,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'ファイルの相対パス' },
          diff: { type: 'string', description: 'SEARCH/REPLACE ブロック形式の差分' },
        },
        required: ['path', 'diff'],
      },
      execute: async (input: { path: string; diff: string }) => {
        const fp = input.path;
        const count = fileWriteCountMap.get(fp) ?? 0;
        if (count >= 3) {
          return `[lint-loop-guard] ${fp} への書き込みが3回に達しました。繰り返し修正を中断します。`;
        }
        fileWriteCountMap.set(fp, count + 1);

        const absPath = resolvePath(fp);
        let oldContent: string;
        try {
          oldContent = fs.readFileSync(absPath, 'utf-8');
        } catch (err: any) {
          throw new Error(`ファイル読み取りエラー: ${err.message}`);
        }

        const pairs: Array<{ search: string; replace: string }> = [];
        const blockRe = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n=======\r?\n([\s\S]*?)\r?\n>>>>>>> REPLACE/g;
        let m: RegExpExecArray | null;
        while ((m = blockRe.exec(input.diff)) !== null) {
          pairs.push({ search: m[1], replace: m[2] });
        }

        if (pairs.length === 0) {
          return 'diff に有効な SEARCH/REPLACE ブロックが見つかりませんでした。形式を確認してください。';
        }

        let newContent = oldContent;
        for (const { search, replace } of pairs) {
          if (!newContent.includes(search)) {
            return `置換対象のテキストが見つかりませんでした。read_file で現在の内容を確認してから再試行してください:\n${search.slice(0, 300)}`;
          }
          newContent = newContent.replace(search, replace);
        }

        if (!autoApplyFiles) {
          const id = uuidv4();
          const approved = await showDiffAndWaitApproval(
            id, 'replace_in_file', { path: fp, oldContent, newContent },
            oldContent, newContent, fp,
          );
          if (!approved) return 'ユーザーによってキャンセルされました。';
        }

        try {
          fs.writeFileSync(absPath, newContent, 'utf-8');
          const checkpoint = recordFileCheckpoint(fp, absPath, oldContent, true);
          onEvent({
            type: 'file_change_applied',
            undoId: checkpoint.id,
            path: fp,
            action: 'update',
          });
          readFileCache.delete(fp);
          return `${fp} を更新しました（${pairs.length}箇所置換）。`;
        } catch (err: any) {
          throw new Error(`ファイル書き込みエラー: ${err.message}`);
        }
      },
    }),

    // ── list_directory ──
    createTool({
      name: 'list_directory',
      description: 'ディレクトリの内容（ファイル・サブディレクトリ）を一覧表示する。',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '対象ディレクトリのパス（省略時はワークスペースルート）' },
        },
        required: [],
      },
      execute: async (input: { path?: string }) => {
        const dirPath = input.path ? resolvePath(input.path) : workspacePath;
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const lines = entries
            .filter((e) => !(e.name.startsWith('.') && e.name !== '.env'))
            .map((e) => `${e.isDirectory() ? '[DIR]' : '[   ]'} ${e.name}`);
          return lines.join('\n') || '(空のディレクトリ)';
        } catch (err: any) {
          throw new Error(`ディレクトリ一覧エラー: ${err.message}`);
        }
      },
    }),

    // ── search_files ──
    createTool({
      name: 'search_files',
      description: 'ワークスペース内の全ファイルからキーワードを検索する。正規表現を使うなら grep_search を優先。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '検索キーワード' },
          path: { type: 'string', description: '検索ルートディレクトリ（省略時はワークスペース全体）' },
        },
        required: ['query'],
      },
      execute: async (input: { query: string; path?: string }) => {
        const query = input.query.toLowerCase();
        const searchRoot = input.path ? resolvePath(input.path) : workspacePath;
        const results: string[] = [];

        const walk = (dir: string) => {
          if (results.length >= 100) return;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (results.length >= 100) break;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
              } else if (entry.isFile()) {
                try {
                  const lines = fs.readFileSync(full, 'utf-8').split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i].toLowerCase().includes(query)) {
                      results.push(`${path.relative(workspacePath, full)}:${i + 1}: ${lines[i].trim()}`);
                      if (results.length >= 100) break;
                    }
                  }
                } catch { /* バイナリスキップ */ }
              }
            }
          } catch { /* ignore */ }
        };

        walk(searchRoot);
        if (results.length === 0) return `"${input.query}" に一致する行が見つかりませんでした。`;
        return results.join('\n');
      },
    }),

    // ── run_command ──
    createTool({
      name: 'run_command',
      description: 'シェルコマンドを実行する。ビルド・テスト・型チェックに使用。実行前にユーザーの承認が必要。長時間かかるコマンドは timeoutMs で延長できる。',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '実行するシェルコマンド' },
          timeoutMs: { type: 'number', description: 'タイムアウト時間（ミリ秒）。省略時は120000。0以下で無制限。' },
        },
        required: ['command'],
      },
      execute: async (input: { command: string; timeoutMs?: number }) => {
        const command = normalizeAllowedCommand(input.command);
        const guard = isTerminalCommandSafe(command);
        if (!guard.safe) return `⚠️ 安全チェックでブロックされました: ${guard.reason}`;

        const allowlist = getCommandAllowlist();
        const isAllowed = allowlist.includes(command);
        if (!isAllowed) {
          const id = uuidv4();
          const approved = await awaitApproval(id, 'run_command', { command, canAllowlist: true });
          if (!approved) return 'ユーザーによってキャンセルされました。';
        }

        const ch = getOutputChannel();
        ch.show(true);
        ch.appendLine(`\n$ ${command}`);
        ch.appendLine(`── 実行中 (cwd: ${workspacePath}) ──`);

        return new Promise<string>((resolve) => {
          const child = spawn(command, {
            cwd: workspacePath,
            shell: true,
            env: {
              ...process.env,
              PATH: [
                process.env.PATH || '',
                '/usr/local/bin', '/usr/bin', '/bin',
                '/opt/homebrew/bin', '/opt/homebrew/sbin',
              ].join(':'),
            },
          });

          const chunks: string[] = [];
          const timeoutMs = typeof input.timeoutMs === 'number' ? input.timeoutMs : 120_000;
          const timer = timeoutMs > 0 ? setTimeout(() => {
            child.kill();
            ch.appendLine('⚠️ タイムアウト');
            resolve(`タイムアウト: ${timeoutMs / 1000}秒を超えました。`);
          }, timeoutMs) : null;

          child.stdout.on('data', (data: Buffer) => {
            const chunk = data.toString();
            chunks.push(chunk);
            ch.append(chunk);
          });
          child.stderr.on('data', (data: Buffer) => {
            const chunk = data.toString();
            chunks.push(chunk);
            ch.append(chunk);
          });
          child.on('close', (code) => {
            if (timer) clearTimeout(timer);
            const output = chunks.join('').trim() || '(出力なし)';
            ch.appendLine(`\n── 終了 (exit ${code}) ──`);
            resolve(code === 0 ? output : `コマンドエラー (exit ${code}):\n${output}`);
          });
          child.on('error', (err) => {
            if (timer) clearTimeout(timer);
            ch.appendLine(`❌ 実行エラー: ${err.message}`);
            resolve(`実行エラー: ${err.message}`);
          });
        });
      },
    }),

    // ── grep_search（NEW） ──
    createTool({
      name: 'grep_search',
      description: 'ワークスペース内のファイルを正規表現でテキスト検索する。関数名・クラス名・シンボルの検索に最適。結果はパス:行番号:内容 形式。',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '検索パターン（正規表現または文字列）' },
          path: { type: 'string', description: '検索ルートディレクトリ（省略時はワークスペース全体）' },
          case_sensitive: { type: 'string', description: '"true" で大文字小文字を区別する（デフォルト: false）' },
          include_pattern: { type: 'string', description: '対象ファイルの拡張子フィルター（例: ".ts,.tsx"）' },
        },
        required: ['pattern'],
      },
      execute: async (input: { pattern: string; path?: string; case_sensitive?: string; include_pattern?: string }) => {
        const searchRoot = input.path ? resolvePath(input.path) : workspacePath;
        const caseSensitive = input.case_sensitive === 'true';
        const includeExts = input.include_pattern?.split(',').map((s) => s.trim());

        let regex: RegExp;
        try {
          regex = new RegExp(input.pattern, caseSensitive ? '' : 'i');
        } catch {
          const escaped = input.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          regex = new RegExp(escaped, caseSensitive ? '' : 'i');
        }

        const results: string[] = [];
        const walk = (dir: string) => {
          if (results.length >= 200) return;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (results.length >= 200) break;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
              } else if (entry.isFile()) {
                if (includeExts && !includeExts.some((ext) => entry.name.endsWith(ext))) continue;
                try {
                  const lines = fs.readFileSync(full, 'utf-8').split('\n');
                  for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                      results.push(`${path.relative(workspacePath, full)}:${i + 1}: ${lines[i].trim()}`);
                      if (results.length >= 200) break;
                    }
                  }
                } catch { /* バイナリスキップ */ }
              }
            }
          } catch { /* ignore */ }
        };

        walk(searchRoot);
        if (results.length === 0) return `"${input.pattern}" に一致する行が見つかりませんでした。`;
        const truncated = results.length >= 200 ? '\n... (200件以上。パスや拡張子フィルターで絞ってください)' : '';
        return results.join('\n') + truncated;
      },
    }),

    // ── find_files（NEW） ──
    createTool({
      name: 'find_files',
      description: 'ファイル名パターンでワークスペース内のファイルを探す。glob パターン（*.ts, **/*.test.ts）または部分一致で検索。ファイルの場所が不明な場合に最初に使う。',
      inputSchema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'ファイル名の部分一致または glob パターン（例: "*.ts", "App.tsx", "**/*.test.*"）' },
          path: { type: 'string', description: '検索ルートディレクトリ（省略時はワークスペース全体）' },
        },
        required: ['pattern'],
      },
      execute: async (input: { pattern: string; path?: string }) => {
        const searchRoot = input.path ? resolvePath(input.path) : workspacePath;
        const pat = input.pattern.toLowerCase();

        const globToRegex = (glob: string): RegExp => {
          const escaped = glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '##DSTAR##')
            .replace(/\*/g, '[^/]*')
            .replace(/##DSTAR##/g, '.*');
          return new RegExp(escaped + '$', 'i');
        };

        const isGlob = pat.includes('*') || pat.includes('?');
        const matchRegex = isGlob ? globToRegex(pat) : null;

        const results: string[] = [];
        const walk = (dir: string) => {
          if (results.length >= 100) return;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (results.length >= 100) break;
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(full);
              } else {
                const rel = path.relative(workspacePath, full);
                const matches = matchRegex
                  ? matchRegex.test(rel.replace(/\\/g, '/'))
                  : entry.name.toLowerCase().includes(pat);
                if (matches) results.push(rel);
              }
            }
          } catch { /* ignore */ }
        };

        walk(searchRoot);
        if (results.length === 0) return `"${input.pattern}" に一致するファイルが見つかりませんでした。`;
        return results.join('\n');
      },
    }),

    // ── attempt_completion（NEW） ──
    createTool({
      name: 'attempt_completion',
      description: 'タスクが完全に完了したときだけ呼ぶ。途中では絶対呼ばない。すべての変更・確認・ビルドチェックが終わってから使用する。',
      inputSchema: {
        type: 'object',
        properties: {
          result: { type: 'string', description: '作業サマリー: 何をしたか・何が変わったか（3行以内）' },
          command: { type: 'string', description: '（省略可）成果物の確認コマンド（例: npm run dev）' },
        },
        required: ['result'],
      },
      lifecycle: { completesRun: true },
      execute: async (input: { result: string; command?: string }) => {
        return input.command
          ? `${input.result}\n\n確認コマンド: ${input.command}`
          : input.result;
      },
    }),
  ];

  return rawTools.map((tool) => ({
    ...tool,
    execute: async (input: any) => {
      const result = await (tool.execute as (input: any) => Promise<any>)(input);
      return appendTaskReminderForToolResult(tool.name, result);
    },
  }));
}
