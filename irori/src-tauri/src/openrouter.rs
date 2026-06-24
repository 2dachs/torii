use chrono::Utc;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessagePayload {
  pub role: String,
  pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenRouterResponse {
  pub reply: String,
  pub input_tokens: i64,
  pub output_tokens: i64,
  pub total_tokens: i64,
  pub latency_ms: i64,
}

pub async fn send_chat(
  api_key: &str,
  model_slug: &str,
  messages: Vec<ChatMessagePayload>,
  max_tokens: i64,
) -> Result<OpenRouterResponse, String> {
  let started_at = Utc::now();
  let client = reqwest::Client::new();
  let response = client
    .post("https://openrouter.ai/api/v1/chat/completions")
    .header(AUTHORIZATION, format!("Bearer {}", api_key))
    .header(CONTENT_TYPE, "application/json")
    .header("HTTP-Referer", "https://irori.local")
    .header("X-Title", "Irori")
    .json(&serde_json::json!({
      "model": model_slug,
      "messages": messages,
      "max_tokens": max_tokens,
    }))
    .send()
    .await
    .map_err(|err| err.to_string())?;

  let status = response.status();
  let body_text = response.text().await.map_err(|err| err.to_string())?;
  if !status.is_success() {
    let body_value: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_else(|_| serde_json::json!({}));
    let message = body_value
      .get("error")
      .and_then(|value| value.get("message"))
      .and_then(|value| value.as_str())
      .or_else(|| body_value.get("message").and_then(|value| value.as_str()))
      .unwrap_or_else(|| body_text.trim());
    return Err(format!("OpenRouter API error ({}): {}", status, message));
  }

  let body: serde_json::Value = serde_json::from_str(&body_text)
    .map_err(|err| format!("OpenRouter response parse error: {}", err))?;

  let reply = body["choices"][0]["message"]["content"]
    .as_str()
    .unwrap_or("(No response)")
    .to_string();
  let input_tokens = body["usage"]["prompt_tokens"].as_i64().unwrap_or(0);
  let output_tokens = body["usage"]["completion_tokens"].as_i64().unwrap_or(0);
  let total_tokens = body["usage"]["total_tokens"].as_i64().unwrap_or(input_tokens + output_tokens);
  let latency_ms = (Utc::now() - started_at).num_milliseconds();

  Ok(OpenRouterResponse {
    reply,
    input_tokens,
    output_tokens,
    total_tokens,
    latency_ms,
  })
}
