import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { PROVIDERS } from '../constants';

export interface BuildWebviewHtmlOptions {
  webview: {
    cspSource: string;
    asWebviewUri(uri: vscode.Uri): string | { toString(): string };
  };
  extensionPath: string;
  entryHtml: string;
  resourceRootUri?: vscode.Uri;
}

function getProviderEndpointOrigins(): string {
  const origins = new Set<string>();
  for (const provider of Object.values(PROVIDERS)) {
    try {
      origins.add(new URL(provider.defaultEndpoint).origin);
    } catch {
      // Ignore invalid endpoint defaults.
    }
  }
  origins.add('http://localhost:11434');
  return [...origins].join(' ');
}

export function buildWebviewHtml(options: BuildWebviewHtmlOptions): string {
  const distWebviewPath = path.join(options.extensionPath, 'dist', 'webview');
  const htmlPath = path.join(distWebviewPath, options.entryHtml);
  let html = fs.readFileSync(htmlPath, 'utf-8');

  const csp = [
    `default-src 'none';`,
    `style-src ${options.webview.cspSource} http://localhost:* http://127.0.0.1:* 'unsafe-inline';`,
    `script-src ${options.webview.cspSource} http://localhost:* http://127.0.0.1:*;`,
    `connect-src http://localhost:* http://127.0.0.1:* ${getProviderEndpointOrigins()} https:;`,
    `frame-src http://localhost:* http://127.0.0.1:* http://[::1]:* https://localhost:* https://127.0.0.1:* https://[::1]:*;`,
    `img-src ${options.webview.cspSource} https: data:;`,
    `font-src ${options.webview.cspSource};`,
    `media-src ${options.webview.cspSource} data:;`,
  ].join(' ');

  html = html.replace(
    '<head>',
    `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`
  );

  const resourceRootUri = options.resourceRootUri ?? ({ fsPath: distWebviewPath } as vscode.Uri);
  const distWebviewUri = options.webview.asWebviewUri(resourceRootUri).toString();
  html = html.replace(/(src|href)="\/([^"]+)"/g, `$1="${distWebviewUri}/$2"`);
  html = html.replace(/(src|href)="\.\/([^"]+)"/g, `$1="${distWebviewUri}/$2"`);

  return html;
}
