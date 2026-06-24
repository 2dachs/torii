use crate::models::*;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use uuid::Uuid;

const DEFAULT_PROJECT_NAME: &str = "General";

pub fn now_string() -> String {
  Utc::now().to_rfc3339()
}

pub fn mode_to_string(mode: &Mode) -> &'static str {
  match mode {
    Mode::Quick => "quick",
    Mode::Standard => "standard",
    Mode::Deep => "deep",
  }
}

pub fn mode_from_string(value: &str) -> Mode {
  match value {
    "standard" => Mode::Standard,
    "deep" => Mode::Deep,
    _ => Mode::Quick,
  }
}

pub fn role_to_string(role: &MessageRole) -> &'static str {
  match role {
    MessageRole::User => "user",
    MessageRole::Assistant => "assistant",
    MessageRole::System => "system",
  }
}

pub fn role_from_string(value: &str) -> MessageRole {
  match value {
    "assistant" => MessageRole::Assistant,
    "system" => MessageRole::System,
    _ => MessageRole::User,
  }
}

pub fn default_models() -> HashMap<String, ModelConfig> {
  HashMap::from([
    (
      "quick".into(),
      ModelConfig {
        id: "quick".into(),
        provider: ProviderKind::Openrouter,
        display_name: "DeepSeek V4 Flash".into(),
        model_slug: "deepseek/deepseek-v4-flash".into(),
        input_price_per_million_tokens: 0.14,
        output_price_per_million_tokens: 0.28,
        context_window: 64_000,
        enabled: true,
      },
    ),
    (
      "standard".into(),
      ModelConfig {
        id: "standard".into(),
        provider: ProviderKind::Openrouter,
        display_name: "DeepSeek V4 Pro".into(),
        model_slug: "deepseek/deepseek-v4-pro".into(),
        input_price_per_million_tokens: 1.74,
        output_price_per_million_tokens: 3.48,
        context_window: 128_000,
        enabled: true,
      },
    ),
    (
      "deep".into(),
      ModelConfig {
        id: "deep".into(),
        provider: ProviderKind::Openrouter,
        display_name: "GLM 5.2".into(),
        model_slug: "z-ai/glm-5.2".into(),
        input_price_per_million_tokens: 1.2,
        output_price_per_million_tokens: 4.1,
        context_window: 128_000,
        enabled: true,
      },
    ),
  ])
}

pub fn default_settings() -> AppSettings {
  let now = now_string();
  AppSettings {
    id: "app".into(),
    open_router_api_key: String::new(),
    tavily_api_key: String::new(),
    tavily_search_depth: "basic".into(),
    tavily_max_results: 5,
    quick_model_slug: "deepseek/deepseek-v4-flash".into(),
    standard_model_slug: "deepseek/deepseek-v4-pro".into(),
    deep_model_slug: "z-ai/glm-5.2".into(),
    monthly_budget_jpy: 30000.0,
    jpy_per_usd: 150.0,
    quick_input_price_per_million_tokens: 0.14,
    quick_output_price_per_million_tokens: 0.28,
    standard_input_price_per_million_tokens: 1.74,
    standard_output_price_per_million_tokens: 3.48,
    deep_input_price_per_million_tokens: 1.2,
    deep_output_price_per_million_tokens: 4.1,
    deep_confirmation_enabled: true,
    per_run_cost_limit: 0.5,
    active_project_id: None,
    active_conversation_id: None,
    updated_at: now,
  }
}

pub fn open_database(path: &Path) -> Result<Connection, String> {
  let conn = Connection::open(path).map_err(|err| err.to_string())?;
  init_database(&conn)?;
  Ok(conn)
}

