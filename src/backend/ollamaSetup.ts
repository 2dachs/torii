import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type SetupStep = 'checking' | 'installing' | 'detecting_ram' | 'pulling' | 'verifying' | 'done' | 'error';

export interface SetupProgress {
  step: SetupStep;
  message: string;
  recommendedModel?: string;
}

/** RAM容量(GB)からOllamaの推奨モデルを返す */
export function recommendOllamaModel(ramGb: number): string {
  if (ramGb >= 32) return 'qwen2.5-coder:14b';
  if (ramGb >= 16) return 'qwen2.5-coder:7b';
  return 'qwen2.5-coder:3b';
}

/** Macのシステムメモリ容量をGBで返す */
async function detectRamGb(): Promise<number> {
  try {
    const { stdout } = await execAsync('sysctl hw.memsize');
    const bytes = parseInt(stdout.split(':')[1].trim(), 10);
    return Math.round(bytes / (1024 ** 3));
  } catch {
    return 8;
  }
}

/** Ollamaが起動中かチェック */
async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434');
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

/** ollama コマンドのパスを返す（PATH + 標準インストール先を両方確認） */
async function findOllamaPath(): Promise<string | null> {
  const candidates = ['ollama', '/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama'];
  for (const cmd of candidates) {
    try {
      await execAsync(`${cmd} --version`);
      return cmd;
    } catch {
      continue;
    }
  }
  return null;
}

/** ダウンロード済みモデル一覧を取得 */
async function listLocalModels(ollama: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(`${ollama} list`);
    return stdout.split('\n').slice(1).map(l => l.split(/\s+/)[0]).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Ollama自動セットアップを実行する
 * Mac(Homebrew)優先。Windows/Linuxは手動インストールガイドを表示。
 */
export async function runOllamaSetup(
  onProgress: (p: SetupProgress) => void,
): Promise<{ success: boolean; recommendedModel: string }> {
  let recommendedModel = 'qwen2.5-coder:3b';

  try {
    // 1. インストール確認（PATH + 標準インストール先を探索）
    onProgress({ step: 'checking', message: 'Ollamaのインストールを確認しています...' });
    let ollamaCmd = await findOllamaPath();

    // 2. 未インストール → Homebrew でインストール（Mac）
    if (!ollamaCmd) {
      const platform = process.platform;
      if (platform !== 'darwin') {
        onProgress({
          step: 'error',
          message: `⚠️ Windows/Linuxの自動インストールは未対応です。\nhttps://ollama.com からOllamaをダウンロードしてインストールしてください。`,
        });
        return { success: false, recommendedModel };
      }

      onProgress({ step: 'installing', message: 'Ollamaをインストールしています（Homebrew経由）...' });
      try {
        await execAsync('brew install ollama', { timeout: 300_000 });
        ollamaCmd = await findOllamaPath();
        if (!ollamaCmd) throw new Error('インストール後もコマンドが見つかりません');
      } catch (err: any) {
        onProgress({
          step: 'error',
          message: `❌ Homebrewでのインストールに失敗しました。\nhttps://ollama.com から手動でインストールしてください。\n(${err.message})`,
        });
        return { success: false, recommendedModel };
      }
    } else {
      onProgress({ step: 'checking', message: `✅ Ollama インストール済み（${ollamaCmd}）` });
    }

    // 3. RAM検出 → モデル推奨
    onProgress({ step: 'detecting_ram', message: 'メモリ容量を検出しています...' });
    const ramGb = await detectRamGb();
    recommendedModel = recommendOllamaModel(ramGb);
    onProgress({
      step: 'detecting_ram',
      message: `RAM: ${ramGb}GB 検出。推奨モデル: ${recommendedModel}`,
      recommendedModel,
    });

    // 4. Ollamaサーバー起動（すでに起動中の場合はスキップ）
    const alreadyRunning = await isOllamaRunning();
    if (!alreadyRunning) {
      onProgress({ step: 'detecting_ram', message: 'Ollamaサーバーを起動しています...' });
      exec(`${ollamaCmd} serve`);
      let started = false;
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isOllamaRunning()) { started = true; break; }
      }
      if (!started) {
        onProgress({ step: 'error', message: '❌ Ollamaサーバーの起動に失敗しました。ターミナルで `ollama serve` を実行してください。' });
        return { success: false, recommendedModel };
      }
    } else {
      onProgress({ step: 'detecting_ram', message: '✅ Ollamaサーバー起動済み' });
    }

    // 5. モデルが既にダウンロード済みか確認
    const localModels = await listLocalModels(ollamaCmd);
    const modelAlreadyPresent = localModels.some(m => m === recommendedModel || m.startsWith(recommendedModel + ':'));

    if (modelAlreadyPresent) {
      onProgress({
        step: 'verifying',
        message: `✅ ${recommendedModel} は既にインストール済みです`,
        recommendedModel,
      });
    } else {
      onProgress({
        step: 'pulling',
        message: `${recommendedModel} をダウンロードしています（数分かかる場合があります）...`,
        recommendedModel,
      });
      try {
        await execAsync(`${ollamaCmd} pull ${recommendedModel}`, { timeout: 600_000 });
      } catch (err: any) {
        onProgress({
          step: 'error',
          message: `❌ モデルのダウンロードに失敗しました。\nターミナルで \`ollama pull ${recommendedModel}\` を試してください。\n(${err.message})`,
        });
        return { success: false, recommendedModel };
      }
    }

    // 6. 疎通確認
    onProgress({ step: 'verifying', message: 'Ollamaの動作を確認しています...' });
    if (!(await isOllamaRunning())) {
      onProgress({ step: 'error', message: '❌ Ollamaサーバーへの接続を確認できませんでした。' });
      return { success: false, recommendedModel };
    }

    onProgress({
      step: 'done',
      message: `✅ セットアップ完了！${recommendedModel} が使用可能です。`,
      recommendedModel,
    });
    return { success: true, recommendedModel };

  } catch (err: any) {
    onProgress({ step: 'error', message: `❌ セットアップエラー: ${err.message}` });
    return { success: false, recommendedModel };
  }
}
