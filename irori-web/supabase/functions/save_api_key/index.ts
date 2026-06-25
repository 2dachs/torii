import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

type ApiKeyKind = 'openrouter' | 'fugu' | 'tavily';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error('Supabase environment variables are missing.');
    }

    const authorization = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const { kind, value } = await req.json() as { kind?: ApiKeyKind; value?: string };
    if (!kind || !['openrouter', 'fugu', 'tavily'].includes(kind) || !value?.trim()) {
      return jsonResponse({ error: 'Invalid API key payload' }, { status: 400 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { error: saveError } = await admin.rpc('save_user_api_key', {
      p_user_id: userData.user.id,
      p_kind: kind,
      p_secret: value.trim(),
    });
    if (saveError) throw saveError;

    return jsonResponse({ ok: true, kind });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Failed to save API key' }, { status: 400 });
  }
});