pub fn init_database(conn: &Connection) -> Result<(), String> {
  conn.execute_batch(
    r#"
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      model_display_name TEXT,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      actual_cost REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      display_name TEXT NOT NULL,
      model_slug TEXT NOT NULL,
      input_price_per_million_tokens REAL NOT NULL,
      output_price_per_million_tokens REAL NOT NULL,
      context_window INTEGER NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      estimated_cost REAL NOT NULL,
      actual_cost REAL NOT NULL,
      latency_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY,
      open_router_api_key TEXT NOT NULL,
      tavily_api_key TEXT NOT NULL DEFAULT '',
      tavily_search_depth TEXT NOT NULL DEFAULT 'basic',
      tavily_max_results INTEGER NOT NULL DEFAULT 5,
      quick_model_slug TEXT NOT NULL,
      standard_model_slug TEXT NOT NULL,
      deep_model_slug TEXT NOT NULL,
      monthly_budget_jpy REAL NOT NULL DEFAULT 30000,
      jpy_per_usd REAL NOT NULL DEFAULT 150,
      quick_input_price_per_million_tokens REAL NOT NULL,
      quick_output_price_per_million_tokens REAL NOT NULL,
      standard_input_price_per_million_tokens REAL NOT NULL,
      standard_output_price_per_million_tokens REAL NOT NULL,
      deep_input_price_per_million_tokens REAL NOT NULL,
      deep_output_price_per_million_tokens REAL NOT NULL,
      deep_confirmation_enabled INTEGER NOT NULL,
      per_run_cost_limit REAL NOT NULL,
      active_project_id TEXT,
      active_conversation_id TEXT,
      updated_at TEXT NOT NULL
    );
    "#,
  ).map_err(|err| err.to_string())?;

  seed_defaults(conn)?;
  ensure_app_settings_columns(conn)?;
  migrate_standard_model_defaults(conn)?;
  Ok(())
}

fn ensure_app_settings_columns(conn: &Connection) -> Result<(), String> {
  let mut stmt = conn
    .prepare("PRAGMA table_info(app_settings)")
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|err| err.to_string())?;
  let mut columns = HashSet::new();
  for row in rows {
    columns.insert(row.map_err(|err| err.to_string())?);
  }

  if !columns.contains("monthly_budget_jpy") {
    conn.execute(
      "ALTER TABLE app_settings ADD COLUMN monthly_budget_jpy REAL NOT NULL DEFAULT 30000",
      [],
    ).map_err(|err| err.to_string())?;
  }
  if !columns.contains("jpy_per_usd") {
    conn.execute(
      "ALTER TABLE app_settings ADD COLUMN jpy_per_usd REAL NOT NULL DEFAULT 150",
      [],
    ).map_err(|err| err.to_string())?;
  }
  if !columns.contains("tavily_api_key") {
    conn.execute(
      "ALTER TABLE app_settings ADD COLUMN tavily_api_key TEXT NOT NULL DEFAULT ''",
      [],
    ).map_err(|err| err.to_string())?;
  }
  if !columns.contains("tavily_search_depth") {
    conn.execute(
      "ALTER TABLE app_settings ADD COLUMN tavily_search_depth TEXT NOT NULL DEFAULT 'basic'",
      [],
    ).map_err(|err| err.to_string())?;
  }
  if !columns.contains("tavily_max_results") {
    conn.execute(
      "ALTER TABLE app_settings ADD COLUMN tavily_max_results INTEGER NOT NULL DEFAULT 5",
      [],
    ).map_err(|err| err.to_string())?;
  }

  Ok(())
}

fn migrate_standard_model_defaults(conn: &Connection) -> Result<(), String> {
  let mut settings = load_settings(conn)?;
  let mut settings_changed = false;
  if settings.quick_model_slug == "deepseek/deepseek-chat-v4-flash" {
    settings.quick_model_slug = "deepseek/deepseek-v4-flash".into();
    settings_changed = true;
  }
  if settings.standard_model_slug == "deepseek/deepseek-chat-v4-pro" {
    settings.standard_model_slug = "deepseek/deepseek-v4-pro".into();
    settings_changed = true;
  }
  if is_legacy_gpt4o_model(&settings.standard_model_slug) {
    settings.standard_model_slug = "deepseek/deepseek-v4-pro".into();
    settings.standard_input_price_per_million_tokens = 1.74;
    settings.standard_output_price_per_million_tokens = 3.48;
    settings_changed = true;
  }

  if settings_changed {
    settings.updated_at = now_string();
    save_settings(conn, &settings)?;
  }

  let existing_standard: Option<(String, String, f64, f64)> = conn
    .query_row(
      "SELECT display_name, model_slug, input_price_per_million_tokens, output_price_per_million_tokens FROM model_configs WHERE id = 'standard'",
      [],
      |row| {
        Ok((
          row.get(0)?,
          row.get(1)?,
          row.get(2)?,
          row.get(3)?,
        ))
      },
    )
    .optional()
    .map_err(|err| err.to_string())?;

  if let Some((_display_name, model_slug, _input_price, _output_price)) = existing_standard {
    if is_legacy_gpt4o_model(&model_slug) {
      conn.execute(
        r#"
        UPDATE model_configs
        SET display_name = ?2,
            model_slug = ?3,
            input_price_per_million_tokens = ?4,
            output_price_per_million_tokens = ?5
        WHERE id = 'standard'
        "#,
        params![
          "standard",
          "DeepSeek V4 Pro",
          "deepseek/deepseek-v4-pro",
          1.74,
          3.48,
        ],
      ).map_err(|err| err.to_string())?;
    }
  }

  conn.execute(
    r#"
    UPDATE messages
    SET model_display_name = 'DeepSeek V4 Pro'
    WHERE model = 'deepseek/deepseek-v4-pro'
      AND model_display_name IS NOT NULL
      AND lower(model_display_name) LIKE '%gpt-4o%'
    "#,
    [],
  ).map_err(|err| err.to_string())?;

  sync_model_configs_from_settings(conn, &settings)?;

  Ok(())
}

