# Irori Web

Irori Web is the first Next.js + Supabase implementation slice for using Irori from a browser or phone.

## Stack

- Next.js App Router + TypeScript + Tailwind CSS
- Supabase Auth, Postgres, RLS, Edge Functions, Vault
- Vercel target hosting
- Shared cost/routing utilities from `../packages/core`

## Local setup

```bash
cd irori-web
npm install
cp .env.example .env.local
npm run dev
```

Required `.env.local` values:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## Supabase setup

1. Create a Supabase project.
2. Enable Google provider in Supabase Auth.
3. Apply the migration:

```bash
supabase db push
```

4. Deploy Edge Functions:

```bash
supabase functions deploy save_api_key
supabase functions deploy send_message
```

The functions require the standard Supabase function environment values:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Security model

- Every application table has `user_id`.
- RLS policies restrict normal client reads/writes to `auth.uid()`.
- API keys are saved through the `save_api_key` Edge Function.
- API keys are stored in Supabase Vault through `save_user_api_key`.
- Plain API keys are not returned to the browser.
- Saved API key inputs are intentionally blank after reload; use the saved/unsaved status badge in Settings to confirm state.
- `send_message` retrieves keys server-side and calls OpenRouter, Sakana/Fugu, and Tavily from the Edge Function.

## Current implementation slice

- Google OAuth login screen.
- Authenticated project/conversation/message loading.
- Automatic fallback project and conversation creation.
- Quick / Standard / Deep mode selector.
- Deep confirmation before send.
- Settings modal for OpenRouter, Fugu, and Tavily key upload.
- Mode model selectors:
  - Quick: DeepSeek V4 Flash
  - Standard: DeepSeek V4 Pro / GPT-4o
  - Deep: Fugu / OpenRouter Fusion / Claude Opus 4.8
- Provider-aware send gating: Fugu uses the Fugu API key, while DeepSeek / GPT-4o / Fusion / Opus use the OpenRouter API key.
- Account section with current email, logout, and switch-account path back to login.
- Fugu API key acquisition link.
- Responsive desktop 3-column layout and mobile drawer/bottom sheet.
- Supabase schema, RLS, Vault RPCs, and Edge Functions.

## Known gaps

- Vercel deployment is not configured yet.
- Supabase project ID and OAuth callback URLs must be configured outside the repo.
- `send_message` currently generates conversation titles from the first prompt text instead of using a separate title model call.
- The Tauri app still uses its existing local SQLite implementation. `packages/core` is ready for shared logic, but Tauri has not yet been switched to import it.
