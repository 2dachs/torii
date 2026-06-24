# Irori

Irori is a local desktop AI chat MVP built with Tauri, React, TypeScript, and SQLite.

## Run

```bash
cd irori
npm install
npm run tauri:dev
```

## Mac app

```bash
cd irori
npm run tauri:build
npm run app:open
```

The bundled app is created at `irori/src-tauri/target/release/bundle/macos/Irori.app`. You can drag that app into the Dock and launch it like a normal Mac app.

## Notes

- MVP provider support is OpenRouter only.
- The initial model list is configurable in the settings UI. Current defaults are Quick = DeepSeek V4 Flash, Standard = DeepSeek V4 Pro, Deep = GLM 5.2. OpenRouter slugs are `deepseek/deepseek-v4-flash` and `deepseek/deepseek-v4-pro`.
- MVP stores the OpenRouter API key in the app database so it does not prompt for Keychain access on every launch.
- Cost is shown in both JPY and USD. The Usage panel also includes a monthly budget bar based on the configured JPY budget and exchange rate.
- The UI is responsive: desktop keeps the navigation/chat/usage layout, while tablet and mobile prioritize the chat view with navigation in a drawer and usage details in a bottom sheet.
- The app icon is Irori-specific: a Japanese dark-academia hearth mark based on fire, a dark sunken hearth frame, and subtle lattice lines without a bright outer frame.
- The same Irori icon is used inside the app chrome, with compact macOS system typography and lighter panels/buttons so the chat content stays visually primary.
- Conversation titles are auto-generated from the first exchange. New conversations still start as `New chat`, then rename themselves after the first reply.
- Projects and conversations can be renamed or deleted from the sidebar details area. Long lists collapse after the first 3 items.
- Send failures now surface the underlying OpenRouter or Tauri error text instead of only the generic fallback.
- Settings are edited as a draft and saved with an explicit button so it is obvious when changes are committed.
- The composer sends with Enter, keeps Shift+Enter for new lines, and ignores Enter while Japanese IME composition is active.
- The first assistant reply is prompted to begin with `Iroriにようこそ。` so the app identity is visible up front.
- Older `GPT-4o` standard-model settings and stale display names are migrated to DeepSeek V4 Pro on startup.
- If a message includes terms such as `検索`, `調べて`, or `最新`, Irori searches the web before calling the selected model and passes source URLs/content as external context. Tavily is used first when a Tavily API key is configured; otherwise Irori falls back to the older lightweight DuckDuckGo/Brave search path. Retry prompts such as `もう一度検索して` reuse the previous user topic when the new query is too short.
- While a response is running, Irori immediately shows the user's pending message and an assistant progress bubble such as `検索中` or `考え中`, then fades the final result in when it arrives.
- `tauri:dev` and `tauri:build` add `irori/bin` to `PATH` with an absolute path so Cargo stays visible even if Tauri changes directories internally.
- `app:build-open` builds the macOS bundle and opens it immediately.
- `bundle.active` is enabled in Tauri config so the build produces a real `.app` bundle instead of only a binary.
- On first launch, the app opens the Settings panel automatically if no OpenRouter API key is stored yet.

## Assumptions

- Deep mode starts with a single OpenRouter-compatible model.
- Fugu, Fusion, and multi-model review are deferred.
- Web search uses Tavily Search API when `Tavily API key` is set. The default depth is `basic` and the search context includes Tavily credit usage when returned by the API. Without a Tavily key, Irori uses DuckDuckGo's public JSON endpoint first, then falls back to DuckDuckGo HTML and Brave Search HTML results when the JSON response has no useful hits or cannot be parsed. High-stakes answers still need source verification.
- The Mac environment needs Rust before `tauri dev` and `tauri build` can work.
