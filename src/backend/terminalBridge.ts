import * as vscode from 'vscode';

let activeTerminal: vscode.Terminal | undefined;

/**
 * VS Codeの組み込みターミナルにコマンドを送信する
 * （Webview内の疑似ターミナルではなく、VS Code標準ターミナルを使用）
 */
export function executeInTerminal(command: string): void {
  // 既存のターミナルがあれば再利用、なければ新規作成
  if (!activeTerminal || activeTerminal.exitStatus !== undefined) {
    activeTerminal = vscode.window.createTerminal({
      name: 'Torii',
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    });
  }

  activeTerminal.show(true); // preserveFocus = true
  activeTerminal.sendText(command);
}

/**
 * ターミナルを閉じる
 */
export function disposeTerminal(): void {
  if (activeTerminal) {
    activeTerminal.dispose();
    activeTerminal = undefined;
  }
}