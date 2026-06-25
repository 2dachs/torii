import type { Mode } from '@irori/core';

export interface Project {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  mode: Mode;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  user_id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  model_display_name: string | null;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  actual_cost: number;
  latency_ms: number;
  created_at: string;
}

export interface AppSettings {
  id: string;
  user_id: string;
  quick_model_slug: string;
  standard_model_slug: string;
  deep_model_slug: string;
  monthly_budget_jpy: number;
  jpy_per_usd: number;
  deep_confirmation_enabled: boolean;
  per_run_cost_limit: number;
  has_openrouter_key: boolean;
  has_fugu_key: boolean;
  has_tavily_key: boolean;
  updated_at: string;
}