fn is_legacy_gpt4o_model(model_slug: &str) -> bool {
  let lowered = model_slug.to_lowercase();
  lowered == "openai/gpt-4o" || lowered.contains("gpt-4o")
}

fn display_name_for_model_slot(slot_id: &str, model_slug: &str, existing_display_name: Option<String>) -> String {
  match model_slug {
    "deepseek/deepseek-v4-flash" => "DeepSeek V4 Flash".into(),
    "deepseek/deepseek-v4-pro" => "DeepSeek V4 Pro".into(),
    "z-ai/glm-5.2" => "GLM 5.2".into(),
    "openrouter/fusion" => "OpenRouter Fusion".into(),
    _ => existing_display_name
      .filter(|value| !value.trim().is_empty() && !is_legacy_gpt4o_model(value))
      .unwrap_or_else(|| {
        model_slug
          .rsplit('/')
          .next()
          .unwrap_or(slot_id)
          .replace('-', " ")
      }),
  }
}

pub fn seed_defaults(conn: &Connection) -> Result<(), String> {
  let settings_count: i64 = conn
    .query_row("SELECT COUNT(*) FROM app_settings", [], |row| row.get(0))
    .map_err(|err| err.to_string())?;
  if settings_count == 0 {
    let settings = default_settings();
    conn.execute(
      r#"
      INSERT INTO app_settings (
        id, open_router_api_key, tavily_api_key, tavily_search_depth, tavily_max_results,
        quick_model_slug, standard_model_slug, deep_model_slug,
        monthly_budget_jpy, jpy_per_usd,
        quick_input_price_per_million_tokens, quick_output_price_per_million_tokens,
        standard_input_price_per_million_tokens, standard_output_price_per_million_tokens,
        deep_input_price_per_million_tokens, deep_output_price_per_million_tokens,
        deep_confirmation_enabled, per_run_cost_limit, active_project_id, active_conversation_id, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
      "#,
      params![
        settings.id,
        settings.open_router_api_key,
        settings.tavily_api_key,
        settings.tavily_search_depth,
        settings.tavily_max_results,
        settings.quick_model_slug,
        settings.standard_model_slug,
        settings.deep_model_slug,
        settings.monthly_budget_jpy,
        settings.jpy_per_usd,
        settings.quick_input_price_per_million_tokens,
        settings.quick_output_price_per_million_tokens,
        settings.standard_input_price_per_million_tokens,
        settings.standard_output_price_per_million_tokens,
        settings.deep_input_price_per_million_tokens,
        settings.deep_output_price_per_million_tokens,
        if settings.deep_confirmation_enabled { 1 } else { 0 },
        settings.per_run_cost_limit,
        settings.active_project_id,
        settings.active_conversation_id,
        settings.updated_at,
      ],
    ).map_err(|err| err.to_string())?;
  }

  for model in default_models().values() {
    let exists: Option<String> = conn
      .query_row("SELECT id FROM model_configs WHERE id = ?1", params![model.id], |row| row.get(0))
      .optional()
      .map_err(|err| err.to_string())?;
    if exists.is_none() {
      conn.execute(
        r#"
        INSERT INTO model_configs (
          id, provider, display_name, model_slug, input_price_per_million_tokens,
          output_price_per_million_tokens, context_window, enabled
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
          model.id,
          serde_json::to_string(&model.provider).map_err(|err| err.to_string())?,
          model.display_name,
          model.model_slug,
          model.input_price_per_million_tokens,
          model.output_price_per_million_tokens,
          model.context_window,
          if model.enabled { 1 } else { 0 },
        ],
      ).map_err(|err| err.to_string())?;
    }
  }

  let project_count: i64 = conn
    .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
    .map_err(|err| err.to_string())?;
  if project_count == 0 {
    let now = now_string();
    let id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
      params![id, DEFAULT_PROJECT_NAME, now, now],
    ).map_err(|err| err.to_string())?;
    let conversation_id = Uuid::new_v4().to_string();
    conn.execute(
      "INSERT INTO conversations (id, project_id, title, mode, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      params![conversation_id, id, "New chat", "quick", now, now],
    ).map_err(|err| err.to_string())?;
    conn.execute(
      "UPDATE app_settings SET active_project_id = ?1, active_conversation_id = ?2, updated_at = ?3 WHERE id = 'app'",
      params![id, conversation_id, now],
    ).map_err(|err| err.to_string())?;
  }

  Ok(())
}

