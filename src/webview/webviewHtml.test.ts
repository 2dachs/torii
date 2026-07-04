import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildWebviewHtml } from './webviewHtml';

function createFakeWebview() {
  return {
    cspSource: 'vscode-webview://torii',
    asWebviewUri(uri: { fsPath: string }) {
      return `vscode-resource:${uri.fsPath}`;
    },
  };
}

function createFixtureExtension() {
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'torii-webview-html-'));
  const distPath = path.join(extensionPath, 'dist', 'webview');
  fs.mkdirSync(distPath, { recursive: true });
  fs.writeFileSync(
    path.join(distPath, 'index.html'),
    '<!DOCTYPE html><html><head><title>Torii</title><link rel="stylesheet" href="/assets/index.css"></head><body><script type="module" src="/assets/index.js"></script></body></html>',
  );
  fs.writeFileSync(
    path.join(distPath, 'agent-window.html'),
    '<!DOCTYPE html><html><head><title>Torii Agent Window</title><link rel="stylesheet" href="/assets/agent-window.css"></head><body><script type="module" src="/assets/agent-window.js"></script></body></html>',
  );
  return extensionPath;
}

test('buildWebviewHtml loads the sidebar entry by default', () => {
  const extensionPath = createFixtureExtension();
  const html = buildWebviewHtml({
    webview: createFakeWebview(),
    extensionPath,
    entryHtml: 'index.html',
  });

  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src vscode-webview:\/\/torii/);
  assert.match(html, /frame-src http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /src="vscode-resource:.*\/dist\/webview\/assets\//);
  assert.doesNotMatch(html, /agent-window/);
});

test('buildWebviewHtml can load the Agent Window entry', () => {
  const extensionPath = createFixtureExtension();
  const html = buildWebviewHtml({
    webview: createFakeWebview(),
    extensionPath,
    entryHtml: 'agent-window.html',
  });

  assert.match(html, /<title>Torii Agent Window<\/title>/);
  assert.match(html, /agent-window/);
  assert.match(html, /href="vscode-resource:.*\/dist\/webview\/assets\//);
});
