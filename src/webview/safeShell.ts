export interface SafeShellOptions {
  status?: string;
  error?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildSafeShellHtml(options: SafeShellOptions = {}): string {
  const status = escapeHtml(options.status ?? 'VS Code起動直後の安定性を優先し、Torii本体はまだ起動していません。');
  const error = options.error ? escapeHtml(options.error) : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Torii Safe Shell</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #171626;
      --panel: #201d32;
      --border: rgba(199, 163, 255, 0.24);
      --text: #f1eefb;
      --muted: #b8afd2;
      --accent: #c7a3ff;
      --danger: #ff8a9b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .shell {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: #141322;
      font-weight: 700;
    }
    .mark { color: #9b2f24; font-size: 15px; }
    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 24px 18px;
      text-align: center;
    }
    .status {
      color: var(--muted);
      max-width: 32rem;
      margin: 0;
    }
    .error {
      width: 100%;
      max-width: 32rem;
      color: var(--danger);
      background: rgba(255, 138, 155, 0.08);
      border: 1px solid rgba(255, 138, 155, 0.28);
      border-radius: 8px;
      padding: 10px 12px;
      overflow-wrap: anywhere;
    }
    button {
      appearance: none;
      border: 1px solid rgba(199, 163, 255, 0.5);
      border-radius: 8px;
      padding: 9px 16px;
      color: #171626;
      background: var(--accent);
      font-weight: 700;
      cursor: pointer;
      min-width: 150px;
    }
    button:disabled {
      opacity: 0.62;
      cursor: default;
    }
  </style>
</head>
<body>
  <main class="shell">
    <div class="header"><span class="mark">鳥</span><span>Torii</span></div>
    <section class="content" aria-live="polite">
      <p id="status" class="status">${status}</p>
      ${error ? `<div class="error">${error}</div>` : ''}
      <button id="boot" type="button">Toriiを起動</button>
    </section>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const button = document.getElementById('boot');
    const status = document.getElementById('status');
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = '起動中...';
      status.textContent = 'Torii本体を初期化しています。';
      vscode.postMessage({ command: 'bootTorii' });
    });
  </script>
</body>
</html>`;
}
