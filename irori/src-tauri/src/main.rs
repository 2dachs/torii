mod db;
mod models;
mod openrouter;
mod search;

use crate::db::now_string;
use crate::models::*;
use openrouter::ChatMessagePayload;
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
  std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
  Ok(dir.join("irori.db"))
}

fn snapshot(conn: &Connection) -> Result<BootstrapPayload, String> {
  let settings = db::load_settings(conn)?;
  let projects = db::load_projects(conn)?;
  let active_project_id = settings.active_project_id.clone().or_else(|| projects.first().map(|project| project.id.clone()));
  let conversations = match active_project_id.as_deref() {
    Some(project_id) => db::load_conversations(conn, project_id)?,
    None => Vec::new(),
  };
  let active_conversation_id = settings.active_conversation_id.clone().or_else(|| conversations.first().map(|conversation| conversation.id.clone()));
  let messages = match active_conversation_id.as_deref() {
    Some(conversation_id) => db::load_messages(conn, conversation_id)?,
    None => Vec::new(),
  };
  let monthly_usage_summary = db::load_monthly_usage_summary(conn)?;
  let usage_summary = db::load_usage_summary(conn, active_project_id.as_deref())?;
  Ok(BootstrapPayload {
    projects,
    conversations,
    messages,
    settings,
    model_configs: db::load_model_configs(conn)?,
    active_project_id,
    active_conversation_id,
    monthly_usage_summary,
    usage_summary,
  })
}

fn open_conn(app: &AppHandle) -> Result<Connection, String> {
  db::open_database(&db_path(app)?)
}

fn estimate_tokens(text: &str) -> i64 {
  let trimmed = text.trim();
  if trimmed.is_empty() {
    return 0;
  }
  let mut estimate = 0.0f64;
  let mut ascii_run = 0.0f64;
  for ch in trimmed.chars() {
    let code = ch as u32;
    let is_cjk = (0x3040..=0x30ff).contains(&code) || (0x4e00..=0x9fff).contains(&code) || (0xac00..=0xd7af).contains(&code);
    if is_cjk {
      estimate += 1.25;
      ascii_run = 0.0;
    } else {
      ascii_run += 1.0;
      if ascii_run >= 4.0 {
        estimate += 1.0;
        ascii_run = 0.0;
      }
    }
  }
  if ascii_run > 0.0 {
    estimate += 1.0;
  }
  estimate.ceil().max(1.0) as i64
}

fn estimate_output_tokens(input_tokens: i64, context_window: i64) -> i64 {
  let baseline = (input_tokens as f64 * 0.6).ceil() as i64;
  let baseline = baseline.max(256);
  let cap = ((context_window as f64) * 0.2).floor() as i64;
  baseline.min(cap.max(256))
}

fn normalize_generated_title(title: &str) -> String {
  let cleaned = title
    .lines()
    .next()
    .unwrap_or("")
    .trim()
    .trim_matches(|ch| matches!(ch, '"' | '\'' | '「' | '」' | '『' | '』' | '`'))
    .trim()
    .trim_matches(|ch| matches!(ch, '.' | ',' | '。' | '、' | '!' | '?' | '！' | '？'))
    .trim();
  let lowered = cleaned.to_lowercase();
  if cleaned.is_empty() || lowered.contains("no response") || lowered.contains("応答なし") {
    "New chat".to_string()
  } else {
    cleaned.chars().take(24).collect()
  }
}

async fn generate_conversation_title(
  api_key: &str,
  model_slug: &str,
  user_content: &str,
  assistant_content: &str,
) -> Result<String, String> {
  let prompt = format!(
    "次の会話に短いタイトルを付けてください。日本語で2〜8語、20文字以内、記号や引用符は不要です。出力はタイトル1行だけ。\n\nUser:\n{}\n\nAssistant:\n{}",
    user_content,
    assistant_content
  );
  let result = openrouter::send_chat(
    api_key,
    model_slug,
    vec![ChatMessagePayload { role: "user".into(), content: prompt }],
    32,
  ).await?;
  Ok(normalize_generated_title(&result.reply))
}

