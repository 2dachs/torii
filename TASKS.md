# TASKS — Agent Window / サイドバーUI 改善（0.8.4）

UI/UXレビュー対応。優先度「高」+「中」を1リリースとして実装する。
方針: 狭幅時はアイコン化＋右ペイントグル / Catppuccinとiroriは当面併存 / 詳細は `~/.claude/plans/noble-marinating-graham.md`

## 高優先

- [x] **T1: 実行中の停止ボタン＋入力欄有効化**
  - 対象: `src/webview/agentWindowPanel.ts` / `webview/src/AgentWindow.tsx` / `webview/src/agentWindowState.ts`
  - 内容: `cancelAgent` ハンドラ追加（`agentReq.destroy()` + `POST /api/agent/cancel`、`provider.ts:_handleCancelAgent` をミラー）。送信ボタンを実行中「停止」に切替。textareaの `disabled` を外しEnter送信のみブロック。`requestCancelled` でloading解除
  - テスト: `agentWindowState.test.ts` に requestCancelled ケース追加
  - 完了条件: 実行中に停止でき、停止後すぐ次の依頼を送信できる

- [x] **T2: タスク削除の確認UI**
  - 対象: `webview/src/AgentWindow.tsx` / 新規 `webview/src/agentWindowDeleteConfirm.ts` / `webview/src/agent-window.css`
  - 内容: 「削除」1クリック目で「削除する / キャンセル」のインライン確認に切替、2クリック目で `deleteTask` 送信。`--irori-danger` 変数追加
  - テスト: 新規 `agentWindowDeleteConfirm.test.ts` + `package.json` に `test:agent-window-delete-confirm`
  - 完了条件: 1クリックでタスクが消えない

- [x] **T3: 狭幅レイアウト（font-size:0 廃止・右ペイントグル）**
  - 対象: `webview/src/agent-window.css` / `webview/src/AgentWindow.tsx`
  - 内容: `font-size: 0` ハック削除 → 980px以下は72pxアイコン列（＋=新規タスク、⚙=設定、テキスト系は `display: none`）。右ペインはヘッダートグル `[◧]`（`aria-expanded`）でオーバーレイ表示。メンションpopoverを `bottom: calc(100% + 8px)` に修正。Preview二重スクロール解消（`min-height: calc(100vh - 96px)` 削除 → flex化）
  - 完了条件: 980px以下で不可視の操作可能要素がない（Tab巡回で確認）。Files/Previewに狭幅でも到達できる

- [x] **T4: コントラスト・文字サイズ是正（サイドバー）**
  - 対象: `webview/src/styles.css`
  - 内容: `--text-muted: #6c7086` → `#8288a5`（#1e1e2e で4.70:1、#181825 で5.03:1、#11111b で5.37:1）。`font-size: 10px` 全箇所（約40箇所）を11pxへ引き上げ、最小フォントを11pxに統一（全数12px化は幅300px前後のサイドバーでレイアウト崩れリスクが高いため見送り）
  - 完了条件: #1e1e2e / #181825 両背景で新muted色が4.5:1以上 → 達成

## 中優先

- [x] **T5: 日本語フォントスタック**
  - 対象: `webview/src/styles.css:30` / `webview/src/agent-window.css:19`
  - 内容: `"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", Meiryo` を追加

- [x] **T6: :focus-visible 共通化**
  - 対象: `webview/src/agent-window.css` / `webview/src/styles.css`
  - 内容: `.agent-window-task-delete:focus { outline: none }` 削除。両CSSに `:focus-visible` フォーカスリング追加（irori=gold / Catppuccin=accent）

- [x] **T7: aria付与**
  - 対象: `webview/src/App.tsx` / `webview/src/AgentWindow.tsx`
  - 内容: 絵文字アイコンボタンに `aria-label`、ストリーミング領域に `aria-live="polite"`、承認カードに `role="region"`、添付チップに削除用 `aria-label`

- [x] **T8: 文言・死んだUIの整理（Agent Window）**
  - 対象: `webview/src/AgentWindow.tsx` / `webview/src/agentWindowState.ts`
  - 内容: 空状態文言を行動喚起型に変更。Budget「接続待ち」セクション削除。履歴読み込み中インジケータ追加（`historyLoading` フラグ）

- [x] **T9: Agent WindowのMarkdown描画**
  - 対象: 新規 `webview/src/markdownBlocks.ts` / 新規 `webview/src/MarkdownContent.tsx` / `webview/src/App.tsx` / `webview/src/AgentWindow.tsx` / `webview/src/agent-window.css`
  - 内容: `parseMarkdownBlocks` / `renderInlineMarkdown` / `MarkdownContent` をApp.tsxから共有モジュールへ切り出し（挙動不変）。AgentWindowの完了済みassistantメッセージをMarkdown描画（ストリーミング中はプレーン維持）。`.md-*` CSSをirori配色でagent-window.cssに追加
  - テスト: 新規 `markdownBlocks.test.ts` + `test:markdown-blocks`（`[REMINDER: ...]` 系回帰入力含む）

## リリース

- [x] **T10: ドキュメント・バージョン・検証**
  - `package.json` / `package-lock.json` を 0.8.4 へ。新規 `test:*` を `test` チェーンへ追加
  - `CLAUDE.md` 変更ログ（2026-07-05）・実装済み機能リスト更新、`DESIGN.md` 更新
  - `npm test` / `npm run vscode:prepublish` 成功。Extension Development Hostで手動確認（狭幅・削除確認・停止・Markdown・フォーカスリング）
