use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
  Quick,
  Standard,
  Deep,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
  Openrouter,
  Sakana,
  Openai,
  Anthropic,
  Google,
  Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfig {
  pub id: String,
  pub provider: ProviderKind,
  pub display_name: String,
  pub model_slug: String,
  pub input_price_per_million_tokens: f64,
  pub output_price_per_million_tokens: f64,
  pub context_window: i64,
  pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteDecision {
  pub mode: Mode,
  pub selected_model: ModelConfig,
  pub estimated_input_tokens: i64,
  pub estimated_output_tokens: i64,
  pub estimated_cost: f64,
  pub requires_confirmation: bool,
  pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLog {
  pub project_id: String,
  pub conversation_id: String,
  pub model: String,
  pub mode: Mode,
  pub input_tokens: i64,
  pub output_tokens: i64,
  pub estimated_cost: f64,
  pub actual_cost: f64,
  pub latency_ms: i64,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
  pub id: String,
  pub name: String,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
  pub id: String,
  pub project_id: String,
  pub title: String,
  pub mode: Mode,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
  User,
  Assistant,
  System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
  pub id: String,
  pub conversation_id: String,
  pub role: MessageRole,
  pub content: String,
  pub model: Option<String>,
  pub model_display_name: Option<String>,
  pub input_tokens: i64,
  pub output_tokens: i64,
  pub estimated_cost: f64,
  pub actual_cost: f64,
  pub latency_ms: i64,
  pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
  pub id: String,
  pub open_router_api_key: String,
  pub tavily_api_key: String,
  pub tavily_search_depth: String,
  pub tavily_max_results: i64,
  pub quick_model_slug: String,
  pub standard_model_slug: String,
  pub deep_model_slug: String,
  pub monthly_budget_jpy: f64,
  pub jpy_per_usd: f64,
  pub quick_input_price_per_million_tokens: f64,
  pub quick_output_price_per_million_tokens: f64,
  pub standard_input_price_per_million_tokens: f64,
  pub standard_output_price_per_million_tokens: f64,
  pub deep_input_price_per_million_tokens: f64,
  pub deep_output_price_per_million_tokens: f64,
  pub deep_confirmation_enabled: bool,
  pub per_run_cost_limit: f64,
  pub active_project_id: Option<String>,
  pub active_conversation_id: Option<String>,
  pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
  pub total_input_tokens: i64,
  pub total_output_tokens: i64,
  pub total_estimated_cost: f64,
  pub total_actual_cost: f64,
  pub total_latency_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapPayload {
  pub projects: Vec<Project>,
  pub conversations: Vec<Conversation>,
  pub messages: Vec<Message>,
  pub settings: AppSettings,
  pub model_configs: std::collections::HashMap<String, ModelConfig>,
  pub active_project_id: Option<String>,
  pub active_conversation_id: Option<String>,
  pub monthly_usage_summary: UsageSummary,
  pub usage_summary: UsageSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageArgs {
  pub project_id: String,
  pub conversation_id: String,
  pub mode: Mode,
  pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageResult {
  pub snapshot: BootstrapPayload,
  pub decision: RouteDecision,
  pub assistant_message: Message,
  pub usage_log: UsageLog,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
  pub open_router_api_key: Option<String>,
  pub tavily_api_key: Option<String>,
  pub tavily_search_depth: Option<String>,
  pub tavily_max_results: Option<i64>,
  pub quick_model_slug: Option<String>,
  pub standard_model_slug: Option<String>,
  pub deep_model_slug: Option<String>,
  pub monthly_budget_jpy: Option<f64>,
  pub jpy_per_usd: Option<f64>,
  pub quick_input_price_per_million_tokens: Option<f64>,
  pub quick_output_price_per_million_tokens: Option<f64>,
  pub standard_input_price_per_million_tokens: Option<f64>,
  pub standard_output_price_per_million_tokens: Option<f64>,
  pub deep_input_price_per_million_tokens: Option<f64>,
  pub deep_output_price_per_million_tokens: Option<f64>,
  pub deep_confirmation_enabled: Option<bool>,
  pub per_run_cost_limit: Option<f64>,
  pub active_project_id: Option<Option<String>>,
  pub active_conversation_id: Option<Option<String>>,
}