pub fn load_settings(conn: &Connection) -> Result<AppSettings, String> {
  let settings = conn.query_row(
    r#"
    SELECT id, open_router_api_key, tavily_api_key, tavily_search_depth, tavily_max_results,
      quick_model_slug, standard_model_slug, deep_model_slug,
      monthly_budget_jpy, jpy_per_usd,
      quick_input_price_per_million_tokens, quick_output_price_per_million_tokens,
      standard_input_price_per_million_tokens, standard_output_price_per_million_tokens,
      deep_input_price_per_million_tokens, deep_output_price_per_million_tokens,
      deep_confirmation_enabled, per_run_cost_limit, active_project_id, active_conversation_id, updated_at
    FROM app_settings
    WHERE id = 'app'
    "#,
    [],
    |row| {
      Ok(AppSettings {
        id: row.get(0)?,
        open_router_api_key: row.get(1)?,
        tavily_api_key: row.get(2)?,
        tavily_search_depth: row.get(3)?,
        tavily_max_results: row.get(4)?,
        quick_model_slug: row.get(5)?,
        standard_model_slug: row.get(6)?,
        deep_model_slug: row.get(7)?,
        monthly_budget_jpy: row.get(8)?,
        jpy_per_usd: row.get(9)?,
        quick_input_price_per_million_tokens: row.get(10)?,
        quick_output_price_per_million_tokens: row.get(11)?,
        standard_input_price_per_million_tokens: row.get(12)?,
        standard_output_price_per_million_tokens: row.get(13)?,
        deep_input_price_per_million_tokens: row.get(14)?,
        deep_output_price_per_million_tokens: row.get(15)?,
        deep_confirmation_enabled: row.get::<_, i64>(16)? != 0,
        per_run_cost_limit: row.get(17)?,
        active_project_id: row.get(18)?,
        active_conversation_id: row.get(19)?,
        updated_at: row.get(20)?,
      })
    },
  ).map_err(|err| err.to_string())?;

  Ok(settings)
}

pub fn save_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
  let api_key = settings.open_router_api_key.trim().to_string();
  let tavily_api_key = settings.tavily_api_key.trim().to_string();
  conn.execute(
    r#"
    UPDATE app_settings SET
      open_router_api_key = ?2,
      tavily_api_key = ?3,
      tavily_search_depth = ?4,
      tavily_max_results = ?5,
      quick_model_slug = ?6,
      standard_model_slug = ?7,
      deep_model_slug = ?8,
      monthly_budget_jpy = ?9,
      jpy_per_usd = ?10,
      quick_input_price_per_million_tokens = ?11,
      quick_output_price_per_million_tokens = ?12,
      standard_input_price_per_million_tokens = ?13,
      standard_output_price_per_million_tokens = ?14,
      deep_input_price_per_million_tokens = ?15,
      deep_output_price_per_million_tokens = ?16,
      deep_confirmation_enabled = ?17,
      per_run_cost_limit = ?18,
      active_project_id = ?19,
      active_conversation_id = ?20,
      updated_at = ?21
    WHERE id = ?1
    "#,
    params![
      settings.id,
      api_key,
      tavily_api_key,
      settings.tavily_search_depth,
      settings.tavily_max_results,
      settings.quick_model_slug,
      settings.standard_model_slug,
      settings.deep_model_slug,
      settings.monthly_budget_jpy,
      settings.jpy_per_usd,
      settings.quick_input_price_per_million_tokens,
      settings.quick_output_price_per_million_tokens,
      settings.standard_input_price_per_million_tokens,
      settings.standard_output_price_per_million_tokens,
      settings.deep_input_price_per_million_tokens,
      settings.deep_output_price_per_million_tokens,
      if settings.deep_confirmation_enabled { 1 } else { 0 },
      settings.per_run_cost_limit,
      settings.active_project_id,
      settings.active_conversation_id,
      settings.updated_at,
    ],
  ).map_err(|err| err.to_string())?;
  Ok(())
}