fn calculate_cost(input_tokens: i64, output_tokens: i64, input_price: f64, output_price: f64) -> f64 {
  (input_tokens as f64 / 1_000_000.0) * input_price + (output_tokens as f64 / 1_000_000.0) * output_price
}

fn search_query_with_history(current: &str, history: &[Message]) -> String {
  let base = search::search_query_from_message(current);
  let needs_context = base.chars().count() < 10
    || current.contains("もう一度")
    || current.contains("再検索")
    || current.contains("検索してみて");
  if !needs_context {
    return base;
  }

  let previous_user_text = history
    .iter()
    .rev()
    .skip(1)
    .find(|message| matches!(message.role, MessageRole::User) && !message.content.trim().is_empty())
    .map(|message| search::search_query_from_message(&message.content));

  match previous_user_text {
    Some(previous) if !previous.trim().is_empty() && base.trim().is_empty() => previous,
    Some(previous) if !previous.trim().is_empty() => format!("{} {}", previous, base),
    _ => base,
  }
}

fn mode_key(mode: &Mode) -> &'static str {
  match mode {
    Mode::Quick => "quick",
    Mode::Standard => "standard",
    Mode::Deep => "deep",
  }
}

fn route(mode: Mode, text: &str, settings: &AppSettings, models: &std::collections::HashMap<String, ModelConfig>) -> Result<RouteDecision, String> {
  let model = models
    .get(mode_key(&mode))
    .cloned()
    .ok_or_else(|| "Model config not found".to_string())?;
  let input_tokens = estimate_tokens(text);
  let output_tokens = estimate_output_tokens(input_tokens, model.context_window);
  let estimated_cost = calculate_cost(
    input_tokens,
    output_tokens,
    model.input_price_per_million_tokens,
    model.output_price_per_million_tokens,
  );
  let requires_confirmation = matches!(mode, Mode::Deep) && settings.deep_confirmation_enabled || estimated_cost > settings.per_run_cost_limit;
  let reason = match mode {
    Mode::Quick => "Quick モードなので低コストモデルを選択".to_string(),
    Mode::Standard => "Standard モードなので標準モデルを選択".to_string(),
    Mode::Deep => "Deep モードなので深い思考向けモデルを選択".to_string(),
  };

  Ok(RouteDecision {
    mode,
    selected_model: model,
    estimated_input_tokens: input_tokens,
    estimated_output_tokens: output_tokens,
    estimated_cost,
    requires_confirmation,
    reason,
  })
}

fn upsert_settings(conn: &Connection, update: SettingsUpdate) -> Result<AppSettings, String> {
  let mut settings = db::load_settings(conn)?;
  if let Some(value) = update.open_router_api_key { settings.open_router_api_key = value; }
  if let Some(value) = update.tavily_api_key { settings.tavily_api_key = value; }
  if let Some(value) = update.tavily_search_depth {
    settings.tavily_search_depth = match value.as_str() {
      "advanced" | "fast" | "ultra-fast" => value,
      _ => "basic".into(),
    };
  }
  if let Some(value) = update.tavily_max_results {
    settings.tavily_max_results = value.clamp(1, 10);
  }
  if let Some(value) = update.quick_model_slug { settings.quick_model_slug = value; }
  if let Some(value) = update.standard_model_slug { settings.standard_model_slug = value; }
  if let Some(value) = update.deep_model_slug { settings.deep_model_slug = value; }
  if let Some(value) = update.quick_input_price_per_million_tokens { settings.quick_input_price_per_million_tokens = value; }
  if let Some(value) = update.quick_output_price_per_million_tokens { settings.quick_output_price_per_million_tokens = value; }
  if let Some(value) = update.standard_input_price_per_million_tokens { settings.standard_input_price_per_million_tokens = value; }
  if let Some(value) = update.standard_output_price_per_million_tokens { settings.standard_output_price_per_million_tokens = value; }
  if let Some(value) = update.deep_input_price_per_million_tokens { settings.deep_input_price_per_million_tokens = value; }
  if let Some(value) = update.deep_output_price_per_million_tokens { settings.deep_output_price_per_million_tokens = value; }
  if let Some(value) = update.deep_confirmation_enabled { settings.deep_confirmation_enabled = value; }
  if let Some(value) = update.per_run_cost_limit { settings.per_run_cost_limit = value; }
  if let Some(value) = update.monthly_budget_jpy { settings.monthly_budget_jpy = value; }
  if let Some(value) = update.jpy_per_usd { settings.jpy_per_usd = value; }
  if let Some(value) = update.active_project_id { settings.active_project_id = value; }
  if let Some(value) = update.active_conversation_id { settings.active_conversation_id = value; }
  settings.updated_at = now_string();
  db::save_settings(conn, &settings)?;
  db::sync_model_configs_from_settings(conn, &settings)?;
  Ok(settings)
}