pub fn sync_model_configs_from_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
  let updates = [
    (
      "quick",
      &settings.quick_model_slug,
      settings.quick_input_price_per_million_tokens,
      settings.quick_output_price_per_million_tokens,
      64_000i64,
    ),
    (
      "standard",
      &settings.standard_model_slug,
      settings.standard_input_price_per_million_tokens,
      settings.standard_output_price_per_million_tokens,
      128_000i64,
    ),
    (
      "deep",
      &settings.deep_model_slug,
      settings.deep_input_price_per_million_tokens,
      settings.deep_output_price_per_million_tokens,
      128_000i64,
    ),
  ];

  for (id, model_slug, input_price, output_price, context_window) in updates {
    let existing = conn
      .query_row(
        "SELECT provider, display_name, enabled FROM model_configs WHERE id = ?1",
        params![id],
        |row| {
          Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
          ))
        },
      )
      .optional()
      .map_err(|err| err.to_string())?;

    let (provider_json, existing_display_name, enabled) = existing.unwrap_or_else(|| {
      (
        serde_json::to_string(&ProviderKind::Openrouter).unwrap_or_else(|_| "\"openrouter\"".into()),
        String::new(),
        1,
      )
    });
    let display_name = display_name_for_model_slot(id, model_slug, Some(existing_display_name));

    conn.execute(
      r#"
      INSERT INTO model_configs (
        id, provider, display_name, model_slug, input_price_per_million_tokens,
        output_price_per_million_tokens, context_window, enabled
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        display_name = excluded.display_name,
        model_slug = excluded.model_slug,
        input_price_per_million_tokens = excluded.input_price_per_million_tokens,
        output_price_per_million_tokens = excluded.output_price_per_million_tokens,
        context_window = excluded.context_window,
        enabled = excluded.enabled
      "#,
      params![
        id,
        provider_json,
        display_name,
        model_slug,
        input_price,
        output_price,
        context_window,
        enabled,
      ],
    )
    .map_err(|err| err.to_string())?;
  }

  Ok(())
}

pub fn load_model_configs(conn: &Connection) -> Result<HashMap<String, ModelConfig>, String> {
  let mut stmt = conn.prepare(
    r#"
    SELECT id, provider, display_name, model_slug, input_price_per_million_tokens,
      output_price_per_million_tokens, context_window, enabled
    FROM model_configs
    ORDER BY id
    "#,
  ).map_err(|err| err.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      let provider_str: String = row.get(1)?;
      Ok(ModelConfig {
        id: row.get(0)?,
        provider: serde_json::from_str(&provider_str).unwrap_or(ProviderKind::Openrouter),
        display_name: row.get(2)?,
        model_slug: row.get(3)?,
        input_price_per_million_tokens: row.get(4)?,
        output_price_per_million_tokens: row.get(5)?,
        context_window: row.get(6)?,
        enabled: row.get::<_, i64>(7)? != 0,
      })
    })
    .map_err(|err| err.to_string())?;

  let mut out = HashMap::new();
  for row in rows {
    let model = row.map_err(|err| err.to_string())?;
    out.insert(model.id.clone(), model);
  }
  Ok(out)
}

pub fn load_projects(conn: &Connection) -> Result<Vec<Project>, String> {
  let mut stmt = conn
    .prepare("SELECT id, name, created_at, updated_at FROM projects ORDER BY updated_at DESC")
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map([], |row| {
      Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
      })
    })
    .map_err(|err| err.to_string())?;
  rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