#[tauri::command]
fn bootstrap(app: AppHandle) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  snapshot(&conn)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<AppSettings, String> {
  let conn = open_conn(&app)?;
  db::load_settings(&conn)
}

#[tauri::command]
fn create_project(app: AppHandle, name: String) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  let project = db::insert_project(&conn, &name)?;
  db::set_active_project(&conn, Some(project.id.clone()))?;
  let conversation = db::insert_conversation(&conn, &project.id, "New chat", Mode::Quick)?;
  db::set_active_conversation(&conn, Some(conversation.id.clone()))?;
  let mut settings = db::load_settings(&conn)?;
  settings.active_project_id = Some(project.id);
  settings.active_conversation_id = Some(conversation.id);
  settings.updated_at = now_string();
  db::save_settings(&conn, &settings)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn update_project_name(app: AppHandle, project_id: String, name: String) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  db::update_project_name(&conn, &project_id, &name)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn delete_project(app: AppHandle, project_id: String) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  let mut settings = db::load_settings(&conn)?;
  db::delete_project(&conn, &project_id)?;
  let projects = db::load_projects(&conn)?;
  let next_project_id = projects.first().map(|project| project.id.clone());
  settings.active_project_id = next_project_id.clone();

  let next_conversation_id = if let Some(active_project_id) = next_project_id.as_deref() {
    let conversations = db::load_conversations(&conn, active_project_id)?;
    conversations.first().map(|conversation| conversation.id.clone())
  } else {
    None
  };
  settings.active_conversation_id = next_conversation_id.clone();
  settings.updated_at = now_string();
  db::save_settings(&conn, &settings)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn create_conversation(app: AppHandle, project_id: String, title: String, mode: Mode) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  let conversation = db::insert_conversation(&conn, &project_id, &title, mode)?;
  db::set_active_project(&conn, Some(project_id))?;
  db::set_active_conversation(&conn, Some(conversation.id.clone()))?;
  let mut settings = db::load_settings(&conn)?;
  settings.active_conversation_id = Some(conversation.id);
  settings.updated_at = now_string();
  db::save_settings(&conn, &settings)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn update_conversation_title(app: AppHandle, conversation_id: String, title: String) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  db::update_conversation_title(&conn, &conversation_id, &title)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn delete_conversation(app: AppHandle, conversation_id: String) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  let mut settings = db::load_settings(&conn)?;
  let conversation = db::load_conversation(&conn, &conversation_id)?;
  let project_id = conversation.as_ref().map(|item| item.project_id.clone());
  db::delete_conversation(&conn, &conversation_id)?;

  let next_conversation_id = if let Some(project_id) = project_id.as_deref() {
    let conversations = db::load_conversations(&conn, project_id)?;
    conversations.first().map(|conversation| conversation.id.clone())
  } else {
    None
  };

  if settings.active_conversation_id.as_deref() == Some(&conversation_id) {
    settings.active_conversation_id = next_conversation_id.clone();
  }
  settings.updated_at = now_string();
  db::save_settings(&conn, &settings)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn set_active_project(app: AppHandle, project_id: Option<String>) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  db::set_active_project(&conn, project_id)?;
  let next_conversation_id = match db::load_settings(&conn)?.active_project_id.as_deref() {
    Some(active_project_id) => {
      let conversations = db::load_conversations(&conn, active_project_id)?;
      if let Some(conversation) = conversations.first() {
        Some(conversation.id.clone())
      } else {
        let conversation = db::insert_conversation(&conn, active_project_id, "New chat", Mode::Quick)?;
        Some(conversation.id)
      }
    }
    None => None,
  };
  db::set_active_conversation(&conn, next_conversation_id.clone())?;
  let mut settings = db::load_settings(&conn)?;
  settings.active_conversation_id = next_conversation_id;
  settings.updated_at = now_string();
  db::save_settings(&conn, &settings)?;
  snapshot(&conn)
}

#[tauri::command(rename_all = "camelCase")]
fn set_active_conversation(app: AppHandle, conversation_id: Option<String>) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  db::set_active_conversation(&conn, conversation_id)?;
  let active_conversation_id = db::load_settings(&conn)?.active_conversation_id;
  if let Some(conversation_id) = active_conversation_id.as_deref() {
    if let Some(conversation) = db::load_conversation(&conn, conversation_id)? {
      db::set_active_project(&conn, Some(conversation.project_id.clone()))?;
      let mut settings = db::load_settings(&conn)?;
      settings.active_project_id = Some(conversation.project_id);
      settings.updated_at = now_string();
      db::save_settings(&conn, &settings)?;
    }
  }
  snapshot(&conn)
}

#[tauri::command]
fn update_settings(app: AppHandle, update: SettingsUpdate) -> Result<BootstrapPayload, String> {
  let conn = open_conn(&app)?;
  upsert_settings(&conn, update)?;
  snapshot(&conn)
}

#[tauri::command]
async fn send_message(app: AppHandle, args: SendMessageArgs) -> Result<SendMessageResult, String> {
  let conn = open_conn(&app)?;
  let settings = db::load_settings(&conn)?;
  let model_configs = db::load_model_configs(&conn)?;
  let decision = route(args.mode.clone(), &args.content, &settings, &model_configs)?;
  let api_key = settings.open_router_api_key.trim();
  if api_key.is_empty() {
    return Err("OpenRouter APIキーを設定してください".into());
  }

  let now = now_string();
  let user_message = Message {
    id: Uuid::new_v4().to_string(),
    conversation_id: args.conversation_id.clone(),
    role: MessageRole::User,
    content: args.content.clone(),
    model: None,
    model_display_name: None,
    input_tokens: estimate_tokens(&args.content),
    output_tokens: 0,
    estimated_cost: 0.0,
    actual_cost: 0.0,
    latency_ms: 0,
    created_at: now.clone(),
  };
  db::insert_message(&conn, &user_message)?;
  db::update_conversation_mode(&conn, &args.conversation_id, args.mode.clone())?;

  let history = db::load_messages(&conn, &args.conversation_id)?;
  let has_assistant_reply = history.iter().any(|message| matches!(message.role, MessageRole::Assistant));
  let request_messages = history
    .iter()
    .map(|message| ChatMessagePayload {
      role: match message.role {
        MessageRole::User => "user".into(),
        MessageRole::Assistant => "assistant".into(),
        MessageRole::System => "system".into(),
      },
      content: message.content.clone(),
    })
    .collect::<Vec<_>>();
  let request_messages = if !has_assistant_reply {
    let mut prefixed = vec![ChatMessagePayload {
      role: "system".into(),
      content: "あなたは Irori のアシスタントです。日本語で自然に返答してください。最初の応答では、冒頭に『Iroriにようこそ。』と一文だけ添えてから本文を続けてください。モデル名やプロバイダー名は名乗らないでください。".into(),
    }];
    prefixed.extend(request_messages);
    prefixed
  } else {
    request_messages
  };
  let request_messages = if search::should_search(&args.content) {
    let query = search_query_with_history(&args.content, &history);
    let max_results = usize::try_from(settings.tavily_max_results).unwrap_or(5).clamp(1, 10);
    let search_options = search::SearchOptions {
      tavily_api_key: settings.tavily_api_key.clone(),
      tavily_search_depth: settings.tavily_search_depth.clone(),
      max_results,
    };
    let search_context = match search::search_web(&query, search_options).await {
      Ok(outcome) => search::format_search_context(&query, &outcome),
      Err(err) => format!(
        "Irori attempted a web search for \"{}\", but it failed: {}. Tell the user the search failed and avoid pretending to have current web results.",
        query,
        err
      ),
    };
    let search_instruction = format!(
      "{}\n\nImportant: The user's latest message asked Irori to search. Answer using this search context. Do not answer that you cannot access the internet unless the search explicitly failed.",
      search_context
    );
    let mut request_messages = request_messages;
    if let Some(latest_user_message) = request_messages
      .iter_mut()
      .rev()
      .find(|message| message.role == "user")
    {
      latest_user_message.content = format!(
        "{}\n\n[Irori web search context injected before answering]\n{}",
        latest_user_message.content,
        search_instruction
      );
    }
    let mut with_search = vec![ChatMessagePayload {
      role: "system".into(),
      content: search_instruction,
    }];
    with_search.extend(request_messages);
    with_search
  } else {
    request_messages
  };

  let result = openrouter::send_chat(
    api_key,
    &decision.selected_model.model_slug,
    request_messages,
    2048,
  ).await?;

  let actual_cost = calculate_cost(
    result.input_tokens,
    result.output_tokens,
    decision.selected_model.input_price_per_million_tokens,
    decision.selected_model.output_price_per_million_tokens,
  );
  let assistant_message = Message {
    id: Uuid::new_v4().to_string(),
    conversation_id: args.conversation_id.clone(),
    role: MessageRole::Assistant,
    content: result.reply.clone(),
    model: Some(decision.selected_model.model_slug.clone()),
    model_display_name: Some(decision.selected_model.display_name.clone()),
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    estimated_cost: decision.estimated_cost,
    actual_cost,
    latency_ms: result.latency_ms,
    created_at: now.clone(),
  };
  db::insert_message(&conn, &assistant_message)?;
  db::update_conversation_touch(&conn, &args.conversation_id)?;

  if let Some(conversation) = db::load_conversation(&conn, &args.conversation_id)? {
    let is_default_title = conversation.title.trim().is_empty() || conversation.title == "New chat";
    if is_default_title {
      if let Ok(title) = generate_conversation_title(
        api_key,
        &settings.quick_model_slug,
        &args.content,
        &result.reply,
      ).await {
        let title = normalize_generated_title(&title);
        if title != "New chat" {
          db::update_conversation_title(&conn, &args.conversation_id, &title)?;
        }
      }
    }
  }

  let usage_log = UsageLog {
    project_id: args.project_id.clone(),
    conversation_id: args.conversation_id.clone(),
    model: decision.selected_model.model_slug.clone(),
    mode: args.mode,
    input_tokens: result.input_tokens,
    output_tokens: result.output_tokens,
    estimated_cost: decision.estimated_cost,
    actual_cost,
    latency_ms: result.latency_ms,
    created_at: now,
  };
  db::insert_usage_log(&conn, &usage_log)?;

  let snapshot = snapshot(&conn)?;
  Ok(SendMessageResult {
    snapshot,
    decision,
    assistant_message,
    usage_log,
  })
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      bootstrap,
      load_settings,
      create_project,
      update_project_name,
      delete_project,
      create_conversation,
      update_conversation_title,
      delete_conversation,
      set_active_project,
      set_active_conversation,
      update_settings,
      send_message
    ])
    .run(tauri::generate_context!())
    .expect("failed to run Irori");
}