pub fn load_conversations(conn: &Connection, project_id: &str) -> Result<Vec<Conversation>, String> {
  let mut stmt = conn
    .prepare(
      "SELECT id, project_id, title, mode, created_at, updated_at FROM conversations WHERE project_id = ?1 ORDER BY updated_at DESC",
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![project_id], |row| {
      let mode_str: String = row.get(3)?;
      Ok(Conversation {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        mode: mode_from_string(&mode_str),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
      })
    })
    .map_err(|err| err.to_string())?;
  rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

pub fn load_conversation(conn: &Connection, conversation_id: &str) -> Result<Option<Conversation>, String> {
  conn
    .query_row(
      "SELECT id, project_id, title, mode, created_at, updated_at FROM conversations WHERE id = ?1",
      params![conversation_id],
      |row| {
        let mode_str: String = row.get(3)?;
        Ok(Conversation {
          id: row.get(0)?,
          project_id: row.get(1)?,
          title: row.get(2)?,
          mode: mode_from_string(&mode_str),
          created_at: row.get(4)?,
          updated_at: row.get(5)?,
        })
      },
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn load_messages(conn: &Connection, conversation_id: &str) -> Result<Vec<Message>, String> {
  let mut stmt = conn
    .prepare(
      r#"
      SELECT id, conversation_id, role, content, model, model_display_name,
        input_tokens, output_tokens, estimated_cost, actual_cost, latency_ms, created_at
      FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC
      "#,
    )
    .map_err(|err| err.to_string())?;
  let rows = stmt
    .query_map(params![conversation_id], |row| {
      let role_str: String = row.get(2)?;
      Ok(Message {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        role: role_from_string(&role_str),
        content: row.get(3)?,
        model: row.get(4)?,
        model_display_name: row.get(5)?,
        input_tokens: row.get(6)?,
        output_tokens: row.get(7)?,
        estimated_cost: row.get(8)?,
        actual_cost: row.get(9)?,
        latency_ms: row.get(10)?,
        created_at: row.get(11)?,
      })
    })
    .map_err(|err| err.to_string())?;
  rows.map(|row| row.map_err(|err| err.to_string())).collect()
}

pub fn load_usage_summary(conn: &Connection, project_id: Option<&str>) -> Result<UsageSummary, String> {
  let filter = project_id.map(|_| " WHERE project_id = ?1").unwrap_or("");
  let sql = format!(
    "SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(estimated_cost),0), COALESCE(SUM(actual_cost),0), COALESCE(SUM(latency_ms),0) FROM usage_logs{}",
    filter
  );
  if let Some(project_id) = project_id {
    conn.query_row(&sql, params![project_id], |row| {
      Ok(UsageSummary {
        total_input_tokens: row.get(0)?,
        total_output_tokens: row.get(1)?,
        total_estimated_cost: row.get(2)?,
        total_actual_cost: row.get(3)?,
        total_latency_ms: row.get(4)?,
      })
    }).map_err(|err| err.to_string())
  } else {
    conn.query_row(&sql, [], |row| {
      Ok(UsageSummary {
        total_input_tokens: row.get(0)?,
        total_output_tokens: row.get(1)?,
        total_estimated_cost: row.get(2)?,
        total_actual_cost: row.get(3)?,
        total_latency_ms: row.get(4)?,
      })
    }).map_err(|err| err.to_string())
  }
}

pub fn load_monthly_usage_summary(conn: &Connection) -> Result<UsageSummary, String> {
  let month_prefix = chrono::Utc::now().format("%Y-%m").to_string();
  conn.query_row(
    r#"
    SELECT COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(estimated_cost),0), COALESCE(SUM(actual_cost),0), COALESCE(SUM(latency_ms),0)
    FROM usage_logs
    WHERE created_at LIKE ?1 || '%'
    "#,
    params![month_prefix],
    |row| {
      Ok(UsageSummary {
        total_input_tokens: row.get(0)?,
        total_output_tokens: row.get(1)?,
        total_estimated_cost: row.get(2)?,
        total_actual_cost: row.get(3)?,
        total_latency_ms: row.get(4)?,
      })
    },
  )
  .map_err(|err| err.to_string())
}

pub fn insert_project(conn: &Connection, name: &str) -> Result<Project, String> {
  let now = now_string();
  let id = Uuid::new_v4().to_string();
  conn.execute(
    "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
    params![id, name, now, now],
  )
  .map_err(|err| err.to_string())?;
  Ok(Project { id, name: name.into(), created_at: now.clone(), updated_at: now })
}

pub fn update_project_name(conn: &Connection, project_id: &str, name: &str) -> Result<(), String> {
  conn.execute(
    "UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1",
    params![project_id, name, now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn delete_project(conn: &Connection, project_id: &str) -> Result<(), String> {
  let conversations = load_conversations(conn, project_id)?;
  for conversation in conversations {
    conn.execute(
      "DELETE FROM messages WHERE conversation_id = ?1",
      params![conversation.id],
    ).map_err(|err| err.to_string())?;
    conn.execute(
      "DELETE FROM usage_logs WHERE conversation_id = ?1",
      params![conversation.id],
    ).map_err(|err| err.to_string())?;
  }
  conn.execute(
    "DELETE FROM conversations WHERE project_id = ?1",
    params![project_id],
  ).map_err(|err| err.to_string())?;
  conn.execute(
    "DELETE FROM projects WHERE id = ?1",
    params![project_id],
  ).map_err(|err| err.to_string())?;
  Ok(())
}

pub fn insert_conversation(conn: &Connection, project_id: &str, title: &str, mode: Mode) -> Result<Conversation, String> {
  let now = now_string();
  let id = Uuid::new_v4().to_string();
  conn.execute(
    "INSERT INTO conversations (id, project_id, title, mode, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    params![id, project_id, title, mode_to_string(&mode), now, now],
  )
  .map_err(|err| err.to_string())?;
  Ok(Conversation { id, project_id: project_id.into(), title: title.into(), mode, created_at: now.clone(), updated_at: now })
}

pub fn delete_conversation(conn: &Connection, conversation_id: &str) -> Result<(), String> {
  conn.execute(
    "DELETE FROM messages WHERE conversation_id = ?1",
    params![conversation_id],
  ).map_err(|err| err.to_string())?;
  conn.execute(
    "DELETE FROM usage_logs WHERE conversation_id = ?1",
    params![conversation_id],
  ).map_err(|err| err.to_string())?;
  conn.execute(
    "DELETE FROM conversations WHERE id = ?1",
    params![conversation_id],
  ).map_err(|err| err.to_string())?;
  Ok(())
}

pub fn insert_message(conn: &Connection, message: &Message) -> Result<(), String> {
  conn.execute(
    r#"
    INSERT INTO messages (
      id, conversation_id, role, content, model, model_display_name,
      input_tokens, output_tokens, estimated_cost, actual_cost, latency_ms, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
    "#,
    params![
      message.id,
      message.conversation_id,
      role_to_string(&message.role),
      message.content,
      message.model,
      message.model_display_name,
      message.input_tokens,
      message.output_tokens,
      message.estimated_cost,
      message.actual_cost,
      message.latency_ms,
      message.created_at,
    ],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn insert_usage_log(conn: &Connection, usage: &UsageLog) -> Result<(), String> {
  let id = Uuid::new_v4().to_string();
  conn.execute(
    r#"
    INSERT INTO usage_logs (
      id, project_id, conversation_id, model, mode, input_tokens, output_tokens,
      estimated_cost, actual_cost, latency_ms, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    "#,
    params![
      id,
      usage.project_id,
      usage.conversation_id,
      usage.model,
      mode_to_string(&usage.mode),
      usage.input_tokens,
      usage.output_tokens,
      usage.estimated_cost,
      usage.actual_cost,
      usage.latency_ms,
      usage.created_at,
    ],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn update_conversation_touch(conn: &Connection, conversation_id: &str) -> Result<(), String> {
  conn.execute(
    "UPDATE conversations SET updated_at = ?2 WHERE id = ?1",
    params![conversation_id, now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn update_conversation_mode(conn: &Connection, conversation_id: &str, mode: Mode) -> Result<(), String> {
  conn.execute(
    "UPDATE conversations SET mode = ?2, updated_at = ?3 WHERE id = ?1",
    params![conversation_id, mode_to_string(&mode), now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn update_conversation_title(conn: &Connection, conversation_id: &str, title: &str) -> Result<(), String> {
  conn.execute(
    "UPDATE conversations SET title = ?2, updated_at = ?3 WHERE id = ?1",
    params![conversation_id, title, now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn set_active_project(conn: &Connection, project_id: Option<String>) -> Result<(), String> {
  conn.execute(
    "UPDATE app_settings SET active_project_id = ?1, updated_at = ?2 WHERE id = 'app'",
    params![project_id, now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}

pub fn set_active_conversation(conn: &Connection, conversation_id: Option<String>) -> Result<(), String> {
  conn.execute(
    "UPDATE app_settings SET active_conversation_id = ?1, updated_at = ?2 WHERE id = 'app'",
    params![conversation_id, now_string()],
  )
  .map_err(|err| err.to_string())?;
  Ok(())
}
